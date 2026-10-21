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
  if(!requested.search.includes(fileId)&&!requested.pathname.includes(fileId))throw Error('FILE_ID_NOT_IN_URL');
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
    await page.locator(selector).first().waitFor({state:'visible',timeout:30000});
    // screenshot is backed by the genuine editor DOM, not imported/rendered SVG.
    const png=await page.screenshot({type:'png',fullPage:false,animations:'disabled'});
    if(!Buffer.isBuffer(png)||png.length<100)throw Error('INVALID_BROWSER_SCREENSHOT');
    mkdirSync(path.dirname(output),{recursive:true});writeFileSync(output,png,{flag:'wx'});
    return {teamId,fileId,fileUrl:page.url(),screenshotPath:output,
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
