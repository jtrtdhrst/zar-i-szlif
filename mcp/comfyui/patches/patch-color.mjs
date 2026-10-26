#!/usr/bin/env node
// COMFY_PATCH_COLOR_V1: uniform fills are not "washed out".
import { readFileSync, writeFileSync } from 'node:fs';
const F='/usr/local/lib/node_modules/comfyui-mcp/dist/services/color-analysis.js';
let s=readFileSync(F,'utf8');
if (s.includes('COMFY_PATCH_COLOR_V1')) { console.log('color already patched'); process.exit(0); }
const a='    const lowContrast = lumaStd < TH.lowContrast;';
if (!s.includes(a)) throw new Error('anchor1 missing');
s=s.replace(a,'    // COMFY_PATCH_COLOR_V1: uniform fills (std 0) are deliberate flat design, not washed out.\n    const uniformFill = lumaStd === 0;\n    const lowContrast = lumaStd < TH.lowContrast;');
const b='    const washedOut = lowContrast && (liftedBlacks || lowSaturation || dimHighlights);';
if (!s.includes(b)) throw new Error('anchor2 missing');
s=s.replace(b,'    const washedOut = !uniformFill && lowContrast && (liftedBlacks || lowSaturation || dimHighlights);');
const c='    const verdict = washedOut';
if (!s.includes(c)) throw new Error('anchor3 missing');
s=s.replace(c,'    const verdict = uniformFill\n        ? `FLAT — uniform fill (std 0), not washed out`\n        : washedOut');
writeFileSync(F,s);
console.log('patched color-analysis.js');
