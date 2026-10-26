import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=new URL('.',import.meta.url).pathname;
const temp=mkdtempSync(join(tmpdir(),'gateway-release-'));
const py=join(root,'recreate-gateway-argv.py');
const sh=join(root,'deploy-gateway-vps.sh');
const old=join(temp,'old.json'),next=join(temp,'next.json');
const argv=join(temp,'args'),env=join(temp,'env');
function run(exe,args){return spawnSync(exe,args,{encoding:'utf8',timeout:10000});}
function check(run,code,needle){if(run.status!==code||!(run.stdout+run.stderr).includes(needle))throw Error(JSON.stringify({code:run.status,stdout:run.stdout,stderr:run.stderr}));}
const base={Name:'/paperclip-mcp-gateway',Id:'0123456789abcdef',State:{Running:true},
 Config:{Env:['PORT=3101','TEST_SECRET=not-printed'],Entrypoint:['/usr/local/bin/paperclip-mcp-entrypoint.sh'],
 Cmd:['node','/paperclip/mcp-gateway/gateway.mjs'],Labels:{'test':'value','org.opencontainers.image.revision':'old-sha'},
 User:'node',WorkingDir:'/app'},
 HostConfig:{NetworkMode:'paperclip-net',RestartPolicy:{Name:'unless-stopped'}},
 Mounts:[{Type:'volume',Name:'paperclip-home',Source:'/var/lib/docker/volumes/paperclip-home/_data',Destination:'/paperclip',RW:true}],
 NetworkSettings:{Networks:{'paperclip-net':{Aliases:['paperclip-mcp-gateway','gateway-alias']}}}};
test('bash syntax passes',()=>{check(run('bash',['-n',sh]),0,'');});
test('live config roundtrip with persistent mount, network alias and secret-safe env-file',()=>{
 writeFileSync(old,JSON.stringify([base]));
 check(run('python3',[py,'prepare',old,'paperclip-mcp-gateway','rollback',argv,env]),0,'SPEC_VERIFIED');
 const args=readFileSync(argv,'utf8').split('\0').filter(Boolean);
 for(const x of ['--volumes-from','rollback','--network-alias','gateway-alias','--entrypoint'])if(!args.includes(x))throw Error('missing '+x);
 if(args.includes('org.opencontainers.image.revision=old-sha'))throw Error('old release SHA overrides new image label');
 if((statSync(env).mode&0o777)!==0o600)throw Error('env file permissions not 0600');
 writeFileSync(next,JSON.stringify([base]));
 check(run('python3',[py,'verify',old,next,'_','_','_']),0,'CONFIG_MATCH');
});
test('drift in environment is refused after deploy',()=>{
 writeFileSync(old,JSON.stringify([base]));
 const changed=structuredClone(base);changed.Config.Env=['PORT=3100'];writeFileSync(next,JSON.stringify([changed]));
 check(run('python3',[py,'verify',old,next,'_','_','_']),1,'changed');
});
test('unreviewed exposed ports are refused before stopping old gateway',()=>{
 const changed=structuredClone(base);changed.HostConfig.PortBindings={'3101/tcp':[{HostPort:'3101'}]};
 writeFileSync(old,JSON.stringify([changed]));
 check(run('python3',[py,'prepare',old,'paperclip-mcp-gateway','rollback',argv,env]),1,'PortBindings');
});
test('missing persistent volume is refused before deploy',()=>{
 const changed=structuredClone(base);changed.Mounts=[];writeFileSync(old,JSON.stringify([changed]));
 check(run('python3',[py,'prepare',old,'paperclip-mcp-gateway','rollback',argv,env]),1,'paperclip-home');
});
test('non-full commit SHA is refused',()=>{check(run('bash',[sh,'deadbeef','sha256:e00d1ff3139d8671d38dc55e86855cbac577270577df82051b0cb206a777d104']),2,'REFUSED');});
test('unapproved artifact digest is refused before deploy',()=>{check(run('bash',[sh,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff']),2,'REFUSED');});
process.on('exit',()=>rmSync(temp,{recursive:true,force:true}));
