import test from "node:test";
import assert from "node:assert/strict";
import { getReleaseIdentity } from "../release-identity.mjs";

const env = {
  SOURCE_COMMIT: "a".repeat(40),
  COOLIFY_RESOURCE_UUID: "fs9rik9axzl1ubbimekvqs03",
  COOLIFY_CONTAINER_NAME: "fs9rik9axzl1ubbimekvqs03-20261026",
};

test("returns only validated Coolify release identity", () => {
  assert.deepEqual(getReleaseIdentity(env), {
    sourceSha: env.SOURCE_COMMIT,
    resourceUuid: env.COOLIFY_RESOURCE_UUID,
    containerName: env.COOLIFY_CONTAINER_NAME,
  });
});

test("fails closed when any identity value is missing or malformed", () => {
  for (const invalid of [
    { ...env, SOURCE_COMMIT: undefined },
    { ...env, SOURCE_COMMIT: "main" },
    { ...env, COOLIFY_RESOURCE_UUID: undefined },
    { ...env, COOLIFY_CONTAINER_NAME: "bad\\nname" },
  ]) assert.equal(getReleaseIdentity(invalid), null);
});
