import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const source = new URL("../public/mcp-smoke/login/index.html", import.meta.url);
const built = new URL("../dist/mcp-smoke/login/index.html", import.meta.url);
test("the isolated Plasmic login canary is emitted unchanged", async () => {
  const [src,out] = await Promise.all([readFile(source,"utf8"),readFile(built,"utf8")]);
  assert.equal(out,src);
  assert.match(out, /data-plasmic-project="ew9Zg1DsRBmoU5D99kLXHZ"/);
  assert.match(out, /data-plasmic-page="mcpmvfk4pspr05tqexp"/);
  assert.match(out, /data-plasmic-revision="91"/);
  assert.match(out, /<html lang="pl">/);
  assert.match(out, /@media\(max-width:800px\)/);
  for (const s of ["Żar i Szlif","Wróć do obozowiska.","Witaj ponownie!","Zaloguj się"])
    assert.ok(out.includes(s), "missing native Plasmic copy: "+s);
  assert.match(out, /id="smoke-email"[^>]+disabled/);
  assert.match(out, /id="smoke-password"[^>]+disabled/);
  assert.match(out, /<button type="button" disabled/);
  assert.doesNotMatch(out, /<form|type="submit"|fetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|https?:\/\//i);
  assert.match(out, /name="robots" content="noindex,nofollow"/);
});
