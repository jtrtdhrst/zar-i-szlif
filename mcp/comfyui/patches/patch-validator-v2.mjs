#!/usr/bin/env node
// COMFY_PATCH_DYNAMIC_V1: MCP validate must match ComfyUI /prompt validation for
// dynamic-combo (COMFY_DYNAMICCOMBO_V3) inputs.
//
// A node like OpenAIGPTImageNodeV2 takes ONE dict input `model`, but ComfyUI
// validates the SELECTED option's required sub-inputs (size, quality,
// background, custom_*) at execution time. The validator only checked the
// top-level `model` key, so it greened graphs the server rejects with 400
// (observed 2026-10-26: "missing background/quality/size/custom_*").
// This adds exactly that descent: for a dict-valued dynamic-combo input, every
// required sub-key of the selected option must be present in the dict or linked
// as `inputName.subKey`. No other behaviour changes; unknown shapes are skipped
// (never false-positive).
import { readFileSync, writeFileSync } from 'node:fs';

const F = '/usr/local/lib/node_modules/comfyui-mcp/dist/services/workflow-validator.js';
let s = readFileSync(F, 'utf8');
if (s.includes('COMFY_PATCH_DYNAMIC_V1')) { console.log('validator already patched'); process.exit(0); }

const anchor = `        // 2c. Check connections point to existing nodes`;
if (!s.includes(anchor)) throw new Error('anchor 2c not found');

const block = `        // 2b2. COMFY_PATCH_DYNAMIC_V1: descend into dynamic-combo dicts (see header).
        for (const [inputName, inputSpec] of Object.entries(requiredInputs)) {
            const inputType = Array.isArray(inputSpec) ? inputSpec[0] : undefined;
            const spec = Array.isArray(inputSpec) ? inputSpec[1] : undefined;
            if (inputType !== "COMFY_DYNAMICCOMBO_V3" || !spec || !Array.isArray(spec.options))
                continue;
            const value = node.inputs[inputName];
            if (!value || typeof value !== "object" || Array.isArray(value))
                continue;
            const selected = spec.options.find((o) => o && o.key === value.model);
            if (!selected || !selected.inputs || typeof selected.inputs.required !== "object")
                continue;
            for (const subKey of Object.keys(selected.inputs.required)) {
                if (!(subKey in value) && !(\`\${inputName}.\${subKey}\` in node.inputs)) {
                    issues.push({
                        severity: "error",
                        node_id: nodeId,
                        node_type: classType,
                        message: \`Missing required input "\${inputName}.\${subKey}" for \${JSON.stringify(value.model)} (dynamic option of "\${inputName}")\`,
                    });
                }
            }
        }
`;

s = s.replace(anchor, block + anchor);
writeFileSync(F, s);
console.log('patched workflow-validator.js with COMFY_PATCH_DYNAMIC_V1');
