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
  assert.equal(resolveService("mcp-edge-stage.51.89.174.58.sslip.io").error, "unknown_host");
  assert.equal(resolveService("mcp-edge-stage.51.89.174.58.sslip.io", {EDGE_STAGE_SERVICE:"paperclip"}).id, "paperclip");
});
