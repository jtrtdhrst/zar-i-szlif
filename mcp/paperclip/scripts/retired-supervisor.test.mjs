import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/tools.ts', import.meta.url), 'utf8');
test('retire supervisor tool registration without retiring workspace and OAuth tools', () => {
  assert.doesNotMatch(source, /createHostTools\(client\)/);
  assert.doesNotMatch(source, /createHostQueryTools\(\)/);
  assert.doesNotMatch(source, /paperclipHost/);
  assert.doesNotMatch(source, /paperclipExecuteDeliveryUnit/);
  assert.match(source, /createWorkspaceNativeTools\(client\)/);
  assert.match(source, /createP1PlatformTools\(client\)/);
});


test('no retired host-module imports in active runtime',()=>{
for(const n of ['p1-platform.ts','effective-access.ts','execution-broker.ts','live-verify.ts','tools.ts']){
const t=readFileSync(new URL('../src/'+n,import.meta.url),'utf8');
assert.ok(!t.includes("from \"./host-ops.js\"") && !t.includes("from \"./host-query.js\"") && !t.includes("from \"./host-plan-ops.js\"") && !t.includes("from \"./host-run-context.js\""));
}
});


