import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../../vps-ops-supervisor/deploy-canary.sh", import.meta.url));
const source = readFileSync(script, "utf8");

test("gateway supervisor lane rollout script is valid Bash", () => {
  const result = spawnSync("bash", ["-n", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("rollout pins a single target and immutable images", () => {
  assert.match(source, /GATEWAY=paperclip-mcp-gateway/);
  assert.match(source, /GATEWAY_IMAGE=sha256:e00d1ff3139d8671d38dc55e86855cbac577270577df82051b0cb206a777d104/);
  assert.match(source, /GATEWAY_PREVIOUS=sha256:531fa0b9d361104c9ca271bb4c9e88136bed5146e01aff0705af3c422fbf5eb0/);
  assert.match(source, /SUP_IMAGE=sha256:395595bb698a39832579ad4d15fbfc6ec07e9a2e763cb276a153b56cb93e8d69/);
  assert.match(source, /GATEWAY_BACKUP=vps-ops-supervisor-pre-gateway-komaa1458/);
  assert.match(source, /GW_SWAP_PENDING=1/);
  assert.match(source, /trap .*gateway_rollback/);
  assert.match(source, /GW_SWAP_PENDING=0/);
});

test("immutable release admission rejects omitted, wildcard and mismatched image/policy", async () => {
  const { configuredRecreateTargets } = await import("../../src/host-recreate-policy.ts");
  const valid = {
    PAPERCLIP_HOST_RECREATE_TARGETS: "paperclip-mcp-gateway",
    PAPERCLIP_HOST_RECREATE_IMAGES: "paperclip-mcp-gateway=sha256:e00d1ff3139d8671d38dc55e86855cbac577270577df82051b0cb206a777d104",
    PAPERCLIP_HOST_SUPERVISOR_POLICY_SHA256: "c15f036a7645b3f341878969f02850570b1710df96aa434644995464fbdeae99",
  };
  assert.deepEqual(configuredRecreateTargets({}), []);
  assert.deepEqual(configuredRecreateTargets({ ...valid, PAPERCLIP_HOST_RECREATE_TARGETS: "*" }), []);
  assert.deepEqual(configuredRecreateTargets({ ...valid, PAPERCLIP_HOST_RECREATE_IMAGES: "paperclip-mcp-gateway=sha256:other" }), []);
  assert.deepEqual(configuredRecreateTargets({ ...valid, PAPERCLIP_HOST_SUPERVISOR_POLICY_SHA256: "wrong" }), []);
  assert.deepEqual(configuredRecreateTargets(valid), ["paperclip-mcp-gateway"]);
});

test("unavailable live supervisor denies apply before Docker mutation", () => {
  const dir = mkdtempSync(join(tmpdir(), "supervisor-release-test-"));
  try {
    const log = join(dir, "docker.log");
    const fakeSudo = join(dir, "sudo");
    writeFileSync(fakeSudo, '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$GATEWAY_DOCKER_LOG"\nexit 1\n', { mode: 0o700 });
    const result = spawnSync("bash", [script, "gateway-apply"], {
      encoding: "utf8",
      env: { ...process.env, PATH: [dir, process.env.PATH].join(":"), GATEWAY_DOCKER_LOG: log },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /REFUSED: active supervisor absent/);
    const calls = readFileSync(log, "utf8");
    assert.match(calls, /container inspect vps-ops-supervisor/);
    assert.doesNotMatch(calls, /docker -H \S+ (?:stop|rename|run|rm|start)\b/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
