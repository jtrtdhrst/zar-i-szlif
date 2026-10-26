import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { once } from 'node:events';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'deploy-gateway-vps.sh');
const SHA = 'b'.repeat(40);
const ID = 'sha256:' + 'a'.repeat(64);
const OLD_ID = 'sha256:' + 'c'.repeat(64);

async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-release-regression-'));
  const bin = join(dir, 'bin');
  const repo = join(dir, 'repo');
  const source = join(dir, 'source');
  const socket = join(dir, 'docker.sock');
  const log = join(dir, 'docker.log');
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(repo, '.git'), { recursive: true });
  mkdirSync(join(source, 'mcp/paperclip'), { recursive: true });
  writeFileSync(join(source, 'mcp/paperclip/Dockerfile'), 'FROM scratch\n');
  writeFileSync(log, '');
  const git = [
    '#!/bin/sh',
    'if [ "$1" = "-C" ]; then shift 2; fi',
    'case "$1" in',
    '  archive) exec tar -C "$MOCK_SOURCE" -cf - mcp/paperclip ;;',
    '  status) exit 0 ;;',
    '  *) exit 0 ;;',
    'esac',
  ].join('\n') + '\n';
  const docker = [
    '#!/bin/sh',
    'if [ "$1" = "-H" ]; then shift 2; fi',
    'printf "%s\\n" "$*" >> "$MOCK_LOG"',
    'if [ "$1" = "container" ] && [ "$2" = "inspect" ]; then',
    '  case "$3" in *-rollback-*) exit 1;; esac',
    '  echo "{}"; exit 0',
    'fi',
    'if [ "$1" = "image" ] && [ "$2" = "inspect" ]; then',
    '  case "$*" in',
    '    *"org.opencontainers.image.revision"*) echo "$MOCK_SOURCE_SHA" ;;',
    '    *) echo "$MOCK_IMAGE_ID" ;;',
    '  esac',
    '  exit 0',
    'fi',
    'if [ "$1" = "run" ] && [ "$2" = "-d" ]; then touch "$MOCK_MARKER"; exit 0; fi',
    'if [ "$1" = "inspect" ]; then',
    '  case "$*" in',
    '    *".Config.Image"*) echo "local/gateway-base:old" ;;',
    '    *".State.Status"*) echo "running|healthy" ;;',
    '    *"org.opencontainers.image.revision"*) echo "$MOCK_SOURCE_SHA" ;;',
    '    *) if [ -e "$MOCK_MARKER" ]; then echo "$MOCK_IMAGE_ID"; else echo "$MOCK_OLD_ID"; fi ;;',
    '  esac',
    '  exit 0',
    'fi',
    'if [ "$1" = "exec" ] && [ "$2" = "paperclip" ] && [ "$3" = "df" ]; then',
    '  echo "Filesystem 1024-blocks Used Available Capacity Mounted"',
    '  echo "/dev/fake 100000000 1000 50000000 10% /paperclip"',
    '  exit 0',
    'fi',
    'exit 0',
  ].join('\n') + '\n';
  const python = [
    '#!/bin/sh',
    'case "$1" in',
    '  */recreate-gateway-argv.py)',
    '    if [ "$2" = "prepare" ]; then : > "$6"; : > "$7"; fi',
    '    exit 0 ;;',
    'esac',
    'exec /usr/bin/python3 "$@"',
  ].join('\n') + '\n';
  for (const [name, body] of [['git', git], ['docker', docker], ['python3', python]]) {
    writeFileSync(join(bin, name), body, { mode: 0o755 });
  }
  const server = createServer();
  server.listen(socket);
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((done) => server.close(done));
    rmSync(dir, { recursive: true, force: true });
  });
  const env = {
    ...process.env,
    PATH: bin + ':' + process.env.PATH,
    PAPERCLIP_DOCKER_SOCKET: socket,
    PAPERCLIP_RELEASE_REPO: repo,
    MOCK_LOG: log,
    MOCK_MARKER: join(dir, 'switched'),
    MOCK_SOURCE: source,
    MOCK_SOURCE_SHA: SHA,
    MOCK_IMAGE_ID: ID,
    MOCK_OLD_ID: OLD_ID,
  };
  return { env, log };
}

test('prepare produces an immutable candidate ID without stopping the running gateway', async (t) => {
  const x = await setup(t);
  const r = spawnSync('bash', [SCRIPT, 'prepare', SHA], { env: x.env, encoding: 'utf8', timeout: 10000 });
  if (r.status !== 0) throw Error('prepare failed: ' + r.stderr + r.stdout);
  if (!r.stdout.includes('CANDIDATE_PREPARED') || !r.stdout.includes(ID)) throw Error('missing approved-ID handoff');
  const log = readFileSync(x.log, 'utf8');
  if (!log.includes('build ') || log.includes('stop ') || log.includes('rename ')) throw Error('prepare mutated running service');
});

test('mismatched approved Docker image ID fails before any stop or rename', async (t) => {
  const x = await setup(t);
  const wrong = 'sha256:' + 'd'.repeat(64);
  const r = spawnSync('bash', [SCRIPT, SHA, wrong], { env: x.env, encoding: 'utf8', timeout: 10000 });
  if (r.status === 0 || !r.stderr.includes('before stop')) throw Error('mismatch was not rejected: ' + r.stderr + r.stdout);
  const log = readFileSync(x.log, 'utf8');
  if (log.includes('stop ') || log.includes('rename ') || log.includes('build ')) throw Error('mismatch mutated service or rebuilt image');
});

test('approved ID from prepare is accepted without rebuilding, then health and live SHA are checked', async (t) => {
  const x = await setup(t);
  const r = spawnSync('bash', [SCRIPT, SHA, ID], { env: x.env, encoding: 'utf8', timeout: 10000 });
  if (r.status !== 0 || !r.stdout.includes('DEPLOY_VERIFIED')) throw Error('approved release failed: ' + r.stderr + r.stdout);
  const log = readFileSync(x.log, 'utf8');
  if (!log.includes('stop ') || !log.includes('rename ') || !log.includes('run -d ')) throw Error('expected rollout not performed');
  if (log.includes('build ')) throw Error('apply rebuilt the independently approved image');
});

test('prepared image with wrong source SHA is rejected before service mutation', async (t) => {
  const x = await setup(t);
  x.env.MOCK_SOURCE_SHA = 'f'.repeat(40);
  const r = spawnSync('bash', [SCRIPT, SHA, ID], { env: x.env, encoding: 'utf8', timeout: 10000 });
  if (r.status === 0 || !r.stderr.includes('source revision mismatch')) throw Error('revision mismatch was not rejected');
  const log = readFileSync(x.log, 'utf8');
  if (log.includes('stop ') || log.includes('rename ')) throw Error('revision mismatch modified service');
});

test('script remains syntactically valid Bash', () => {
  const r = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  if (r.status !== 0) throw Error(r.stderr);
});
