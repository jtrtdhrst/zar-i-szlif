import test from "node:test";
import assert from "node:assert/strict";
import { resolvePrincipal } from "../../paperclip/mcp-gateway/principal.mjs";

const companyId = "11111111-1111-4111-8111-111111111111";
const agentId = "22222222-2222-4222-8222-222222222222";
const dep = {
  companyId,
  serviceTokens: ["SERVICE"],
  serviceAgentKey: "AGENT",
  serviceBoardKey: "INTERNAL",
  serviceAgentId: agentId,
  authenticateBoard: async (value) => value === "BOARD",
  fetchAgentMe: async (value) => value === "PERSONA" ? {id:agentId,companyId} : null,
};

test("service OAuth session has no implicit board grant", async () => {
  const p = await resolvePrincipal(dep,{token:"SERVICE"});
  assert.equal(p.kind,"service");
  assert.equal(p.boardApiKey,null);
});

test("board session is not represented as the fixed service agent",async () => {
  const p=await resolvePrincipal(dep,{token:"BOARD"});
  assert.equal(p.kind,"board");
  assert.equal(p.agentId,null);
  assert.equal(p.agentApiKey,null);
});

test("agent session has no implicit board grant",async () => {
  const p=await resolvePrincipal(dep,{token:"PERSONA"});
  assert.equal(p.kind,"agent");
  assert.equal(p.agentId,agentId);
  assert.equal(p.boardApiKey,null);
});

test("invalid identity is refused",async () => {
  const p=await resolvePrincipal(dep,{token:"UNKNOWN"});
  assert.equal(p.ok,false);
});

test("verified Board credential takes precedence over a matching service-token label",async () => {
  const p = await resolvePrincipal({ ...dep, serviceTokens: ["SERVICE", "BOARD"] },{token:"BOARD"});
  assert.equal(p.kind,"board");
  assert.equal(p.agentId,null);
  assert.equal(p.boardApiKey,"BOARD");
});

test("rejects Board credential paired with an unbound run ID", async () => {
  const p = await resolvePrincipal(dep,{token:"BOARD",rawRunId:"33333333-3333-4333-8333-333333333333"});
  assert.equal(p.ok,false);
  assert.equal(p.reason,"ambiguous_credential_scope");
});
test("rejects a service credential paired with an unbound run ID", async () => {
  const p = await resolvePrincipal(dep,{token:"SERVICE",rawRunId:"33333333-3333-4333-8333-333333333333"});
  assert.equal(p.ok,false);
  assert.equal(p.reason,"ambiguous_credential_scope");
});
