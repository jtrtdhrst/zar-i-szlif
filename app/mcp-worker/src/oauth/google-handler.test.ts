import { describe, expect, it } from "vitest";
import { createGoogleAuthHandler } from "./google-handler.js";

// The public product MCP must not expose any routes of the legacy panel.
describe("standalone product MCP OAuth route ownership", () => {
  const handler = createGoogleAuthHandler();
  for (const path of ["/panel", "/panel/secret", "/api/activities", "/api/skills", "/ui", "/preview", "/legacy"]) {
    it(`denies legacy route ${path}`, async () => {
      const response = await handler.fetch!(new Request("https://mcp.zariszlif.pl" + path), {} as never, {} as never);
      expect(response.status).toBe(404);
    });
  }
  it("denies invalid methods to login endpoints", async () => {
    const response = await handler.fetch!(new Request("https://mcp.zariszlif.pl/authorize", { method: "DELETE" }), {} as never, {} as never);
    expect(response.status).toBe(404);
  });
});
