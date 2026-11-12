// Supabase Auth access-token verification.
//
// The product MCP accepts exactly the JWT that the application already
// receives from Supabase Auth (email/password now, Google later). Verification
// is local, HS256-only and never depends on a network round trip:
//   - `alg` must be exactly HS256 (`none`, `RS256`, … are rejected),
//   - the HMAC-SHA256 signature is compared in constant time,
//   - `aud` must contain `authenticated`,
//   - `exp`/`nbf` are enforced,
//   - `iss` is enforced only when the deployment pins SUPABASE_JWT_ISSUER.
//
// Nothing here logs, returns or stores the raw token.

import { createHmac, timingSafeEqual } from "node:crypto";

export type AuthFailureReason =
  | "missing_token"
  | "malformed_token"
  | "unsupported_algorithm"
  | "bad_signature"
  | "expired"
  | "not_yet_valid"
  | "wrong_audience"
  | "wrong_issuer"
  | "missing_subject";

export class AuthError extends Error {
  readonly reason: AuthFailureReason;

  constructor(reason: AuthFailureReason, message: string) {
    super(message);
    this.name = "AuthError";
    this.reason = reason;
  }
}

export interface AuthenticatedActor {
  /** Supabase Auth `sub` — the stable user id used by the application. */
  sub: string;
}

export interface VerifyOptions {
  secret: string;
  issuer?: string | undefined;
  /** Allowed clock skew in seconds. Defaults to 0. */
  clockToleranceSec?: number;
  /** Injectable clock (seconds since epoch) for deterministic tests. */
  now?: number;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const REQUIRED_AUDIENCE = "authenticated";

function b64urlToBuffer(segment: string): Buffer {
  return Buffer.from(segment, "base64url");
}

function decodeJsonSegment(segment: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(b64urlToBuffer(segment).toString("utf8"));
  } catch {
    throw new AuthError("malformed_token", "token segment is not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AuthError("malformed_token", "token segment is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/**
 * Extract the token from an `Authorization` header. Only the `Bearer` scheme is
 * accepted; the token itself is returned to the caller and never logged here.
 */
export function extractBearerToken(header: string | undefined): string {
  if (!header) throw new AuthError("missing_token", "missing Authorization header");
  const match = /^Bearer[ ]+(\S+)$/i.exec(header.trim());
  if (!match?.[1]) throw new AuthError("missing_token", "Authorization header is not a Bearer token");
  return match[1];
}

function audienceContains(aud: unknown): boolean {
  if (typeof aud === "string") return aud.split(/[\s,]+/).includes(REQUIRED_AUDIENCE);
  if (Array.isArray(aud)) return aud.some((entry) => entry === REQUIRED_AUDIENCE);
  return false;
}

function numericClaim(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AuthError("malformed_token", `claim ${key} is not a number`);
  }
  return value;
}

/**
 * Verify a Supabase access token and return the authenticated actor.
 * Throws `AuthError` for every rejection path.
 */
export function verifyAccessToken(token: string, options: VerifyOptions): AuthenticatedActor {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("malformed_token", "token must have three segments");
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
  if (!BASE64URL.test(encodedHeader)) throw new AuthError("malformed_token", "token header is not base64url");

  // The algorithm check comes before signature decoding so `alg: none` can
  // never be mistaken for a well-formed unsigned token.
  const header = decodeJsonSegment(encodedHeader);
  if (header.alg !== "HS256") {
    throw new AuthError("unsupported_algorithm", "only HS256 tokens are accepted");
  }

  for (const segment of [encodedPayload, encodedSignature]) {
    if (!BASE64URL.test(segment)) throw new AuthError("malformed_token", "token segments must be base64url");
  }
  if (header.typ !== undefined && header.typ !== "JWT") {
    throw new AuthError("malformed_token", "unexpected token type");
  }

  const expected = createHmac("sha256", options.secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  const provided = b64urlToBuffer(encodedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new AuthError("bad_signature", "token signature does not match");
  }

  const payload = decodeJsonSegment(encodedPayload);
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const tolerance = options.clockToleranceSec ?? 0;

  const exp = numericClaim(payload, "exp");
  if (exp === undefined) throw new AuthError("malformed_token", "token has no exp claim");
  if (exp + tolerance <= now) throw new AuthError("expired", "token is expired");

  const nbf = numericClaim(payload, "nbf");
  if (nbf !== undefined && nbf - tolerance > now) {
    throw new AuthError("not_yet_valid", "token is not valid yet");
  }

  if (!audienceContains(payload.aud)) {
    throw new AuthError("wrong_audience", `token audience must contain ${REQUIRED_AUDIENCE}`);
  }

  if (options.issuer !== undefined) {
    const iss = payload.iss;
    if (typeof iss !== "string" || iss.replace(/\/+$/, "") !== options.issuer) {
      throw new AuthError("wrong_issuer", "token issuer does not match the pinned issuer");
    }
  }

  const sub = payload.sub;
  if (typeof sub !== "string" || sub.trim() === "") {
    throw new AuthError("missing_subject", "token has no subject");
  }

  return { sub };
}

export interface Authenticator {
  /** Verify an `Authorization` header value. Throws `AuthError`. */
  (authorizationHeader: string | undefined): AuthenticatedActor;
}

export function createAuthenticator(options: VerifyOptions): Authenticator {
  return (authorizationHeader) => verifyAccessToken(extractBearerToken(authorizationHeader), options);
}
