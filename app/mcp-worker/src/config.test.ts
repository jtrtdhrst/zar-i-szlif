import { describe, expect, it } from "vitest";
import { canonicalOrigin, requestHostAllowed } from "./config.js";

describe("product MCP origin isolation", () => {
  it("accepts only the configured HTTPS origin", () => {
    expect(canonicalOrigin("https://mcp.zariszlif.pl")).toBe("https://mcp.zariszlif.pl");
    expect(requestHostAllowed("https://mcp.zariszlif.pl/mcp", "https://mcp.zariszlif.pl")).toBe(true);
  });
  it.each(["http://mcp.zariszlif.pl","https://evil.example","https://mcp.zariszlif.pl.evil.example"])("rejects foreign host %s", host => {
    expect(requestHostAllowed(host+"/mcp", "https://mcp.zariszlif.pl")).toBe(false);
  });
  it.each(["http://mcp.zariszlif.pl","https://mcp.zariszlif.pl/path","https://u:p@mcp.zariszlif.pl","https://mcp.zariszlif.pl:9999",""] )("rejects unsafe origin %s", value => {
    expect(() => canonicalOrigin(value)).toThrow();
  });
});
