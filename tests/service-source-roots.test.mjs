import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
const file = JSON.parse(readFileSync(resolve(repo, 'ops/service-build-roots.json'), 'utf8'));

test('exactly all five Product Coolify resources have distinct UUID routes', () => {
  assert.equal(file.schema_version, 1);
  assert.equal(file.source_repository, 'jtrtdhrst/zar-i-szlif');
  assert.equal(file.resources.length, 5);
  assert.equal(new Set(file.resources.map(x => x.id)).size, 5);
  assert.equal(new Set(file.resources.map(x => x.uuid)).size, 5);
});

test('all source roots are isolated, non-root and typed', () => {
  for (const resource of file.resources) {
    assert.match(resource.uuid, /^[a-z0-9]{24}$/);
    assert.ok(resource.source_root && resource.source_root !== '/' && resource.source_root !== '.');
    assert.ok(!resource.source_root.includes('..'));
    assert.ok(existsSync(resolve(repo, resource.source_root)), resource.source_root);
    assert.ok(resource.build_dockerfile.startsWith(resource.source_root + '/'));
    if (resource.source_build_ready) {
      assert.ok(existsSync(resolve(repo, resource.build_dockerfile)));
    } else {
      assert.ok(resource.reason.length > 30);
    }
  }
});

test('Product MCP host Dockerfile copies no external source', () => {
  const dockerfile = readFileSync(resolve(repo, 'mcp/product-host/Dockerfile'), 'utf8');
  assert.doesNotMatch(dockerfile, /^\s*(?:COPY|ADD)\s+.*\.\.\//m);
  assert.ok(dockerfile.split('\n').filter(line => line.startsWith('COPY ')).every(line => !line.includes('scripts/') && !line.includes('ops/') && !line.includes('../')));
});

test('web and its canary use one app/web context with explicitly named shared sources', () => {
  const roots = file.resources.filter(x => x.source_build_ready).map(x => x.source_root);
  assert.deepEqual(new Set(roots), new Set(['app/web','mcp/product-host','ops/mascot-worker']));
  for (const id of ['zar-i-szlif-web','zar-i-szlif-image-canary']) {
    const route = file.resources.find(x => x.id === id);
    assert.equal(route.source_build_ready, true);
    assert.deepEqual(route.named_build_contexts, {registry:'registry', config:'ops/coolify'});
  }
  const dockerfile = readFileSync(resolve(repo, 'app/web/Dockerfile'), 'utf8');
  assert.match(dockerfile,/COPY --from=registry \/ \/workspace\/registry\//);
  assert.match(dockerfile,/COPY --from=config \/nginx.conf/);
  assert.doesNotMatch(dockerfile, /^\s*(?:COPY|ADD)\s+.*\.\.\//m);
});

test('Mascot Worker owns its entire runtime source tree', () => {
  const mascot = file.resources.find(x => x.id === 'zar-i-szlif-mascot-worker');
  assert.equal(mascot.source_build_ready, true);
  const dockerfile = readFileSync(resolve(repo, mascot.build_dockerfile), 'utf8');
  const copies = dockerfile.split('\n').filter(line => line.startsWith('COPY '));
  assert.ok(copies.every(line => !line.includes('scripts/') && !line.includes('ops/') && !line.includes('../')));
  for (const name of ['mascot-factory.mjs', 'mascot-factory-service.mjs', 'reference-pins.json']) {
    assert.ok(existsSync(resolve(repo, mascot.source_root, name)));
  }
  const original = readFileSync(resolve(repo, 'scripts/mascot-factory-service.mjs'), 'utf8');
  assert.match(original, /re-export|Backward-compatible/);
});

// Git-backed production currently deploys ci-approved; its SHA can differ from main.
// The public release manifest must never claim an unverified source branch.
test('release manifest identifies the canonical repository without fabricating a branch', () => {
  const script = readFileSync(resolve(repo, 'ops/coolify/40-release-provenance.sh'), 'utf8');
  assert.match(script, /SOURCE_COMMIT/);
  assert.match(script, /\"source\":\"jtrtdhrst\/zar-i-szlif\"/);
  assert.doesNotMatch(script, /\"source\":\"zar-i-szlif\/main\"/);
});

// Product CI runs only after reviewed main merge. Its real container-readback
// contract must agree with the Docker entrypoint, without hardcoding a branch.
test('trusted main release CI verifies the same canonical source as the image', () => {
  const workflow = readFileSync(resolve(repo, '.github/workflows/product-ci.yml'), 'utf8');
  const entrypoint = readFileSync(resolve(repo, 'ops/coolify/40-release-provenance.sh'), 'utf8');
  assert.ok(workflow.includes('x["source"]=="jtrtdhrst/zar-i-szlif"'));
  assert.ok(entrypoint.includes('"source":"jtrtdhrst/zar-i-szlif"'));
  assert.ok(!workflow.includes('x["source"]=="zar-i-szlif/main"'));
});
