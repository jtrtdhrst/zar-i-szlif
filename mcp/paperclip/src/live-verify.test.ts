import { describe, expect, it } from "vitest";
import {
  PUBLIC_APP_BASE_DEFAULT,
  PUBLIC_MCP_BASE_DEFAULT,
  commentCanarySkipReason,
  parseMcpStreamBody,
  resolvePublicMcpBase,
} from "./live-verify.js";

describe("MCP smoke comment-canary safety", () => {
  it.each(["done", "cancelled", "blocked", "in_review", "todo"])("never canaries issue status %s", (status) => {
    expect(commentCanarySkipReason(status, false, false)).not.toBeNull();
  });

  it("allows a fresh canary only on an idle backlog issue", () => {
    expect(commentCanarySkipReason("backlog", false, false)).toBeNull();
  });

  it("suppresses a canary replay when requestId is supplied", () => {
    expect(commentCanarySkipReason("backlog", false, true)).toMatch(/requestId replay/i);
  });

  it("suppresses canaries while an issue has a live execution", () => {
    expect(commentCanarySkipReason("backlog", true, false)).toMatch(/live execution/i);
  });
});

describe("public MCP endpoint resolution (Phase 1)", () => {
  it("defaults to the named-tunnel MCP domain, not the app domain", () => {
    delete process.env.MCP_PUBLIC_BASE_URL;
    expect(resolvePublicMcpBase()).toBe(PUBLIC_MCP_BASE_DEFAULT);
    expect(resolvePublicMcpBase()).not.toBe(PUBLIC_APP_BASE_DEFAULT);
    expect(PUBLIC_MCP_BASE_DEFAULT).toContain("paperclip-mcp.kompaszbiorek.pl");
  });
  it("honors the configured MCP_PUBLIC_BASE_URL and strips trailing slashes", () => {
    process.env.MCP_PUBLIC_BASE_URL = "https://example.invalid///";
    expect(resolvePublicMcpBase()).toBe("https://example.invalid");
    delete process.env.MCP_PUBLIC_BASE_URL;
  });
});

describe("parseMcpStreamBody", () => {
  it("parses plain JSON-RPC bodies", () => {
    expect(parseMcpStreamBody('{"jsonrpc":"2.0","id":1,"result":{}}', "application/json")).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {},
    });
  });
  it("parses SSE event streams by last data frame", () => {
    const raw = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"a":1}}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"a":2}}\n\n';
    expect(parseMcpStreamBody(raw, "text/event-stream")).toEqual({ jsonrpc: "2.0", id: 1, result: { a: 2 } });
  });
  it("returns null on empty or unparseable bodies", () => {
    expect(parseMcpStreamBody("", "application/json")).toBeNull();
    expect(parseMcpStreamBody("not-json", "application/json")).toBeNull();
    expect(parseMcpStreamBody("event: ping\n\n", "text/event-stream")).toBeNull();
  });
});
