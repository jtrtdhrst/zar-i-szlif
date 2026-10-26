import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createP1PlatformTools } from "./p1-platform.js";

const AGENT="11111111-1111-4111-8111-111111111111";
const COMPANY="22222222-2222-4222-8222-222222222222";
const RUN="33333333-3333-4333-8333-333333333333";
const ISSUE="44444444-4444-4444-8444-444444444444";
const FOREIGN="55555555-5555-4555-8555-555555555555";
const SHA="a".repeat(40), IMAGE="sha256:"+"b".repeat(64);
function fakeClient(runIssueId:string){
  return {
    callerApiKey:"jwt-agent-fixture",defaults:{runId:RUN},
    resolveCompanyId:()=>COMPANY,
    requestJson:async(_method:string,path:string)=>{
      if(path==="/agents/me")return {id:AGENT};
      if(path.startsWith("/heartbeat-runs/"))return {
        agentId:AGENT,companyId:COMPANY,status:"running",contextSnapshot:{issueId:runIssueId},
      };
      throw Error("Unexpected endpoint "+path);
    },
    getJsonOrNull:async(path:string)=>{
      if(path.startsWith("/heartbeat-runs/"))return {
        agentId:AGENT,companyId:COMPANY,status:"running",contextSnapshot:{issueId:runIssueId},
      };
      return null;
    },
  } as never;
}
async function fixture(issueId=ISSUE){
  const dir=await mkdtemp(join(tmpdir(),"p1-gateway-apply-"));
  const req=join(dir,"requests"),res=join(dir,"results"),ledger=join(dir,"ledger");
  await Promise.all([mkdir(req),mkdir(res),mkdir(ledger)]);
  const old={ledger:process.env.PAPERCLIP_PLATFORM_OPS_LEDGER_DIR,
    req:process.env.PAPERCLIP_HOST_OPS_REQUESTS_DIR,res:process.env.PAPERCLIP_HOST_OPS_RESULTS_DIR};
  process.env.PAPERCLIP_PLATFORM_OPS_LEDGER_DIR=ledger;
  process.env.PAPERCLIP_HOST_OPS_REQUESTS_DIR=req;
  process.env.PAPERCLIP_HOST_OPS_RESULTS_DIR=res;
  const planId=randomUUID();
  await writeFile(join(ledger,"plan-"+planId+".json"),JSON.stringify({
    planId,service:"paperclip-mcp-gateway",environment:"production",
    operations:["mcp.gateway.release","host.deployment_verify"],
    sourceSha:SHA,artifactDigest:SHA,issueId,
  }));
  return {planId,req,res,cleanup:async()=>{
    for(const [k,v] of Object.entries(old)) {
      const name=k==="ledger"?"PAPERCLIP_PLATFORM_OPS_LEDGER_DIR":k==="req"?"PAPERCLIP_HOST_OPS_REQUESTS_DIR":"PAPERCLIP_HOST_OPS_RESULTS_DIR";
      if(v===undefined)delete process.env[name];else process.env[name]=v;
    }
    await rm(dir,{recursive:true,force:true});
  }};
}
describe("gateway apply real host-result contract",()=>{
  it("refuses a plan scoped to a foreign issue without submitting a host operation",async()=>{
    const f=await fixture(FOREIGN);
    try{
      const tool=createP1PlatformTools(fakeClient(ISSUE)).find(x=>x.name==="paperclipHostApplyDeployment")!;
      const r=await tool.execute({planId:f.planId,runId:RUN});
      expect(r.content[0]!.text).toContain("scope_denied");
      expect(await readdir(f.req)).toEqual([]);
    }finally{await f.cleanup();}
  });
  it("never declares VERIFIED on a misleading host success response",async()=>{
    const f=await fixture();
    try{
      const tool=createP1PlatformTools(fakeClient(ISSUE)).find(x=>x.name==="paperclipHostApplyDeployment")!;
      const work=tool.execute({planId:f.planId,runId:RUN});
      await new Promise(r=>setTimeout(r,100));
      await writeFile(join(f.res,f.planId+".json"),JSON.stringify({
        requestId:f.planId,target:"recreate-paperclip-mcp-gateway",status:"ok",ok:true,result:"PREFLIGHT_PASSED",errorCode:null,
      }));
      const r=await work;
      expect(r.content[0]!.text).toContain("verification_failed");
      expect(r.content[0]!.text).not.toContain('"state":"VERIFIED"');
    }finally{await f.cleanup();}
  });
  it("emits VERIFIED only for a matching live image digest and source SHA",async()=>{
    const f=await fixture();
    try{
      const tool=createP1PlatformTools(fakeClient(ISSUE)).find(x=>x.name==="paperclipHostApplyDeployment")!;
      const work=tool.execute({planId:f.planId,runId:RUN});
      await new Promise(r=>setTimeout(r,100));
      await writeFile(join(f.res,f.planId+".json"),JSON.stringify({
        requestId:f.planId,target:"recreate-paperclip-mcp-gateway",status:"ok",ok:true,
        result:"DEPLOY_VERIFIED source_sha="+SHA+" image_id="+IMAGE+" rollback_container=previous",
      }));
      const r=await work;
      const text=r.content[0]!.text;
      expect(JSON.parse(text).state).toBe("VERIFIED");
      expect(JSON.parse(text).deployedImageDigest).toBe(IMAGE);
      const reqs=await readdir(f.req);
      expect(reqs).toEqual([f.planId+".json"]);
    }finally{await f.cleanup();}
  });
});
