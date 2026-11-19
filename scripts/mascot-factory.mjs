#!/usr/bin/env node
/**
 * Mascot Factory: fail-closed ComfyUI runner.
 *
 * Security contract:
 * - No credential is ever accepted from CLI flags, files or the repository; the
 *   only sources are COMFY_API_TOKEN (bearer) or CF_ACCESS_CLIENT_ID +
 *   CF_ACCESS_CLIENT_SECRET (Cloudflare Access service token) in the caller's
 *   environment.
 * - Non-loopback transport must be HTTPS and must carry a credential; plain
 *   HTTP to a remote host is refused before any request is made, so this runner
 *   cannot be pointed at an exposed unauthenticated ComfyUI.
 * - Credentials are never written to provenance, logs or artifacts.
 * - Every render is bounded: a per-window render budget is consumed before the
 *   prompt is submitted, and only GET requests are retried, so a transient
 *   error can never duplicate a billable render.
 * Node 24+.
 */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';

export const PROFILES = Object.freeze({
  zar: {
    name: 'Żar',
    prompt: `IMAGE 1 is the AUTHORITATIVE identity reference of Żar, a friendly orange fox mascot. IMAGE 2 is Szlif, used ONLY for matching the shared graphic style. Preserve fox species, dark brown ear tips, cream inner ears and broad cream muzzle, black oval eyes with one tiny white catchlight each, brown nose, joyful smile, orange forehead tuft, white oval belly, brown paws and feet, large curling orange tail with cream tip, original red neckerchief with white diagonal stripes and brown slide. Connected raised waving arm and lowered arm, two legs, no extra digits or floating limbs. Improve the craftsmanship through smooth precisely designed vector-like curves, more elegant spacing and refined warm flat color regions. Preserve every recognizable identity feature and overall original brand proportions. Single full-body character on transparent background, 8 percent safe margin, 1:1, matte 2D illustration, sharp anti-aliased silhouette, no text, props, outlines, realism, 3D, extra characters or cropping.`,
  },
  szlif: {
    name: 'Szlif',
    prompt: `IMAGE 1 is the AUTHORITATIVE identity reference of Szlif, a charming navy-blue raven/bird mascot. IMAGE 2 is Żar, used ONLY to match the shared graphic style. Preserve species, rounded navy head and body, big black oval eyes each with one tiny white catchlight, compact two-part blue gray beak and subtle friendly smile, layered powder-blue chest and wing markings, pale blue bird feet and dark navy tail, oversized olive-brown peaked cap with red band and a white circular fastener. Connected symmetric wings, two legs, separated bird toes, exact original hat design. Improve curves, spacing, appealing balanced silhouette, restrained matte tonal separation and subtle professional illustration polish without changing any brand-identifying features. Single full-body character on transparent background, 8 percent safe margin, 1:1, crisp vector-like 2D art, no fox ears/scarf/tail, no text, realism, 3D, glossy shading, cropping or added characters.`,
  },
});

/** Statuses an artifact directory may legitimately hold before human brand QA. */
export const PENDING_STATUSES = Object.freeze(['AWAITING_HUMAN_BRAND_QA']);

export const sha256 = data => createHash('sha256').update(data).digest('hex');
function assert(ok, message) { if (!ok) throw new Error(message); }
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));

/**
 * Standard CRC-32 (ISO 3309 / ITU-T V.42, polynomial 0xEDB88320) used by every PNG chunk.
 * Known-answer test in the unit suite anchors it to the spec instead of trusting this table.
 */
const CRC32_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = Buffer.from([137,80,78,71,13,10,26,10]);

/** Verify the PNG container (framing, CRC-32, IHDR) before any pixel is decoded. */
function parsePngContainer(png) {
  assert(Buffer.isBuffer(png) && png.length > 8 && png.subarray(0,8).equals(PNG_SIGNATURE), 'NOT_PNG');
  let pos=8, width=0, height=0, depth=-1, color=-1, interlace=-1, compression=-1, filterMethod=-1;
  const blocks=[]; let idatBytes=0, sawIhdr=false, sawIend=false, index=0;
  while(pos+12 <= png.length) {
    const len=png.readUInt32BE(pos); const type=png.toString('latin1',pos+4,pos+8);
    assert(/^[A-Za-z]{4}$/.test(type), 'MALFORMED_PNG_CHUNK_TYPE');
    assert(len <= 0x7fffffff && pos+12+len<=png.length, 'MALFORMED_PNG_CHUNK');
    const end=pos+12+len;
    const data=png.subarray(pos+8,pos+8+len);
    // Every chunk carries CRC-32 over its type + data; a mismatch means the file is corrupted or forged.
    const stored=png.readUInt32BE(pos+8+len);
    assert(stored===crc32(png.subarray(pos+4,pos+8+len)), `PNG_CHUNK_CRC_MISMATCH:${type}`);
    if(index===0) assert(type==='IHDR', 'PNG_IHDR_NOT_FIRST');
    if(type==='IHDR') {
      assert(!sawIhdr && len===13, 'INVALID_IHDR');
      sawIhdr=true;
      width=data.readUInt32BE(0); height=data.readUInt32BE(4);
      depth=data[8]; color=data[9]; compression=data[10]; filterMethod=data[11]; interlace=data[12];
    }
    if(type==='IDAT') {idatBytes+=len; blocks.push(data);}
    if(type==='IEND') {assert(len===0,'PNG_IEND_NOT_EMPTY'); sawIend=true; assert(end===png.length,'PNG_TRAILING_DATA'); break;}
    pos=end; index++;
  }
  assert(sawIhdr, 'PNG_MISSING_IHDR');
  assert(sawIend, 'PNG_MISSING_IEND');
  assert(idatBytes>0, 'PNG_MISSING_IDAT');
  return {width,height,depth,color,interlace,compression,filterMethod,blocks};
}

/** Inflate and defilter the scanlines of an 8-bit RGB or RGBA PNG. */
function decodePngPixels({width,height,color,blocks}) {
  const bpp=color===6?4:3, rowBytes=width*bpp, expected=(rowBytes+1)*height;
  let pixels;
  try { pixels=inflateSync(Buffer.concat(blocks),{maxOutputLength:expected+1}); }
  catch { throw new Error('PNG_IDAT_INFLATE_FAILED'); }
  assert(pixels.length===expected, 'PNG_DECOMPRESSED_LENGTH_INVALID');
  const out=Buffer.allocUnsafe(rowBytes*height);
  let old=Buffer.alloc(rowBytes), at=0, o=0;
  for(let y=0;y<height;y++){
    const filter=pixels[at++];assert(filter<=4,'PNG_UNSUPPORTED_FILTER');
    const row=Buffer.allocUnsafe(rowBytes);
    for(let x=0;x<rowBytes;x++){
      const val=pixels[at++], left=x>=bpp?row[x-bpp]:0, up=old[x], ul=x>=bpp?old[x-bpp]:0;
      let pred=0;
      if(filter===1)pred=left;
      if(filter===2)pred=up;
      if(filter===3)pred=Math.floor((left+up)/2);
      if(filter===4){const p=left+up-ul; const a=Math.abs(p-left),b=Math.abs(p-up),c=Math.abs(p-ul);pred=a<=b&&a<=c?left:b<=c?up:ul;}
      row[x]=(val+pred)&255;
    }
    row.copy(out,o); o+=rowBytes; old=row;
  }
  return out;
}

function pngChunk(type,data) {
  const b=Buffer.alloc(12+data.length);
  b.writeUInt32BE(data.length,0); b.write(type,4,'latin1'); data.copy(b,8);
  b.writeUInt32BE(crc32(b.subarray(4,8+data.length)),8+data.length);
  return b;
}

/** Encode 8-bit RGBA pixels as a non-interlaced PNG (filter 0, deterministic deflate). */
export function encodeRgbaPng(width,height,rgba) {
  assert(rgba.length===width*height*4,'RGBA_BUFFER_LENGTH_MISMATCH');
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(width,0); ihdr.writeUInt32BE(height,4); ihdr[8]=8; ihdr[9]=6;
  const stride=1+width*4, raw=Buffer.allocUnsafe(height*stride);
  for(let y=0;y<height;y++){ raw[y*stride]=0; rgba.copy(raw,y*stride+1,y*width*4,(y+1)*width*4); }
  return Buffer.concat([PNG_SIGNATURE,pngChunk('IHDR',ihdr),pngChunk('IDAT',deflateSync(raw)),pngChunk('IEND',Buffer.alloc(0))]);
}

/**
 * Parse and defilter a PNG to evaluate actual transparency and clipping. The
 * Codex backend returns a flat RGB render (a ComfyUI IMAGE tensor has three
 * channels), so raw renders are validated with `requireAlpha: false` and the
 * RGBA contract is enforced on the alpha-exported artifact instead.
 */
export function validatePng(png, { minSize = 512, marginRatio = 0.02, requireAlpha = true } = {}) {
  const parsed=parsePngContainer(png);
  const {width,height,depth,color,interlace,compression,filterMethod}=parsed;
  assert(width>=minSize && height>=minSize && width<=4096 && height<=4096, 'PNG_DIMENSIONS_OR_DATA_INVALID');
  assert(depth===8 && (color===6 || (!requireAlpha && color===2)) && interlace===0 && compression===0 && filterMethod===0,
    requireAlpha?'PNG_MUST_BE_NONINTERLACED_RGBA8':'PNG_MUST_BE_NONINTERLACED_8BIT_RGB_OR_RGBA');
  const px=decodePngPixels(parsed);
  if(color===2) return {width,height,mode:'RGB8',alpha:'ABSENT',sha256:sha256(png),crc_check:'PASS',structural_check:'PASS',brand_review:'PENDING_MANUAL'};
  let count=0, minX=width,minY=height,maxX=-1,maxY=-1, opaqueCorners=0;
  for(let y=0;y<height;y++) for(let x=0;x<width;x++){
    if(px[(y*width+x)*4+3]>8){count++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      if((x===0||x===width-1)&&(y===0||y===height-1))opaqueCorners++;}
  }
  assert(count > width*height*0.02 && count < width*height*0.85,'PNG_EMPTY_OR_OPAQUE_BACKGROUND');
  const margin=Math.max(8,Math.floor(Math.min(width,height)*marginRatio));
  assert(minX>=margin && minY>=margin && maxX<width-margin && maxY<height-margin,'MASCOT_TOUCHES_CANVAS_EDGE');
  assert(opaqueCorners===0,'PNG_NONTRANSPARENT_CORNERS');
  return {width,height,mode:'RGBA8',coverage:Number((count/(width*height)).toFixed(4)),bbox:[minX,minY,maxX,maxY],sha256:sha256(png),crc_check:'PASS',structural_check:'PASS',brand_review:'PENDING_MANUAL'};
}

export const ALPHA_EXPORT = Object.freeze({ method:'corner-flood-fill-v3', tolerance:28, feather:24 });

/**
 * The prompt asks the model for an 8% safe margin, but the Codex backend
 * routinely returns the subject 1–2% from the border. A cropped character
 * still reaches the very edge and is rejected; a tight-but-intact one is a
 * valid artifact, so the published file only requires 1% of breathing room.
 */
export const ARTIFACT_MARGIN_RATIO = 0.08;

/** Deterministic median of the border pixels; the canvas edge is background by contract. */
function borderMedianColor(rgb,width,height) {
  const samples=[];
  const add=(x,y)=>{const i=(y*width+x)*3;samples.push([rgb[i],rgb[i+1],rgb[i+2]]);};
  for(let x=0;x<width;x++){add(x,0);add(x,height-1);}
  for(let y=0;y<height;y++){add(0,y);add(width-1,y);}
  const channel=c=>{const v=samples.map(p=>p[c]).sort((a,b)=>a-b);return v[v.length>>1];};
  return [channel(0),channel(1),channel(2)];
}

/**
 * Recover transparency outside ComfyUI: flood-fill the background connected to
 * the canvas edge, then feather the silhouette so anti-aliased edge pixels keep
 * partial alpha. Pure and deterministic, so the verifier recomputes the exact
 * same bytes from `render.png` instead of trusting the runner.
 *
 * shortcut: only edge-connected background becomes transparent; enclosed holes
 * keep their colour until a real matting model is available.
 */
export function exportAlphaPng(png, { tolerance = ALPHA_EXPORT.tolerance, feather = ALPHA_EXPORT.feather, method = ALPHA_EXPORT.method } = {}) {
  assert(['corner-flood-fill-v2','corner-flood-fill-v3'].includes(method), 'ALPHA_EXPORT_UNSUPPORTED_METHOD');
  const parsed=parsePngContainer(png);
  const {width,height,depth,color,interlace,compression,filterMethod}=parsed;
  assert(depth===8 && (color===2||color===6) && interlace===0 && compression===0 && filterMethod===0,'ALPHA_EXPORT_UNSUPPORTED_COLOR_TYPE');
  if(color===6) return {png,passthrough:true,width,height};
  const rgb=decodePngPixels(parsed);
  const background=borderMedianColor(rgb,width,height);
  const distance=(x,y)=>{const i=(y*width+x)*3;return Math.max(Math.abs(rgb[i]-background[0]),Math.abs(rgb[i+1]-background[1]),Math.abs(rgb[i+2]-background[2]));};
  const visited=new Uint8Array(width*height);
  const queue=new Int32Array(width*height);
  let head=0, tail=0;
  const seed=(x,y)=>{const p=y*width+x; if(!visited[p] && distance(x,y)<=tolerance){visited[p]=1;queue[tail++]=p;}};
  for(let x=0;x<width;x++){seed(x,0);seed(x,height-1);}
  for(let y=0;y<height;y++){seed(0,y);seed(width-1,y);}
  while(head<tail){
    const p=queue[head++], x=p%width, y=(p-x)/width;
    if(x>0)seed(x-1,y); if(x+1<width)seed(x+1,y); if(y>0)seed(x,y-1); if(y+1<height)seed(x,y+1);
  }
  // The backend occasionally emits a few stray pixels on the canvas border
  // (observed as pure-blue flecks on the last row of every Szlif render). Drop
  // edge-touching blobs smaller than 0.2% of the canvas so debris cannot
  // masquerade as a crop; a real crop is far larger and still fails the gate.
  const debris=new Uint8Array(width*height), seen=new Uint8Array(width*height), blob=new Int32Array(width*height);
  const debrisLimit=Math.max(64,Math.floor(width*height*0.002));
  const isBackground=p=>visited[p]===1||debris[p]===1;
  for(let start=0;start<width*height;start++){
    if(isBackground(start)||seen[start])continue;
    let head2=0, tail2=0; seen[start]=1; blob[tail2++]=start; let touches=false;
    while(head2<tail2){
      const p=blob[head2++], x=p%width, y=(p-x)/width;
      if(x===0||y===0||x===width-1||y===height-1)touches=true;
      if(x>0&&!isBackground(p-1)&&!seen[p-1]){seen[p-1]=1;blob[tail2++]=p-1;}
      if(x+1<width&&!isBackground(p+1)&&!seen[p+1]){seen[p+1]=1;blob[tail2++]=p+1;}
      if(y>0&&!isBackground(p-width)&&!seen[p-width]){seen[p-width]=1;blob[tail2++]=p-width;}
      if(y+1<height&&!isBackground(p+width)&&!seen[p+width]){seen[p+width]=1;blob[tail2++]=p+width;}
    }
    if(touches && tail2<debrisLimit) for(let i=0;i<tail2;i++) debris[blob[i]]=1;
  }
  const rgba=Buffer.allocUnsafe(width*height*4);
  for(let p=0;p<width*height;p++){
    const i=p*3, o=p*4;
    rgba[o]=rgb[i];rgba[o+1]=rgb[i+1];rgba[o+2]=rgb[i+2];
    if(isBackground(p)){rgba[o+3]=0;continue;}
    const x=p%width, y=(p-x)/width;
    const onEdge=(x>0&&isBackground(p-1))||(x+1<width&&isBackground(p+1))||(y>0&&isBackground(p-width))||(y+1<height&&isBackground(p+width));
    if(!onEdge){rgba[o+3]=255;continue;}
    const d=distance(x,y);
    rgba[o+3]=Math.max(0,Math.min(255,Math.round(255*(d-tolerance)/feather)));
  }
  const fixed=method==='corner-flood-fill-v3'?cleanAlphaAndReframe(rgba,width,height):{rgba,removedPixels:0,reframed:false};
  return {png:encodeRgbaPng(width,height,fixed.rgba),passthrough:false,width,height,background,removed_pixels:fixed.removedPixels,reframed:fixed.reframed};
}


/**
 * Keep the principal contiguous mascot, reject genuinely disconnected anatomy,
 * and normalize undersized safety margins. The previous RGB render stays intact
 * as the forensic source. No model inference or extra charged render is needed.
 * Connectivity is 8-way: diagonal anti-aliased joins must not split the shape.
 */
function cleanAlphaAndReframe(rgba, width, height) {
  const total=width*height, labels=new Int32Array(total), queue=new Int32Array(total);
  const sizes=[0];
  let largest=0, largestSize=0;
  for(let start=0;start<total;start++){
    if(labels[start] || rgba[start*4+3]<=8) continue;
    const id=sizes.length; let head=0,tail=0;labels[start]=id;queue[tail++]=start;
    while(head<tail) {
      const p=queue[head++],x=p%width,y=(p-x)/width;
      for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;
        const nx=x+dx,ny=y+dy;
        if(nx<0||nx>=width||ny<0||ny>=height)continue;
        const q=ny*width+nx;
        if(!labels[q] && rgba[q*4+3]>8){labels[q]=id;queue[tail++]=q;}
      }
    }
    sizes.push(tail);
    if(tail>largestSize){largest=id;largestSize=tail;}
  }
  assert(largestSize>total*0.02,'PNG_EMPTY_OR_OPAQUE_BACKGROUND');
  const significant=largestSize*0.005;
  for(let id=1;id<sizes.length;id++) if(id!==largest) {
    assert(sizes[id]<=significant,'MASCOT_DISCONNECTED_SILHOUETTE');
  }
  let removedPixels=0,minX=width,minY=height,maxX=-1,maxY=-1;
  for(let p=0;p<total;p++){
    const i=p*4;
    if(labels[p]!==largest){if(rgba[i+3]>8)removedPixels++;rgba[i+3]=0;continue;}
    const x=p%width,y=(p-x)/width;
    minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
  }
  // Never hide a truly clipped body by shrinking it into the safe area.
  const physicalMargin=Math.max(2,Math.floor(Math.min(width,height)*0.01));
  assert(minX>=physicalMargin && minY>=physicalMargin &&
    maxX<width-physicalMargin && maxY<height-physicalMargin,'MASCOT_TOUCHES_CANVAS_EDGE');

  // A narrow 1px antialiasing transition; the old exporter created nearly
  // binary alpha even where the raw RGB illustration contains softened edges.
  for(let y=minY;y<=maxY;y++) for(let x=minX;x<=maxX;x++) {
    const p=y*width+x,o=p*4;
    if(labels[p]!==largest||rgba[o+3]<=8)continue;
    let neighbours=0;
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;
      const nx=x+dx,ny=y+dy;
      if(nx>=0&&nx<width&&ny>=0&&ny<height&&labels[ny*width+nx]===largest) neighbours++;
    }
    if(neighbours<8) rgba[o+3]=Math.min(rgba[o+3],Math.round(255*(0.56+0.44*neighbours/8)));
  }

  const target=Math.ceil(Math.min(width,height)*ARTIFACT_MARGIN_RATIO)+2;
  if(minX>=target&&minY>=target&&maxX<width-target&&maxY<height-target)
    return {rgba,removedPixels,reframed:false};
  const bw=maxX-minX+1,bh=maxY-minY+1;
  const scale=Math.min(1,(width-2*target)/bw,(height-2*target)/bh);
  assert(scale>0.05,'MASCOT_CANNOT_REFRAME');
  const centerX=(minX+maxX)/2,centerY=(minY+maxY)/2;
  const dstCenterX=(width-1)/2,dstCenterY=(height-1)/2;
  const out=Buffer.alloc(total*4);
  // Bilinear resample of PREMULTIPLIED color to prevent RGB background halos
  // from bleeding across translucent edges when placed on dark UI surfaces.
  for(let y=0;y<height;y++){
    const sy=(y-dstCenterY)/scale+centerY,iy=Math.floor(sy),fy=sy-iy;
    if(sy<minY-1||sy>maxY+1)continue;
    for(let x=0;x<width;x++){
      const sx=(x-dstCenterX)/scale+centerX,ix=Math.floor(sx),fx=sx-ix;
      if(sx<minX-1||sx>maxX+1)continue;
      let aa=0,rr=0,gg=0,bb=0;
      for(let ky=0;ky<=1;ky++)for(let kx=0;kx<=1;kx++){
        const nx=ix+kx,ny=iy+ky;
        if(nx<0||nx>=width||ny<0||ny>=height)continue;
        const weight=(ky?fy:1-fy)*(kx?fx:1-fx);
        const i=(ny*width+nx)*4,a=rgba[i+3]/255*weight;
        aa+=a;rr+=rgba[i]*a;gg+=rgba[i+1]*a;bb+=rgba[i+2]*a;
      }
      const o=(y*width+x)*4;
      if(aa>0){out[o]=Math.round(rr/aa);out[o+1]=Math.round(gg/aa);out[o+2]=Math.round(bb/aa);out[o+3]=Math.round(aa*255);}
    }
  }
  return {rgba:out,removedPixels,reframed:true};
}

function buildLegacyGraph({profile, identityImage, styleImage, codexHome=''}) {
  assert(Object.hasOwn(PROFILES, profile), 'UNKNOWN_PROFILE');
  const n=(class_type,inputs,title)=>({class_type,inputs,_meta:{title}});
  return {
    '1':n('LoadImage',{image:identityImage},'LOCKED identity reference'),
    '2':n('LoadImage',{image:styleImage},'Secondary style-only reference'),
    '3':n('ArkCodexImageGen',{prompt:PROFILES[profile].prompt,image_1:['1',0],image_2:['2',0],aspect_ratio:'1:1',quality:'high',background:'transparent',codex_home:codexHome,allow_refresh:true,timeout_seconds:300,force_rerun:false,run_mode:'one at a time',max_concurrent:1,on_failure:'fail the run',speed:'standard'},'Reference-locked generation (authorization required)'),
    '4':n('SaveImage',{images:['3',0],filename_prefix:`mascot_factory/pending/${profile}`},'Save for QC; NOT published'),
  };
}


export const ACTIVE_BACKEND_NODE = 'CodexExecImageGen';
export const BATCH_NODE = 'ImageBatch';
export const LEGACY_BACKEND_NODE = 'ArkCodexImageGen';
export const SCALER_NODE = 'ImageScale';

/** The historical graph may be reconstructed ONLY when verifying old artifacts.
 * New inference uses the installed CodexExecImageGen schema.
 */
export function buildGraph({profile, identityImage, styleImage, codexHome='', backend=ACTIVE_BACKEND_NODE}) {
  assert(Object.hasOwn(PROFILES,profile),'UNKNOWN_PROFILE');
  if(backend===LEGACY_BACKEND_NODE)
    return buildLegacyGraph({profile,identityImage,styleImage,codexHome});
  assert(backend===ACTIVE_BACKEND_NODE,'UNSUPPORTED_IMAGE_BACKEND');
  const n=(class_type,inputs,title)=>({class_type,inputs,_meta:{title}});
  return {
    '1':n('LoadImage',{image:identityImage},'LOCKED identity reference'),
    '2':n('LoadImage',{image:styleImage},'Secondary style-only reference'),
    '3':n(SCALER_NODE,{image:['1',0],upscale_method:'lanczos',width:1024,height:1024,crop:'disabled'},'Reference normalization'),
    '4':n(SCALER_NODE,{image:['2',0],upscale_method:'lanczos',width:1024,height:1024,crop:'disabled'},'Style normalization'),
    '5':n(BATCH_NODE,{image1:['3',0],image2:['4',0]},'Two pinned source images'),
    '6':n(ACTIVE_BACKEND_NODE,{concurrency_count:'1',prompt:PROFILES[profile].prompt,images:['5',0],aspect_ratio:'1:1',model:'gpt-6-luna',reasoning_effort:'medium',json_output:true,auto_save_to_output:false,skip_git_repo_check:true,ephemeral:true},'Codex image generator; independent authorization required'),
    '7':n(SCALER_NODE,{image:['6',0],upscale_method:'lanczos',width:1254,height:1254,crop:'disabled'},'Acceptance canvas 1254px'),
    '8':n('SaveImage',{images:['7',0],filename_prefix:'mascot_factory/pending/'+profile},'Save for QA; NOT published'),
  };
}

/**
 * Canonical workflow hash, recomputed by the independent verifier. The account
 * binding (codex_home) is excluded so the hash covers the identity-defining
 * graph only and its value never has to be stored in provenance.
 */
export function canonicalGraphForHash(graph) {
  const clone=JSON.parse(JSON.stringify(graph));
  for(const node of Object.values(clone)) if(node?.inputs && 'codex_home' in node.inputs) node.inputs.codex_home='';
  return clone;
}
export function graphSha256(graph) { return sha256(Buffer.from(JSON.stringify(canonicalGraphForHash(graph)))); }

const LOOPBACK_HOSTS = new Set(['127.0.0.1','::1','[::1]','localhost','localhost.']);
export function isLoopbackHost(hostname) { return LOOPBACK_HOSTS.has(String(hostname).toLowerCase()); }

/**
 * Decide whether this process may talk to a ComfyUI endpoint and with which
 * credential. Fails closed before any network call.
 */
export function resolveTransport({url, env=process.env}) {
  let base;
  try { base=new URL(url); } catch { throw new Error('INVALID_COMFY_URL'); }
  assert(['http:','https:'].includes(base.protocol),'INVALID_COMFY_URL');
  assert(!base.username && !base.password,'URL_CREDENTIALS_NOT_ALLOWED');
  const loopback=isLoopbackHost(base.hostname);
  const bearer=env?.COMFY_API_TOKEN;
  const clientId=env?.CF_ACCESS_CLIENT_ID, clientSecret=env?.CF_ACCESS_CLIENT_SECRET;
  assert(!(bearer && (clientId || clientSecret)),'AMBIGUOUS_REMOTE_CREDENTIALS');
  assert(!(clientId || clientSecret) || (clientId && clientSecret),'INCOMPLETE_SERVICE_TOKEN');
  const headers={};
  if (bearer) headers.authorization=`Bearer ${bearer}`;
  else if (clientId) { headers['CF-Access-Client-Id']=clientId; headers['CF-Access-Client-Secret']=clientSecret; }
  const authenticated=Object.keys(headers).length>0;
  if (!loopback) {
    assert(base.protocol==='https:','INSECURE_REMOTE_TRANSPORT');
    assert(authenticated,'MISSING_REMOTE_CREDENTIAL');
  }
  const scheme=bearer?'bearer':clientId?'service-token':'none';
  return {base,headers,authenticated,loopback,scheme};
}

/** Public description of the transport for provenance; never carries secrets. */
export function describeTransport(transport) {
  return {scheme:transport.scheme, loopback:transport.loopback, host:transport.base.host, protocol:transport.base.protocol, authenticated:transport.authenticated};
}

function urlFor(base,path) { const baseUrl=new URL(base); assert(['http:','https:'].includes(baseUrl.protocol),'INVALID_COMFY_URL'); const url=new URL(path,baseUrl);assert(url.origin===baseUrl.origin,'CROSS_ORIGIN_URL_DENIED');return url; }

const RETRYABLE_STATUS = new Set([429,502,503,504]);
const RETRYABLE_ERRORS = new Set(['TypeError','TimeoutError','AbortError','FetchError','ECONNREFUSED','ECONNRESET']);

/**
 * Bounded HTTP client. GET is retried with backoff (safe, idempotent); a POST
 * such as /prompt is attempted exactly once so a retry can never queue a second
 * billable render.
 */
export function createApi(base, {env=process.env, retries=2, timeoutMs=30_000, baseDelayMs=150}={}) {
  const transport=resolveTransport({url:base,env});
  const call=async (path, options={}) => {
    const method=(options.method??'GET').toUpperCase();
    const attempts=method==='GET'?Math.max(1,retries+1):1;
    let lastError;
    for(let attempt=0;attempt<attempts;attempt++){
      try{
        const response=await fetch(urlFor(transport.base,path),{...options,method,headers:{...transport.headers,...(options.headers??{})},signal:AbortSignal.timeout(timeoutMs)});
        if(RETRYABLE_STATUS.has(response.status)) {
          if(attempt+1<attempts) { lastError=new Error(`COMFY_HTTP_${response.status} ${path}`); await delay(baseDelayMs*2**attempt); continue; }
          throw new Error(`COMFY_HTTP_${response.status} ${path}`);
        }
        assert(response.ok,`COMFY_HTTP_${response.status} ${path}`);
        return response;
      }catch(err){
        const retryable=RETRYABLE_ERRORS.has(err?.name)||err?.code==='ECONNREFUSED'||err?.code==='ECONNRESET';
        if(!retryable || attempt+1>=attempts) throw err;
        lastError=err; await delay(baseDelayMs*2**attempt);
      }
    }
    throw lastError ?? new Error('COMFY_REQUEST_FAILED');
  };
  return {transport, call};
}

export async function request(base, path, options={}) { return createApi(base).call(path, options); }

export async function uploadReference(api, filepath) {
  const call=typeof api==='function'?api:api.call;
  const buf=await readFile(filepath); assert(buf.length<10_000_000,'REFERENCE_FILE_TOO_LARGE');
  assert(buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'INPUT_NOT_PNG');
  const form=new FormData(); const name=`mascot_${sha256(buf).slice(0,24)}_${randomUUID().slice(0,8)}.png`;
  form.set('image',new Blob([buf],{type:'image/png'}),name);form.set('type','input');form.set('overwrite','false');
  const uploaded=await(await call('/upload/image',{method:'POST',body:form})).json();
  assert(uploaded.name===name,'COMFY_UPLOAD_NAME_MISMATCH');
  return {name,sha256:sha256(buf),size:buf.length};
}

/**
 * Consume one unit of the render budget for the current UTC day. The ledger is
 * written before the prompt is submitted and is fail-closed: an unreadable or
 * corrupt ledger blocks the run instead of resetting the counter.
 */
export async function consumeRenderBudget({ledgerPath, maxRenders=4, now=new Date()}) {
  assert(Number.isInteger(maxRenders)&&maxRenders>0,'INVALID_RENDER_BUDGET');
  assert(typeof ledgerPath==='string'&&ledgerPath.length>0,'BUDGET_LEDGER_REQUIRED');
  const window=now.toISOString().slice(0,10);
  let count=0;
  try {
    const parsed=JSON.parse(await readFile(ledgerPath,'utf8'));
    if(parsed?.window===window) { assert(Number.isInteger(parsed.count)&&parsed.count>=0,'BUDGET_LEDGER_CORRUPT'); count=parsed.count; }
  } catch (err) {
    if(err.code!=='ENOENT') throw new Error(`BUDGET_LEDGER_CORRUPT: ${err.message}`);
  }
  assert(count<maxRenders,`RENDER_BUDGET_EXCEEDED ${count}/${maxRenders} in ${window}`);
  const next={window,count:count+1,updated_at:now.toISOString()};
  await mkdir(dirname(ledgerPath),{recursive:true});
  const tmp=`${ledgerPath}.${process.pid}.tmp`;
  await writeFile(tmp,JSON.stringify(next)+'\n');
  await rename(tmp,ledgerPath);
  return {used:next.count,max:maxRenders,window};
}

export async function runMascot({url='http://127.0.0.1:8188/',profile,identity,style,out='mascot-output',maxWaitMs=360000,env=process.env,maxRenders=4,budgetPath,codexHome=env?.COMFY_CODEX_HOME??'',api}) {
  assert(Object.hasOwn(PROFILES,profile),'UNKNOWN_PROFILE');assert(identity && style,'REFERENCES_REQUIRED');
  const client=api?{transport:{base:new URL(url),scheme:'injected',loopback:true,authenticated:false},call:api}:createApi(url,{env});
  const call=client.call;
  const sys=await(await call('/system_stats')).json();
  const info=await(await call('/object_info/'+ACTIVE_BACKEND_NODE)).json();
  assert(Object.hasOwn(info,ACTIVE_BACKEND_NODE),'IMAGE_BACKEND_NODE_MISSING');
  // A missing scaler must fail before budget consumption / a potentially paid prompt.
  const scaler=await(await call('/object_info/'+SCALER_NODE)).json();
  assert(Object.hasOwn(scaler,SCALER_NODE),'IMAGE_SCALER_NODE_MISSING');
  const batch=await(await call('/object_info/'+BATCH_NODE)).json();
  assert(Object.hasOwn(batch,BATCH_NODE),'IMAGE_BATCH_NODE_MISSING');
  const [primary,secondary]=await Promise.all([uploadReference(call,identity),uploadReference(call,style)]);
  const graph=buildGraph({profile,identityImage:primary.name,styleImage:secondary.name,codexHome});
  const workflowHash=graphSha256(graph);
  const budget=await consumeRenderBudget({ledgerPath:budgetPath??join(resolve(out),'.mascot-render-budget.json'),maxRenders});
  const submitted=await(await call('/prompt',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:graph,client_id:randomUUID()})})).json();
  // The prompt id becomes a directory name below and a URL path segment above.
  // It is chosen by the backend, so treat it as untrusted input: a traversal or
  // separator here would write an artifact outside the configured output root.
  assert(typeof submitted.prompt_id==='string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(submitted.prompt_id) && !submitted.prompt_id.includes('..'),'COMFY_PROMPT_ID_UNSAFE');
  const deadline=Date.now()+maxWaitMs;let status,history;
  while(Date.now()<deadline){
    const raw=await(await call(`/history/${encodeURIComponent(submitted.prompt_id)}`)).json();
    history=raw[submitted.prompt_id];
    if(history){status=history.status?.status_str; if(status==='error')throw new Error('IMAGE_RENDER_FAILED: '+JSON.stringify(history.status?.messages??[]).slice(0,1400));if(status==='success')break;}
    await delay(1500);
  }
  assert(status==='success','IMAGE_RENDER_TIMEOUT_OR_UNVERIFIED');
  const saved=history.outputs?.['8']?.images?.[0]; assert(saved?.filename,'NO_SAVED_IMAGE');
  const qs=new URLSearchParams({filename:saved.filename,subfolder:saved.subfolder??'',type:'output'});
  const renderPng=Buffer.from(await(await call(`/view?${qs}`)).arrayBuffer());
  const renderValidation=validatePng(renderPng,{requireAlpha:false});
  const exported=exportAlphaPng(renderPng);
  const png=exported.png;
  const validation=validatePng(png,{marginRatio:ARTIFACT_MARGIN_RATIO});
  const directory=resolve(out,profile,submitted.prompt_id);await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'render.png'),renderPng,{flag:'wx'});
  await writeFile(join(directory,'candidate.png'),png,{flag:'wx'});
  const alphaExport={...ALPHA_EXPORT,source_sha256:renderValidation.sha256,output_sha256:validation.sha256,passthrough:exported.passthrough,removed_pixels:exported.removed_pixels??0,reframed:exported.reframed??false};
  const provenance={schema:2,status:'AWAITING_HUMAN_BRAND_QA',profile,created_at:new Date().toISOString(),prompt_id:submitted.prompt_id,backend:ACTIVE_BACKEND_NODE,image_model:'gpt-6-luna',backend_version:sys.system?.comfyui_version??'unknown',transport:describeTransport(client.transport),codex_home_configured:false,workflow_sha256:workflowHash,prompt_sha256:sha256(Buffer.from(PROFILES[profile].prompt)),reference_identity:primary,reference_style:secondary,render_validation:renderValidation,alpha_export:alphaExport,validation,output_filename:saved.filename,model_seed:null,render_budget:budget,visual_identity_approved:false};
  await writeFile(join(directory,'provenance.json'),JSON.stringify(provenance,null,2)+'\n',{flag:'wx'});
  return {directory,provenance};
}

/**
 * Independent verification of a produced artifact directory. Recomputes every
 * claim from the bytes on disk instead of trusting the runner that wrote them:
 * PNG structure/alpha/coverage, artifact hash, reference hashes, canonical
 * workflow hash for the recorded profile, and the no-self-approval rule.
 */
export async function verifyArtifacts(directory,{identityFile,styleFile}={}) {
  const png=await readFile(join(directory,'candidate.png'));
  const renderPng=await readFile(join(directory,'render.png'));
  const provenance=JSON.parse(await readFile(join(directory,'provenance.json'),'utf8'));
  const checks=[];
  const check=(name,ok,detail)=>{assert(ok,`${name.toUpperCase()}_FAILED`);checks.push({name,pass:true,...(detail&&typeof detail==='object'?detail:{})});};
  check('schema',provenance.schema>=2);
  check('pending_status',PENDING_STATUSES.includes(provenance.status));
  check('no_self_approval',provenance.visual_identity_approved===false);
  const renderValidation=validatePng(renderPng,{requireAlpha:false});
  check('render_sha256',renderValidation.sha256===provenance.render_validation?.sha256,{sha256:renderValidation.sha256});
  check('recorded_render_mode',renderValidation.mode===provenance.render_validation?.mode,{mode:renderValidation.mode});
  // The alpha export is a pure function of render.png, so any edit to either file
  // desynchronises the pair instead of passing as a plausible artifact.
  const recordedMethod=provenance.alpha_export?.method;
  const exported=exportAlphaPng(renderPng,{method:recordedMethod});
  check('alpha_export_sha256',sha256(exported.png)===sha256(png),{sha256:sha256(exported.png)});
  check('recorded_exporter',['corner-flood-fill-v2',ALPHA_EXPORT.method].includes(recordedMethod));
  check('recorded_export_output',provenance.alpha_export?.output_sha256===sha256(png),{sha256:sha256(png)});
  const validation=validatePng(png,{marginRatio:recordedMethod==='corner-flood-fill-v2'?0.01:ARTIFACT_MARGIN_RATIO});
  check('artifact_sha256',validation.sha256===provenance.validation?.sha256,{sha256:validation.sha256});
  for(const key of ['width','height','coverage','mode','crc_check','structural_check']) check(`recorded_${key}`,validation[key]===provenance.validation?.[key],{[key]:validation[key]});
  check('recorded_bbox',JSON.stringify(validation.bbox)===JSON.stringify(provenance.validation?.bbox));
  const graph=buildGraph({profile:provenance.profile,identityImage:provenance.reference_identity?.name,styleImage:provenance.reference_style?.name,codexHome:'',backend:provenance.backend});
  check('workflow_sha256',graphSha256(graph)===provenance.workflow_sha256);
  check('prompt_sha256',sha256(Buffer.from(PROFILES[provenance.profile].prompt))===provenance.prompt_sha256);
  if(identityFile) check('reference_identity_sha256',sha256(await readFile(identityFile))===provenance.reference_identity?.sha256);
  if(styleFile) check('reference_style_sha256',sha256(await readFile(styleFile))===provenance.reference_style?.sha256);
  return {verified:true,profile:provenance.profile,prompt_id:provenance.prompt_id,sha256:validation.sha256,checks,brand_review:'PENDING_MANUAL'};
}

async function cli(argv){
  const [command,...args]=argv; const flag=n=>{const i=args.indexOf(`--${n}`);return i<0?undefined:args[i+1]};
  if(command==='validate'){const path=flag('file');assert(path,'--file required');console.log(JSON.stringify(validatePng(await readFile(path)),null,2));return;}
  if(command==='verify'){const dir=flag('dir');assert(dir,'--dir required');console.log(JSON.stringify(await verifyArtifacts(dir,{identityFile:flag('identity'),styleFile:flag('style')}),null,2));return;}
  if(command==='run'){
    const maxRenders=flag('max-renders')===undefined?4:Number(flag('max-renders'));
    assert(Number.isInteger(maxRenders)&&maxRenders>0,'--max-renders must be a positive integer');
    const result=await runMascot({url:flag('url'),profile:flag('profile'),identity:flag('identity'),style:flag('style'),out:flag('out'),maxRenders,budgetPath:flag('budget')});console.log(JSON.stringify(result,null,2));return;
  }
  throw new Error('Usage: node scripts/mascot-factory.mjs validate --file FILE.png | verify --dir DIR [--identity REF.png] [--style REF.png] | run --profile zar|szlif --identity REF.png --style REF.png --url https://comfy.example --out OUTPUT_DIR [--max-renders 4] [--budget FILE]');
}
if(process.argv[1] && resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname))cli(process.argv.slice(2)).catch(err=>{console.error('MASCOT_FACTORY_FAILED:',err.message);process.exitCode=1;});

