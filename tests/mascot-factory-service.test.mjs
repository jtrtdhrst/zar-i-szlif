import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { crc32, sha256 } from '../scripts/mascot-factory.mjs';
import {
  createHandler, loadConfig, computePins, startServer, SERVICE_NAME, MIN_TOKEN_LENGTH,
} from '../scripts/mascot-factory-service.mjs';

const COMMIT = 'e5880d53e9bb9f0dc1b201ec7b296b42c0fccdf7';
const TOKEN = 'service-test-token-0123456789abcdef';
const COMFY_TOKEN = 'comfy-test-bearer-0123456789abcdef';

// Deterministic fixture PNG: never a substitute for real model output.
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function chunk(type, data) {
  const b = Buffer.alloc(12 + data.length);
  b.writeUInt32BE(data.length, 0);
  b.write(type, 4, 'latin1');
  data.copy(b, 8);
  b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
  return b;
}
function fixture({ width = 512, height = 512, clipped = false } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * (1 + width * 4) + 1 + x * 4;
    const inside = x >= (clipped ? 0 : 80) && x < width - 80 && y >= 80 && y < height - 80;
    raw[i] = 255; raw[i + 1] = 96; raw[i + 2] = 24; raw[i + 3] = inside ? 255 : 0;
  }
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function baseEnv(overrides = {}) {
  return {
    SOURCE_COMMIT: COMMIT,
    MASCOT_FACTORY_API_TOKEN: TOKEN,
    COMFY_URL: 'http://127.0.0.1:8188/',
    PORT: '8080',
    ...overrides,
  };
}

async function mockComfy({ fail = false, promptId = 'mock-run-123', image = fixture(), unauthorized = false, missingNode = false, missingScaler = false, hang = false } = {}) {
  let submissions = 0;
  let probes = 0;
  const s = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const send = (code, data, type = 'application/json') => {
      res.writeHead(code, { 'content-type': type });
      res.end(type === 'application/json' ? JSON.stringify(data) : data);
    };
    const isProbe = pathname === '/system_stats' || pathname.startsWith('/object_info/');
    if (isProbe) {
      probes += 1;
      // A backend that never answers: readiness must time out, not hang.
      if (hang) return;
      // Cloudflare Access / a wrong bearer answers the probed endpoints with 401.
      if (unauthorized) return send(401, { error: 'unauthorized' });
    }
    if (pathname === '/system_stats') return send(200, { system: { comfyui_version: 'test-mock-only' } });
    if (pathname === '/object_info/OpenAIGPTImageNodeV2') return send(200, missingNode ? { SomeOtherNode:{} } : { OpenAIGPTImageNodeV2:{} });
    if (pathname === '/object_info/ImageScale') return send(200, missingScaler ? { SomeOtherNode:{} } : { ImageScale:{} });
    if (pathname === '/upload/image') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const match = Buffer.concat(chunks).toString('latin1').match(/filename="(mascot_[a-f0-9]{24}_[a-f0-9]{8}\.png)"/);
      return send(200, { name: match?.[1] ?? 'MALFORMED_UPLOAD' });
    }
    if (pathname === '/prompt') { submissions += 1; return send(200, { prompt_id: promptId }); }
    if (pathname === `/history/${encodeURIComponent(promptId)}`) {
      return send(200, {
        [promptId]: fail
          ? { status: { status_str: 'error', messages: [['execution_error', { node_id: '3', exception_message: 'CodexImageUnavailable' }]] } }
          : { status: { status_str: 'success' }, outputs: { '5': { images: [{ filename: 'mock.png', subfolder: '', type: 'output' }] } } },
      });
    }
    if (pathname === '/view') return send(200, image, 'image/png');
    return send(404, { error: 'not found' });
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  return {
    url: `http://127.0.0.1:${s.address().port}/`,
    // A hanging probe would otherwise keep a socket open and stall close().
    close: () => new Promise((ok) => { s.closeAllConnections?.(); s.close(ok); }),
    getSubmissions: () => submissions,
    getProbes: () => probes,
  };
}

/** A references directory plus a pin file that matches those exact bytes. */
async function pinnedWorkspace({ references = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'mascot-service-'));
  const referencesDir = join(root, 'references');
  await mkdir(referencesDir, { recursive: true });
  const zar = fixture();
  const szlif = fixture();
  if (references) {
    await writeFile(join(referencesDir, 'zar.png'), zar);
    await writeFile(join(referencesDir, 'szlif.png'), szlif);
  }
  const computed = computePins();
  const pins = {
    schema: 1,
    profiles: {
      zar: {
        identity: { file: 'zar.png', sha256: sha256(zar) },
        style: { file: 'szlif.png', sha256: sha256(szlif) },
        ...computed.zar,
      },
      szlif: {
        identity: { file: 'szlif.png', sha256: sha256(szlif) },
        style: { file: 'zar.png', sha256: sha256(zar) },
        ...computed.szlif,
      },
    },
  };
  const pinsPath = join(root, 'pins.json');
  await writeFile(pinsPath, JSON.stringify(pins));
  return { root, referencesDir, pinsPath, outDir: join(root, 'out'), ledger: join(root, 'out', '.mascot-render-budget.json') };
}

async function serve(env, deps) {
  const config = { ...loadConfig(baseEnv(env)), port: 0 };
  const factory = createHandler(config, deps);
  const server = createServer(factory.handler);
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, config, state: factory.state, close: () => new Promise((ok) => server.close(ok)) };
}

test('service configuration refuses to start without a commit, a strong token and a safe transport', () => {
  assert.throws(() => loadConfig({}), /SOURCE_COMMIT_INVALID/);
  assert.throws(() => loadConfig(baseEnv({ SOURCE_COMMIT: 'e5880d5' })), /SOURCE_COMMIT_INVALID/);
  assert.throws(() => loadConfig(baseEnv({ MASCOT_FACTORY_API_TOKEN: 'short' })), /MASCOT_FACTORY_API_TOKEN_INVALID/);
  assert.throws(() => loadConfig(baseEnv({ MASCOT_FACTORY_API_TOKEN: 'a'.repeat(MIN_TOKEN_LENGTH - 1) })), /MASCOT_FACTORY_API_TOKEN_INVALID/);
  assert.throws(() => loadConfig(baseEnv({ COMFY_URL: '' })), /COMFY_URL_REQUIRED/);
  assert.throws(() => loadConfig(baseEnv({ COMFY_URL: 'http://comfy.example/' })), /INSECURE_REMOTE_TRANSPORT/);
  assert.throws(() => loadConfig(baseEnv({ COMFY_URL: 'https://comfy.example/' })), /MISSING_REMOTE_CREDENTIAL/);
  assert.throws(() => loadConfig(baseEnv({ COMFY_URL: 'https://user:pw@comfy.example/' })), /URL_CREDENTIALS_NOT_ALLOWED/);
  assert.throws(() => loadConfig(baseEnv({ PORT: 'not-a-port' })), /PORT_INVALID/);
  assert.throws(() => loadConfig(baseEnv({ MASCOT_FACTORY_MAX_RENDERS: '0' })), /INVALID_RENDER_BUDGET/);
  assert.throws(() => loadConfig(baseEnv({ MASCOT_FACTORY_PROBE_TIMEOUT_MS: '0' })), /INVALID_PROBE_TIMEOUT/);
  assert.throws(() => loadConfig(baseEnv({ MASCOT_FACTORY_PROBE_TIMEOUT_MS: '600000' })), /INVALID_PROBE_TIMEOUT/);

  // A remote endpoint with a service token is accepted and reported without its secret.
  const remote = loadConfig(baseEnv({
    COMFY_URL: 'https://comfy.example/mcp',
    CF_ACCESS_CLIENT_ID: 'client-id.access',
    CF_ACCESS_CLIENT_SECRET: 'client-secret-value',
  }));
  assert.equal(remote.transport.scheme, 'service-token');
  assert.equal(remote.transport.authenticated, true);
  assert.ok(!JSON.stringify(remote).includes('client-secret-value'));
});

test('startServer binds a real port and reports liveness without touching the backend', async () => {
  const ws = await pinnedWorkspace();
  const config = {
    ...loadConfig(baseEnv({
      MASCOT_FACTORY_REFERENCES: ws.referencesDir,
      MASCOT_FACTORY_REFERENCE_PINS: ws.pinsPath,
      MASCOT_FACTORY_OUT_DIR: ws.outDir,
      COMFY_URL: 'http://127.0.0.1:9/',
    })),
    port: 0,
  };
  const server = await startServer(config);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, service: SERVICE_NAME, version: '1.0.0' });

    const release = await (await fetch(`${base}/__release.json`)).json();
    assert.equal(release.commit, COMMIT);
    assert.match(release.source, /mascot-factory/);

    // No ComfyUI is listening on port 9; liveness must still be green.
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
  } finally {
    await new Promise((ok) => server.close(ok));
  }
});

test('readiness and status expose pinned identity but never a credential', async () => {
  const ws = await pinnedWorkspace();
  const mock = await mockComfy();
  const svc = await serve({
    MASCOT_FACTORY_REFERENCES: ws.referencesDir,
    MASCOT_FACTORY_REFERENCE_PINS: ws.pinsPath,
    MASCOT_FACTORY_OUT_DIR: ws.outDir,
    COMFY_URL: mock.url,
    COMFY_API_TOKEN: COMFY_TOKEN,
  });
  try {
    const ready = await fetch(`${svc.base}/readyz`);
    assert.equal(ready.status, 200);
    const readyBody = await ready.json();
    assert.deepEqual(readyBody.blockers, []);
    // Readiness really probed the engine and never submitted a billable prompt.
    assert.equal(readyBody.backend.probed, true);
    assert.ok(mock.getProbes() >= 2, 'readiness must query /system_stats and /object_info');
    assert.equal(mock.getSubmissions(), 0, 'a readiness probe must never submit a billable /prompt');

    const status = await (await fetch(`${svc.base}/status`)).json();
    const pins = JSON.parse(await readFile(ws.pinsPath, 'utf8'));
    for (const profile of ['zar', 'szlif']) {
      assert.equal(status.profiles[profile].graph_template_sha256, pins.profiles[profile].graph_template_sha256);
      assert.equal(status.profiles[profile].prompt_sha256, pins.profiles[profile].prompt_sha256);
    }
    assert.equal(status.backend.authenticated, true);
    assert.equal(status.backend.scheme, 'bearer');
    assert.equal(status.artifact_status, 'AWAITING_HUMAN_BRAND_QA');
    assert.equal(status.publication, 'disabled');

    const body = JSON.stringify(status);
    assert.ok(!body.includes(TOKEN), 'render token must never be served');
    assert.ok(!body.includes(COMFY_TOKEN), 'backend credential must never be served');
    assert.equal(status.backend.probe, null);
  } finally {
    await svc.close();
    await mock.close();
  }
});

test('readiness fails closed on missing, swapped references and a corrupt cost ledger', async () => {
  const missing = await pinnedWorkspace({ references: false });
  const svcMissing = await serve({
    MASCOT_FACTORY_REFERENCES: missing.referencesDir,
    MASCOT_FACTORY_REFERENCE_PINS: missing.pinsPath,
    MASCOT_FACTORY_OUT_DIR: missing.outDir,
  });
  try {
    const res = await fetch(`${svcMissing.base}/readyz`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.ok(body.blockers.some((b) => b.startsWith('REFERENCE_MISSING:zar:identity')));
  } finally {
    await svcMissing.close();
  }

  // Files exist but do not hash to the pin: a swapped mount must never render.
  const swapped = await pinnedWorkspace();
  await writeFile(join(swapped.referencesDir, 'zar.png'), fixture({ width: 640, height: 640 }));
  const svcSwapped = await serve({
    MASCOT_FACTORY_REFERENCES: swapped.referencesDir,
    MASCOT_FACTORY_REFERENCE_PINS: swapped.pinsPath,
    MASCOT_FACTORY_OUT_DIR: swapped.outDir,
  });
  try {
    const body = await (await fetch(`${svcSwapped.base}/readyz`)).json();
    assert.ok(body.blockers.includes('REFERENCE_HASH_MISMATCH:zar:identity'));
    // A not-ready service refuses renders even with a valid token.
    const render = await fetch(`${svcSwapped.base}/render`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ profile: 'zar' }),
    });
    assert.equal(render.status, 503);
    assert.equal((await render.json()).error, 'NOT_READY');
  } finally {
    await svcSwapped.close();
  }

  // A corrupt ledger blocks rendering instead of resetting the budget.
  const corrupt = await pinnedWorkspace();
  await mkdir(corrupt.outDir, { recursive: true });
  await writeFile(corrupt.ledger, '{not json');
  const svcCorrupt = await serve({
    MASCOT_FACTORY_REFERENCES: corrupt.referencesDir,
    MASCOT_FACTORY_REFERENCE_PINS: corrupt.pinsPath,
    MASCOT_FACTORY_OUT_DIR: corrupt.outDir,
  });
  try {
    const body = await (await fetch(`${svcCorrupt.base}/readyz`)).json();
    assert.ok(body.blockers.includes('BUDGET_LEDGER_CORRUPT'));
  } finally {
    await svcCorrupt.close();
  }
});

test('readiness probes the real backend and fails closed when it is down, unauthenticated or missing the generation node', async () => {
  const cases = [
    { name: 'unreachable', env: { COMFY_URL: 'http://127.0.0.1:9/' }, expect: 'BACKEND_UNREACHABLE' },
    { name: 'credential rejected', mock: await mockComfy({ unauthorized: true }), expect: 'BACKEND_UNAUTHORIZED' },
    { name: 'generation node missing', mock: await mockComfy({ missingNode: true }), expect: 'BACKEND_NODE_MISSING' },
    { name: 'required scaler missing', mock: await mockComfy({ missingScaler: true }), expect: 'BACKEND_SCALER_MISSING' },
    { name: 'backend never answers', mock: await mockComfy({ hang: true }), env: { MASCOT_FACTORY_PROBE_TIMEOUT_MS: '200' }, expect: 'BACKEND_TIMEOUT' },
  ];
  for (const testCase of cases) {
    const ws = await pinnedWorkspace();
    const svc = await serve({
      MASCOT_FACTORY_REFERENCES: ws.referencesDir,
      MASCOT_FACTORY_REFERENCE_PINS: ws.pinsPath,
      MASCOT_FACTORY_OUT_DIR: ws.outDir,
      COMFY_API_TOKEN: COMFY_TOKEN,
      ...(testCase.mock ? { COMFY_URL: testCase.mock.url } : {}),
      ...testCase.env,
    });
    try {
      const started = Date.now();
      const ready = await fetch(`${svc.base}/readyz`);
      const elapsed = Date.now() - started;
      assert.equal(ready.status, 503, `${testCase.name}: readiness must be 503`);
      const body = await ready.json();
      assert.equal(body.ok, false);
      assert.ok(body.blockers.includes(testCase.expect), `${testCase.name}: expected ${testCase.expect} in ${JSON.stringify(body.blockers)}`);
      assert.equal(body.backend.code, testCase.expect);
      // Bounded: a hanging engine can never stall a health check.
      assert.ok(elapsed < 3000, `${testCase.name}: probe took ${elapsed}ms`);
      assert.ok(!JSON.stringify(body).includes(COMFY_TOKEN), 'a probe must never echo a credential');
      // Liveness stays green so an outage does not restart a healthy pod.
      assert.equal((await fetch(`${svc.base}/healthz`)).status, 200);
      assert.equal((await (await fetch(`${svc.base}/status`)).json()).ready, false);
      if (testCase.mock) assert.equal(testCase.mock.getSubmissions(), 0, 'readiness must never submit a billable prompt');
    } finally {
      await svc.close();
      if (testCase.mock) await testCase.mock.close();
    }
  }
});

test('render endpoint rejects missing, wrong and misplaced credentials before any work', async () => {
  const ws = await pinnedWorkspace();
  const mock = await mockComfy();
  const svc = await serve({
    MASCOT_FACTORY_REFERENCES: ws.referencesDir,
    MASCOT_FACTORY_REFERENCE_PINS: ws.pinsPath,
    MASCOT_FACTORY_OUT_DIR: ws.outDir,
    COMFY_URL: mock.url,
  });
  const post = (init = {}) => fetch(`${svc.base}/render`, { method: 'POST', ...init });
  const json = { 'content-type': 'application/json' };
  try {
    assert.equal((await post({ headers: json, body: JSON.stringify({ profile: 'zar' }) })).status, 401);
    assert.equal((await post({ headers: { ...json, authorization: 'Bearer wrong-token-wrong-token-wrong-1' }, body: JSON.stringify({ profile: 'zar' }) })).status, 401);
    const query = await fetch(`${svc.base}/render?token=${TOKEN}`, { method: 'POST', headers: json, body: JSON.stringify({ profile: 'zar' }) });
    assert.equal(query.status, 400);
    assert.equal((await query.json()).error, 'TOKEN_IN_QUERY_REJECTED');

    const auth = { ...json, authorization: `Bearer ${TOKEN}` };
    const credsInBody = await post({ headers: auth, body: JSON.stringify({ profile: 'zar', comfy_api_token: 'x' }) });
    assert.equal(credsInBody.status, 400);
    assert.equal((await credsInBody.json()).error, 'CREDENTIAL_IN_BODY_REJECTED');
    assert.equal((await post({ headers: auth, body: JSON.stringify({ profile: 'koala' }) })).status, 400);
    assert.equal((await post({ headers: { ...auth, 'content-type': 'text/plain' }, body: 'not json' })).status, 400);
    assert.equal((await post({ headers: auth, body: 'x'.repeat(8192) })).status, 413);
    assert.equal((await fetch(`${svc.base}/render`)).status, 405);
    assert.equal((await fetch(`${svc.base}/nope`)).status, 404);
    // Nothing above may have reached the backend.
    assert.equal(mock.getSubmissions(), 0);
  } finally {
    await svc.close();
    await mock.close();
  }
});

test('an authenticated render produces a pending, provenance-complete artifact and is single-flight', async () => {
  const ws = await pinnedWorkspace();
  const mock = await mockComfy();
  const svc = await serve({
    MASCOT_FACTORY_REFERENCES: ws.referencesDir,
    MASCOT_FACTORY_REFERENCE_PINS: ws.pinsPath,
    MASCOT_FACTORY_OUT_DIR: ws.outDir,
    COMFY_URL: mock.url,
    COMFY_API_TOKEN: COMFY_TOKEN,
    MASCOT_FACTORY_MAX_RENDERS: '2',
  });
  const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
  try {
    const [first, second] = await Promise.all([
      fetch(`${svc.base}/render`, { method: 'POST', headers, body: JSON.stringify({ profile: 'zar' }) }),
      fetch(`${svc.base}/render`, { method: 'POST', headers, body: JSON.stringify({ profile: 'zar' }) }),
    ]);
    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [200, 409], 'a concurrent render must be refused, not queued');
    assert.equal(mock.getSubmissions(), 1);

    const ok = first.status === 200 ? first : second;
    const body = await ok.json();
    assert.equal(body.profile, 'zar');
    assert.equal(body.status, 'AWAITING_HUMAN_BRAND_QA');
    assert.equal(body.brand_review, 'PENDING_MANUAL');
    assert.deepEqual(body.dimensions, [512, 512]);
    const png = await readFile(body.artifact.candidate);
    assert.equal(sha256(png), body.sha256);
    const provenance = JSON.parse(await readFile(body.artifact.provenance, 'utf8'));
    assert.equal(provenance.status, 'AWAITING_HUMAN_BRAND_QA');
    assert.equal(provenance.visual_identity_approved, false);
    assert.equal(provenance.workflow_sha256, body.workflow_sha256);
    assert.equal(provenance.reference_identity.sha256, sha256(await readFile(join(ws.referencesDir, 'zar.png'))));
    assert.ok(!JSON.stringify(provenance).includes(COMFY_TOKEN), 'provenance must not carry the backend credential');
    assert.ok(!JSON.stringify(body).includes(TOKEN));

    // The budget is consumed before submission, so the ledger must already reflect one render.
    const ledger = JSON.parse(await readFile(ws.ledger, 'utf8'));
    assert.equal(ledger.count, 1);
  } finally {
    await svc.close();
    await mock.close();
  }
});

test('an exhausted render budget blocks further renders with the exact reason', async () => {
  const ws = await pinnedWorkspace();
  const mock = await mockComfy();
  const svc = await serve({
    MASCOT_FACTORY_REFERENCES: ws.referencesDir,
    MASCOT_FACTORY_REFERENCE_PINS: ws.pinsPath,
    MASCOT_FACTORY_OUT_DIR: ws.outDir,
    COMFY_URL: mock.url,
    MASCOT_FACTORY_MAX_RENDERS: '1',
  });
  const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
  try {
    const first = await fetch(`${svc.base}/render`, { method: 'POST', headers, body: JSON.stringify({ profile: 'szlif' }) });
    assert.equal(first.status, 200);

    const second = await fetch(`${svc.base}/render`, { method: 'POST', headers, body: JSON.stringify({ profile: 'szlif' }) });
    assert.equal(second.status, 503);
    const body = await second.json();
    assert.equal(body.error, 'NOT_READY');
    assert.ok(body.blockers.some((b) => b.startsWith('RENDER_BUDGET_EXHAUSTED')));
    assert.equal(mock.getSubmissions(), 1, 'an exhausted budget must never submit a second billable render');
  } finally {
    await svc.close();
    await mock.close();
  }
});

test('a backend failure or an unsafe prompt id never writes an artifact', async () => {
  const failure = await pinnedWorkspace();
  const failingMock = await mockComfy({ fail: true });
  const svcFail = await serve({
    MASCOT_FACTORY_REFERENCES: failure.referencesDir,
    MASCOT_FACTORY_REFERENCE_PINS: failure.pinsPath,
    MASCOT_FACTORY_OUT_DIR: failure.outDir,
    COMFY_URL: failingMock.url,
  });
  const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
  try {
    const res = await fetch(`${svcFail.base}/render`, { method: 'POST', headers, body: JSON.stringify({ profile: 'zar' }) });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.error, 'RENDER_FAILED');
    assert.match(body.code, /IMAGE_RENDER_FAILED/);
    assert.equal(existsSync(join(failure.outDir, 'zar', 'mock-run-123', 'candidate.png')), false);
  } finally {
    await svcFail.close();
    await failingMock.close();
  }

  // An unreachable backend is now caught by readiness before any render work.
  const offline = await pinnedWorkspace();
  const svcOffline = await serve({
    MASCOT_FACTORY_REFERENCES: offline.referencesDir,
    MASCOT_FACTORY_REFERENCE_PINS: offline.pinsPath,
    MASCOT_FACTORY_OUT_DIR: offline.outDir,
    COMFY_URL: 'http://127.0.0.1:9/',
  });
  try {
    const res = await fetch(`${svcOffline.base}/render`, { method: 'POST', headers, body: JSON.stringify({ profile: 'zar' }) });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error, 'NOT_READY');
    assert.ok(body.blockers.includes('BACKEND_UNREACHABLE'));
    assert.equal(existsSync(join(offline.outDir, 'zar')), false);
  } finally {
    await svcOffline.close();
  }

  // A backend that dies after readiness still reports an operational cause, not a render defect.
  const dropped = await pinnedWorkspace();
  const liveMock = await mockComfy();
  const svcDropped = await serve({
    MASCOT_FACTORY_REFERENCES: dropped.referencesDir,
    MASCOT_FACTORY_REFERENCE_PINS: dropped.pinsPath,
    MASCOT_FACTORY_OUT_DIR: dropped.outDir,
    COMFY_URL: liveMock.url,
  }, { runner: async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); } });
  try {
    const res = await fetch(`${svcDropped.base}/render`, { method: 'POST', headers, body: JSON.stringify({ profile: 'zar' }) });
    assert.equal(res.status, 502);
    assert.match((await res.json()).code, /^BACKEND_UNREACHABLE/);
    assert.equal(existsSync(join(dropped.outDir, 'zar')), false);
  } finally {
    await svcDropped.close();
    await liveMock.close();
  }

  // The backend controls the prompt id; a traversal must not escape the output root.
  const traversal = await pinnedWorkspace();
  const evil = await mockComfy({ promptId: '../escape' });
  const svcEvil = await serve({
    MASCOT_FACTORY_REFERENCES: traversal.referencesDir,
    MASCOT_FACTORY_REFERENCE_PINS: traversal.pinsPath,
    MASCOT_FACTORY_OUT_DIR: traversal.outDir,
    COMFY_URL: evil.url,
  });
  try {
    const res = await fetch(`${svcEvil.base}/render`, { method: 'POST', headers, body: JSON.stringify({ profile: 'zar' }) });
    assert.equal(res.status, 502);
    assert.match((await res.json()).code, /COMFY_PROMPT_ID_UNSAFE/);
    assert.equal(existsSync(join(traversal.root, 'escape')), false);
    assert.equal(existsSync(join(traversal.outDir, 'escape', 'candidate.png')), false);
  } finally {
    await svcEvil.close();
    await evil.close();
  }
});

test('the deployment image is non-root, health-checked and ships exactly what the service needs', async () => {
  const dockerfile = await readFile('ops/mascot-worker/Dockerfile', 'utf8');
  assert.match(dockerfile, /^USER 10001:10001$/m);
  assert.match(dockerfile, /HEALTHCHECK[\s\S]*\/healthz/);
  assert.match(dockerfile, /CMD \["node", "scripts\/mascot-factory-service\.mjs"\]/);
  for (const path of ['scripts/mascot-factory.mjs', 'scripts/mascot-factory-service.mjs', 'ops/mascot-worker/reference-pins.json']) {
    assert.match(dockerfile, new RegExp(`COPY [^\\n]*${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), `Dockerfile must ship ${path}`);
    assert.ok(existsSync(path), `missing build input: ${path}`);
  }
  assert.match(dockerfile, /MASCOT_FACTORY_REFERENCE_PINS=\/app\/ops\/mascot-worker\/reference-pins\.json/);
  // The static panel image must stay untouched by this service.
  const panel = await readFile('ops/coolify/Dockerfile', 'utf8');
  assert.match(panel, /nginx:alpine/);
  assert.doesNotMatch(panel, /mascot-factory-service\.mjs/);
  assert.ok((await stat('ops/mascot-worker/README.md')).size > 0);
});
