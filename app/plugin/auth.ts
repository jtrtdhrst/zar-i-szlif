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

import { createHash } from "node:crypto";

// Schemat bezpieczeństwa dla publicznego narzędzia demo (brak prywatnych danych).
// Lokalny kontrakt _meta.securitySchemes, wiążący przez contract.test.mjs
// (assert exact: type === "none" && requiresAuth === false). Nie jest to
// OpenAPI/OAuth scheme — publiczne narzędzie nie ma wymogu auth.
export const PUBLIC_SECURITY_SCHEME = {
  type: "none",
  requiresAuth: false,
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

// Stabilny, serwerowy identyfikator podmiotu z tokenu Bearer (sha256,
// nigdy sam token; nie logować). Izolacja scope bez lokalnej weryfikacji
// JWT: ten serwer nie ufa żadnemu user_id z argumentów klienta — tożsamość
// pochodzi wyłącznie stąd. Prod upgrade: prawdziwy `sub` z weryfikacji
// w Workerze (window.__KOMPAS_OAUTH__), ten hash to fallback dla opaque tokenów.
//
// ponytail: jeden hash zamiast stosu JWT; upgrade gdy Worker poda sub.
export function bearerSubject(authorizationHeader: string): string | null {
  const m = /^bearer\s+(\S+)$/i.exec(authorizationHeader.trim());
  if (!m) return null;
  return `bearer:${createHash("sha256").update(m[1]).digest("hex")}`;
}
// Strukturalny gate dla przyszłych prywatnych narzędzi: owiń handler,
// żeby rejestracja bez auth była niemożliwa bez wywołania tego wrappera.
// Demo (publiczne) go nie używa — pokryte testem jednostkowym w kontrakcie.
// Token flow dla prywatnych danych należy do Workera (window.__KOMPAS_OAUTH__);
// GET / tego serwera celowo serwuje publiczny bundle demo bez iniekcji tokenów.
export function guardPrivateTool<TArgs extends unknown[], TResult>(
  auth: AuthContext,
  handler: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    requireAuth(auth);
    return handler(...args);
  };
}

// Kanoniczny origin dla RFC 9728 metadata. PLUGIN_PUBLIC_ORIGIN (np.
// https://mcp.kompaszbiorek.pl) ma pierwszeństwo i jest jedyną ścieżką prod.
// Fallback bez env: tylko loopback (localhost/127.0.0.1/::1, test/dev).
// Wszystko inne -> null -> endpoint zwraca 400 zamiast odbicia Host atakującego.
const LOOPBACK_RE = /^(localhost|127\.0\.0\.1|\[?::1\]?)(:\d+)?$/i;
// F3: origin to schemat + host (bez ścieżki/query/credentials) — inaczej
// `https://x/y` sklejałoby się w `https://x/y/mcp`, a `https://u:p@x` wbiłoby
// sekrety w identyfikator `resource`. http tylko dla loopback.
const ORIGIN_RE = /^(https:\/\/[^\s/?#@]+|http:\/\/(?:localhost|127\.0\.0\.1|\[?::1\]?)(?::\d+)?)$/i;

// "" = nieustawione. Błędna wartość to błąd konfiguracji (zaufane wejście),
// nie atak — dlatego głośny throw zamiast cichego odbicia verbatim.
function configuredOrigin(): string {
  const origin = (process.env.PLUGIN_PUBLIC_ORIGIN ?? "").trim().replace(/\/+$/, "");
  if (origin && !ORIGIN_RE.test(origin)) {
    throw new Error(
      `PLUGIN_PUBLIC_ORIGIN is invalid: ${JSON.stringify(origin)}. ` +
        `Expected an origin like https://mcp.kompaszbiorek.pl (scheme https + host only, ` +
        `no path/query/credentials; http only for localhost/127.0.0.1/::1). ` +
        `It is echoed verbatim into the RFC 9728 "resource" identifier.`,
    );
  }
  return origin;
}

/** Asert schematu przy starcie (wołany z entrypointu): zły origin ma padać głośno. */
export function assertPluginPublicOrigin(): void {
  configuredOrigin();
}

export function publicResourceUrl(req: {
  protocol: string;
  get: (name: string) => string | undefined;
}): string | null {
  const configured = configuredOrigin();
  if (configured) return `${configured}/mcp`;
  const host = (req.get("host") ?? "").trim();
  if (!LOOPBACK_RE.test(host)) return null;
  const proto = req.protocol === "https" ? "https" : "http";
  return `${proto}://${host}/mcp`;
}

export function protectedResourceMetadata(resource: string) {
  return {
    resource,
    authorization_servers: [OAUTH_ISSUER],
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ["header"],
  };
}
