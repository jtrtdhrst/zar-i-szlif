import { describe, expect, it } from "vitest";
import { mcpLandingResponse } from "./landing.js";

const origin = "https://mcp.zariszlif.pl";

/** WCAG 2.1 relative luminance + contrast ratio for #rrggbb pairs. */
const luminance = (hex: string): number => {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
};
const contrast = (a: string, b: string): number => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};
const colorOf = (html: string, pattern: RegExp): string => html.match(pattern)?.[1] ?? "";

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
  it("keeps landing text contrast at WCAG AA 4.5:1", async () => {
    const html = (await mcpLandingResponse(new Request(origin + "/"), origin)?.text()) ?? "";
    const background = colorOf(html, /:root\{[^}]*background:(#[0-9a-f]{6})/i);
    const brandSuffix = colorOf(html, /font-weight:500;color:(#[0-9a-f]{6})/i);
    const footer = colorOf(html, /footer\{[^}]*color:(#[0-9a-f]{6})/i);
    expect(background).toMatch(/^#[0-9a-f]{6}$/i);
    expect(brandSuffix).toMatch(/^#[0-9a-f]{6}$/i);
    expect(footer).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrast(brandSuffix, background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(footer, background)).toBeGreaterThanOrEqual(4.5);
  });
  it("gives header nav links a WCAG 2.2 SC 2.5.8 target size", async () => {
    const html = (await mcpLandingResponse(new Request(origin + "/"), origin)?.text()) ?? "";
    expect(html).toMatch(/nav a\{[^}]*padding:8px 0/);
  });
});
