#!/usr/bin/env node
/**
 * Live MCP protocol + auth smoke: READ-ONLY by default. Never prints credentials.
 * Required env: MCP_SMOKE_URL, MCP_SMOKE_BEARER.
 * Optional: MCP_SMOKE_ISSUE_ID, MCP_SMOKE_ALLOW_WRITE=1,
 * MCP_SMOKE_CANCEL_ISSUE_ID (requires MCP_SMOKE_ALLOW_CANCEL=1).
 * All mutating targets must be disposable, pre-verified fixtures.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const url = process.env.MCP_SMOKE_URL;
const bearer = process.env.MCP_SMOKE_BEARER;
if (!url || !bearer) {
  console.error("Missing MCP_SMOKE_URL or MCP_SMOKE_BEARER; use deployment secret injection.");
  process.exit(2);
}
if (!/^https:\/\//i.test(url)) throw new Error("HTTPS endpoint required");
const results = [];
let sessionId = null;
let nextId = 1;
function decode(raw) {
  try { return JSON.parse(raw); } catch {}
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      try { return JSON.parse(line.slice(5).trim()); } catch {}
    }
  }
  throw new Error("No valid JSON-RPC response; body omitted for credential safety");
}
async function rpc(method, params = {}, credential = bearer) {
  const headers = {
    "content-type": "application/json",
    "accept": "application/json, text/event-stream",
    "mcp-protocol-version": "2025-06-18",
    authorization: "Bearer " + credential,
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const response = await fetch(url, {
    method: "POST", headers,
    body: JSON.stringify({ jsonrpc:"2.0",id:nextId++,method,params }),
    signal: AbortSignal.timeout(30000),
    redirect: "manual",
  });
  const newId = response.headers.get("mcp-session-id");
  if (newId) sessionId = newId;
  const text = await response.text();
  const payload = text ? decode(text) : null;
  return {status:response.status,payload,challenge:response.headers.has("www-authenticate")};
}
function unpack(reply) {
  assert.equal(reply.status,200,"Unexpected HTTP status " + reply.status);
  assert.ok(!reply.payload?.error,reply.payload?.error?.message || "JSON-RPC error");
  assert.ok(!reply.payload?.result?.isError,JSON.stringify(reply.payload?.result?.content || []));
  const r = reply.payload?.result;
  if (r?.structuredContent && typeof r.structuredContent === "object") return r.structuredContent;
  const text = r?.content?.find(c => c.type === "text")?.text;
  if (text) { try { return JSON.parse(text); } catch { return text; } }
  return r;
}
async function check(label, fn) {
  try {
    const result = await fn();
    results.push({label,status:"PASS", ...(result || {})});
  } catch (error) {
    results.push({label,status:"FAIL",reason:String(error.message || error).slice(0,240)});
    process.exitCode = 1;
  }
}
async function call(name,args={}) {
  return unpack(await rpc("tools/call",{name,arguments:args}));
}
await check("MCP initialize",async () => {
  const response = await rpc("initialize",{
    protocolVersion:"2025-06-18",
    capabilities:{},clientInfo:{name:"paperclip-auth-canary",version:"1.0.0"},
  });
  assert.ok(response.payload?.result?.protocolVersion);
});
await check("unauthorized-denied",async () => {
  const r = await rpc("tools/list",{},"invalid-canary-credential");
  assert.ok(r.status===401||r.status===403);
});
let toolNames = [];
await check("tools/list",async () => {
  const seen=new Set();let cursor;let exhausted=false;
  for(let page=0;page<30;page++){
    const r=unpack(await rpc("tools/list",cursor?{cursor}:{}));
    const items=r.tools || [];
    for(const t of items) {assert.ok(t.name && t.inputSchema);seen.add(t.name);}
    if(!r.nextCursor){exhausted=true;break;}
    cursor=r.nextCursor;
  }
  assert.equal(exhausted,true,"tools/list pagination never exhausted");
  toolNames=[...seen];
  assert.ok(toolNames.length>=100,"Registry unexpectedly small");
  return {count:toolNames.length};
});
await check("principal",async () => {
  const actor=await call("paperclipMe");
  assert.equal(actor.kind || actor.type,"board","Use actual Board OAuth credential, not COO agent key");
});
await check("health",async () => {
  const health=await call("paperclipGetSystemHealth");
  assert.ok(health.health?.status==="ok"||health.status==="ok");
});
await check("pagination-offset-0",async () => {
  const r=await call("paperclipListIssues",{limit:3,offset:0});
  assert.ok(Array.isArray(r));
  return {count:r.length};
});
await check("pagination-offset-1000",async () => {
  const r=await call("paperclipListIssues",{limit:3,offset:1000});
  assert.ok(Array.isArray(r));
  return {count:r.length};
});
const issueId=process.env.MCP_SMOKE_ISSUE_ID;
if(issueId) await check("read-fixture-issue",async () => {
  const x=await call("paperclipGetIssue",{issueId});assert.ok(x.id && x.status);
});
if(process.env.MCP_SMOKE_ALLOW_WRITE==="1"){
  if(!issueId) throw new Error("MCP_SMOKE_ISSUE_ID is mandatory for write fixture");
  await check("authorized-comment-and-readback",async () => {
    const marker="mcp-auth-smoke-"+randomUUID();
    await call("paperclipAddComment",{issueId,body:marker});
    const comments=await call("paperclipListComments",{issueId});
    assert.ok(JSON.stringify(comments).includes(marker),"Comment missing after confirmed write");
  });
}
const cancelId=process.env.MCP_SMOKE_CANCEL_ISSUE_ID;
if(cancelId && process.env.MCP_SMOKE_ALLOW_CANCEL==="1") {
  await check("authorized-cancel-and-readback",async () => {
    const before=await call("paperclipGetIssue",{issueId:cancelId});
    assert.ok(["todo","backlog","blocked"].includes(before.status),"Fixture not safely cancellable");
    await call("paperclipUpdateIssue",{issueId:cancelId,status:"cancelled"});
    const after=await call("paperclipGetIssue",{issueId:cancelId});
    assert.equal(after.status,"cancelled");
  });
}
if(process.env.MCP_SMOKE_CHAT_ID && process.env.MCP_SMOKE_ALLOW_CHAT==="1") {
  const chatId=process.env.MCP_SMOKE_CHAT_ID;
  await check("chat-message-and-readback",async () => {
    const marker="mcp-chat-smoke-"+randomUUID();
    await call("paperclipSendChatMessage",{chatId,message:marker,clientRequestId:randomUUID()});
    const read=await call("paperclipGetChatMessages",{chatId,limit:50});
    assert.ok(JSON.stringify(read).includes(marker),"Chat message not present after send");
  });
}
if(process.env.MCP_SMOKE_WAKE_AGENT_ID && process.env.MCP_SMOKE_ALLOW_WAKE==="1") {
  const agentId=process.env.MCP_SMOKE_WAKE_AGENT_ID;
  await check("agent-wakeup-and-run-readback",async () => {
    const before=await call("paperclipListRuns",{agentId,summary:true,limit:20});
    const rows=(x)=>Array.isArray(x)?x:Array.isArray(x?.runs)?x.runs:[];
    const old=new Set(rows(before).map(x=>x.id));
    await call("paperclipWakeupAgent",{agentId,source:"on_demand",triggerDetail:"manual",reason:"explicit MCP smoke fixture"});
    let observed=false;
    for(let i=0;i<6;i++){
      const after=await call("paperclipListRuns",{agentId,summary:true,limit:20});
      if(rows(after).some(x=>x.id&&!old.has(x.id))){observed=true;break;}
      await new Promise(resolve=>setTimeout(resolve,1500));
    }
    assert.equal(observed,true,"No new agent run observed; wake is not verified");
  });
}
console.log(JSON.stringify({checks:results,total:results.length,failed:results.filter(x=>x.status!=="PASS").length},null,2));
