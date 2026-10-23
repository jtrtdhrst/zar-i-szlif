import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchAgentMe } from "../identity-retry.mjs";

const id = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const opts = { apiUrl: "http://127.0.0.1:3100/api", wait: async () => {} };
const good = () => new Response(JSON.stringify({ id, companyId: "c" }), {status:200,headers:{"content-type":"application/json"}});

test("identity retry binds original credential and runId, no substitution", async () => {
  const calls=[];
  const out=await fetchAgentMe("agent-key",runId,{...opts,fetchImpl:async (url,init)=>{calls.push({url,headers:init.headers,signal:init.signal});return good()}});
  assert.deepEqual(out,{id,companyId:"c"});
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,"http://127.0.0.1:3100/api/agents/me");
  assert.equal(calls[0].headers.Authorization,"Bearer agent-key");
  assert.equal(calls[0].headers["X-Paperclip-Run-Id"],runId);
  assert.ok(calls[0].signal);
});

test("401 and 403 never retry or elevate identity",async()=>{
  for(const code of [401,403]){
    let calls=0;
    const res=await fetchAgentMe("agent-key",runId,{...opts,fetchImpl:async()=>{calls++;return new Response(null,{status:code})}});
    assert.equal(res,null);assert.equal(calls,1);
  }
});

test("retry once on 503, then return same caller identity",async()=>{
  let calls=0,delays=[];
  const out=await fetchAgentMe("agent-key",null,{...opts,wait:async ms=>delays.push(ms),fetchImpl:async()=>++calls===1?new Response(null,{status:503}):good()});
  assert.equal(calls,2);assert.deepEqual(delays,[500]);assert.equal(out.id,id);
});

test("network error retries once, then succeeds",async()=>{
  let calls=0;
  const out=await fetchAgentMe("agent-key",runId,{...opts,fetchImpl:async()=>{if(++calls===1)throw new TypeError("network");return good()}});
  assert.equal(calls,2);assert.equal(out.id,id);
});

test("permanent 404 does not retry",async()=>{
  let calls=0;
  const out=await fetchAgentMe("agent-key",null,{...opts,fetchImpl:async()=>{calls++;return new Response(null,{status:404})}});
  assert.equal(out,null);assert.equal(calls,1);
});

test("persistent 500 or network failure is bounded to two calls",async()=>{
  for(const failing of [async()=>new Response(null,{status:500}),async()=>{throw Error("network")}]){
    let calls=0;
    const out=await fetchAgentMe("agent-key",runId,{...opts,fetchImpl:async()=>{calls++;return failing()}});
    assert.equal(out,null);assert.equal(calls,2);
  }
});

test("wrong identity, missing token and invalid response always fail closed",async()=>{
  let called=0;
  const fetchImpl=async()=>{called++;return new Response(JSON.stringify({id:"not-a-uuid"}),{status:200})};
  assert.equal(await fetchAgentMe("agent-key",null,{...opts,fetchImpl}),null);
  assert.equal(await fetchAgentMe("",null,{...opts,fetchImpl}),null);
  assert.equal(called,1);
});
