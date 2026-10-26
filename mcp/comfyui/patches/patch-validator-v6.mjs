#!/usr/bin/env node
// COMFY_PATCH_ENQUEUE_UI_V1: enqueueWorkflow must accept saved canvas exports
// (Web-UI nodes[]/links[] shape) exactly like create_workflow validate does.
// Without conversion, /prompt receives {"nodes": [...], "last_node_id": N,...}
// and ComfyUI's node_replace_manager crashes with 500
// ("argument of type 'int' is not iterable") instead of running anything.
// Reuses the validator's own convertUiToApi path, so validate == execution.
// Idempotent.
import { readFileSync, writeFileSync } from 'node:fs';

const TARGET = '/usr/local/lib/node_modules/comfyui-mcp/dist/services/workflow-executor.js';
let s = readFileSync(TARGET, 'utf8');
if (s.includes('COMFY_PATCH_ENQUEUE_UI_V1')) { console.log('enqueue-ui already patched'); process.exit(0); }

const a1 = 'import { convertApiToUi, isUiFormat } from "./workflow-converter.js";';
if (!s.includes(a1)) throw new Error('import anchor not found');
s = s.replace(a1, 'import { convertApiToUi, convertUiToApi, isUiFormat } from "./workflow-converter.js";');

const a2 = `export async function enqueueWorkflow(workflowJson, options) {
    const workflow = options?.disable_random_seed`;
if (!s.includes(a2)) throw new Error('enqueue anchor not found');
const block = `export async function enqueueWorkflow(workflowJson, options) {
    // COMFY_PATCH_ENQUEUE_UI_V1: convert saved-canvas shape to API shape first.
    let uiWorkflow = workflowJson;
    if (isUiFormat(workflowJson)) {
        try {
            const objectInfo = await clientGetObjectInfo();
            const converted = convertUiToApi(workflowJson, objectInfo);
            for (const w of converted.warnings ?? []) logger.warn("enqueue UI->API conversion", { warning: w });
            uiWorkflow = converted.workflow;
        } catch (err) {
            throw new Error(\`Cannot enqueue this Web-UI workflow: UI->API conversion failed (\${err instanceof Error ? err.message : err}). Submit API format ({"1": {"class_type": ..., "inputs": ...}}) instead.\`);
        }
    }
    const workflow = options?.disable_random_seed`;
s = s.replace(a2, block);
writeFileSync(TARGET, s);
console.log('patched workflow-executor.js with COMFY_PATCH_ENQUEUE_UI_V1');
