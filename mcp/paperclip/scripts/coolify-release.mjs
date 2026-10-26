import { pathToFileURL } from 'node:url';

const validSha = (s) => /^[0-9a-f]{40}$/.test(String(s || ''));
const cleanRepo = (s) => String(s || '').trim().replace(/^git@github\.com:/i, '').replace(/^https:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/$/, '').toLowerCase();
const terminalFailure = new Set(['failed', 'error', 'cancelled', 'canceled']);

export function createCoolifyRelease(config, fetcher = globalThis.fetch) {
  const { baseUrl, token, applicationUuid, sourceSha, publicMcpUrl, canaryToken } = config;
  if (!/^https:\/\/[^/]+\/?$/.test(baseUrl || '')) throw Error('COOLIFY_URL must be an HTTPS origin');
  if (!token || !applicationUuid) throw Error('COOLIFY_TOKEN and COOLIFY_APP_UUID are required');
  if (!validSha(sourceSha)) throw Error('SOURCE_SHA must be an immutable 40-digit commit SHA');
  if (!/^https:\/\/[^/]+\/?$/.test(publicMcpUrl || '')) throw Error('MCP_PUBLIC_URL must be an HTTPS origin');
  const api = async (method, path, body) => {
    const response = await fetcher(baseUrl.replace(/\/$/, '') + '/api/v1' + path, {
      method, headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw Error('Coolify ' + method + ' ' + path.split('?')[0] + ' HTTP ' + response.status);
    return response.json();
  };
  const appPath = '/applications/' + encodeURIComponent(applicationUuid);
  const readApp = () => api('GET', appPath);
  const assertApp = (app) => {
    if (app?.uuid !== applicationUuid) throw Error('Wrong Coolify application UUID');
    if (cleanRepo(app.git_repository || app.git_full_url) !== 'miloszspyrka-code/zar-i-szlif') throw Error('Wrong source repository');
    if (app.git_branch !== 'main') throw Error('Only approved main branch can be released');
    if (!['/mcp/paperclip', 'mcp/paperclip'].includes(app.base_directory)) throw Error('Wrong Coolify base directory');
    if (app.build_pack !== 'dockerfile') throw Error('Paperclip MCP requires Dockerfile build');
    if (!String(app.ports_exposes || '').split(',').map(s => s.trim()).includes('3101')) throw Error('Expected MCP port 3101');
  };
  async function preflight() {
    const app = await readApp();
    assertApp(app);
    return { applicationUuid, sourceSha, priorConfiguredSha: validSha(app.git_commit_sha) ? app.git_commit_sha : null,
      status: app.status, branch: app.git_branch, dockerfile: app.dockerfile_location || null };
  }
  async function queue() {
    await preflight();
    // Pin EXACT reviewed main SHA. The next readback detects ignored/unsupported pins.
    await api('PATCH', appPath, { git_commit_sha: sourceSha });
    const pinned = await readApp();
    assertApp(pinned);
    if (pinned.git_commit_sha !== sourceSha) throw Error('Coolify did not retain immutable source SHA');
    const response = await api('POST', '/deploy', { uuid: applicationUuid, force: false });
    const queued = response?.deployments?.find(x => x.resource_uuid === applicationUuid);
    if (!queued?.deployment_uuid) throw Error('Coolify did not return a deployment UUID for the target');
    return { deploymentUuid: queued.deployment_uuid, sourceSha };
  }
  async function verifyDeployment(deploymentUuid) {
    if (!/^[a-zA-Z0-9_-]{6,128}$/.test(deploymentUuid || '')) throw Error('Invalid deployment UUID');
    const record = await api('GET', '/deployments/' + encodeURIComponent(deploymentUuid));
    if (record?.deployment_uuid !== deploymentUuid) throw Error('Wrong deployment record');
    if (record?.commit !== sourceSha) throw Error('Deployed commit does not match exact source SHA');
    if (record?.status !== 'finished') {
      if (terminalFailure.has(record?.status)) throw Error('Deployment failed: ' + record.status);
      return { done: false, status: record?.status || 'unknown' };
    }
    const app = await readApp();
    assertApp(app);
    if (app.git_commit_sha !== sourceSha) throw Error('Post-deploy configured SHA differs');
    return { done: true, deploymentUuid, sourceSha, status: record.status,
      imageDigest: null, imageDigestVerified: false };
  }
  async function verifyMcp() {
    if (!canaryToken) throw Error('MCP_CANARY_TOKEN missing: authenticated MCP cannot be verified');
    const url = publicMcpUrl.replace(/\/$/, '');
    const health = await fetcher(url + '/health');
    if (health.status !== 200 || !(await health.json())?.ok) throw Error('Public MCP health failure');
    const identityResponse = await fetcher(url + '/__release/identity');
    if (identityResponse.status !== 200) throw Error('Public MCP release identity unavailable');
    const identity = await identityResponse.json();
    if (identity?.sourceSha !== sourceSha) throw Error('Public MCP route serves a different source SHA');
    if (identity?.resourceUuid !== applicationUuid) throw Error('Public MCP route serves a different Coolify application');
    if (typeof identity?.containerName !== 'string' || !identity.containerName) throw Error('Public MCP container identity missing');
    const oauth = await fetcher(url + '/.well-known/oauth-protected-resource/mcp');
    if (oauth.status !== 200) throw Error('OAuth discovery failure');
    const unauth = await fetcher(url + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 19, method: 'tools/list', params: {} }) });
    if (unauth.status !== 401) throw Error('Unauthenticated MCP call must return 401');
    const mcp = async (id, method, params) => {
      const response = await fetcher(url + '/mcp', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-06-18', 'Authorization': 'Bearer ' + canaryToken },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
      if (!response.ok) throw Error('Authenticated MCP ' + method + ' HTTP ' + response.status);
      const raw = await response.text();
      const lines = raw.startsWith('data:') || raw.includes('\ndata:')
        ? raw.split('\n').filter(x => x.startsWith('data:')).map(x => x.slice(5).trim()) : [raw];
      for (const line of lines) { try { const parsed = JSON.parse(line); if (parsed.id === id) {
        if (parsed.error) throw Error('MCP '+method+' failed: '+parsed.error.code);
        return parsed.result;
      } } catch (e) { if (e.message?.startsWith('MCP ')) throw e; } }
      throw Error('No matching MCP response for ' + method);
    };
    const init = await mcp(20, 'initialize', { protocolVersion: '2025-06-18',
      capabilities: {}, clientInfo: { name: 'coolify-release-smoke', version: '1' } });
    if (!init?.serverInfo?.name) throw Error('MCP initialize did not return serverInfo');
    const list = await mcp(21, 'tools/list', {});
    if (!Array.isArray(list?.tools) || !list.tools.some(t => t.name === 'paperclipGetServerInfo')) throw Error('MCP tool registry incomplete');
    if (list.tools.some(t => t.name.startsWith('paperclipHost') || t.name === 'paperclipExecuteDeliveryUnit')) throw Error('Legacy supervisor-backed MCP tools still exposed');
    return { initialized: true, tools: list.tools.length, oauthDiscovery: true, deniesUnauthenticated: true,
      releaseIdentity: identity };
  }
  return { preflight, queue, verifyDeployment, verifyMcp };
}

export async function main(env = process.env) {
  const mode = process.argv[2];
  if (!['preflight', 'deploy', 'verify', 'rollback'].includes(mode)) throw Error('Usage: coolify-release.mjs preflight|deploy|verify|rollback');
  const sourceSha = mode === 'rollback' ? env.ROLLBACK_SHA : env.SOURCE_SHA;
  const rel = createCoolifyRelease({ baseUrl: env.COOLIFY_URL, token: env.COOLIFY_TOKEN,
    applicationUuid: env.COOLIFY_APP_UUID, sourceSha,
    publicMcpUrl: env.MCP_PUBLIC_URL, canaryToken: env.MCP_CANARY_TOKEN });
  const before = await rel.preflight();
  if (mode === 'preflight') return { status: 'PREFLIGHT', ...before };
  let deploymentUuid = env.DEPLOYMENT_UUID;
  if (mode === 'deploy' || mode === 'rollback') deploymentUuid = (await rel.queue()).deploymentUuid;
  if (!deploymentUuid) throw Error('DEPLOYMENT_UUID is required for verify');
  for (let i = 0; i < 48; i++) {
    const dep = await rel.verifyDeployment(deploymentUuid);
    if (dep.done) {
      const mcp = await rel.verifyMcp();
      return { status: 'RUNTIME_VERIFIED_DIGEST_PENDING', ...dep, mcp,
        priorConfiguredSha: before.priorConfiguredSha,
        acceptedAsDone: false, reason: 'Immutable running image digest requires independent readback' };
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw Error('Coolify deployment did not reach finished before timeout');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(x => { console.log(JSON.stringify(x)); if (x.acceptedAsDone === false) process.exitCode = 2; }).catch(e => {
    console.error(JSON.stringify({ status: 'FAILED', error: e.message, acceptedAsDone: false }));
    process.exitCode = 1;
  });
}


