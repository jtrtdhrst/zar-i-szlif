import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { validatePng, exportAlphaPng, buildGraph, runMascot, resolveTransport, consumeRenderBudget, verifyArtifacts, sha256, crc32 } from '../scripts/mascot-factory.mjs';

// A deterministic fixture generator; never passes off a mocked render as a real model output.
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function chunk(type, data, { crc } = {}) {
  const b = Buffer.alloc(12 + data.length);
  b.writeUInt32BE(data.length, 0);
  b.write(type, 4, 'latin1');
  data.copy(b, 8);
  b.writeUInt32BE(crc ?? crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
  return b;
}
function ihdr({ width, height }) {
  const d = Buffer.alloc(13);
  d.writeUInt32BE(width, 0); d.writeUInt32BE(height, 4);
  d[8] = 8; d[9] = 6; d[10] = 0; d[11] = 0; d[12] = 0;
  return chunk('IHDR', d);
}
function pixels({ width, height, allOpaque = false, clipped = false }) {
  const data = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * (1 + width * 4) + 1 + x * 4;
    const inside = allOpaque || (x >= (clipped ? 0 : 80) && x < width - 80 && y >= 80 && y < height - 80);
    data[i] = 255; data[i + 1] = 96; data[i + 2] = 24; data[i + 3] = inside ? 255 : 0;
  }
  return data;
}
const idat = raw => chunk('IDAT', deflateSync(raw));
const iend = () => chunk('IEND', Buffer.alloc(0));
function fixture({ width = 512, height = 512, allOpaque = false, clipped = false } = {}) {
  return Buffer.concat([SIGNATURE, ihdr({ width, height }), idat(pixels({ width, height, allOpaque, clipped })), iend()]);
}

// The Codex backend returns a flat three-channel render; this is that shape.
function rgbFixture({ width = 512, height = 512, inset = 80 } = {}) {
  const rowBytes = width * 3;
  const raw = Buffer.alloc(height * (1 + rowBytes));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * (1 + rowBytes) + 1 + x * 3;
    const inside = x >= inset && x < width - inset && y >= inset && y < height - inset;
    raw[i] = 255; raw[i + 1] = inside ? 96 : 255; raw[i + 2] = inside ? 24 : 255;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), iend()]);
}

test('crc32 matches the published PNG/ISO 3309 known-answer vectors', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.from('IEND')), 0xae426082);
  assert.equal(crc32(Buffer.alloc(0)), 0x00000000);
});

test('reference-locked graph uses exactly one generation node and one save node', () => {
  const g = buildGraph({ profile: 'zar', identityImage: 'identity.png', styleImage: 'style.png' });
  assert.equal(g['3'].inputs.image_1[0], '1'); assert.equal(g['3'].inputs.image_2[0], '2');
  assert.equal(g['4'].inputs.images[0], '3'); assert.match(g['3'].inputs.prompt, /Żar/);
  assert.throws(() => buildGraph({ profile: 'other', identityImage: 'a', styleImage: 'b' }), /UNKNOWN_PROFILE/);
});

test('valid CRC-correct RGBA PNG passes structural QC, and clipped/opaque output fails closed', () => {
  const valid = validatePng(fixture());
  assert.equal(valid.structural_check, 'PASS');
  assert.equal(valid.crc_check, 'PASS');
  assert.equal(valid.brand_review, 'PENDING_MANUAL');
  assert.deepEqual(valid.bbox, [80, 80, 431, 431]);
  assert.throws(() => validatePng(fixture({ allOpaque: true })), /PNG_EMPTY_OR_OPAQUE_BACKGROUND/);
  assert.throws(() => validatePng(fixture({ clipped: true })), /MASCOT_TOUCHES_CANVAS_EDGE/);
  assert.throws(() => validatePng(Buffer.from('wrong')), /NOT_PNG/);
});

test('a chunk with a wrong CRC is rejected even when its pixels would otherwise pass', () => {
  const good = fixture();
  // Zeroed CRCs are exactly the defect that previously slipped through: every chunk must be verified.
  const zeroed = Buffer.concat([SIGNATURE, ihdr({ width: 512, height: 512 }),
    chunk('IDAT', deflateSync(pixels({ width: 512, height: 512 })), { crc: 0 }), iend()]);
  assert.equal(zeroed.length, good.length);
  assert.throws(() => validatePng(zeroed), /PNG_CHUNK_CRC_MISMATCH:IDAT/);

  const flipped = Buffer.from(good);
  flipped[flipped.length - 3] ^= 0xff; // corrupt the IEND CRC bytes only
  assert.throws(() => validatePng(flipped), /PNG_CHUNK_CRC_MISMATCH:IEND/);

  const payloadDrift = Buffer.from(good);
  payloadDrift[45] ^= 0x01; // mutate a compressed byte, leaving the stored CRC stale
  assert.throws(() => validatePng(payloadDrift), /PNG_CHUNK_CRC_MISMATCH:IDAT/);
});

test('trailing bytes after IEND are rejected', () => {
  const withTrailer = Buffer.concat([fixture(), Buffer.from('PK\x03\x04polyglot-tail')]);
  assert.throws(() => validatePng(withTrailer), /PNG_TRAILING_DATA/);
});

test('malformed structure is rejected: missing IEND, truncated chunk, IHDR not first, non-empty IEND', () => {
  const base = fixture();
  assert.throws(() => validatePng(Buffer.concat([SIGNATURE, ihdr({ width: 512, height: 512 }),
    idat(pixels({ width: 512, height: 512 }))])), /PNG_MISSING_IEND/);
  assert.throws(() => validatePng(base.subarray(0, base.length - 30)), /MALFORMED_PNG_CHUNK/);
  assert.throws(() => validatePng(Buffer.concat([SIGNATURE, chunk('tEXt', Buffer.from('a\0b')),
    ihdr({ width: 512, height: 512 }), idat(pixels({ width: 512, height: 512 })), iend()])), /PNG_IHDR_NOT_FIRST/);
  assert.throws(() => validatePng(Buffer.concat([SIGNATURE, ihdr({ width: 512, height: 512 }),
    idat(pixels({ width: 512, height: 512 })), chunk('IEND', Buffer.from('x'))])), /PNG_IEND_NOT_EMPTY/);
  assert.throws(() => validatePng(Buffer.concat([SIGNATURE, ihdr({ width: 512, height: 512 }), iend()])), /PNG_MISSING_IDAT/);
});

test('decompression safeguards: wrong decompressed size and inflate bombs fail closed', () => {
  const wrongSize = Buffer.concat([SIGNATURE, ihdr({ width: 512, height: 512 }),
    idat(pixels({ width: 512, height: 512 }).subarray(0, 1024)), iend()]);
  assert.throws(() => validatePng(wrongSize), /PNG_DECOMPRESSED_LENGTH_INVALID/);

  const bomb = Buffer.concat([SIGNATURE, ihdr({ width: 512, height: 512 }),
    idat(Buffer.alloc(512 * 512 * 8)), iend()]);
  assert.throws(() => validatePng(bomb), /PNG_IDAT_INFLATE_FAILED/);

  const notRgba = Buffer.alloc(13);
  notRgba.writeUInt32BE(512, 0); notRgba.writeUInt32BE(512, 4);
  notRgba[8] = 8; notRgba[9] = 2; notRgba[12] = 0;
  assert.throws(() => validatePng(Buffer.concat([SIGNATURE, chunk('IHDR', notRgba),
    idat(Buffer.alloc(512 * 512 * 3)), iend()])), /PNG_MUST_BE_NONINTERLACED_RGBA8/);
});

test('a flat RGB render is structurally valid only when alpha is not required', () => {
  const rgb = rgbFixture();
  const structural = validatePng(rgb, { requireAlpha: false });
  assert.equal(structural.mode, 'RGB8');
  assert.equal(structural.alpha, 'ABSENT');
  assert.equal(structural.structural_check, 'PASS');
  // The published artifact contract still refuses an RGB file.
  assert.throws(() => validatePng(rgb), /PNG_MUST_BE_NONINTERLACED_RGBA8/);
});

test('alpha export is deterministic, transparent at the corners and passes the RGBA contract', () => {
  const rgb = rgbFixture();
  const first = exportAlphaPng(rgb);
  const second = exportAlphaPng(rgb);
  assert.equal(first.passthrough, false);
  assert.equal(sha256(first.png), sha256(second.png));
  const validated = validatePng(first.png);
  assert.equal(validated.mode, 'RGBA8');
  assert.equal(validated.crc_check, 'PASS');
  assert.deepEqual(validated.bbox, [80, 80, 431, 431]);
  // An already-RGBA file is passed through unchanged instead of being re-matted.
  const rgba = fixture();
  const passthrough = exportAlphaPng(rgba);
  assert.equal(passthrough.passthrough, true);
  assert.equal(sha256(passthrough.png), sha256(rgba));
});

test('a live-shaped RGB render is exported to RGBA and verified from render.png', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mascot-rgb-')); const ref = join(root, 'reference.png'); await writeFile(ref, fixture());
  const mock = await server({ image: rgbFixture() });
  try {
    const result = await runMascot({ url: mock.url, profile: 'zar', identity: ref, style: ref, out: join(root, 'outputs'), maxWaitMs: 10000 });
    assert.equal(result.provenance.render_validation.mode, 'RGB8');
    assert.equal(result.provenance.alpha_export.passthrough, false);
    assert.equal(result.provenance.alpha_export.output_sha256, result.provenance.validation.sha256);
    const candidate = await readFile(join(result.directory, 'candidate.png'));
    const render = await readFile(join(result.directory, 'render.png'));
    assert.notEqual(sha256(candidate), sha256(render));
    assert.equal(validatePng(candidate).mode, 'RGBA8');
    assert.equal(validatePng(render, { requireAlpha: false }).mode, 'RGB8');
    const verified = await verifyArtifacts(result.directory);
    assert.equal(verified.verified, true);
    // Tampering with the raw render breaks the export binding instead of passing.
    await writeFile(join(result.directory, 'render.png'), rgbFixture({ inset: 96 }));
    await assert.rejects(() => verifyArtifacts(result.directory), /(RENDER_SHA256|ALPHA_EXPORT_SHA256)_FAILED/);
  } finally { await mock.close(); }
});

async function server({ fail = false, historyFailures = 0, promptFailures = 0, image = fixture() } = {}) {
  let submissions = 0, historyAttempts = 0, promptAttempts = 0; const requests = [];
  const s = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    requests.push({ path: pathname, headers: req.headers });
    const send = (code, data, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(type === 'application/json' ? JSON.stringify(data) : data); };
    if (pathname === '/system_stats') return send(200, { system: { comfyui_version: 'test-mock-only' } });
    if (pathname === '/object_info/ArkCodexImageGen') return send(200, { ArkCodexImageGen: {} });
    if (pathname === '/upload/image') {
      const chunks = []; for await (const c of req) chunks.push(c);
      const match = Buffer.concat(chunks).toString('latin1').match(/filename="(mascot_[a-f0-9]{24}_[a-f0-9]{8}\.png)"/);
      return send(200, { name: match?.[1] ?? 'MALFORMED_UPLOAD' });
    }
    if (pathname === '/prompt') { promptAttempts++; if (promptAttempts <= promptFailures) return send(503, { error: 'queue busy' }); submissions++; return send(200, { prompt_id: 'mock-run-123' }); }
    if (pathname === '/history/mock-run-123') {
      historyAttempts++;
      if (historyAttempts <= historyFailures) return send(503, { error: 'queue busy' });
      return send(200, { 'mock-run-123': fail ? { status: { status_str: 'error', messages: [['execution_error', { node_id: '3', exception_message: 'AUTH_DENIED' }]] } } : { status: { status_str: 'success' }, outputs: { '4': { images: [{ filename: 'mock.png', subfolder: '', type: 'output' }] } } } });
    }
    if (pathname === '/view') return send(200, image, 'image/png');
    return send(404, { error: 'not found' });
  });
  await new Promise(ok => s.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${s.address().port}/`, close: () => new Promise(ok => s.close(ok)), getSubmissions: () => submissions, getHistoryAttempts: () => historyAttempts, getPromptAttempts: () => promptAttempts, requests };
}

test('mock ComfyUI E2E uploads refs → queues → reads history → validates → writes pending artifact with provenance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mascot-e2e-')); const ref = join(root, 'reference.png'); await writeFile(ref, fixture());
  const mock = await server();
  try {
    const result = await runMascot({ url: mock.url, profile: 'szlif', identity: ref, style: ref, out: join(root, 'outputs'), maxWaitMs: 10000 });
    assert.equal(mock.getSubmissions(), 1);
    assert.equal(result.provenance.status, 'AWAITING_HUMAN_BRAND_QA');
    assert.equal(result.provenance.prompt_id, 'mock-run-123');
    assert.equal(result.provenance.visual_identity_approved, false);
    assert.equal(result.provenance.validation.crc_check, 'PASS');
    const png = await readFile(join(result.directory, 'candidate.png'));
    assert.equal(validatePng(png).sha256, result.provenance.validation.sha256);
    const metadata = JSON.parse(await readFile(join(result.directory, 'provenance.json'), 'utf8'));
    assert.equal(metadata.reference_identity.sha256, metadata.reference_style.sha256);
  } finally { await mock.close(); }
});

test('mock failed node does not create a falsely successful output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mascot-fail-')); const ref = join(root, 'reference.png'); await writeFile(ref, fixture());
  const mock = await server({ fail: true });
  try {
    await assert.rejects(() => runMascot({ url: mock.url, profile: 'zar', identity: ref, style: ref, out: join(root, 'outputs'), maxWaitMs: 10000 }), /IMAGE_RENDER_FAILED/);
    // A failed render must leave no candidate/provenance artifact behind, even though the runner wrote its budget ledger.
    await assert.rejects(() => readFile(join(root, 'outputs', 'zar', 'mock-run-123', 'candidate.png')), /ENOENT/);
    await assert.rejects(() => readFile(join(root, 'outputs', 'zar', 'mock-run-123', 'provenance.json')), /ENOENT/);
  } finally { await mock.close(); }
});

test('a corrupt PNG from the backend is rejected before any artifact is written', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mascot-corrupt-')); const ref = join(root, 'reference.png'); await writeFile(ref, fixture());
  const corrupt = Buffer.from(fixture()); corrupt[corrupt.length - 2] ^= 0xff; // corrupt the trailing IEND CRC
  const mock = await server({ image: corrupt });
  try {
    await assert.rejects(() => runMascot({ url: mock.url, profile: 'zar', identity: ref, style: ref, out: join(root, 'outputs'), maxWaitMs: 10000 }), /PNG_CHUNK_CRC_MISMATCH/);
    await assert.rejects(() => readFile(join(root, 'outputs', 'zar', 'mock-run-123', 'candidate.png')), /ENOENT/);
    await assert.rejects(() => readFile(join(root, 'outputs', 'zar', 'mock-run-123', 'provenance.json')), /ENOENT/);
  } finally { await mock.close(); }
});

test('transport policy refuses remote plaintext, unauthenticated remote and URL-embedded credentials', () => {
  assert.throws(() => resolveTransport({ url: 'http://comfy.example:8188/', env: {} }), /INSECURE_REMOTE_TRANSPORT/);
  assert.throws(() => resolveTransport({ url: 'https://comfy.example/', env: {} }), /MISSING_REMOTE_CREDENTIAL/);
  assert.throws(() => resolveTransport({ url: 'https://user:pass@comfy.example/', env: {} }), /URL_CREDENTIALS_NOT_ALLOWED/);
  assert.throws(() => resolveTransport({ url: 'https://comfy.example/', env: { CF_ACCESS_CLIENT_ID: 'id-only' } }), /INCOMPLETE_SERVICE_TOKEN/);
  assert.throws(() => resolveTransport({ url: 'https://comfy.example/', env: { COMFY_API_TOKEN: 'a', CF_ACCESS_CLIENT_ID: 'b', CF_ACCESS_CLIENT_SECRET: 'c' } }), /AMBIGUOUS_REMOTE_CREDENTIALS/);
  const bearer = resolveTransport({ url: 'https://comfy.example/', env: { COMFY_API_TOKEN: 'unit-test-token' } });
  assert.equal(bearer.scheme, 'bearer'); assert.equal(bearer.headers.authorization, 'Bearer unit-test-token');
  const service = resolveTransport({ url: 'https://comfy.example/', env: { CF_ACCESS_CLIENT_ID: 'cid', CF_ACCESS_CLIENT_SECRET: 'csecret' } });
  assert.equal(service.scheme, 'service-token'); assert.equal(service.headers['CF-Access-Client-Id'], 'cid');
  assert.equal(service.headers['CF-Access-Client-Secret'], 'csecret');
  assert.equal(resolveTransport({ url: 'http://127.0.0.1:8188/', env: {} }).loopback, true);
});

test('bearer credential reaches the backend and is never written into provenance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mascot-auth-')); const ref = join(root, 'reference.png'); await writeFile(ref, fixture());
  const mock = await server(); const token = 'unit-test-token-NOT-A-REAL-CREDENTIAL';
  try {
    const result = await runMascot({ url: mock.url, profile: 'zar', identity: ref, style: ref, out: join(root, 'outputs'), maxWaitMs: 10000, env: { COMFY_API_TOKEN: token } });
    assert.ok(mock.requests.length > 0);
    for (const entry of mock.requests) assert.equal(entry.headers.authorization, `Bearer ${token}`);
    assert.equal(result.provenance.transport.scheme, 'bearer');
    assert.equal(result.provenance.transport.loopback, true);
    const raw = await readFile(join(result.directory, 'provenance.json'), 'utf8');
    assert.equal(raw.includes(token), false);
  } finally { await mock.close(); }
});

test('only idempotent GETs are retried: a busy history response is retried, the prompt is never resubmitted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mascot-retry-')); const ref = join(root, 'reference.png'); await writeFile(ref, fixture());
  const mock = await server({ historyFailures: 1 });
  try {
    const result = await runMascot({ url: mock.url, profile: 'zar', identity: ref, style: ref, out: join(root, 'outputs'), maxWaitMs: 10000 });
    assert.equal(result.provenance.prompt_id, 'mock-run-123');
    assert.equal(mock.getSubmissions(), 1);
    assert.equal(mock.requests.filter(r => r.path === '/prompt').length, 1);
    assert.ok(mock.getHistoryAttempts() >= 2);
  } finally { await mock.close(); }
  // A rejected submission must not be retried: retrying /prompt would queue a second (billable) render.
  const busy = await server({ promptFailures: 1 });
  try {
    await assert.rejects(() => runMascot({ url: busy.url, profile: 'zar', identity: ref, style: ref, out: join(root, 'outputs-busy'), maxWaitMs: 10000 }), /COMFY_HTTP_503 \/prompt/);
    assert.equal(busy.getPromptAttempts(), 1);
    assert.equal(busy.getSubmissions(), 0);
  } finally { await busy.close(); }
});

test('render budget fails closed before a second prompt is submitted and a corrupt ledger never resets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mascot-budget-')); const ref = join(root, 'reference.png'); await writeFile(ref, fixture());
  const budgetPath = join(root, 'budget.json'); const mock = await server();
  try {
    await runMascot({ url: mock.url, profile: 'zar', identity: ref, style: ref, out: join(root, 'outputs'), maxWaitMs: 10000, maxRenders: 1, budgetPath });
    await assert.rejects(() => runMascot({ url: mock.url, profile: 'zar', identity: ref, style: ref, out: join(root, 'outputs'), maxWaitMs: 10000, maxRenders: 1, budgetPath }), /RENDER_BUDGET_EXCEEDED/);
    assert.equal(mock.getSubmissions(), 1);
    const corrupt = join(root, 'corrupt-budget.json'); await writeFile(corrupt, '{not json');
    await assert.rejects(() => consumeRenderBudget({ ledgerPath: corrupt, maxRenders: 5 }), /BUDGET_LEDGER_CORRUPT/);
  } finally { await mock.close(); }
});

test('independent verifier recomputes every claim and rejects tampered artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mascot-verify-')); const ref = join(root, 'reference.png'); await writeFile(ref, fixture());
  const other = join(root, 'other.png'); await writeFile(other, fixture({ width: 513, height: 513 }));
  const mock = await server();
  try {
    const { directory } = await runMascot({ url: mock.url, profile: 'szlif', identity: ref, style: ref, out: join(root, 'outputs'), maxWaitMs: 10000 });
    const genuine = await verifyArtifacts(directory, { identityFile: ref });
    assert.equal(genuine.verified, true); assert.ok(genuine.checks.length >= 9); assert.equal(genuine.brand_review, 'PENDING_MANUAL');
    await assert.rejects(() => verifyArtifacts(directory, { identityFile: other }), /REFERENCE_IDENTITY_SHA256_FAILED/);
    const readProvenance = async () => JSON.parse(await readFile(join(directory, 'provenance.json'), 'utf8'));
    const writeProvenance = async value => writeFile(join(directory, 'provenance.json'), JSON.stringify(value, null, 2) + '\n');
    const original = await readProvenance();
    await writeProvenance({ ...original, workflow_sha256: '0'.repeat(64) });
    await assert.rejects(() => verifyArtifacts(directory), /WORKFLOW_SHA256_FAILED/);
    await writeProvenance({ ...original, validation: { ...original.validation, crc_check: 'SKIPPED' } });
    await assert.rejects(() => verifyArtifacts(directory), /RECORDED_CRC_CHECK_FAILED/);
    await writeProvenance({ ...original, visual_identity_approved: true });
    await assert.rejects(() => verifyArtifacts(directory), /NO_SELF_APPROVAL_FAILED/);
    await writeProvenance({ ...original, status: 'APPROVED' });
    await assert.rejects(() => verifyArtifacts(directory), /PENDING_STATUS_FAILED/);
    await writeProvenance(original);
    const png = await readFile(join(directory, 'candidate.png'));
    await writeFile(join(directory, 'candidate.png'), Buffer.concat([png, Buffer.from([0])]));
    // Appended bytes are now caught by the structural gate (PNG_TRAILING_DATA) before any hash comparison.
    await assert.rejects(() => verifyArtifacts(directory), /(ARTIFACT_SHA256|RECORDED_|ALPHA_EXPORT_).*_FAILED|PNG_TRAILING_DATA/);
  } finally { await mock.close(); }
});
