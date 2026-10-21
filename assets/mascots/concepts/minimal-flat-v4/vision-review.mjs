#!/usr/bin/env node
/**
 * Structured multimodal critique of actual Penpot screenshot bytes.
 * Model recommendation is NOT a first-class CMO or UI QA decision.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

const METRICS=['fox_anatomy','raven_anatomy','expression','pair_chemistry','small_size_readability','contrast','composition'];
export const sha256=(buffer)=>createHash('sha256').update(buffer).digest('hex');
export function validateCritique(c) {
  if(!c||typeof c!=='object')throw Error('INVALID_VISION_JSON');
  if(!METRICS.every(k=>Number.isInteger(c.scores?.[k])&&c.scores[k]>=1&&c.scores[k]<=5))
    throw Error('INVALID_VISION_SCORES');
  if(!Array.isArray(c.defects)||!c.defects.every(d=>typeof d.message==='string'&&d.message.length>4&&['open','resolved'].includes(d.status)))
    throw Error('INVALID_DEFECT_LIST');
  if(!['pass','changes_requested'].includes(c.verdict))throw Error('INVALID_VISION_VERDICT');
  if(c.verdict==='pass'&&(METRICS.some(k=>c.scores[k]<4)||c.defects.some(d=>d.status!=='resolved')))
    throw Error('FALSE_POSITIVE_VISION_VERDICT');
  return c;
}
export async function critique({image,baseUrl,apiKey,model,candidateSha,fetchFn=fetch}){
  if(!Buffer.isBuffer(image)||image.length<100||image.length>8*1024*1024||image.subarray(1,4).toString()!=='PNG')
    throw Error('SCREENSHOT_MUST_BE_REAL_PNG');
  if(!/^[a-f0-9]{40}$/i.test(candidateSha??''))throw Error('INVALID_COMMIT_SHA');
  if(!apiKey||!model||!baseUrl)throw Error('MISSING_VISION_PROVIDER_CONFIGURATION');
  const url=new URL('chat/completions',baseUrl.endsWith('/')?baseUrl:baseUrl+'/');
  const payload={
    model,temperature:0,response_format:{type:'json_object'},
    messages:[
      {role:'system',content:'You are an independent mascot art director. Assess only the supplied real screenshot, not filenames, SVG compliance, pixelmatch or agent assertions. This is a forest adventure app with minimalist Finch-like mascots. Iskra must clearly look like an expressive orange fox with asymmetrical fringe and angled turquoise scarf; Szlif must clearly look like a thoughtful raven with coherent beak, crest, wings, feet and tail. Look for detached limbs, oversized blobs, overlong feathers, weak 32/64px silhouettes, low dark-background contrast, cramped or clipped composition and weak pair chemistry. Refuse approval for any major visual defect. Respond JSON only: {"scores":{"fox_anatomy":1,"raven_anatomy":1,"expression":1,"pair_chemistry":1,"small_size_readability":1,"contrast":1,"composition":1},"defects":[{"message":"specific actionable issue","status":"open"}],"verdict":"changes_requested"}. Scores are integers 1–5. Pass requires every score >=4 and all defects resolved. Do not grant any human/reviewer approval.'},
      {role:'user',content:[{type:'text',text:'Review actual Penpot screenshot bound to candidate Git commit '+candidateSha+'. Compare fox and raven composition, and visible proof at 32, 64, 128, 512. Answer only what image truly shows.'},
        {type:'image_url',image_url:{url:'data:image/png;base64,'+image.toString('base64')}}]}
    ]};
  const res=await fetchFn(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)});
  if(!res.ok)throw Error('VISION_API_HTTP_'+res.status);
  const data=await res.json();
  const raw=data.choices?.[0]?.message?.content;
  if(typeof raw!=='string')throw Error('VISION_API_EMPTY_RESPONSE');
  const parsed=validateCritique(JSON.parse(raw));
  return {type:'multimodal_image_review',model,sessionId:data.id||null,candidateSha,
    penpotScreenshotSha256:sha256(image),scores:parsed.scores,defects:parsed.defects,verdict:parsed.verdict,
    providerFinishReason:data.choices?.[0]?.finish_reason||null};
}
const isMain=process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href;
if(isMain){
  const screenshot=process.argv[2],candidateSha=process.argv[3],output=process.argv[4];
  if(!screenshot||!candidateSha||!output){console.error('Usage: node vision-review.mjs <penpot-screenshot.png> <candidate-sha> <report.json>');process.exitCode=2;}
  else try{
    const report=await critique({image:readFileSync(screenshot),candidateSha,baseUrl:process.env.VISION_API_BASE,apiKey:process.env.VISION_API_KEY,model:process.env.VISION_MODEL});
    writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log('VISION_REPORT '+output+' verdict='+report.verdict+' screenshot_sha='+report.penpotScreenshotSha256);
  }catch(err){console.error('VISION_REVIEW_FAILED '+String(err.message));process.exitCode=1;}
}
