// Kanoniczny kontrakt bezpieczeństwa narzędzi MCP.
//
// Czysty moduł BEZ `node:*` i BEZ `process.env`: importowany przez oba
// entrypointy — lokalny serwer Wtyczki (`app/plugin/index.ts`) i produkcyjny
// Cloudflare Worker (`app/cloudflare-worker/src/mcp.ts`). Jeden zestaw
// securitySchemes dla obu, żeby schema narzędzia nie rozjeżdżały się
// między transportami.
//
// Kanoniczny origin Workera jest jego WŁASNYM authorization serverem (to
// Worker jest OAuth 2.1 AS dla klienta MCP, a Google — upstream IdP), dlatego
// `oauth2SecurityScheme()` przyjmuje issuer jawnie. Wartość domyślna
// (`OAUTH_ISSUER`) dotyczy wyłącznie lokalnego stacku Node, gdzie AS-em jest
// bezpośrednio Google OIDC.

export const OAUTH_ISSUER = "https://accounts.google.com";
export const OAUTH_SCOPES = ["openid", "email", "profile"] as const;

// Schemat bezpieczeństwa dla publicznego narzędzia demo (brak prywatnych danych).
// Lokalny kontrakt _meta.securitySchemes, wiążący przez contract.test.mjs
// (assert exact: type === "none" && requiresAuth === false). Nie jest to
// OpenAPI/OAuth scheme — publiczne narzędzie nie ma wymogu auth.
export const PUBLIC_SECURITY_SCHEME = {
  type: "none",
  requiresAuth: false,
  reason: "public demo tool; no private data leaves the local bundle",
} as const;

/** Schemat OAuth 2.1 Bearer dla narzędzi zwracających dane zalogowanego usera. */
export function oauth2SecurityScheme(issuer: string, scopes: readonly string[]) {
  return { type: "oauth2", issuer, scopes: [...scopes] } as const;
}

// Schemat dla narzędzi z prywatnymi danymi w lokalnym stacku Node.
export const OAUTH2_SECURITY_SCHEME = oauth2SecurityScheme(OAUTH_ISSUER, OAUTH_SCOPES);
