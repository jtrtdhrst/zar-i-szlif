import { describe, expect, it } from "vitest";
import { mcpLandingResponse } from "./landing.js";

const origin = "https://mcp.zariszlif.pl";

describe("public product MCP landing (separate from the protocol)", () => {
  it.each(["/", "/docs"])("returns a Polish HTML page for GET %s", async path => {
    const res = mcpLandingResponse(new Request(origin + path), origin);
    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-type")).toContain("text/html");
    expect(res?.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await res?.text();
    expect(html).toContain("Żar i Szlif");
    expect(html).toContain(origin + "/mcp");
    expect(html).toContain("Jak podłączyć MCP");
    expect(html).not.toContain("GOOGLE_CLIENT_SECRET");
  });
  it.each(["/mcp", "/authorize", "/callback", "/token", "/register",
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-protected-resource/mcp", "/health"])(
    "does not intercept protocol/auth endpoint %s", path => {
      expect(mcpLandingResponse(new Request(origin + path), origin)).toBeNull();
    });
  it("never consumes non-GET requests, including root POST", () => {
    expect(mcpLandingResponse(new Request(origin + "/", { method: "POST" }), origin)).toBeNull();
  });
});
