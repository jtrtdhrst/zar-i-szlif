#!/usr/bin/env node
/** Recompose editable V7 interaction scene from immutable native SVG masters.
 * Design-time only: NOT a shipping renderer or a replacement for scripts/mascots/export.mjs.
 * Run: node assets/mascots/concepts/v7-art-experiment/compose-v7.mjs
 */
import {compose} from '../minimal-flat-v5/compose.mjs';
import {fileURLToPath} from 'node:url';
import {writeFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';

const here=path.dirname(fileURLToPath(import.meta.url));
const before=process.cwd();
try {
  process.chdir(here);
  const document=compose([
    'props/ground.svg:0,0,1',
    'masters/szlif-master.svg:2,150,0.62',
    'masters/iskra-master.svg:197,148,0.63'
  ],{
    viewBox:'0 0 512 512',
    title:'Iskra and Szlif — V7 editable pair',
    desc:'A native vector interaction scene derived from two five-colour mascot masters.'
  });
  mkdirSync(path.join(here,'scenes'),{recursive:true});
  const filepath=path.join(here,'scenes/iskra-szlif-vignette.svg');
  writeFileSync(filepath,document);
  console.log('V7_PAIR_WRITTEN '+filepath);
} finally {process.chdir(before)}
