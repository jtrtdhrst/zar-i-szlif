#!/usr/bin/env node
/** Mascot Factory: fail-closed ComfyUI runner. No credentials in files. Node 24+. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';

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

export const sha256 = data => createHash('sha256').update(data).digest('hex');
function assert(ok, message) { if (!ok) throw new Error(message); }

/** Parse and defilter 8-bit RGBA PNG to evaluate actual transparency and clipping. */
export function validatePng(png, { minSize = 512, marginRatio = 0.02 } = {}) {
  const signature = Buffer.from([137,80,78,71,13,10,26,10]);
  assert(png.subarray(0,8).equals(signature), 'NOT_PNG');
  let pos=8, width=0, height=0, depth=-1, color=-1, interlace=-1; const blocks=[];
  let ended=false;
  while(pos+12 <= png.length) {
    const len=png.readUInt32BE(pos); const type=png.toString('ascii',pos+4,pos+8);
    assert(len < 100_000_000 && pos+12+len<=png.length, 'MALFORMED_PNG_CHUNK');
    const data=png.subarray(pos+8,pos+8+len);
    if(type==='IHDR') {assert(len===13,'INVALID_IHDR'); width=data.readUInt32BE(0);height=data.readUInt32BE(4);depth=data[8];color=data[9];interlace=data[12];}
    if(type==='IDAT') blocks.push(data);
    if(type==='IEND') {ended=true; break;}
    pos+=len+12;
  }
  assert(ended && blocks.length && width>=minSize && height>=minSize && width<=4096 && height<=4096,'PNG_DIMENSIONS_OR_DATA_INVALID');
  assert(depth===8 && color===6 && interlace===0, 'PNG_MUST_BE_NONINTERLACED_RGBA8');
  const bpp=4, rowBytes=width*bpp, expected=(rowBytes+1)*height;
  const pixels=inflateSync(Buffer.concat(blocks),{maxOutputLength:expected+1});
  assert(pixels.length===expected, 'PNG_DECOMPRESSED_LENGTH_INVALID');
  let old=Buffer.alloc(rowBytes), at=0, count=0, minX=width,minY=height,maxX=-1,maxY=-1, opaqueCorners=0;
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
    for(let x=0;x<width;x++){
      if(row[x*4+3]>8){count++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
        if((x===0||x===width-1)&&(y===0||y===height-1))opaqueCorners++;}
    }
    old=row;
  }
  assert(count > width*height*0.02 && count < width*height*0.85,'PNG_EMPTY_OR_OPAQUE_BACKGROUND');
  const margin=Math.max(8,Math.floor(Math.min(width,height)*marginRatio));
  assert(minX>=margin && minY>=margin && maxX<width-margin && maxY<height-margin,'MASCOT_TOUCHES_CANVAS_EDGE');
  assert(opaqueCorners===0,'PNG_NONTRANSPARENT_CORNERS');
  return {width,height,mode:'RGBA8',coverage:Number((count/(width*height)).toFixed(4)),bbox:[minX,minY,maxX,maxY],sha256:sha256(png),structural_check:'PASS',brand_review:'PENDING_MANUAL'};
}

export function buildGraph({profile, identityImage, styleImage}) {
  assert(Object.hasOwn(PROFILES, profile), 'UNKNOWN_PROFILE');
  const n=(class_type,inputs,title)=>({class_type,inputs,_meta:{title}});
  return {
    '1':n('LoadImage',{image:identityImage},'LOCKED identity reference'),
    '2':n('LoadImage',{image:styleImage},'Secondary style-only reference'),
    '3':n('ArkCodexImageGen',{prompt:PROFILES[profile].prompt,image_1:['1',0],image_2:['2',0],aspect_ratio:'1:1',quality:'high',background:'transparent',codex_home:'',allow_refresh:true,timeout_seconds:300,force_rerun:false,run_mode:'one at a time',max_concurrent:1,on_failure:'fail the run',speed:'standard'},'Reference-locked generation (authorization required)'),
    '4':n('SaveImage',{images:['3',0],filename_prefix:`mascot_factory/pending/${profile}`},'Save for QC; NOT published'),
  };
}

function urlFor(base,path) { const baseUrl=new URL(base); assert(['http:','https:'].includes(baseUrl.protocol),'INVALID_COMFY_URL'); const url=new URL(path,baseUrl);assert(url.origin===baseUrl.origin,'CROSS_ORIGIN_URL_DENIED');return url; }
async function request(base,path,options={}) {
  const response=await fetch(urlFor(base,path),{...options,signal:AbortSignal.timeout(30_000)});
  assert(response.ok,`COMFY_HTTP_${response.status} ${path}`);
  return response;
}

export async function uploadReference(base,filepath) {
  const buf=await readFile(filepath); assert(buf.length<10_000_000,'REFERENCE_FILE_TOO_LARGE');
  assert(buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'INPUT_NOT_PNG');
  const form=new FormData(); const name=`mascot_${sha256(buf).slice(0,24)}_${randomUUID().slice(0,8)}.png`;
  form.set('image',new Blob([buf],{type:'image/png'}),name);form.set('type','input');form.set('overwrite','false');
  const uploaded=await(await request(base,'/upload/image',{method:'POST',body:form})).json();
  assert(uploaded.name===name,'COMFY_UPLOAD_NAME_MISMATCH');
  return {name,sha256:sha256(buf),size:buf.length};
}

export async function runMascot({url='http://127.0.0.1:8188/',profile,identity,style,out='mascot-output',maxWaitMs=360000,api=request}) {
  assert(Object.hasOwn(PROFILES,profile),'UNKNOWN_PROFILE');assert(identity && style,'REFERENCES_REQUIRED');
  const sys=await(await api(url,'/system_stats')).json();
  const types=await(await api(url,'/object_info/ArkCodexImageGen')).json();
  assert(Object.hasOwn(types,'ArkCodexImageGen'),'IMAGE_BACKEND_NODE_MISSING');
  const [primary,secondary]=await Promise.all([uploadReference(url,identity),uploadReference(url,style)]);
  const graph=buildGraph({profile,identityImage:primary.name,styleImage:secondary.name});
  const workflowHash=sha256(Buffer.from(JSON.stringify(graph)));
  const submitted=await(await api(url,'/prompt',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:graph,client_id:randomUUID()})})).json();
  assert(submitted.prompt_id,'COMFY_PROMPT_NOT_ACCEPTED');
  const deadline=Date.now()+maxWaitMs;let status,history;
  while(Date.now()<deadline){
    const raw=await(await api(url,`/history/${encodeURIComponent(submitted.prompt_id)}`)).json();
    history=raw[submitted.prompt_id];
    if(history){status=history.status?.status_str; if(status==='error')throw new Error('IMAGE_RENDER_FAILED: '+JSON.stringify(history.status?.messages??[]).slice(0,1400));if(status==='success')break;}
    await new Promise(r=>setTimeout(r,1500));
  }
  assert(status==='success','IMAGE_RENDER_TIMEOUT_OR_UNVERIFIED');
  const saved=history.outputs?.['4']?.images?.[0]; assert(saved?.filename,'NO_SAVED_IMAGE');
  const qs=new URLSearchParams({filename:saved.filename,subfolder:saved.subfolder??'',type:'output'});
  const png=Buffer.from(await(await api(url,`/view?${qs}`)).arrayBuffer());
  const validation=validatePng(png);
  const directory=resolve(out,profile,submitted.prompt_id);await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'candidate.png'),png,{flag:'wx'});
  const provenance={schema:1,status:'AWAITING_HUMAN_BRAND_QA',profile,created_at:new Date().toISOString(),prompt_id:submitted.prompt_id,backend:'ArkCodexImageGen',backend_version:sys.system?.comfyui_version??'unknown',workflow_sha256:workflowHash,reference_identity:primary,reference_style:secondary,validation,output_filename:saved.filename,model_seed:null,visual_identity_approved:false};
  await writeFile(join(directory,'provenance.json'),JSON.stringify(provenance,null,2)+'\n',{flag:'wx'});
  return {directory,provenance};
}

async function cli(argv){
  const [command,...args]=argv; const flag=n=>{const i=args.indexOf(`--${n}`);return i<0?undefined:args[i+1]};
  if(command==='validate'){const path=flag('file');assert(path,'--file required');console.log(JSON.stringify(validatePng(await readFile(path)),null,2));return;}
  if(command==='run'){const result=await runMascot({url:flag('url'),profile:flag('profile'),identity:flag('identity'),style:flag('style'),out:flag('out')});console.log(JSON.stringify(result,null,2));return;}
  throw new Error('Usage: node scripts/mascot-factory.mjs validate --file FILE.png | run --profile zar|szlif --identity REF.png --style REF.png --url http://127.0.0.1:8188 --out OUTPUT_DIR');
}
if(process.argv[1] && resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname))cli(process.argv.slice(2)).catch(err=>{console.error('MASCOT_FACTORY_FAILED:',err.message);process.exitCode=1;});
