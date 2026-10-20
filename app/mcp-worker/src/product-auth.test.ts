import { describe, expect, it } from "vitest";

import { createGoogleAuthHandler } from "../../cloudflare-worker/src/google-handler.js";
import { PRODUCT_GOOGLE_SCOPES, PRODUCT_SERVER_INFO } from "./product-auth.js";

/** Minimalny stub środowiska Workera: handler potrzebuje tylko AS-a, klucza cookie i KV. */
function stubEnv() {
  return {
    OAUTH_PROVIDER: {
      parseAuthRequest: async () => ({ clientId: "test-client", clientIdIssuedAt: 1 }),
      lookupClient: async () => ({
        clientId: "test-client",
        clientName: "Test MCP Client",
        clientUri: "https://example.com",
      }),
    },
    COOKIE_ENCRYPTION_KEY: "test-cookie-encryption-key",
    GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
    OAUTH_KV: {
      get: async () => null,
      put: async () => undefined,
      delete: async () => undefined,
    },
  } as never;
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

async function consentHtml(options: Parameters<typeof createGoogleAuthHandler>[0]): Promise<string> {
  const handler = createGoogleAuthHandler(options);
  const request = new Request(
    "https://mcp.zariszlif.pl/authorize?client_id=test-client&response_type=code" +
      "&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fconnector%2Foauth%2Fcb" +
      "&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256",
  );
  const response = await handler.fetch!(request, stubEnv(), ctx);
  expect(response.status).toBe(200);
  return response.text();
}

describe("produktowy MCP — ekran zgody Google", () => {
  it("pokazuje brand Żar i Szlif, a nie legacy Kompas Zbiórek", async () => {
    const html = await consentHtml({ widgetHtml: "", serverInfo: PRODUCT_SERVER_INFO });
    expect(html).toContain("Żar i Szlif");
    expect(html).not.toContain("Kompas Zbiórek");
  });

  it("nie zmienia brandu panelu legacy, który woła handler bez nadpisań", async () => {
    const html = await consentHtml({ widgetHtml: "" });
    expect(html).toContain("Kompas Zbiórek");
  });

  it("prosi Google tylko o zakresy identyfikacyjne (bez Drive/Calendar)", () => {
    expect(PRODUCT_GOOGLE_SCOPES).toEqual(["openid", "email", "profile"]);
    expect(PRODUCT_GOOGLE_SCOPES.join(" ")).not.toContain("googleapis.com/auth");
  });
});
