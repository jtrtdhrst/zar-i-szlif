#!/usr/bin/env node
/** Native SVG layout only; not the application export renderer. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
function paths(filename,prefix){
  const source=fs.readFileSync(path.join(here,filename),'utf8');
  if(/<image\b|<foreignObject\b|<script\b|\bon[a-z]+=|url\(/i.test(source))throw Error('RASTER_OR_ACTIVE_SVG_FORBIDDEN');
  const tags=[...source.matchAll(/<path\s+id="([^"]+)"\s+fill="(#[0-9a-fA-F]{6})"\s+d="([^"]+)"[^>]*\/>/g)];
  if((prefix==='ground' ? tags.length!==1 : (tags.length<15||tags.length>22)))throw Error('INVALID_SHAPE_BUDGET: '+filename);
  if(new Set(tags.map(x=>x[2].toLowerCase())).size>5)throw Error('INVALID_PALETTE_BUDGET: '+filename);
  if(new Set(tags.map(x=>x[1])).size!==tags.length)throw Error('DUPLICATE_MASTER_SHAPE_ID');
  return tags.map(x=>x[0].replace(' id="',' id="'+prefix+'-')).join('\n');
}
const raven=paths('masters/szlif-master.svg','szlif');
const fox=paths('masters/iskra-master.svg','iskra');
const ground=paths('props/ground.svg','ground').replace('ground-ground-shadow','ground-shadow');
const scene=`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" aria-label="Iskra and Szlif V7 pair">
<title>Iskra and Szlif — V7 exploratory pair, editable vectors</title>
${ground}
<g id="szlif" transform="translate(2 150) scale(.62)">${raven}</g>
<g id="iskra" transform="translate(197 148) scale(.63)">${fox}</g>
</svg>`;
const output=path.join(here,'scenes/iskra-szlif-vignette.svg');
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,scene,'utf8');
console.log('EDITABLE_NATIVE_PAIR',output,'paths',1+21+21);
