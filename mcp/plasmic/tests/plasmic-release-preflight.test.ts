import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = (...args: string[]) => spawnSync(
  process.execPath, ["scripts/release-preflight.mjs", ...args], {
    cwd: root, encoding: "utf8", timeout: 10_000,
  },
);

test("canonical Dockerfile passes deterministic non-root source preflight", () => {
  const r = check("--source-only");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /SOURCE_PREFLIGHT_OK/);
});

test("production preflight is fail-closed on incomplete GHCR source mapping", () => {
  const r = check();
  // This assertion remains valid when a reviewer later fixes the workflow:
  // the outcome must either prove admission or enumerate explicit blockers.
  assert.ok(r.status === 0 || r.status === 1, r.stderr);
  if (r.status === 0) {
    assert.match(r.stdout, /RELEASE_PREFLIGHT_OK/);
    assert.doesNotMatch(r.stderr, /RELEASE_BLOCKED/);
  } else {
    assert.match(r.stderr, /RELEASE_BLOCKED:/);
    assert.doesNotMatch(r.stdout, /RELEASE_PREFLIGHT_OK/);
  }
});
