import test from "node:test";
import assert from "node:assert/strict";
import { resolveService, SERVICES } from "../coolify-routing.mjs";
test("each production host has one unique MCP engine and no Penpot", () => {
  assert.equal(Object.keys(SERVICES).length, 8);
  assert.equal(Object.values(SERVICES).filter(x => x.id === "paperclip").length, 1);
  assert.equal(resolveService("penpot-mcp.zariszlif.pl").error, "unknown_host");
});
test("unconfigured privileged services deny by default", () => {
  for (const [host, record] of Object.entries(SERVICES)) {
    if (record.auth) assert.equal(resolveService(host, {}).error, "credentials_not_provisioned", host);
  }
});
test("paperclip rejects shared identity token, remains OAuth-only", () => {
  assert.equal(resolveService("paperclip-mcp.zariszlif.pl", {}).config.PAPERCLIP_AUTH_PROXY, "1");
  assert.equal(resolveService("paperclip-mcp.zariszlif.pl", {MCP_AUTH_TOKEN_PAPERCLIP:"shared"}).error, "paperclip_shared_secret_forbidden");
});
test("all credentialed edge services need separate caller and upstream secrets", () => {
  assert.equal(resolveService("qdrant-mcp.zariszlif.pl", {MCP_AUTH_TOKEN_QDRANT:"x"}).error, "credentials_not_provisioned");
  const r = resolveService("qdrant-mcp.zariszlif.pl", {MCP_AUTH_TOKEN_QDRANT:"x",UPSTREAM_TOKEN_QDRANT:"y"});
  assert.equal(r.config.MCP_AUTH_TOKEN, "x");
  assert.equal(r.config.UPSTREAM_TOKEN, "y");
});
test("reject unknown Host, spoofed Host suffixes, and stage bypasses", () => {
  assert.equal(resolveService("evil.com").error, "unknown_host");
  assert.equal(resolveService("paperclip-mcp.zariszlif.pl.evil.com").error, "unknown_host");
  assert.equal(resolveService("mcp-edge-stage.zariszlif.pl").error, "unknown_host");
  assert.equal(resolveService("mcp-edge-stage.zariszlif.pl", {EDGE_STAGE_SERVICE:"paperclip"}).id, "paperclip");
});
test("EDGE_SERVICE_ID pins a dedicated per-service app regardless of Host", () => {
  const env = {EDGE_SERVICE_ID:"qdrant",MCP_AUTH_TOKEN_QDRANT:"x",UPSTREAM_TOKEN_QDRANT:"y"};
  const r = resolveService("qdrant-edge.51.89.174.58.sslip.io:8787", env);
  assert.equal(r.id, "qdrant");
  assert.equal(r.config.UPSTREAM_URL, "https://qdrant-engine.zariszlif.pl/mcp");
  assert.equal(r.config.MCP_AUTH_TOKEN, "x");
  assert.equal(r.config.UPSTREAM_TOKEN, "y");
});
test("EDGE_SERVICE_ID fails closed on unknown ids and missing credentials", () => {
  assert.equal(resolveService("anything.example", {EDGE_SERVICE_ID:"nope"}).error, "unknown_host");
  assert.equal(resolveService("anything.example", {EDGE_SERVICE_ID:"qdrant"}).error, "credentials_not_provisioned");
  assert.equal(resolveService("anything.example", {EDGE_SERVICE_ID:"qdrant",MCP_AUTH_TOKEN_QDRANT:"x"}).error, "credentials_not_provisioned");
});
test("EDGE_SERVICE_ID keeps paperclip OAuth-only and stage behavior intact", () => {
  assert.equal(resolveService("anything.example", {EDGE_SERVICE_ID:"paperclip"}).config.PAPERCLIP_AUTH_PROXY, "1");
  assert.equal(resolveService("anything.example", {EDGE_SERVICE_ID:"paperclip",MCP_AUTH_TOKEN_PAPERCLIP:"s"}).error, "paperclip_shared_secret_forbidden");
  assert.equal(resolveService("mcp-edge-stage.zariszlif.pl", {EDGE_STAGE_SERVICE:"paperclip"}).id, "paperclip");
});
