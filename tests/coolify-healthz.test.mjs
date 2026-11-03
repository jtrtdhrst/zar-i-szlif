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

test("build-stage smoke isolates nginx from the host's port 80 (KOMAA-1565)", () => {
  const dockerfile = readFileSync(
    new URL("../ops/coolify/Dockerfile", import.meta.url),
    "utf8",
  );
  const buildStage = dockerfile.split("FROM nginx:alpine AS runtime")[0];
  assert.match(buildStage, /listen 127\.0\.0\.1:18999;/);
  assert.match(buildStage, /http:\/\/127\.0\.0\.1:18999/);
  assert.match(
    buildStage,
    /test "\$\(grep -c 'listen 127\.0\.0\.1:18999;' [^)]*\)" -eq 1/,
    "build stage must prove the rebind happened exactly once",
  );
  assert.match(
    buildStage,
    /test "\$\(grep -c 'listen 80;' [^)]*\)" -eq 0/,
    "build config must not keep a :80 listener",
  );
  assert.doesNotMatch(
    buildStage,
    /cp ops\/coolify\/nginx\.conf \/etc\/nginx\/conf\.d\/healthz\.conf/,
    "build stage must not start the committed :80 config directly",
  );
  assert.match(
    dockerfile,
    /COPY ops\/coolify\/nginx\.conf \/etc\/nginx\/conf\.d\/default\.conf/,
    "runtime image must still serve the committed config on :80",
  );
  assert.match(conf, /^\s*listen 80;/m, "runtime config must keep listening on :80");
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
