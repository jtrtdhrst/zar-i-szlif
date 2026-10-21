#!/usr/bin/env node
/**
 * Visual evidence gate — independent of SVG correctness.
 * Guarantees the reviewer saw the *real Penpot export* and the model critiqued
 * that exact file, not a local SVG / hash-only verification.
 * No model call or review decision is fabricated here.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { run as auditContrast } from './contrast-audit.mjs';

export const OWNER_TEAM_ID = 'fa45bb82-5782-8177-8008-cb89bd5343d6';
const SHA40 = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const REQUIRED_IDS = ['iskra-a','iskra-b','iskra-c','szlif-a','szlif-b','szlif-c','iskra-master','szlif-master','iskra-szlif-vignette'];
const SIZES = [512,128,64,32];
const hash = (buf) => createHash('sha256').update(buf).digest('hex');
export const sha256 = hash;
const inRepo = (root, file) => {
  if (typeof file !== 'string' || !file || path.isAbsolute(file)) throw new Error('Invalid relative file path');
  const full = path.resolve(root,file);
  if (!full.startsWith(path.resolve(root)+path.sep)) throw new Error('File escaped asset directory');
  return full;
};

export function validateReview(e, manifest) {
  const errors=[];
  const fail=(name,msg)=>errors.push({code:name,message:msg});
  if(!e || typeof e!=='object') {fail('NO_EVIDENCE','No visual inspection evidence JSON was supplied');return errors;}
  if(!SHA40.test(e.candidateSha??'')) fail('CANDIDATE_SHA','Expected immutable 40-digit Git commit');
  for(const id of REQUIRED_IDS) {
    const row=manifest?.sources?.find(s=>s.id===id);
    if(!row) {fail('MISSING_DIRECTION',id);continue;}
    for(const size of SIZES) if(!row.outputs?.some(o=>o.size===size&&o.file?.endsWith('-'+size+'.png')))
      fail('MISSING_SIZE',id+' '+size);
  }
  const p=e.penpot;
  if(!p || p.teamId!==OWNER_TEAM_ID) fail('WRONG_PENPOT_TEAM','Must read original owner team, not alternate staging team');
  if(!p?.fileId || !p.pageId || !Number.isInteger(p.revision)) fail('PENPOT_READBACK','Missing owner file/page/revision readback');
  if(p?.editable!==true || p?.rasterShapeCount!==0 || !(p?.nativeShapeCount>0))
    fail('NOT_NATIVE','Penpot requires editable vector shapes, no raster wrappers');
  if(!Array.isArray(p?.exports) || p.exports.length<12) fail('NO_PENPOT_EXPORTS','Missing 512/128/64/32 real exports for each approved master and scene');
  for(const id of ['iskra-master','szlif-master','iskra-szlif-vignette'])
    for(const size of SIZES)
      if(!p?.exports?.some(x=>x.id===id&&x.size===size&&SHA256.test(x.sha256??'')&&x.path))
        fail('MISSING_PENPOT_SIZE',id+' '+size);
  const visual=e.vision;
  if(!visual || visual.type!=='multimodal_image_review' || !visual.model || !visual.sessionId)
    fail('NO_VISION_REVIEW','Must record a real multimodal review run and model');
  if(visual?.candidateSha!==e.candidateSha) fail('VISION_SHA','Vision assessment is not bound to candidate SHA');
  if(visual?.verdict!=='pass') fail('VISION_REJECTED','Vision reviewer has not approved the images');
  if(!visual?.penpotScreenshotSha256 || !SHA256.test(visual.penpotScreenshotSha256))
    fail('NO_SCREENSHOT','Real Penpot screenshot hash absent');
  const scores=visual?.scores;
  for(const metric of ['fox_anatomy','raven_anatomy','expression','pair_chemistry','small_size_readability','contrast','composition'])
    if(!Number.isFinite(scores?.[metric]) || scores[metric]<4)
      fail('ART_QUALITY','Vision '+metric+' score below 4/5');
  if(!Array.isArray(visual?.defects) || visual.defects.some(x=>x.status!=='resolved'))
    fail('UNRESOLVED_DEFECTS','Review defects must be explicit and resolved');
  if(!Array.isArray(e.iterations)|| e.iterations.length<2 || e.iterations.some(i=>!SHA256.test(i?.beforeImageSha256??'')||!SHA256.test(i?.afterImageSha256??'')||i.beforeImageSha256===i.afterImageSha256))
    fail('NO_ITERATION_PROOF','At least two distinct image before/after corrections required');
  const art=e.reviews?.art; const qa=e.reviews?.uiQa;
  if(art?.decision!=='approved'||art.candidateSha!==e.candidateSha || !art.reviewerAgentId)
    fail('ART_REVIEW','Independent CMO first-class approval on the same commit required');
  if(qa?.decision!=='approved'||qa.candidateSha!==e.candidateSha||!qa.reviewerAgentId)
    fail('UI_QA_REVIEW','Independent UI QA first-class approval on the same commit required');
  if(art?.reviewerAgentId && qa?.reviewerAgentId && art.reviewerAgentId===qa.reviewerAgentId)
    fail('SELF_REVIEW','Art and UI QA reviewers must be independent');
  if(e.ownerVerdict!=='approved') fail('OWNER_NOT_APPROVED','Owner rejected prior candidate; explicit approved decision for new images required');
  return errors;
}

export function verifyRasterEvidence(e, root) {
  const problems=[];
  const fail=(code,msg)=>problems.push({code,message:msg});
  if(!e?.penpot?.exports) return [{code:'NO_EXPORTS',message:'Penpot exports absent'}];
  for(const record of e.penpot.exports){
    try{
      const name=inRepo(root,record.path);
      if(!existsSync(name)){fail('MISSING_EXPORT',record.path);continue;}
      const buffer=readFileSync(name);
      if(hash(buffer)!==record.sha256){fail('EXPORT_HASH_MISMATCH',record.path);continue;}
      const pen=PNG.sync.read(buffer);
      const canonical=e?.manifest?.sources?.find(s=>s.id===record.id)?.outputs?.find(o=>o.size===record.size&&o.file?.endsWith('-'+record.size+'.png'));
      if(!canonical) {fail('CANONICAL_MISSING',record.id+' '+record.size);continue;}
      const canonPath=inRepo(root,canonical.file);
      if(!existsSync(canonPath)){fail('MISSING_CANONICAL',canonical.file);continue;}
      const ref=PNG.sync.read(readFileSync(canonPath));
      if(pen.width!==ref.width||pen.height!==ref.height){fail('RENDER_DIMENSIONS',record.id+' '+record.size);continue;}
      const different=pixelmatch(ref.data,pen.data,null,pen.width,pen.height,{threshold:0.1,includeAA:false});
      const ratio=different/(pen.width*pen.height);
      if(ratio>0.05)fail('RENDER_DRIFT',record.id+' '+record.size+' diff='+ratio.toFixed(4));
    }catch(err){fail('BAD_EXPORT',String(err.message).slice(0,200));}
  }
  // A SHA is not proof that an image was seen; require a binary screenshot.
  try{
    const screenshot=inRepo(root,e.penpot.screenshotPath);
    const data=readFileSync(screenshot);
    if(hash(data)!==e.vision?.penpotScreenshotSha256)fail('SCREENSHOT_MISMATCH','Screenshot differs from multimodal review evidence');
    PNG.sync.read(data);
  }catch(err){fail('BAD_SCREENSHOT',String(err.message).slice(0,200));}
  return problems;
}

// The claimed Git SHA must be the actual HEAD that owns every raster, SVG,
// manifest and evidence artifact. This rejects a stale signed-looking JSON blob
// copied from another candidate and uncommitted hot edits.
export function verifyGitProvenance(e, root) {
  if (!e) return [];
  const errors = [];
  const fail = (code, message) => errors.push({code, message});
  try {
    const repo = execFileSync('git',['rev-parse','--show-toplevel'],{cwd:root,encoding:'utf8',timeout:5000}).trim();
    const head = execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8',timeout:5000}).trim();
    const rel = path.relative(repo,root).split(path.sep).join('/');
    if(e.candidateSha !== head) fail('GIT_SHA_MISMATCH','Expected candidate SHA '+head+' but received '+String(e.candidateSha));
    const dirty = execFileSync('git',['status','--porcelain','--untracked-files=all','--',rel],{cwd:repo,encoding:'utf8',timeout:5000}).trim();
    if(dirty) fail('UNCOMMITTED_ART_ASSETS','Asset directory differs from the submitted Git commit');
    // Hash-pin the generated manifest, because other review evidence depends on it.
    const committed = execFileSync('git',['show','HEAD:'+rel+'/exports/manifest.json'],{cwd:repo,timeout:5000,maxBuffer:4*1024*1024});
    const local = readFileSync(path.join(root,'exports','manifest.json'));
    if(hash(committed)!==hash(local)) fail('MANIFEST_NOT_COMMITTED','Local manifest is not the one submitted in HEAD');
  } catch(err) { fail('GIT_READBACK_FAILED',String(err.message).slice(0,200)); }
  return errors;
}

export function runGate({root,manifest,evidence}){
  const m=manifest??JSON.parse(readFileSync(inRepo(root,'exports/manifest.json'),'utf8'));
  const e=evidence??null;
  if(e) e.manifest=m;
  const structural=validateReview(e,m);
  const raster=e?.penpot?.exports?.length ? verifyRasterEvidence(e,root):[];
  let contrastErrors=[];
  try {
    contrastErrors=auditContrast().filter(x=>x.shareBelow2>0.5).map(x=>({code:'DARK_CONTRAST_FAIL',message:`${x.id} ${Math.round(x.shareBelow2*100)}% of opaque pixels under 2:1 contrast on dark` }));
  }catch(err){ contrastErrors=[{code:'CONTRAST_CHECK_FAILED',message:String(err.message)}]; }
  const git=verifyGitProvenance(e,root);
  const errors=[...structural,...raster,...contrastErrors,...git];
  return {status:errors.length?'BLOCKED':'PASS',errors,checks:{structural:structural.length,raster:raster.length,contrast:contrastErrors.length,git:git.length}};
}
const invoked=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
  const root=path.dirname(fileURLToPath(import.meta.url));
  const filename=process.argv[2]??'exports/visual-review-evidence.json';
  let evidence;
  try{evidence=JSON.parse(readFileSync(inRepo(root,filename),'utf8'));}
  catch{evidence=null;}
  try{
    const outcome=runGate({root,evidence});
    console.log(JSON.stringify(outcome,null,2));
    if(outcome.status!=='PASS')process.exitCode=1;
  }catch(err){console.error('FAIL_CLOSED '+err.message);process.exitCode=1;}
}
