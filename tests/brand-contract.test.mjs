import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const legacy = /Kompas Zbiórek|Kompasu Zbiórek/u;

test('publiczny kontrakt nazwy jest zatwierdzony', () => {
  const brand = read('branding/BRAND.md');
  assert.match(brand, /Żar i Szlif/u);
  assert.match(brand, /logo|logotyp/u);
  assert.match(read('README.md'), /^# Żar i Szlif/mu);
  assert.match(read('AGENTS.md'), /Publiczna nazwa aplikacji: \*\*Żar i Szlif\*\*/u);
});

test('HTML title, header i teksty panelu nie wracają do starej nazwy', () => {
  const build = read('app/web/scripts/build-static.mjs');
  const header = read('registry/kompas/components/brand-header.js');
  const app = read('app/web/src/static-app-v2.js');
  assert.match(build, /<title>Żar i Szlif<\/title>/u);
  assert.match(header, /brand-name">Żar i Szlif<\/span>/u);
  assert.doesNotMatch(build, legacy);
  assert.doesNotMatch(header, legacy);
  assert.doesNotMatch(app, legacy);
});

test('domeny, endpointy i techniczne identyfikatory pozostają niezmienione', () => {
  const app = read('app/web/src/static-app-v2.js');
  assert.match(app, /https:\/\/panel\.kompaszbiorek\.pl/u);
  assert.match(app, /kompas-zbiorek-draft-v1/u);
  assert.match(read('README.md'), /miloszspyrka-code\/kompas-zbiorek/u);
});
