import test from "node:test";
import assert from "node:assert/strict";
import { AuthError, createAuthenticator, extractBearerToken, verifyAccessToken } from "../src/auth.ts";
import { TEST_SECRET, TEST_USER_ID, signToken, validClaims, validToken } from "./helpers/jwt.ts";

const options = { secret: TEST_SECRET };

test("a valid Supabase access token yields the actor subject", () => {
  const actor = verifyAccessToken(validToken(), options);
  assert.equal(actor.sub, TEST_USER_ID);
});

test("accepts a token whose aud is an array containing authenticated", () => {
  const token = signToken(validClaims({ aud: ["authenticated", "other"] }));
  assert.equal(verifyAccessToken(token, options).sub, TEST_USER_ID);
});

test("missing Authorization header is rejected as missing_token", () => {
  assert.throws(
    () => extractBearerToken(undefined),
    (error: unknown) => error instanceof AuthError && error.reason === "missing_token",
  );
  assert.throws(
    () => extractBearerToken("Basic abcdef"),
    (error: unknown) => error instanceof AuthError && error.reason === "missing_token",
  );
});

test("expired token is rejected", () => {
  const now = Math.floor(Date.now() / 1000);
  const token = signToken(validClaims({ iat: now - 7200, exp: now - 60 }));
  assert.throws(
    () => verifyAccessToken(token, options),
    (error: unknown) => error instanceof AuthError && error.reason === "expired",
  );
});

test("token without exp is rejected", () => {
  const claims = validClaims();
  delete claims.exp;
  assert.throws(
    () => verifyAccessToken(signToken(claims), options),
    (error: unknown) => error instanceof AuthError && error.reason === "malformed_token",
  );
});

test("bad signature is rejected", () => {
  const token = signToken(validClaims(), { secret: "a-different-secret" });
  assert.throws(
    () => verifyAccessToken(token, options),
    (error: unknown) => error instanceof AuthError && error.reason === "bad_signature",
  );
});

test("tampered payload is rejected", () => {
  const [header, , signature] = validToken().split(".") as [string, string, string];
  const forgedPayload = Buffer.from(
    JSON.stringify(validClaims({ sub: "attacker-controlled-subject" })),
    "utf8",
  ).toString("base64url");
  const token = `${header}.${forgedPayload}.${signature}`;
  assert.throws(
    () => verifyAccessToken(token, options),
    (error: unknown) => error instanceof AuthError && error.reason === "bad_signature",
  );
});

test("alg:none is rejected before signature handling", () => {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(validClaims())).toString("base64url");
  for (const token of [`${header}.${payload}.`, `${header}.${payload}.anything`]) {
    assert.throws(
      () => verifyAccessToken(token, options),
      (error: unknown) => error instanceof AuthError && error.reason === "unsupported_algorithm",
    );
  }
});

test("RS256 header is rejected", () => {
  const token = signToken(validClaims(), { alg: "RS256" });
  assert.throws(
    () => verifyAccessToken(token, options),
    (error: unknown) => error instanceof AuthError && error.reason === "unsupported_algorithm",
  );
});

test("wrong audience is rejected", () => {
  const token = signToken(validClaims({ aud: "anon" }));
  assert.throws(
    () => verifyAccessToken(token, options),
    (error: unknown) => error instanceof AuthError && error.reason === "wrong_audience",
  );
});

test("token without a subject is rejected", () => {
  const token = signToken(validClaims({ sub: "" }));
  assert.throws(
    () => verifyAccessToken(token, options),
    (error: unknown) => error instanceof AuthError && error.reason === "missing_subject",
  );
});

test("not-yet-valid token is rejected", () => {
  const now = Math.floor(Date.now() / 1000);
  const token = signToken(validClaims({ nbf: now + 600 }));
  assert.throws(
    () => verifyAccessToken(token, options),
    (error: unknown) => error instanceof AuthError && error.reason === "not_yet_valid",
  );
});

test("pinned issuer is enforced when configured", () => {
  const strict = { secret: TEST_SECRET, issuer: "https://project.supabase.co/auth/v1" };
  assert.throws(
    () => verifyAccessToken(validToken(), strict),
    (error: unknown) => error instanceof AuthError && error.reason === "wrong_issuer",
  );
  const token = signToken(
    validClaims({ iss: "https://project.supabase.co/auth/v1" }),
  );
  assert.equal(verifyAccessToken(token, strict).sub, TEST_USER_ID);
});

test("malformed tokens are rejected without throwing anything else", () => {
  for (const token of ["", "abc", "a.b", "a.b.c.d", "!!!.???.###"]) {
    assert.throws(
      () => verifyAccessToken(token, options),
      (error: unknown) => error instanceof AuthError,
      token,
    );
  }
});

test("the authenticator maps a header to an actor and never echoes the token", () => {
  const authenticate = createAuthenticator(options);
  const token = validToken();
  assert.equal(authenticate(`Bearer ${token}`).sub, TEST_USER_ID);

  let failure: AuthError | undefined;
  try {
    authenticate(`Bearer ${signToken(validClaims({ exp: 1 }))}`);
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    failure = error;
  }
  if (failure === undefined) {
    assert.fail("expected an AuthError for an expired token");
    return;
  }
  assert.ok(!failure.message.includes(token), "auth error leaked the token");
  assert.ok(!failure.stack?.includes(token), "auth error stack leaked the token");
});
