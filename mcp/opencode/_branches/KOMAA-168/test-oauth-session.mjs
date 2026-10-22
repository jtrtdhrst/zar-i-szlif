import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Usage: node test-oauth-session.mjs [1|2]
// Phase 1: fresh flows A/B/C/F + stale-token fabrication, then persist state and exit.
// Restart the gateway between phases (persistence under test).
// Phase 2: D (session survives restart), G (stale refresh rejected), E (logout), audit hygiene.

const base = process.env.OPENCODE_CTB_TEST_URL || "http://127.0.0.1:4097";
const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeDir = path.join(here, ".runtime");
const phase = process.argv[2] || "1";
const stateFile = path.join(runtimeDir, "test-oauth-state.json");
const credentials = Object.fromEntries(
  fs.readFileSync(path.join(runtimeDir, "credentials.txt"), "utf8").trim().split(/\r?\n/).map((line) => line.split(/=(.*)/, 2)),
);

const resource = (await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json()).resource;
const redirectUri = "http://127.0.0.1/callback";
function pkce() {
  const verifier = crypto.randomBytes(48).toString("base64url");
  return { verifier, challenge: crypto.createHash("sha256").update(verifier).digest("base64url") };
}
function authorizeUrl(clientId, challenge, state) {
  const url = new URL(`${base}/oauth/authorize`);
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", resource, scope: "offline_access mcp:read mcp:write", code_challenge: challenge, code_challenge_method: "S256", state }).toString();
  return url.toString();
}
async function formLogin(clientId, challenge, state) {
  return fetch(`${base}/oauth/authorize`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    redirect: "manual",
    body: new URLSearchParams({ username: credentials.username, password: credentials.password, client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "offline_access mcp:read mcp:write", state, resource, code_challenge: challenge, code_challenge_method: "S256" }),
  });
}
async function exchange(clientId, code, verifier) {
  const response = await fetch(`${base}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, redirect_uri: redirectUri, code, code_verifier: verifier }) });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}
async function refreshToken(clientId, tokenValue) {
  return fetch(`${base}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: tokenValue }) });
}

async function registerClient() {
  const registration = await fetch(`${base}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: `OAuth session regression ${phase}`, redirect_uris: [redirectUri] }) });
  assert.equal(registration.status, 201);
  return (await registration.json()).client_id;
}

if (phase === "1") {
  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.ok, true);
  const clientId = await registerClient();

  // A: first authorize without cookie -> login page
  {
    const response = await fetch(authorizeUrl(clientId, pkce().challenge, "A"), { redirect: "manual" });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Autoryzuj/);
  }
  console.log("A first authorize without cookie -> login page: PASS");

  // B: successful login -> Set-Cookie Secure HttpOnly SameSite=Lax + tokens
  let sessionCookie;
  {
    const { challenge, verifier } = pkce();
    const response = await formLogin(clientId, challenge, "B");
    assert.equal(response.status, 302, await response.text());
    const setCookie = response.headers.get("set-cookie") || "";
    assert.match(setCookie, /^__Host-opencode_session=/);
    for (const attribute of ["Secure", "HttpOnly", "SameSite=Lax", "Path=/"]) assert.ok(setCookie.includes(attribute), `missing cookie attribute ${attribute}`);
    sessionCookie = setCookie.split(";")[0];
    const code = new URL(response.headers.get("location")).searchParams.get("code");
    const token = await exchange(clientId, code, verifier);
    assert.ok(token.access_token && token.refresh_token);
  }
  console.log("B successful login -> secure cookie + tokens: PASS");

  // C: second authorize with same cookie -> auto redirect, NO login page
  let refreshC;
  {
    const { challenge, verifier } = pkce();
    const response = await fetch(authorizeUrl(clientId, challenge, "C"), { redirect: "manual", headers: { cookie: sessionCookie } });
    assert.equal(response.status, 302, "expected auto-authorization redirect");
    assert.doesNotMatch(await response.text(), /Autoryzuj/);
    const code = new URL(response.headers.get("location")).searchParams.get("code");
    refreshC = (await exchange(clientId, code, verifier)).refresh_token;
  }
  console.log("C repeated authorize with cookie -> auto redirect, no login page: PASS");

  // F: two concurrent refresh requests with the same token -> consistent replacement
  let refreshF;
  {
    const [left, right] = await Promise.all([refreshToken(clientId, refreshC), refreshToken(clientId, refreshC)]);
    const leftBody = await left.json();
    const rightBody = await right.json();
    assert.equal(left.status, 200, JSON.stringify(leftBody));
    assert.equal(right.status, 200, JSON.stringify(rightBody));
    assert.equal(leftBody.refresh_token, rightBody.refresh_token, "grace-window replay must return identical replacement");
    refreshF = leftBody.refresh_token;
  }
  console.log("F concurrent refresh race -> both succeed, same rotation family: PASS");

  // Fabricate a stale rotated token (rotated > grace window ago) for phase 2 check G.
  const staleToken = `stale_${crypto.randomBytes(12).toString("hex")}`;
  {
    const refreshFileData = JSON.parse(fs.readFileSync(path.join(runtimeDir, "refresh-tokens.json"), "utf8"));
    refreshFileData[staleToken] = { clientId, scope: "offline_access mcp:read mcp:write", expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, rotatedAt: new Date(Date.now() - 61_000).toISOString(), replacement: "nonexistent-replacement" };
    fs.writeFileSync(path.join(runtimeDir, "refresh-tokens.json"), JSON.stringify(refreshFileData, null, 2), { mode: 0o600 });
  }

  fs.writeFileSync(stateFile, JSON.stringify({ clientId, sessionCookie, refreshF, staleToken }, null, 2), { mode: 0o600 });
  console.log("PHASE1 COMPLETE");
} else if (phase === "2") {
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  const { clientId, sessionCookie, refreshF, staleToken } = state;

  // D: after gateway restart the browser session still authorizes automatically
  {
    const { challenge, verifier } = pkce();
    const response = await fetch(authorizeUrl(clientId, challenge, "D"), { redirect: "manual", headers: { cookie: sessionCookie } });
    assert.equal(response.status, 302, "session must survive gateway restart");
    assert.doesNotMatch(await response.text(), /Autoryzuj/);
    const code = new URL(response.headers.get("location")).searchParams.get("code");
    await exchange(clientId, code, verifier);
  }
  console.log("D persistence across gateway restart: PASS");

  // G: replayed refresh outside grace window -> invalid_grant
  {
    const response = await refreshToken(clientId, staleToken);
    assert.equal(response.status, 400, String(response.status));
    assert.equal((await response.json()).error, "invalid_grant");
  }
  console.log("G stale refresh outside grace window -> invalid_grant: PASS");

  // E: logout revokes session and clears cookie
  {
    const logout = await fetch(`${base}/oauth/logout`, { method: "POST", headers: { cookie: sessionCookie }, redirect: "manual" });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie") || "", /^__Host-opencode_session=;/);
    const after = await fetch(authorizeUrl(clientId, pkce().challenge, "E"), { redirect: "manual", headers: { cookie: sessionCookie } });
    assert.equal(after.status, 200, "revoked session must require login again");
    assert.match(await after.text(), /Autoryzuj/);
  }
  console.log("E logout -> revoked session requires login: PASS");

  // Audit hygiene: no credentials, session cookies or refresh tokens in recent audit entries.
  {
    const auditTail = fs.readFileSync(path.join(runtimeDir, "ctb-audit.ndjson"), "utf8").split(/\r?\n/).slice(-400).join("\n");
    assert.ok(!auditTail.includes(credentials.password), "password leaked to audit");
    assert.ok(!auditTail.includes(sessionCookie), "session cookie leaked to audit");
    assert.ok(!auditTail.includes(refreshF), "refresh token leaked to audit");
    assert.ok(!auditTail.includes(staleToken), "fabricated refresh token leaked to audit");
  }
  console.log("Audit hygiene (no secrets): PASS");
  console.log("OAuth browser session + refresh rotation regression: PASS");
} else {
  throw new Error(`unknown phase ${phase}`);
}
