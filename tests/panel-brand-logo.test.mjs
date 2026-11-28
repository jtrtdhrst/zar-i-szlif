// Brand logo contract for the panel shell and the ChatGPT widget (ZARI-197).
//
// The panel header used to hardcode an absolute logo URL on a decommissioned
// Worker host. That host returned HTTP 404, so the brand logo rendered as an
// empty 52x52 box on `https://panel.zariszlif.pl` (naturalWidth=0). The panel
// already ships its logo in `app/web/dist`, so the component must reference the
// shipped same-origin asset, and only the cross-origin ChatGPT widget may hold
// an absolute URL — one that actually serves the PNG.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const brandHeader = read("registry/kompas/components/brand-header.js");
const buildStatic = read("app/web/scripts/build-static.mjs");
const buildWorker = read("app/cloudflare-worker/build-worker.mjs");
const worker = read("app/cloudflare-worker/worker.js");

// Absolute logo URL the widget build rewrites to. Parsed from the generator so
// the test fails if the constant and the shipped artifact drift apart.
const LOGO_URL = buildWorker.match(/const LOGO_URL = "([^"]+)"/)?.[1];
const DEAD_LOGO_HOST = "baza-zabaw.milosz-spyrka.workers.dev";

test("panel brand header uses the logo asset shipped with the panel", () => {
  const src = brandHeader.match(/<img[^>]*src="([^"]+)"/)?.[1];
  assert.equal(src, "/kompas-logo.png", "brand header must use the shipped same-origin asset");
  assert.doesNotMatch(
    brandHeader,
    /<img[^>]*src="(https?:)?\/\//,
    "brand header must not hardcode a remote image host",
  );
  // Approved Polish copy and the brand button semantics stay untouched.
  assert.match(brandHeader, /alt="Kompas Zbiórek"/);
  assert.match(brandHeader, /<span class="brand-name">Kompas Zbiórek<\/span>/);
  assert.match(brandHeader, /aria-label="Strona główna Kompasu Zbiórek"/);
});

test("the referenced logo is a real PNG copied into the built panel", () => {
  const logoPath = new URL("../app/web/public/kompas-logo.png", import.meta.url);
  assert.ok(statSync(logoPath).size > 0, "app/web/public/kompas-logo.png must not be empty");
  const header = readFileSync(logoPath).subarray(0, 8);
  assert.deepEqual([...header], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "logo must be a PNG");
  // The builder now copies the entire public asset directory, including
  // the logo and the native delivery marker. The byte-for-byte output check
  // lives in app/web/scripts/build-static-assets.test.mjs.
  assert.match(
    buildStatic,
    /cp\("web\/public", "web\/dist", \{/,
    "build must copy public assets alongside index.html",
  );
  assert.match(buildStatic, /await lstat\(source\)/, "reject symlinks and special asset types");
  assert.match(buildStatic, /Unsupported static asset type/, "fail closed on unsafe assets");
  assert.match(buildStatic, /Reserved generated asset name/, "do not overwrite generated release data");
});

test("the widget build rewrites the shipped asset to a working absolute URL", () => {
  assert.ok(LOGO_URL, "build-worker.mjs must declare LOGO_URL");
  assert.match(LOGO_URL, /^https:\/\/[^/]+\/kompas-logo\.png$/, "widget logo URL must be absolute https");
  assert.ok(!LOGO_URL.includes(DEAD_LOGO_HOST), "widget logo URL must not use the decommissioned host");

  // Apply the generator's own rewrite regex to the markup the panel renders.
  const markup = brandHeader.match(/`([^`]+)`/)[1];
  const literal = buildWorker.match(/\.replace\((\/.*?\/),\s*`/s)?.[1];
  assert.ok(literal, "build-worker.mjs must keep an img rewrite for the widget");
  const rewritten = markup.replace(new RegExp(literal.slice(1, -1)), `<img src="${LOGO_URL}" alt="Kompas Zbiórek"/>`);
  assert.match(
    rewritten,
    new RegExp(`<img src="${LOGO_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
    "widget rewrite must match the brand header markup",
  );
});

test("the shipped widget references the working logo and never the dead host", () => {
  assert.ok(worker.includes(LOGO_URL), "generated worker.js must carry the current widget logo URL");
  assert.ok(!worker.includes(DEAD_LOGO_HOST), "generated worker.js must not reference the decommissioned host");
});
