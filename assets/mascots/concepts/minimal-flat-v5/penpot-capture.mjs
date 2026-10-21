#!/usr/bin/env node
/**
 * Capture an authenticated Penpot editor screenshot through an existing CDP browser.
 * Does NOT authenticate as another user or use an alternate staging team.
 * Requires browser already logged in to the requested original-owner Penpot team.
 */
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { mkdirSync,writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
export const EXPECTED_TEAM = 'fa45bb82-5782-8177-8008-cb89bd5343d6';
const uuid=/^[a-f0-9-]{30,40}$/i;

export async function capturePenpot({cdpUrl,fileUrl,fileId,teamId=EXPECTED_TEAM,selector='.workspace-container, .workspace-content, [data-testid="workspace"]',output,connect=chromium.connectOverCDP}){
  if(!cdpUrl)throw Error('MISSING_BROWSER_CDP_URL');
  if(!fileUrl||!/^https?:\/\//.test(fileUrl)||!uuid.test(fileId??''))throw Error('INVALID_PENPOT_FILE_URL');
  if(teamId!==EXPECTED_TEAM)throw Error('WRONG_PENPOT_TEAM');
  if(!output)throw Error('MISSING_OUTPUT_PATH');
  const requested=new URL(fileUrl);
  if(!requested.search.includes(fileId)&&!requested.pathname.includes(fileId)&&!requested.hash.includes(fileId))throw Error('FILE_ID_NOT_IN_URL');
  let browser,page;
  try{
    browser=await connect(cdpUrl);
    const context=browser.contexts()[0];
    if(!context)throw Error('NO_EXISTING_AUTHENTICATED_BROWSER_CONTEXT');
    page=await context.newPage();
    await page.goto(fileUrl,{waitUntil:'domcontentloaded',timeout:45000});
    const arrived=new URL(page.url());
    if(arrived.origin!==requested.origin||!page.url().includes(fileId)||/login|signin|sign-in/i.test(arrived.pathname))
      throw Error('PENPOT_FILE_REDIRECT_OR_LOGIN');
    const teams=await page.evaluate(async ()=>{
      const r=await fetch('/api/rpc/command/get-teams',{credentials:'include'});
      if(!r.ok)throw Error('PENPOT_TEAM_RPCS_'+r.status);
      const x=await r.json();return Array.isArray(x)?x:(x?.teams??[]);
    });
    if(!Array.isArray(teams)||!teams.some(t=>t.id===EXPECTED_TEAM))throw Error('OWNER_TEAM_NOT_IN_AUTHENTICATED_SESSION');
    // Membership alone is insufficient: a browser that can see both teams might
    // accidentally open a file in the staging team. Verify the actual file ACL.
    const record=await page.evaluate(async (fid)=>{
      const r=await fetch('/api/rpc/command/get-file?id='+encodeURIComponent(fid),{credentials:'include'});
      if(!r.ok)throw Error('PENPOT_GET_FILE_HTTP_'+r.status);
      const x=await r.json();
      let paths=0,raster=0;
      for(const page of Object.values(x.data?.pagesIndex??{})){
        for(const shape of Object.values(page.objects??{})){
          if(shape.type==='path')paths++;
          if(shape.type==='image'||shape.fills?.some?.(f=>f.fillImage))raster++;
        }
      }
      return {id:x.id,teamId:x.teamId,revision:x.revn,projectId:x.projectId,
        pageIds:x.data?.pages??[],nativeShapeCount:paths,rasterShapeCount:raster};
    },fileId);
    if(record.id!==fileId)throw Error('PENPOT_FILE_ID_MISMATCH');
    if(record.teamId!==EXPECTED_TEAM)throw Error('PENPOT_FILE_BELONGS_TO_ANOTHER_TEAM');
    if(!Number.isInteger(record.revision)||record.revision<0||record.pageIds.length===0)
      throw Error('PENPOT_FILE_SNAPSHOT_INCOMPLETE');
    if(record.nativeShapeCount<=0 || record.rasterShapeCount>0)
      throw Error('PENPOT_NOT_NATIVE_EDITABLE');
    await page.locator(selector).first().waitFor({state:'visible',timeout:30000});
    // screenshot is backed by the genuine editor DOM, not imported/rendered SVG.
    const png=await page.screenshot({type:'png',fullPage:false,animations:'disabled'});
    if(!Buffer.isBuffer(png)||png.length<100)throw Error('INVALID_BROWSER_SCREENSHOT');
    mkdirSync(path.dirname(output),{recursive:true});writeFileSync(output,png,{flag:'wx'});
    return {teamId,fileId,fileUrl:page.url(),projectId:record.projectId,revision:record.revision,
      pageIds:record.pageIds,nativeShapeCount:record.nativeShapeCount,rasterShapeCount:record.rasterShapeCount,
      screenshotPath:output,
      screenshotSha256:createHash('sha256').update(png).digest('hex'),capturedAt:new Date().toISOString(),source:'authenticated_penpot_browser'};
  }finally{
    if(page)await page.close().catch(()=>{});
    // Never close a shared CDP browser managed by someone else's session.
  }
}
const main=process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href;
if(main){
  const [fileUrl,fileId,output]=process.argv.slice(2);
  try{
    const result=await capturePenpot({cdpUrl:process.env.PENPOT_BROWSER_CDP_URL,fileUrl,fileId,output,selector:process.env.PENPOT_VIEWPORT_SELECTOR});
    console.log(JSON.stringify(result,null,2));
  }catch(err){console.error('PENPOT_CAPTURE_FAILED '+String(err.message));process.exitCode=1;}
}
