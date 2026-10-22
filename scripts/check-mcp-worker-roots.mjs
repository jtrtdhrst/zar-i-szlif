import fs from 'node:fs';
import path from 'node:path';

const services = ["mantic","qdrant","supabase","ubuntu","penpot","plasmic","paperclip","emailens","langfuse"];
const root = process.cwd();
let failed = false;
for (const service of services) {
  const dir = path.join(root, 'mcp', service, 'worker');
  const required = ['package.json', 'package-lock.json', 'tsconfig.json', 'wrangler.jsonc', 'src/index.ts'];
  const missing = required.filter((p) => !fs.existsSync(path.join(dir, p)));
  if (missing.length) { console.error(service + ': missing ' + missing.join(', ')); failed = true; continue; }
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const worker = JSON.parse(fs.readFileSync(path.join(dir, 'wrangler.jsonc'), 'utf8'));
  const expectedName = service + '-mcp';
  if (!pkg.scripts?.build || !pkg.scripts?.deploy || worker.name !== expectedName || worker.main !== 'src/index.ts') {
    console.error(service + ': invalid package scripts or Worker target: ' + JSON.stringify({worker:worker.name,main:worker.main}));
    failed = true;
  } else console.log('OK ' + service + ': ' + path.relative(root, dir));
}
process.exitCode = failed ? 1 : 0;
