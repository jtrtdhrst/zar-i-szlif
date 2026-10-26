import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/tools.ts', import.meta.url), 'utf8');
test('retire supervisor tool registration without retiring workspace and OAuth tools', () => {
  assert.doesNotMatch(source, /createHostTools\(client\)/);
  assert.doesNotMatch(source, /createHostQueryTools\(\)/);
  assert.match(source, /!t\.name\.startsWith\("paperclipHost"\)/);
  assert.match(source, /t\.name !== "paperclipExecuteDeliveryUnit"/);
  assert.match(source, /createWorkspaceNativeTools\(client\)/);
  assert.match(source, /createP1PlatformTools\(client\)/);
});

