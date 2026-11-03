import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const conf = readFileSync(
  new URL("../ops/coolify/nginx.conf", import.meta.url),
  "utf8",
);

test("/healthz is an exact-match text/plain readiness route", () => {
  const block = conf.match(/location\s+=\s*\/healthz\s*\{([\s\S]*?)\}/);
  assert.ok(block, "missing exact `location = /healthz` block");
  assert.match(block[1], /default_type\s+text\/plain;/);
  assert.match(block[1], /return\s+200\s+"ok\\n";/);
});

test("/healthz has no prefix or regex location that could catch /healthz/extra", () => {
  const healthzLocations = [
    ...conf.matchAll(/location\s+([^\n{]*?)\s*\/healthz\b/g),
  ];
  assert.equal(healthzLocations.length, 1, "only one /healthz location expected");
  assert.equal(healthzLocations[0][1].trim(), "=");
});

test("existing panel redirects and SPA fallback are preserved", () => {
  assert.match(
    conf,
    /location = \/panel\s*\{\s*return 302 https:\/\/panel\.kompaszbiorek\.pl\/panel;/,
  );
  assert.match(
    conf,
    /location \^~ \/panel\/\s*\{\s*return 302 https:\/\/panel\.kompaszbiorek\.pl\$request_uri;/,
  );
  assert.match(conf, /location \/\s*\{\s*try_files \$uri \$uri\/ \/index\.html;/);
});
