import test from "node:test";
import assert from "node:assert/strict";
import { assertReleaseIdentity } from "./verify-coolify-canary.mjs";

const sha = "c0fad74579903632045fcb3c056b55fabe517557";
const uuid = "fs9rik9axzl1ubbimekvqs03";
const valid = { sourceSha: sha, resourceUuid: uuid, containerName: uuid + "-20261027T114349" };

test("requires exact source commit, Coolify app and real container identity", () => {
  assert.doesNotThrow(() => assertReleaseIdentity(valid, sha));
  assert.throws(() => assertReleaseIdentity(valid, "d8f07b7539518f25ac8dc356cca2cdc57bc56cff"));
  assert.throws(() => assertReleaseIdentity({ ...valid, resourceUuid: "wrong" }, sha));
  assert.throws(() => assertReleaseIdentity({ ...valid, containerName: "" }, sha));
  assert.throws(() => assertReleaseIdentity({ ...valid, containerName: "paperclip-mcp" }, sha));
});

test("requires full immutable Git SHA as the source of truth", () => {
  assert.throws(() => assertReleaseIdentity(valid, "main"));
  assert.throws(() => assertReleaseIdentity(valid, "c0fad745"));
});
