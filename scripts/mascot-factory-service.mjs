#!/usr/bin/env node
/**
 * Mascot Factory render service — the executable deployment target.
 *
 * The merged CLI (`scripts/mascot-factory.mjs`) is a one-shot runner. This file
 * wraps it in a long-lived HTTP service so the Mascot Factory can actually run
 * in production instead of being source that only exists in a repository:
 * liveness, readiness, release provenance, a bounded authenticated render
 * endpoint, artifact provenance on disk and a fail-closed cost guard.
 *
 * Security contract:
 * - Every render requires a bearer token from `MASCOT_FACTORY_API_TOKEN`
 *   (minimum 32 characters). A missing or short token refuses to start, so the
 *   service can never be deployed as an open render endpoint. Tokens are only
 *   accepted in the `Authorization` header — never in the query string, never in
 *   the request body — and are compared in constant time.
 * - ComfyUI credentials are never accepted by this process from a request or a
 *   file: the transport is resolved once at startup from the environment and is
 *   validated by the runner's own fail-closed policy (remote endpoints must be
 *   HTTPS *and* carry a credential). No response, log line or artifact contains
 *   a credential value.
 * - Brand identity is pinned: the identity/style reference files must hash to
 *   the values in `ops/mascot-worker/reference-pins.json`, otherwise readiness
 *   fails and no render is submitted. This keeps a swapped or re-exported
 *   reference from silently changing what the model is locked to.
 * - Cost is bounded twice: a per-UTC-day render budget ledger (consumed before
 *   the prompt is submitted, corrupt or unreadable ledger fails closed) and a
 *   single-flight lock, so a retry or a double click cannot queue a second
 *   billable render.
 * - `/readyz` reports readiness of the *actual* backend, not of this process's
 *   configuration: it performs a bounded, credential-carrying, read-only probe
 *   of ComfyUI (`GET /system_stats` and `GET /object_info/ArkCodexImageGen`) and
 *   fails with `503` when the engine is unreachable, rejects the credential or
 *   lacks the generation node. Only GET is used — readiness must never submit a
 *   billable `/prompt`.
 * - `SOURCE_COMMIT` must be the exact 40-hex commit at startup, so the process
 *   cannot serve an unidentified build. `/__release.json` publishes it.
 * - Nothing is published or approved here: artifacts are written as
 *   `AWAITING_HUMAN_BRAND_QA` and remain unpublished.
 *
 * Node 24+.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILES, buildGraph, describeTransport, graphSha256, runMascot, resolveTransport, sha256 } from './mascot-factory.mjs';

export const SERVICE_NAME = 'mascot-factory';
export const SERVICE_VERSION = '1.0.0';
export const MIN_TOKEN_LENGTH = 32;
export const MAX_BODY_BYTES = 4096;
/** Service default is stricter than the CLI default (4): a daemon is unattended. */
export const DEFAULT_MAX_RENDERS = 2;
/** Upper bound on the whole readiness probe; a slow backend must not hang health checks. */
export const DEFAULT_PROBE_TIMEOUT_MS = 2500;
export const MAX_PROBE_TIMEOUT_MS = 30_000;
/** The ComfyUI node this service's brand-locked graph requires. */
export const REQUIRED_BACKEND_NODE = 'ArkCodexImageGen';

const DEFAULT_PINS = fileURLToPath(new URL('../ops/mascot-worker/reference-pins.json', import.meta.url));
const DEFAULT_OUT_DIR = '/var/lib/mascot-factory/out';
const DEFAULT_REFERENCES_DIR = '/etc/mascot-factory/references';

function fail(code) { throw new Error(code); }
function assert(ok, code) { if (!ok) fail(code); }

/**
 * Read and validate the process configuration. Throws an explicit code instead
 * of starting with a partial or unsafe configuration.
 */
export function loadConfig(env = process.env) {
  const sourceCommit = String(env.SOURCE_COMMIT ?? '').trim();
  assert(/^[0-9a-f]{40}$/i.test(sourceCommit), 'SOURCE_COMMIT_INVALID');

  const token = String(env.MASCOT_FACTORY_API_TOKEN ?? '');
  assert(token.length >= MIN_TOKEN_LENGTH && !/\s/.test(token), 'MASCOT_FACTORY_API_TOKEN_INVALID');

  const url = String(env.COMFY_URL ?? '').trim();
  assert(url.length > 0, 'COMFY_URL_REQUIRED');
  // Fails closed exactly like the runner: remote plaintext, unauthenticated
  // remote, ambiguous and incomplete credentials are all refused here, before
  // the server binds a port.
  const transport = resolveTransport({ url, env });

  const port = Number(env.PORT ?? 8080);
  assert(Number.isInteger(port) && port > 0 && port < 65536, 'PORT_INVALID');

  const maxRenders = Number(env.MASCOT_FACTORY_MAX_RENDERS ?? DEFAULT_MAX_RENDERS);
  assert(Number.isInteger(maxRenders) && maxRenders > 0, 'INVALID_RENDER_BUDGET');

  const maxWaitMs = Number(env.MASCOT_FACTORY_MAX_WAIT_MS ?? 360_000);
  assert(Number.isInteger(maxWaitMs) && maxWaitMs > 0, 'INVALID_MAX_WAIT');

  const probeTimeoutMs = Number(env.MASCOT_FACTORY_PROBE_TIMEOUT_MS ?? DEFAULT_PROBE_TIMEOUT_MS);
  assert(Number.isInteger(probeTimeoutMs) && probeTimeoutMs > 0 && probeTimeoutMs <= MAX_PROBE_TIMEOUT_MS, 'INVALID_PROBE_TIMEOUT');

  const outDir = String(env.MASCOT_FACTORY_OUT_DIR ?? DEFAULT_OUT_DIR);

  // Raw secrets never become properties of the returned configuration: an
  // accidentally serialized or logged config must not leak them. The bearer is
  // kept only as a digest, and credential scrubbing is a closure over the values
  // (functions are not serialized by JSON.stringify).
  const secrets = [token, url, env.COMFY_API_TOKEN, env.CF_ACCESS_CLIENT_ID, env.CF_ACCESS_CLIENT_SECRET].filter(Boolean);

  return {
    sourceCommit: sourceCommit.toLowerCase(),
    tokenDigest: sha256(Buffer.from(token)),
    scrub: (text) => redact(text, secrets),
    comfyUrl: url,
    // Resolution (and therefore the credential headers) stays inside the runner;
    // the service keeps only the secret-free description for reporting.
    transport: describeTransport(transport),
    // Readiness probes the real engine through the same fail-closed transport
    // policy. It is a closure — never serialized — so no credential can reach a
    // response or a log through the configuration object.
    probe: (options = {}) => probeBackend({ url, env, timeoutMs: probeTimeoutMs, ...options }),
    probeTimeoutMs,
    host: String(env.HOST ?? '0.0.0.0'),
    port,
    outDir,
    referencesDir: String(env.MASCOT_FACTORY_REFERENCES ?? DEFAULT_REFERENCES_DIR),
    pinsPath: String(env.MASCOT_FACTORY_REFERENCE_PINS ?? DEFAULT_PINS),
    budgetLedger: String(env.MASCOT_FACTORY_BUDGET_LEDGER ?? join(outDir, '.mascot-render-budget.json')),
    maxRenders,
    maxWaitMs,
  };
}

/** Replace any configured credential value in an outgoing string. */
export function redact(text, secrets = []) {
  let out = String(text ?? '');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 8) out = out.split(secret).join('[redacted]');
  }
  return out;
}

/** Constant-time bearer comparison against the configured digest. */
function tokenMatches(presented, expectedDigest) {
  if (!presented) return false;
  const left = Buffer.from(sha256(Buffer.from(String(presented))), 'hex');
  const right = Buffer.from(String(expectedDigest), 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Deterministic identity of a brand-locked graph, independent of file names. */
export function graphTemplateSha256(profile) {
  const graph = buildGraph({ profile, identityImage: '<identity>', styleImage: '<style>' });
  return graphSha256(graph);
}

/** Pinned expectations this build serves; recomputed, never trusted from disk. */
export function computePins() {
  const profiles = {};
  for (const profile of Object.keys(PROFILES)) {
    profiles[profile] = {
      graph_template_sha256: graphTemplateSha256(profile),
      prompt_sha256: sha256(Buffer.from(PROFILES[profile].prompt)),
    };
  }
  return profiles;
}

export async function loadReferencePins(pinsPath) {
  const pins = JSON.parse(await readFile(pinsPath, 'utf8'));
  assert(pins?.schema === 1, 'REFERENCE_PINS_SCHEMA_INVALID');
  for (const profile of Object.keys(PROFILES)) {
    const entry = pins?.profiles?.[profile];
    assert(entry?.identity?.file && /^[0-9a-f]{64}$/i.test(entry?.identity?.sha256 ?? ''), `REFERENCE_PINS_IDENTITY_INVALID:${profile}`);
    assert(entry?.style?.file && /^[0-9a-f]{64}$/i.test(entry?.style?.sha256 ?? ''), `REFERENCE_PINS_STYLE_INVALID:${profile}`);
  }
  return pins;
}

/**
 * Verify the mounted reference images against the pins. Returns the artifact
 * names the runner must upload and a blocker list instead of throwing, so
 * readiness can report *why* it is not ready.
 */
export async function verifyReferences({ config, pins }) {
  const verified = {};
  const blockers = [];
  for (const profile of Object.keys(PROFILES)) {
    const entry = pins.profiles[profile];
    const files = {};
    for (const role of ['identity', 'style']) {
      const expected = entry[role];
      const path = resolve(config.referencesDir, expected.file);
      try {
        const bytes = await readFile(path);
        const digest = sha256(bytes);
        if (digest !== expected.sha256.toLowerCase()) {
          blockers.push(`REFERENCE_HASH_MISMATCH:${profile}:${role}`);
          continue;
        }
        files[role] = { name: expected.file, path, sha256: digest };
      } catch {
        blockers.push(`REFERENCE_MISSING:${profile}:${role}`);
      }
    }
    verified[profile] = files;
  }
  // The pin file also pins the brand-locked graph and prompt; a drifted prompt
  // would silently change the model's instructions, so it blocks rendering.
  const actual = computePins();
  for (const profile of Object.keys(PROFILES)) {
    if (actual[profile].graph_template_sha256 !== String(pins.profiles[profile].graph_template_sha256 ?? '').toLowerCase()) {
      blockers.push(`GRAPH_TEMPLATE_HASH_MISMATCH:${profile}`);
    }
    if (actual[profile].prompt_sha256 !== String(pins.profiles[profile].prompt_sha256 ?? '').toLowerCase()) {
      blockers.push(`PROMPT_HASH_MISMATCH:${profile}`);
    }
  }
  return { verified, blockers, ok: blockers.length === 0 };
}

/** Read the cost ledger without consuming it; a corrupt ledger is a blocker. */
export async function readBudget({ config, now = new Date() }) {
  const window = now.toISOString().slice(0, 10);
  let count = 0;
  try {
    const parsed = JSON.parse(await readFile(config.budgetLedger, 'utf8'));
    if (parsed?.window === window) {
      if (!Number.isInteger(parsed?.count) || parsed.count < 0) return { ok: false, blocker: 'BUDGET_LEDGER_CORRUPT', window, used: null, max: config.maxRenders };
      count = parsed.count;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') return { ok: false, blocker: 'BUDGET_LEDGER_CORRUPT', window, used: null, max: config.maxRenders };
  }
  const remaining = config.maxRenders - count;
  return { ok: remaining > 0, blocker: remaining > 0 ? null : `RENDER_BUDGET_EXHAUSTED ${count}/${config.maxRenders} in ${window}`, window, used: count, max: config.maxRenders, remaining };
}

/**
 * Bounded, credential-carrying, read-only probe of the real ComfyUI engine.
 *
 * Readiness must describe the *backend*, not this process's intent: an
 * unreachable host, a rejected credential or a missing `ArkCodexImageGen` node
 * all mean "cannot render right now". Only GET endpoints are used, so a probe
 * can never submit a billable `/prompt`.
 *
 * Every failure is reported as a stable code. Response bodies, headers and
 * credentials are never echoed, so the code is safe to serve and to log.
 */
export async function probeBackend({ url, env = process.env, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const deadline = Date.now() + timeoutMs;
  let transport;
  try {
    // Same fail-closed policy as the runner: a remote endpoint without a
    // credential is refused before a single request leaves the process.
    transport = resolveTransport({ url, env });
  } catch (err) {
    return { ok: false, code: String(err?.message ?? 'BACKEND_UNCONFIGURED') };
  }

  const get = async (path) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { code: 'BACKEND_TIMEOUT' };
    let response;
    try {
      response = await fetchImpl(new URL(path, transport.base), {
        method: 'GET',
        headers: transport.headers,
        // A redirect is an authorization/boundary signal here (Cloudflare
        // Access sends unauthenticated callers to a login page), not something
        // to follow into an HTML body.
        redirect: 'manual',
        signal: AbortSignal.timeout(remaining),
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return { code: 'BACKEND_TIMEOUT' };
      return { code: 'BACKEND_UNREACHABLE' };
    }
    if (response.status === 401 || response.status === 403) return { code: 'BACKEND_UNAUTHORIZED' };
    if (!response.ok) return { code: `BACKEND_HTTP_ERROR_${response.status}` };
    return { response };
  };

  const stats = await get('/system_stats');
  if (stats.code) return { ok: false, code: stats.code };
  // Drain the body so the probe never leaves a socket half-read.
  await stats.response.text().catch(() => '');

  const node = await get(`/object_info/${REQUIRED_BACKEND_NODE}`);
  if (node.code) return { ok: false, code: node.code };

  let payload;
  try {
    payload = JSON.parse(await node.response.text());
  } catch {
    return { ok: false, code: 'BACKEND_INVALID_RESPONSE' };
  }
  if (!payload || typeof payload !== 'object' || !Object.hasOwn(payload, REQUIRED_BACKEND_NODE)) {
    return { ok: false, code: 'BACKEND_NODE_MISSING' };
  }
  return { ok: true, code: null };
}

function send(res, status, body, headers = {}) {
  const payload = Buffer.from(`${JSON.stringify(body)}\n`);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

async function readBody(req, limit = MAX_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) fail('BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function bearerFrom(req) {
  const header = String(req.headers.authorization ?? '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/**
 * Build the request handler. Dependencies are injectable so the test suite can
 * drive a real HTTP server against a mock ComfyUI without any live backend.
 */
export function createHandler(config, { runner = runMascot, probe, now = () => new Date(), logger = () => {} } = {}) {
  const state = { inFlight: false, accepted: 0, lastError: null };
  let pinsPromise = null;
  const loadPins = () => (pinsPromise ??= loadReferencePins(config.pinsPath));
  const probeTimeoutMs = config.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const probeFn = probe ?? config.probe ?? ((options) => probeBackend({ url: config.comfyUrl, timeoutMs: probeTimeoutMs, ...options }));

  /**
   * Probe the backend and normalize the result. An injected probe that throws
   * is a not-ready backend, never a ready one.
   */
  const backendReadiness = async () => {
    try {
      const result = await probeFn({ timeoutMs: probeTimeoutMs });
      if (result?.ok) return { ok: true, code: null };
      return { ok: false, code: String(result?.code ?? 'BACKEND_PROBE_FAILED') };
    } catch (err) {
      return { ok: false, code: config.scrub(String(err?.message ?? 'BACKEND_PROBE_FAILED')).slice(0, 120) };
    }
  };

  const readiness = async () => {
    const blockers = [];
    const add = (blocker) => { if (blocker && !blockers.includes(blocker)) blockers.push(blocker); };
    let references = { ok: false, verified: {} };
    try {
      const pins = await loadPins();
      references = await verifyReferences({ config, pins });
      references.blockers.forEach(add);
    } catch (err) {
      add(err?.message?.startsWith?.('REFERENCE_PINS') ? err.message : 'REFERENCE_PINS_UNREADABLE');
    }
    const budget = await readBudget({ config, now: now() });
    if (!budget.ok) add(budget.blocker);
    if (!config.transport.authenticated && !config.transport.loopback) add('MISSING_REMOTE_CREDENTIAL');
    // The static transport check above only proves this process *has* a
    // credential. Only the probe proves the engine answers with it.
    const backend = await backendReadiness();
    if (!backend.ok) add(backend.code);
    return { ok: blockers.length === 0, blockers, references, budget, backend };
  };

  const handler = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://service.local');
    const method = (req.method ?? 'GET').toUpperCase();
    const path = url.pathname;
    try {
      if (path === '/healthz') {
        // Liveness only: the process is up and serving. Backend and pin health
        // belong to /readyz, so a ComfyUI outage never restarts a healthy pod.
        if (method !== 'GET') return send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
        return send(res, 200, { ok: true, service: SERVICE_NAME, version: SERVICE_VERSION });
      }

      if (path === '/__release.json') {
        if (method !== 'GET') return send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
        return send(res, 200, { commit: config.sourceCommit, source: 'zar-i-szlif/mascot-factory' });
      }

      if (path === '/readyz') {
        if (method !== 'GET') return send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
        const ready = await readiness();
        return send(res, ready.ok ? 200 : 503, {
          ok: ready.ok,
          blockers: ready.blockers,
          backend: { probed: true, code: ready.backend.code },
          budget: ready.budget,
          references: Object.fromEntries(Object.entries(ready.references.verified).map(([profile, files]) => [
            profile,
            Object.fromEntries(Object.entries(files ?? {}).map(([role, file]) => [role, file.sha256])),
          ])),
        });
      }

      if (path === '/status') {
        if (method !== 'GET') return send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
        const ready = await readiness();
        return send(res, 200, {
          service: SERVICE_NAME,
          version: SERVICE_VERSION,
          commit: config.sourceCommit,
          ready: ready.ok,
          blockers: ready.blockers,
          profiles: computePins(),
          backend: { scheme: config.transport.scheme, host: config.transport.host, protocol: config.transport.protocol, authenticated: config.transport.authenticated, loopback: config.transport.loopback, probe: ready.backend.code },
          budget: ready.budget,
          renders: { in_flight: state.inFlight, accepted: state.accepted },
          last_error: state.lastError,
          artifact_status: 'AWAITING_HUMAN_BRAND_QA',
          publication: 'disabled',
        });
      }

      if (path === '/render') {
        if (method !== 'POST') return send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
        // A token in the query string leaks into proxy logs and browser history.
        if (url.searchParams.has('token') || url.searchParams.has('api_key')) return send(res, 400, { error: 'TOKEN_IN_QUERY_REJECTED' });
        if (!tokenMatches(bearerFrom(req), config.tokenDigest)) {
          logger({ event: 'render_rejected', reason: 'UNAUTHORIZED' });
          return send(res, 401, { error: 'UNAUTHORIZED' }, { 'www-authenticate': 'Bearer realm="mascot-factory"' });
        }

        let body;
        try {
          body = JSON.parse((await readBody(req)) || '{}');
        } catch (err) {
          return send(res, err?.message === 'BODY_TOO_LARGE' ? 413 : 400, { error: err?.message === 'BODY_TOO_LARGE' ? 'BODY_TOO_LARGE' : 'BODY_NOT_JSON' });
        }
        if (body && Object.keys(body).some((key) => /token|secret|credential/i.test(key))) return send(res, 400, { error: 'CREDENTIAL_IN_BODY_REJECTED' });
        const profile = body?.profile;
        if (!Object.hasOwn(PROFILES, profile)) return send(res, 400, { error: 'UNKNOWN_PROFILE' });

        if (state.inFlight) return send(res, 409, { error: 'RENDER_IN_FLIGHT' });
        state.inFlight = true;
        try {
          const ready = await readiness();
          if (!ready.ok) return send(res, 503, { error: 'NOT_READY', blockers: ready.blockers });

          const files = ready.references.verified[profile];
          const result = await runner({
            url: config.comfyUrl,
            profile,
            identity: files.identity.path,
            style: files.style.path,
            out: config.outDir,
            maxWaitMs: config.maxWaitMs,
            maxRenders: config.maxRenders,
            budgetPath: config.budgetLedger,
          });
          state.accepted += 1;
          const provenance = result.provenance;
          return send(res, 200, {
            status: provenance.status,
            profile,
            prompt_id: provenance.prompt_id,
            sha256: provenance.validation.sha256,
            workflow_sha256: provenance.workflow_sha256,
            dimensions: [provenance.validation.width, provenance.validation.height],
            render_budget: provenance.render_budget,
            artifact: {
              directory: resolve(result.directory),
              candidate: join(resolve(result.directory), 'candidate.png'),
              provenance: join(resolve(result.directory), 'provenance.json'),
            },
            brand_review: 'PENDING_MANUAL',
          });
        } catch (err) {
          // Report a stable, actionable code instead of a bare "fetch failed";
          // an unreachable backend is an operational state, not a render defect.
          const raw = String(err?.message ?? 'RENDER_FAILED');
          const unreachable = /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|UND_ERR/i.test(raw);
          const cause = err?.cause?.code ? ` ${err.cause.code}` : '';
          const code = unreachable ? `BACKEND_UNREACHABLE${cause}` : config.scrub(raw).slice(0, 300);
          state.lastError = { at: now().toISOString(), profile, code };
          logger({ event: 'render_failed', code });
          return send(res, 502, { error: 'RENDER_FAILED', code });
        } finally {
          state.inFlight = false;
        }
      }

      return send(res, 404, { error: 'NOT_FOUND' });
    } catch (err) {
      const code = config.scrub(String(err?.message ?? 'INTERNAL_ERROR')).slice(0, 200);
      logger({ event: 'request_failed', path, code });
      return send(res, 500, { error: 'INTERNAL_ERROR', code });
    }
  };

  return { handler, state };
}

/** Bind the service. Startup is fail-closed: a bad configuration never binds. */
export function startServer(config, deps = {}) {
  const { handler } = createHandler(config, deps);
  const server = createServer(handler);
  server.headersTimeout = 30_000;
  server.requestTimeout = 600_000;
  return new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(config.port, config.host, () => resolvePromise(server));
  });
}

const isEntrypoint = () => Boolean(process.argv[1]) && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isEntrypoint()) {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    // Never print environment values here; the code names the missing input.
    console.error(JSON.stringify({ event: 'startup_refused', code: String(err?.message ?? 'CONFIG_INVALID') }));
    process.exit(1);
  }
  const logger = (record) => console.log(JSON.stringify({ at: new Date().toISOString(), service: SERVICE_NAME, ...record }));
  startServer(config, { logger })
    .then((server) => {
      logger({ event: 'listening', host: config.host, port: config.port, commit: config.sourceCommit, transport: { scheme: config.transport.scheme, host: config.transport.host, authenticated: config.transport.authenticated } });
      for (const signal of ['SIGTERM', 'SIGINT']) {
        process.on(signal, () => server.close(() => process.exit(0)));
      }
    })
    .catch((err) => {
      logger({ event: 'startup_failed', code: String(err?.message ?? 'BIND_FAILED') });
      process.exit(1);
    });
}
