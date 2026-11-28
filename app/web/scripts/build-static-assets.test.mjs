import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const source = new URL("../public/", import.meta.url);
const output = new URL("../dist/", import.meta.url);

test("static builder copies all public files byte-for-byte", async () => {
  const entries = await readdir(source, { withFileTypes: true });
  assert.ok(entries.some((entry) => entry.name === "kompas-logo.png"));
  assert.ok(entries.some((entry) => entry.name === "__delivery-e2e.json"));
  for (const entry of entries) {
    assert.ok(entry.isFile(), `Unexpected public asset type: ${entry.name}`);
    const expected = await readFile(new URL(entry.name, source));
    const actual = await readFile(new URL(entry.name, output));
    assert.deepEqual(actual, expected, `Public asset not in dist: ${entry.name}`);
  }
});

test("native delivery marker is a valid public JSON artifact", async () => {
  const marker = JSON.parse(await readFile(new URL("__delivery-e2e.json", output), "utf8"));
  assert.equal(marker.check, "native-github-coolify-delivery");
  assert.equal(marker.repository, "jtrtdhrst/zar-i-szlif");
  assert.equal(marker.component, "product-web");
});
