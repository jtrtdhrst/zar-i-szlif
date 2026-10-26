import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,copyFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root='/paperclip/vps-ops/policy';
const script='mcp/paperclip/vps-ops-supervisor/apply-gateway-release.py';
const dir=mkdtempSync(join(tmpdir(),'supervisor-gateway-'));
const run=(cmd,args,env)=>spawnSync(cmd,args,{encoding:'utf8',timeout:30000,env:{...process.env,...env}});
test('hash pin baseline and apply narrowed gateway release policy',()=>{
  copyFileSync(join(root,'watcher.sh'),join(dir,'watcher.sh'));
  copyFileSync(join(root,'POLICY.md'),join(dir,'POLICY.md'));
  const r=run('python3',[script],{SUP_PATCH_ROOT:dir});
  if(r.status!==0)throw Error(r.stderr+r.stdout);
  const s=readFileSync(join(dir,'watcher.sh'),'utf8');
  for(const x of ["mcp.gateway.prepare)","mcp.gateway.prepare|mcp.gateway.release)",'LIVE_RUN_MUT_OPS="host.file.patch mcp.gateway.prepare mcp.gateway.release"',
    'mcp.gateway.release) target="recreate-paperclip-mcp-gateway"',
    'gateway release target not allowlisted','deploy-gateway-vps.sh',
    'max_seconds=830','timeout --signal=TERM','artifactDigest','sourceSha'])if(!s.includes(x))throw Error('missing '+x);
  if(!s.includes('RECREATE_TARGETS="${RECREATE_TARGETS:-}"'))throw Error('generic recreate gate changed');
  const c=run('bash',['-n',join(dir,'watcher.sh')]);if(c.status!==0)throw Error(c.stderr);
  const matrix=run('bash',['mcp/paperclip/vps-ops-supervisor/test/gateway-release-matrix.test.sh',join(dir,'watcher.sh'),'mcp/paperclip/vps-ops-supervisor/test/auth-matrix.test.sh']);
  if(matrix.status!==0)throw Error(matrix.stdout+matrix.stderr);
  console.log(matrix.stdout.trim());
  console.log(r.stdout.trim());
});
test('different watcher baseline must fail closed',()=>{
  const r=run('python3',[script],{SUP_PATCH_ROOT:dir});
  if(r.status===0||!r.stderr.includes('REFUSED'))throw Error('hash guard failed');
});
test('supervisor release EXIT trap captures local temp before build returns',()=>{
  const source=readFileSync('mcp/paperclip/vps-ops-supervisor/deploy-gateway-supervisor.sh','utf8');
  const trapLine=source.split('\n').find((line)=>line.trim().startsWith('trap ')&&line.includes('rm -rf'));
  if(!trapLine)throw Error('cleanup trap missing from deploy script');
  const probe=mkdtempSync(join(tmpdir(),'supervisor-trap-'));
  try{
    const shell=['set -euo pipefail','build() {','local temp="$1"',trapLine,'}','build "$1"'].join('\n');
    const result=run('bash',['-c',shell,'bash',probe]);
    if(result.status!==0)throw Error('EXIT cleanup failed: '+result.stderr);
    if(existsSync(probe))throw Error('EXIT cleanup left a staging directory');
  }finally{
    rmSync(probe,{recursive:true,force:true});
  }
});
process.on('exit',()=>rmSync(dir,{recursive:true,force:true}));
