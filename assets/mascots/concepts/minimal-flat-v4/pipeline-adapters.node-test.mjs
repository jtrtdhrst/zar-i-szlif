import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {capturePenpot,EXPECTED_TEAM} from './penpot-capture.mjs';
import {critique,validateCritique,sha256} from './vision-review.mjs';

const img=readFileSync(new URL('./exports/sheet-proof.png',import.meta.url));
const fileId='6769b9bc-1b9c-81d1-8008-d2027677a87c';
const goodUrl='https://penpot.test/workspace/'+fileId+'?team-id='+EXPECTED_TEAM;
const points=Object.fromEntries(['fox_anatomy','raven_anatomy','expression','pair_chemistry','small_size_readability','contrast','composition'].map(k=>[k,4]));
const critiqueResult={scores:points,defects:[],verdict:'pass'};
function fakeBrowser(options={}){
  let closed=false;
  const page={goto:async()=>{},url:()=>options.url??goodUrl,evaluate:async()=>options.teams??[{id:EXPECTED_TEAM}],
    locator:()=>({first:()=>({waitFor:async()=>{if(options.noCanvas)throw Error('NO_CANVAS');}})}),
    screenshot:async()=>img,close:async()=>{closed=true;}};
  return {connect:async()=>({contexts:()=>options.noContext?[]:[{newPage:async()=>page}]}),isClosed:()=>closed};
}
const captured=async(options={})=>{
  const f=fakeBrowser(options),dir=mkdtempSync(path.join(os.tmpdir(),'penpot-capture-test-'));
  try{const output=path.join(dir,'capture.png');const e=await capturePenpot({cdpUrl:'ws://mock',fileUrl:goodUrl,fileId,output,connect:f.connect});return {e,closed:f.isClosed()};}
  finally{rmSync(dir,{force:true,recursive:true});}
};
test('real screenshot byte checksum and exact owner team are recorded by capture adapter',async()=>{
  const {e,closed}=await captured();
  assert.equal(e.teamId,EXPECTED_TEAM);
  assert.equal(e.screenshotSha256,sha256(img));
  assert.equal(e.source,'authenticated_penpot_browser');
  assert.equal(closed,true);
});
test('capture fails closed without a CDP browser',async()=>{await assert.rejects(capturePenpot({fileUrl:goodUrl,fileId,output:'out.png'}),/MISSING_BROWSER_CDP_URL/);});
test('capture fails closed for alternate staging team',async()=>{const f=fakeBrowser();await assert.rejects(capturePenpot({cdpUrl:'ws://mock',fileUrl:goodUrl,fileId,teamId:'fa45bb82-5782-8177-8008-cb9105f337f9',output:'out.png',connect:f.connect}),/WRONG_PENPOT_TEAM/);});
test('capture fails if authenticated browser is not member of owner team',async()=>{await assert.rejects(captured({teams:[{id:'alternate'}]}),/OWNER_TEAM_NOT_IN_AUTHENTICATED_SESSION/);});
test('capture rejects signin redirect rather than screenshot login page',async()=>{await assert.rejects(captured({url:'https://penpot.test/login'}),/PENPOT_FILE_REDIRECT_OR_LOGIN/);});
test('capture rejects missing authenticated browser context',async()=>{await assert.rejects(captured({noContext:true}),/NO_EXISTING_AUTHENTICATED_BROWSER_CONTEXT/);});
test('capture rejects missing editor viewport selector',async()=>{await assert.rejects(captured({noCanvas:true}),/NO_CANVAS/);});
test('API response is bound to exact screenshot SHA and candidate commit',async()=>{
  const calls=[];const mockedFetch=async (url,init)=>{calls.push({url:url.toString(),init});return {ok:true,json:async()=>({id:'vlm-test-run',choices:[{message:{content:JSON.stringify(critiqueResult)},finish_reason:'stop'}]})};};
  const out=await critique({image:img,baseUrl:'https://vision.test/v1',apiKey:'test-key-not-real',model:'mock-vlm',candidateSha:'f'.repeat(40),fetchFn:mockedFetch});
  assert.equal(out.penpotScreenshotSha256,sha256(img));
  assert.equal(out.sessionId,'vlm-test-run');
  assert.equal(out.verdict,'pass');
  assert.ok(calls[0].url.endsWith('/v1/chat/completions'));
  const req=JSON.parse(calls[0].init.body);
  assert.ok(req.messages[1].content[1].image_url.url.startsWith('data:image/png;base64,'));
});
test('VLM adapter refuses empty API configuration before network',async()=>{await assert.rejects(critique({image:img,candidateSha:'a'.repeat(40)}),/MISSING_VISION_PROVIDER_CONFIGURATION/);});
test('VLM invalid score or ungrounded yes-man PASS is rejected',()=>{
  assert.throws(()=>validateCritique({...critiqueResult,scores:{...points,raven_anatomy:2}}),/FALSE_POSITIVE_VISION_VERDICT/);
  assert.throws(()=>validateCritique({...critiqueResult,defects:[{message:'raven tail broken',status:'open'}]}),/FALSE_POSITIVE_VISION_VERDICT/);
});
test('API errors are not silently treated as PASS',async()=>{
  await assert.rejects(critique({image:img,baseUrl:'https://vision.test/v1',apiKey:'test',model:'mock',candidateSha:'a'.repeat(40),fetchFn:async()=>({ok:false,status:401})}),/VISION_API_HTTP_401/);
});
test('opaque non-PNG input cannot receive a vision verdict',async()=>{
  await assert.rejects(critique({image:Buffer.alloc(200,65),baseUrl:'https://vision.test',apiKey:'test',model:'mock',candidateSha:'a'.repeat(40)}),/SCREENSHOT_MUST_BE_REAL_PNG/);
});
