import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { validatePng, buildGraph, runMascot } from '../scripts/mascot-factory.mjs';

// A deterministic fixture generator; never passes off a mocked render as a real model output.
function chunk(type,data){const b=Buffer.alloc(12+data.length);b.writeUInt32BE(data.length,0);b.write(type,4,'ascii');data.copy(b,8);return b;}
function fixture({width=512,height=512,allOpaque=false,clipped=false}={}) {
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
  const data=Buffer.alloc(height*(1+width*4));
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*(1+width*4)+1+x*4;
    const inside=allOpaque || (x >= (clipped?0:80) && x<width-80 && y>=80 && y<height-80);
    data[i]=255;data[i+1]=96;data[i+2]=24;data[i+3]=inside?255:0;
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(data)),chunk('IEND',Buffer.alloc(0))]);
}

test('reference-locked graph uses exactly one generation node and one save node',()=>{
  const g=buildGraph({profile:'zar',identityImage:'identity.png',styleImage:'style.png'});
  assert.equal(g['3'].inputs.image_1[0],'1');assert.equal(g['3'].inputs.image_2[0],'2');
  assert.equal(g['4'].inputs.images[0],'3');assert.match(g['3'].inputs.prompt,/Żar/);
  assert.throws(()=>buildGraph({profile:'other',identityImage:'a',styleImage:'b'}),/UNKNOWN_PROFILE/);
});

test('valid RGBA PNG passes structural QC, and clipped/opaque output fails closed',()=>{
  const valid=validatePng(fixture());assert.equal(valid.structural_check,'PASS');
  assert.equal(valid.brand_review,'PENDING_MANUAL');assert.deepEqual(valid.bbox,[80,80,431,431]);
  assert.throws(()=>validatePng(fixture({allOpaque:true})),/PNG_EMPTY_OR_OPAQUE_BACKGROUND/);
  assert.throws(()=>validatePng(fixture({clipped:true})),/MASCOT_TOUCHES_CANVAS_EDGE/);
  assert.throws(()=>validatePng(Buffer.from('wrong')),/NOT_PNG/);
});

async function server({fail=false}={}) {
  const image=fixture(); let submissions=0;
  const s=createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    const send=(code,data,type='application/json')=>{res.writeHead(code,{'content-type':type});res.end(type==='application/json'?JSON.stringify(data):data);};
    if(pathname==='/system_stats')return send(200,{system:{comfyui_version:'test-mock-only'}});
    if(pathname==='/object_info/ArkCodexImageGen')return send(200,{ArkCodexImageGen:{}});
    if(pathname==='/upload/image'){
      const chunks=[];for await (const c of req) chunks.push(c);
      const match=Buffer.concat(chunks).toString('latin1').match(/filename="(mascot_[a-f0-9]{24}_[a-f0-9]{8}\.png)"/);
      return send(200,{name:match?.[1]??'MALFORMED_UPLOAD'});
    }
    if(pathname==='/prompt') { submissions++;return send(200,{prompt_id:'mock-run-123'}); }
    if(pathname==='/history/mock-run-123')return send(200,{'mock-run-123':fail?{status:{status_str:'error',messages:[['execution_error',{node_id:'3',exception_message:'AUTH_DENIED'}]]}}:{status:{status_str:'success'},outputs:{'4':{images:[{filename:'mock.png',subfolder:'',type:'output'}]}}}});
    if(pathname==='/view')return send(200,image,'image/png');
    return send(404,{error:'not found'});
  });
  await new Promise(ok=>s.listen(0,'127.0.0.1',ok));
  return {url:`http://127.0.0.1:${s.address().port}/`,close:()=>new Promise(ok=>s.close(ok)),getSubmissions:()=>submissions};
}

test('mock ComfyUI E2E uploads refs → queues → reads history → validates → writes pending artifact with provenance',async()=>{
  const root=await mkdtemp(join(tmpdir(),'mascot-e2e-'));const ref=join(root,'reference.png');await writeFile(ref,fixture());
  const mock=await server();
  try{
    const result=await runMascot({url:mock.url,profile:'szlif',identity:ref,style:ref,out:join(root,'outputs'),maxWaitMs:10000});
    assert.equal(mock.getSubmissions(),1);
    assert.equal(result.provenance.status,'AWAITING_HUMAN_BRAND_QA');
    assert.equal(result.provenance.prompt_id,'mock-run-123');
    assert.equal(result.provenance.visual_identity_approved,false);
    const png=await readFile(join(result.directory,'candidate.png'));
    assert.equal(validatePng(png).sha256,result.provenance.validation.sha256);
    const metadata=JSON.parse(await readFile(join(result.directory,'provenance.json'),'utf8'));
    assert.equal(metadata.reference_identity.sha256,metadata.reference_style.sha256);
  }finally{await mock.close();}
});

test('mock failed node does not create a falsely successful output',async()=>{
  const root=await mkdtemp(join(tmpdir(),'mascot-fail-'));const ref=join(root,'reference.png');await writeFile(ref,fixture());
  const mock=await server({fail:true});
  try{
    await assert.rejects(()=>runMascot({url:mock.url,profile:'zar',identity:ref,style:ref,out:join(root,'outputs'),maxWaitMs:10000}),/IMAGE_RENDER_FAILED/);
    await assert.rejects(()=>readdir(join(root,'outputs')),/ENOENT/);
  }finally{await mock.close();}
});
