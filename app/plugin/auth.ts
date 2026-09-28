// Kontrakt auth/readiness dla Wtyczki / MCP.
//
// - Prywatne dane wymagają OAuth 2.1; walidacja tokenów należy do
//   istniejącego stosu (Cloudflare Worker, Google OpenID Connect) —
//   ten serwer nie buduje własnego IdP i nie weryfikuje JWT lokalnie.
// - Autoryzacja jest rozstrzygana per request (resolveAuth), nie per sesja.
// - Serwer nigdy nie czyta ani nie loguje treści rozmów / historii /
//   ciał JSON-RPC poza obsługą protokołu przez SDK (brak chat harvesting).
// - Narzędzie demo jest publiczne (securitySchemes: none); przyszłe
//   narzędzia z prywatnymi danymi muszą wołać requireAuth() (fail-closed).

export const OAUTH_ISSUER = "https://accounts.google.com";
export const OAUTH_SCOPES = ["openid", "email", "profile"] as const;

// Schemat bezpieczeństwa dla publicznego narzędzia demo (brak prywatnych danych).
export const PUBLIC_SECURITY_SCHEME = {
  type: "none",
  reason: "public demo tool; no private data leaves the local bundle",
} as const;

// Schemat dla przyszłych narzędzi z prywatnymi danymi (OAuth 2.1 Bearer).
export const OAUTH2_SECURITY_SCHEME = {
  type: "oauth2",
  issuer: OAUTH_ISSUER,
  scopes: [...OAUTH_SCOPES],
} as const;

export type AuthContext = { anonymous: true } | { anonymous: false; bearerPresent: true };

// Per-request: obecność nagłówka Bearer bez logowania jego wartości.
export function resolveAuth(req: { headers: Record<string, unknown> }): AuthContext {
  const header = req.headers["authorization"];
  if (typeof header === "string" && /^bearer\s+\S+$/i.test(header)) {
    return { anonymous: false, bearerPresent: true };
  }
  return { anonymous: true };
}

// Fail-closed dla przyszłych prywatnych narzędzi (adapter point).
export function requireAuth(auth: AuthContext): void {
  if (auth.anonymous) {
    const error = new Error("unauthorized: Bearer token required");
    (error as { status?: number }).status = 401;
    throw error;
  }
}

export function protectedResourceMetadata(resource: string) {
  return {
    resource,
    authorization_servers: [OAUTH_ISSUER],
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ["header"],
  };
}
