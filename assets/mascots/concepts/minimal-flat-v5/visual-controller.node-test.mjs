import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateReview, verifyRasterEvidence, runGate, sha256, verifyGitProvenance, OWNER_TEAM_ID } from './visual-controller.mjs';
import { run as auditContrast, contrast } from './contrast-audit.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const original=JSON.parse(readFileSync(path.join(root,'exports/manifest.json'),'utf8'));
const refs=['iskra-a','iskra-b','iskra-c','szlif-a','szlif-b','szlif-c','iskra-master','szlif-master','iskra-szlif-vignette'];
const commit='a'.repeat(40);
const hash='b'.repeat(64);
const pExports=['iskra-master','szlif-master','iskra-szlif-vignette'].flatMap(id=>[512,128,64,32].map(size=>({id,size,path:'exports/'+id+'-'+size+'.png',sha256:hash})));
function fixture(){
  return {candidateSha:commit,ownerVerdict:'approved',penpot:{
    teamId:OWNER_TEAM_ID,fileId:'file',pageId:'page',revision:2,editable:true,rasterShapeCount:0,nativeShapeCount:84,
    screenshotPath:'exports/sheet-pair.png',exports:pExports
  },vision:{type:'multimodal_image_review',model:'vision-model',sessionId:'real-session',candidateSha:commit,
    penpotScreenshotSha256:hash,verdict:'pass',scores:{fox_anatomy:5,raven_anatomy:5,expression:5,pair_chemistry:5,small_size_readability:5,contrast:5,composition:5},defects:[]},
    iterations:[{beforeImageSha256:'c'.repeat(64),afterImageSha256:'d'.repeat(64)},{beforeImageSha256:'d'.repeat(64),afterImageSha256:'e'.repeat(64)}],
    reviews:{art:{decision:'approved',candidateSha:commit,reviewerAgentId:'CMO'},uiQa:{decision:'approved',candidateSha:commit,reviewerAgentId:'UI-QA'}}};
}
const errors=(e,m=original)=>validateReview(e,m).map(x=>x.code);
test('structural fixture passes without claiming real E2E approval',()=>assert.deepEqual(errors(fixture()),[]));
test('nine actual SVG sources have all four output sizes',()=>{for(const id of refs){const s=original.sources.find(x=>x.id===id);assert.ok(s,id);for(const n of [32,64,128,512])assert.ok(s.outputs.some(x=>x.size===n&&x.file.endsWith('-'+n+'.png')));}});
test('no evidence blocks rather than fake passing on SVG tests',()=>assert.ok(errors(null).includes('NO_EVIDENCE')));
test('owner original team enforced',()=>{const x=fixture();x.penpot.teamId='fa45bb82-5782-8177-8008-cb9105f337f9';assert.ok(errors(x).includes('WRONG_PENPOT_TEAM'));});
test('no Penpot screenshot cannot pass',()=>{const x=fixture();delete x.vision.penpotScreenshotSha256;assert.ok(errors(x).includes('NO_SCREENSHOT'));});
test('wrong candidate SHA in vision cannot pass',()=>{const x=fixture();x.vision.candidateSha='f'.repeat(40);assert.ok(errors(x).includes('VISION_SHA'));});
test('vision model must have actually executed',()=>{const x=fixture();delete x.vision.sessionId;assert.ok(errors(x).includes('NO_VISION_REVIEW'));});
test('vision sees anatomy defect and rejects',()=>{const x=fixture();x.vision.scores.raven_anatomy=2;assert.ok(errors(x).includes('ART_QUALITY'));});
test('unresolved render critique rejects',()=>{const x=fixture();x.vision.defects=[{message:'missing fox legs',status:'open'}];assert.ok(errors(x).includes('UNRESOLVED_DEFECTS'));});
test('two actual changed image iterations required',()=>{const x=fixture();x.iterations=[];assert.ok(errors(x).includes('NO_ITERATION_PROOF'));});
test('identical before and after image hashes do not count as fixes',()=>{const x=fixture();x.iterations[0].afterImageSha256=x.iterations[0].beforeImageSha256;assert.ok(errors(x).includes('NO_ITERATION_PROOF'));});
test('CMO first-class review must match candidate commit',()=>{const x=fixture();x.reviews.art.candidateSha='0'.repeat(40);assert.ok(errors(x).includes('ART_REVIEW'));});
test('reviewer self-approval rejected',()=>{const x=fixture();x.reviews.uiQa.reviewerAgentId='CMO';assert.ok(errors(x).includes('SELF_REVIEW'));});
test('owner-rejected concept cannot pass',()=>{const x=fixture();x.ownerVerdict='rejected';assert.ok(errors(x).includes('OWNER_NOT_APPROVED'));});
test('Penpot shape rasterization cannot pass',()=>{const x=fixture();x.penpot.rasterShapeCount=1;assert.ok(errors(x).includes('NOT_NATIVE'));});
test('missing 32px Penpot export blocks',()=>{const x=fixture();x.penpot.exports=x.penpot.exports.filter(r=>!(r.id==='szlif-master'&&r.size===32));assert.ok(errors(x).includes('MISSING_PENPOT_SIZE'));});
test('missing candidate direction blocks',()=>{const m=structuredClone(original);m.sources=m.sources.filter(x=>x.id!=='szlif-b');assert.ok(errors(fixture(),m).includes('MISSING_DIRECTION'));});
test('fake screenshot SHA and fake Penpot exports fail actual disk verification',()=>{const x=fixture();x.manifest=original;const failures=verifyRasterEvidence(x,root).map(y=>y.code);assert.ok(failures.includes('EXPORT_HASH_MISMATCH'));assert.ok(failures.includes('SCREENSHOT_MISMATCH'));});
test('malicious path traversal is rejected',()=>{const x=fixture();x.manifest=original;x.penpot.screenshotPath='../outside.png';assert.ok(verifyRasterEvidence(x,root).some(x=>x.code==='BAD_SCREENSHOT'));});
test('actual release gate fails closed on current owner-rejected visuals',()=>{const v=runGate({root,manifest:original,evidence:null});assert.equal(v.status,'BLOCKED');assert.ok(v.errors.some(x=>x.code==='NO_EVIDENCE'));});
test('manifest source checksum is testable',()=>{const entry=original.sources.find(x=>x.id==='iskra-a');assert.equal(sha256(readFileSync(path.join(root,entry.file))),entry.sourceSha256);});

test('actual dark-theme raven is legible after optical correction',()=>{
  const samples=auditContrast();
  const raven=samples.find(x=>x.id==='szlif-master');
  assert.ok(raven.shareBelow2<0.05,JSON.stringify(raven));
});
test('dark subject on dark background is detected by objective contrast',()=>{
  assert.ok(contrast([35,40,51],[22,32,46])<2);
  assert.ok(contrast([154,175,196],[22,32,46])>5);
});

test('real dark phone and camp context reuse corrected raven theme',()=>{
  const read=(name)=>PNG.sync.read(readFileSync(path.join(root,'exports',name)));
  const phone=read('context-phone-375-dark.png');
  const camp=read('context-desktop-camp.png');
  const light=read('context-phone-375-light.png');
  const countTheme=(png)=>{let n=0;for(let i=0;i<png.data.length;i+=4){
    if(png.data[i]===164&&png.data[i+1]===190&&png.data[i+2]===213)n++;
  }return n;};
  assert.equal(phone.width,375);assert.equal(phone.height,640);
  assert.equal(camp.width,900);assert.equal(camp.height,420);
  assert.ok(countTheme(phone)>1000,'Dark phone must display optical raven, not black-on-black');
  assert.ok(countTheme(camp)>1000,'Camp panel must show readable raven');
  assert.equal(countTheme(light),0,'Light panel preserves canonical dark raven');
  for(const name of ['context-phone-375-dark.png','context-desktop-camp.png']){
    const row=original.sheets.find(s=>s.file==='exports/'+name);
    assert.ok(row,'Live context exported in signed/provenance manifest: '+name);
    assert.equal(sha256(readFileSync(path.join(root,row.file))),row.sha256);
  }
});

test('fake candidate Git SHA fails authentic repository readback',()=>{
  const errors=verifyGitProvenance({candidateSha:'0'.repeat(40)},root);
  assert.ok(errors.some(x=>x.code==='GIT_SHA_MISMATCH'),JSON.stringify(errors));
});

test('Szlif vector path consolidation preserves V6 art in actual pixels',()=>{
  const checks=[
    ['szlif-master-512.png','iter2-after-szlif-master-512.png',0],
    ['szlif-master-64.png','iter2-after-szlif-master-64.png',0.01],
    ['szlif-master-32.png','iter2-after-szlif-master-32.png',0.01],
    ['iskra-szlif-vignette-512.png','iter2-after-iskra-szlif-vignette-512.png',0],
  ];
  for(const [name,reference,tolerance] of checks) {
    const a=PNG.sync.read(readFileSync(path.join(root,'exports',name)));
    const b=PNG.sync.read(readFileSync(path.join(root,'exports/iterations',reference)));
    assert.equal(a.width,b.width);assert.equal(a.height,b.height);
    const mismatched=pixelmatch(a.data,b.data,null,a.width,a.height,{threshold:0,includeAA:true});
    assert.ok(mismatched/(a.width*a.height)<=tolerance,name+' pixel diff: '+mismatched);
  }
  for(const master of ['iskra-master','szlif-master']) {
    const rec=original.sources.find(x=>x.id===master);
    assert.ok(rec.shapes<=22,master+' exceeded 22 named paths');
    assert.ok(rec.colors.length<=5,master+' exceeded 5 functional colors');
  }
});
