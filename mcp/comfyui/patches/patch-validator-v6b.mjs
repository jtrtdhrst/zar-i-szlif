#!/usr/bin/env node
// COMFY_PATCH_ENQUEUE_UI_V1b: use the converted graph. The v1 revision converted
// UI->API into `uiWorkflow` but the two continuation lines still referenced the
// original `workflowJson`, discarding the conversion (server 500 persisted).
// Idempotent.
import { readFileSync, writeFileSync } from 'node:fs';

const TARGET = '/usr/local/lib/node_modules/comfyui-mcp/dist/services/workflow-executor.js';
let s = readFileSync(TARGET, 'utf8');
if (s.includes('randomizeSeeds(uiWorkflow')) { console.log('enqueue-ui already fixed (v1b)'); process.exit(0); }
if (!s.includes('COMFY_PATCH_ENQUEUE_UI_V1')) throw new Error('v1 block not found - apply patch-v6 first');

const a1 = '        ? workflowJson\n        : await randomizeSeeds(workflowJson, new Set(options?.preserve_seed_inputs ?? []));';
if (!s.includes(a1)) throw new Error('continuation anchor not found');
s = s.replace(a1, '        ? uiWorkflow\n        : await randomizeSeeds(uiWorkflow, new Set(options?.preserve_seed_inputs ?? []));');
writeFileSync(TARGET, s);
console.log('patched enqueue continuation to use converted graph');
