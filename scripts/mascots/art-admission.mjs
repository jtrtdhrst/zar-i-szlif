#!/usr/bin/env node
/**
 * Mascot artistic-admission PRE-FLIGHT (not an autonomous art judge).
 *
 * Enforces immutable user-rejected candidates, actual on-disk PNG bytes,
 * unique A/B/C concepts, optical (not uniformly downscaled) 32px designs and
 * a genuine image-bound independent critique trace.
 *
 * IMPORTANT: It NEVER outputs ART_APPROVED, OWNER_APPROVED or RELEASE_PASS.
 * A trusted native Paperclip review readback, real owner response, original
 * Penpot and independent UI QA are outside this local code's trust boundary.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const REJECTED = Object.freeze({
  commits: Object.freeze([
    '2a09273490ebbe73fead95f09378057d67a903ec', // owner-rejected V4
    '15c1a642867b3239a2ce4553d0ab4d1a9e51770b', // owner-rejected V7 sample
    '112ba3734510783ef35c955eea0b066d8aa1547f', // same V7 art, prior revision
  ]),
  blobs: Object.freeze([
    'bce62ed93514ed1bc31cdb0a289a33003696e568', // V7 fox master Git blob
    'e112a5ec650dc1d190fe810880bff9b8dfcbf7a9', // V7 raven master Git blob
  ]),
});
const HEX40=/^[0-9a-f]{40}$/i, HEX64=/^[0-9a-f]{64}$/i;
const PNG_SIGNATURE=Buffer.from('89504e470d0a1a0a','hex');
const ART_ROLES=['iskra','szlif','pair'];
const REQUIRE_SIZES=[512,64,32];

export function sha256(buf){return createHash('sha256').update(buf).digest('hex');}
export function gitBlobSha(bytes){
  return createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
}
function safeReadPng(root, file) {
  if(typeof file!=='string'||!file||file.includes('\0'))throw Error('INVALID_FILE_PATH');
  const abs=path.resolve(root,file);
  if(!abs.startsWith(path.resolve(root)+path.sep))throw Error('PATH_ESCAPES_WORKSPACE');
  if(fs.lstatSync(abs).isSymbolicLink())throw Error('SYMLINK_IMAGE_NOT_ALLOWED');
  const bytes=fs.readFileSync(abs);
  if(bytes.length<33||bytes.length>12*1024*1024||!bytes.subarray(0,8).equals(PNG_SIGNATURE))
    throw Error('NOT_ACTUAL_PNG');
  if(bytes.toString('ascii',12,16)!=='IHDR')throw Error('PNG_MISSING_IHDR');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(width<24||height<24||width>8192||height>8192)throw Error('INVALID_PNG_DIMENSIONS');
  return {width,height,sha256:sha256(bytes)};
}

export function evaluateArtEvidence(evidence,{root=process.cwd(),mode='concept'}={}){
  const errors=[];
  const fail=(code,message)=>errors.push({code,message});
  if(!['concept','release'].includes(mode))throw Error('INVALID_GATE_MODE');
  if(!evidence||typeof evidence!=='object')return {status:'BLOCKED',errors:[{code:'EVIDENCE_MISSING',message:'No evidence object'}]};
  const candidate=evidence.candidate||{};
  if(!HEX40.test(candidate.commit||''))fail('INVALID_ART_COMMIT','Pin a 40-digit source Git commit');
  if(REJECTED.commits.includes((candidate.commit||'').toLowerCase()))
    fail('OWNER_REJECTED_CANDIDATE','Submitted Git commit was explicitly rejected by owner');
  const sources=candidate.sources||{};
  for(const role of ART_ROLES.slice(0,2)){
    const rec=sources[role];
    if(!rec?.path||!HEX64.test(rec?.sha256||'')){fail('SOURCE_UNPINNED',role+' source path/hash missing');continue;}
    try{
      const abs=path.resolve(root,rec.path);
      if(!abs.startsWith(path.resolve(root)+path.sep))throw Error('PATH_ESCAPES_WORKSPACE');
      const bytes=fs.readFileSync(abs);
      const contentHash=sha256(bytes);
      const blob=gitBlobSha(bytes);
      if(rec.sha256!==contentHash)fail('SOURCE_HASH_MISMATCH',role);
      if(REJECTED.blobs.includes(blob.toLowerCase()))fail('OWNER_REJECTED_SOURCE_BLOB',role+' exact rejected V7 source art');
    }catch(err){fail('SOURCE_READ_FAILED',role+': '+String(err.code||err.message));}
  }
  if(candidate.writerAgentId&&candidate.visualReviewerAgentId&&candidate.writerAgentId===candidate.visualReviewerAgentId)
    fail('SELF_REVIEW','Art executor cannot grant visual acceptance');
  const images=evidence.images||{};
  const observed={};
  for(const role of ART_ROLES)for(const size of REQUIRE_SIZES){
    const key=role+'_'+size,rec=images[key];
    if(!rec?.path||!HEX64.test(rec.sha256||'')){fail('IMAGE_EVIDENCE_MISSING',key);continue;}
    try{
      const actual=safeReadPng(root,rec.path);
      observed[key]=actual;
      if(actual.sha256!==rec.sha256)fail('IMAGE_HASH_MISMATCH',key);
      if(actual.width!==size)fail('IMAGE_WRONG_NATIVE_SIZE',key+' width '+actual.width);
      if(actual.height>Math.max(size*2,512))fail('IMAGE_WRONG_DIMENSIONS',key+' height '+actual.height);
    }catch(err){fail('IMAGE_NOT_READABLE',key+': '+String(err.code||err.message));}
  }
  const dirs=evidence.directions||{};
  const uniqueSource=new Set(),uniquePairImage=new Set();
  for(const direction of ['A','B','C']){
    const item=dirs[direction];
    if(!HEX64.test(item?.sourceSha256||'')||!item?.pair512?.path||!HEX64.test(item?.pair512?.sha256||'')){
      fail('DIRECTION_EVIDENCE_MISSING',direction+' separate source and 512px pairing');continue;
    }
    try{
      const actual=safeReadPng(root,item.pair512.path);
      if(actual.sha256!==item.pair512.sha256)fail('DIRECTION_IMAGE_HASH_MISMATCH',direction);
      uniqueSource.add(item.sourceSha256);
      uniquePairImage.add(actual.sha256);
    }catch(err){fail('DIRECTION_IMAGE_NOT_READABLE',direction+': '+String(err.code||err.message));}
  }
  if(uniqueSource.size<3||uniquePairImage.size<3)fail('DIRECTIONS_NOT_DISTINCT','A/B/C source and real rendered pixels must differ; visual distinctness still requires human assessment');
  const optical=evidence.optical||{};
  for(const role of ART_ROLES.slice(0,2)){
    const entry=optical[role];
    if(!entry||!['purpose_drawn_bust','purpose_drawn_icon'].includes(entry.kind)||!HEX64.test(entry.sourceSha256||''))
      fail('NO_PURPOSE_DRAWN_32PX',role+' cannot pass from uniformly scaled full-body image');
  }
  // This proves provenance of a reported visual inspection, not its truthfulness.
  const vision=evidence.vision;
  if(!vision||vision.mock===true||vision.inputType!=='image_bytes'||!vision.model||
      !vision.invocationId||vision.screenshotSha256!==observed.pair_512?.sha256||
      !['changes_requested','provisionally_acceptable'].includes(vision.verdict)){
    fail('UNVERIFIED_REAL_IMAGE_CRITIQUE','A mock/text-only/untied review or missing real image invocation cannot count');
  }else if(vision.verdict==='changes_requested')fail('VISUAL_CHANGES_REQUESTED','Independent image review found unresolved defects');
  if(mode==='release')fail('NATIVE_ART_OWNER_UIQA_NOT_VERIFIED','Offline file evidence cannot prove first-class CMO, owner, original Penpot team and UI QA decisions');
  return {status:errors.length?'BLOCKED':'READY_FOR_OWNER_VISUAL_REVIEW',errors,
    note:'Never ART_APPROVED. Requires real owner decision and native independent review readback.',
    artifactCount:Object.keys(observed).length};
}

const self=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(self){
  const [file,mode='concept']=process.argv.slice(2);
  if(!file){console.error('USAGE node scripts/mascots/art-admission.mjs <evidence.json> concept|release');process.exitCode=2;}
  else try{
    const inputPath=path.resolve(file),data=JSON.parse(fs.readFileSync(inputPath,'utf8'));
    const result=evaluateArtEvidence(data,{root:path.dirname(inputPath),mode});
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    if(result.status==='BLOCKED')process.exitCode=1;
  }catch(err){console.error('ART_EVIDENCE_ERROR '+String(err.message));process.exitCode=2;}
}

