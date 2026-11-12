// Local HS256 JWT fixtures. No live Supabase and no real secret is ever needed.

import { createHmac } from "node:crypto";

export const TEST_SECRET = "local-test-jwt-secret-do-not-use";
export const TEST_USER_ID = "8f1c2b3a-4d5e-4f60-9a7b-1c2d3e4f5a6b";

function b64url(input: string | Buffer): string {
  return (typeof input === "string" ? Buffer.from(input, "utf8") : input).toString("base64url");
}

export interface SignOptions {
  secret?: string;
  alg?: string;
  typ?: string | null;
}

export function signToken(claims: Record<string, unknown>, options: SignOptions = {}): string {
  const header: Record<string, unknown> = { alg: options.alg ?? "HS256" };
  if (options.typ !== null) header.typ = options.typ ?? "JWT";

  const encodedHeader = b64url(JSON.stringify(header));
  const encodedPayload = b64url(JSON.stringify(claims));

  if (header.alg !== "HS256") return `${encodedHeader}.${encodedPayload}.`;

  const signature = createHmac("sha256", options.secret ?? TEST_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  return `${encodedHeader}.${encodedPayload}.${b64url(signature)}`;
}

export function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: TEST_USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "scout@example.test",
    iat: now - 30,
    exp: now + 3600,
    ...overrides,
  };
}

export function validToken(overrides: Record<string, unknown> = {}): string {
  return signToken(validClaims(overrides));
}
