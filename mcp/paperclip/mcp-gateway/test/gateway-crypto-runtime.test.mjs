import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";

// The gateway cannot be imported into a portable CI runner because it depends
// on the pinned Paperclip runtime's absolute paths. Exercise the EXACT helper
// implementations from gateway.mjs in a sandbox populated only by imported
// crypto symbols; missing imports fail at runtime instead of passing --check.
const source = readFileSync(new URL("../gateway.mjs", import.meta.url), "utf8");
const cryptoImport = source.match(/^import\s*\{([^}]+)\}\s*from\s*["']node:crypto["'];?$/m);
assert.ok(cryptoImport, "gateway must explicitly import Node's crypto API");
const cryptoNames = cryptoImport[1].split(",").map((s) => s.trim());
const context = {};
if (cryptoNames.includes("createHash")) context.createHash = createHash;

function implementation(name) {
  const pattern = new RegExp(`^function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, "m");
  const match = source.match(pattern);
  assert.ok(match, `gateway implementation of ${name} must exist`);
  return match[0];
}

test("OAuth PKCE SHA-256 helper executes using only declared gateway imports", () => {
  const code = implementation("base64urlSha256") + '\nbase64urlSha256("verify-me")';
  const actual = runInNewContext(code, { ...context });
  const expected = createHash("sha256").update("verify-me").digest("base64url");
  assert.equal(actual, expected);
});

test("MCP token rate-limit key hashes token without exposing credentials", () => {
  const code = implementation("rateLimitKey")
    + '\nrateLimitKey({ headers: {}, socket: { remoteAddress: "127.0.0.1" } }, "secret-canary")';
  const actual = runInNewContext(code, { ...context });
  const expected = "tok:" + createHash("sha256").update("secret-canary").digest("hex");
  assert.equal(actual, expected);
  assert.ok(!actual.includes("secret-canary"));
});

test("anonymous rate-limit key remains per-client without requiring crypto", () => {
  const code = implementation("rateLimitKey")
    + '\nrateLimitKey({ headers: { "x-forwarded-for": "192.0.2.8, 192.0.2.9" } }, null)';
  assert.equal(runInNewContext(code, { ...context }), "ip:192.0.2.8");
});
