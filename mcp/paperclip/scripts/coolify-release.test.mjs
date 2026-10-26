import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCoolifyRelease } from './coolify-release.mjs';

const SHA = 'a'.repeat(40);
const UUID = 'paperclip-mcp-app';
const app = () => ({
  uuid: UUID, git_repository: 'https://github.com/miloszspyrka-code/zar-i-szlif.git',
  git_branch: 'main', base_directory: '/mcp/paperclip',
  build_pack: 'dockerfile', ports_exposes: '3101', git_commit_sha: 'b'.repeat(40),
});
const cfg = (extra = {}) => ({ baseUrl: 'https://coolify.test', token: 'secret-do-not-print',
  applicationUuid: UUID, sourceSha: SHA,
  publicMcpUrl: 'https://paperclip-mcp.example.test', canaryToken: 'mcp-test-secret', ...extra });
const json = (x, status = 200) => ({
  status, ok: status >= 200 && status < 300,
  json: async () => x, text: async () => JSON.stringify(x),
});
function backend(customApp = app()) {
  const requests = []; let state = { ...customApp };
  const fetcher = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    requests.push({ url, method });
    if (url.endsWith('/api/v1/applications/' + UUID)) {
      if (method === 'PATCH') { state = { ...state, ...JSON.parse(opts.body) }; return json(state); }
      return json(state);
    }
    if (url.endsWith('/api/v1/deploy')) return json({ deployments: [
      {resource_uuid: UUID, deployment_uuid: 'abcdef0123'}] });
    if (url.endsWith('/api/v1/deployments/abcdef0123')) return json({
      deployment_uuid: 'abcdef0123', status: 'finished', commit: SHA });
    if (url.endsWith('/health')) return json({ ok: true });
    if (url.endsWith('/__release/identity')) return json({
      sourceSha: SHA, resourceUuid: UUID, containerName: 'paperclip-mcp-container' });
    if (url.includes('oauth-protected-resource')) return json({ resource: '/mcp' });
    if (url.endsWith('/mcp')) {
      const p = JSON.parse(opts.body);
      if (!opts.headers.Authorization) return json({}, 401);
      if (p.method === 'initialize') return json({jsonrpc:'2.0',id:p.id,
        result: {serverInfo:{name:'paperclip'},protocolVersion:'2025-06-18'}});
      if (p.method === 'tools/list') return json({jsonrpc:'2.0',id:p.id,
        result:{tools:[{name:'paperclipGetServerInfo'}]}});
    }
    return json({ error: 'unexpected request' }, 404);
  };
  return { fetcher, requests };
}

test('reject absent configuration and invalid origins before touching network', () => {
  assert.throws(() => createCoolifyRelease(cfg({ baseUrl:'http://untrusted' })), /HTTPS/);
  assert.throws(() => createCoolifyRelease(cfg({ sourceSha:'main' })), /immutable/);
  assert.throws(() => createCoolifyRelease(cfg({ token:'' })), /TOKEN/);
});

for (const [name, change] of [
  ['foreign repository', { git_repository:'https://github.com/evil/other' }],
  ['non-main branch', { git_branch:'KOMAA-1463' }],
  ['wrong project directory', { base_directory:'/mcp/plasmic' }],
  ['wrong port', { ports_exposes:'8091' }],
  ['wrong image builder', { build_pack:'nixpacks' }],
  ['wrong app UUID', { uuid:'other-app' }],
]) test('fail closed: ' + name, async () => {
  const f = backend({ ...app(), ...change });
  await assert.rejects(createCoolifyRelease(cfg(), f.fetcher).queue());
  assert.equal(f.requests.some(x => x.method !== 'GET'), false, 'must not mutate any target');
});

test('Coolify GitHub App shorthand and SSH repo both pass exact source verification', async () => {
  for (const git_repository of ['miloszspyrka-code/zar-i-szlif', 'git@github.com:miloszspyrka-code/zar-i-szlif.git']) {
    const f = backend({ ...app(), git_repository });
    const preflight = await createCoolifyRelease(cfg(), f.fetcher).preflight();
    assert.equal(preflight.sourceSha, SHA);
  }
});

test('reject lookalike repository on other Git hosts', async () => {
  const f = backend({ ...app(), git_repository: 'https://other.example/miloszspyrka-code/zar-i-szlif' });
  await assert.rejects(createCoolifyRelease(cfg(), f.fetcher).preflight(), /Wrong source repository/);
});

test('exact SHA is pinned and deploy request targets only Paperclip application', async () => {
  const f = backend();
  const release = createCoolifyRelease(cfg(), f.fetcher);
  assert.equal((await release.preflight()).priorConfiguredSha, 'b'.repeat(40));
  assert.deepEqual(await release.queue(), {deploymentUuid:'abcdef0123',sourceSha: SHA});
  assert.equal((await release.verifyDeployment('abcdef0123')).done, true);
  const patch = f.requests.filter(x => x.method === 'PATCH');
  const deploy = f.requests.filter(x => x.method === 'POST' && x.url.endsWith('/api/v1/deploy'));
  assert.equal(patch.length,1);
  assert.equal(deploy.length,1);
  assert.deepEqual(await release.verifyMcp(),
    {initialized:true,tools:1,oauthDiscovery:true,deniesUnauthenticated:true,
      releaseIdentity:{sourceSha:SHA,resourceUuid:UUID,containerName:'paperclip-mcp-container'}});
});

for (const [name, status, identity, expected] of [
  ['old route SHA', 200, {sourceSha:'b'.repeat(40),resourceUuid:UUID,containerName:'old-container'}, /different source SHA/],
  ['wrong Coolify application', 200, {sourceSha:SHA,resourceUuid:'other-app',containerName:'other-container'}, /different Coolify application/],
  ['missing runtime identity', 503, {}, /release identity unavailable/],
]) test('public route rejects ' + name, async () => {
  const f = backend(); const original = f.fetcher;
  f.fetcher = async (url, opts) => url.endsWith('/__release/identity')
    ? json(identity, status) : original(url, opts);
  await assert.rejects(createCoolifyRelease(cfg(), f.fetcher).verifyMcp(), expected);
});

test('wrong immutable deployment commit refuses success', async () => {
  const f = backend();const original = f.fetcher;
  f.fetcher = async (url,o) => url.includes('/deployments/abcdef0123')
    ? json({deployment_uuid:'abcdef0123',status:'finished',commit:'b'.repeat(40)}) : original(url,o);
  await assert.rejects(createCoolifyRelease(cfg(),f.fetcher).verifyDeployment('abcdef0123'), /commit/);
});

test('queued deployment is not represented as finished', async () => {
  const f = backend(); const orig = f.fetcher;
  f.fetcher = async (url,o) => url.includes('/deployments/abcdef0123')
    ? json({deployment_uuid:'abcdef0123',status:'queued',commit:SHA}) : orig(url,o);
  assert.deepEqual(await createCoolifyRelease(cfg(),f.fetcher).verifyDeployment('abcdef0123'),
    {done:false,status:'queued'});
});

test('OAuth negative 401 is mandatory and a 200 is rejected', async () => {
  const f = backend(); const orig = f.fetcher;
  f.fetcher = async (url,o) => url.endsWith('/mcp') && !o?.headers?.Authorization
    ? json({unauthenticated:true},200) : orig(url,o);
  await assert.rejects(createCoolifyRelease(cfg(),f.fetcher).verifyMcp(), /401/);
});



test('reject deployed registry that still exposes supervisor host tools', async () => {
  const f = backend(); const orig = f.fetcher;
  const replace = async (url,opts={}) => {
    if (url.endsWith('/mcp') && opts?.headers?.Authorization && JSON.parse(opts.body).method === 'tools/list') {
      const id = JSON.parse(opts.body).id;
      return json({ jsonrpc:'2.0',id,result:{tools:[{name:'paperclipGetServerInfo'},{name:'paperclipHostOperation'}]} });
    }
    return orig(url,opts);
  };
  await assert.rejects(createCoolifyRelease(cfg(),replace).verifyMcp(), /Legacy supervisor-backed/);
});

test('production CLI must never return a success exit status without immutable digest acceptance', () => {
  const code = readFileSync(new URL('./coolify-release.mjs', import.meta.url),'utf8');
  assert.match(code, /acceptedAsDone === false\) process\.exitCode = 2/);
});

