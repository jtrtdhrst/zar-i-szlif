#!/usr/bin/env node
// COMFY_PATCH_DYNAMIC_V1 (v2): MCP validate must match ComfyUI /prompt validation
// for dynamic-combo (COMFY_DYNAMICCOMBO_V3) inputs — verified live 2026-10-26:
//
// TRUE server shape is FLAT: `"model": "<option-key>"` plus `"model.<sub>"` keys.
// A nested dict object `{"model": {...}}` PASSES server validation but crashes at
// execution (`execute() missing 'model'`) — silent poison. A flat shape missing a
// scalar sub-input fails server validation 400 pre-execution (free, no cost).
// This patch enforces both, mirroring framework finalization
// (_expand_schema_for_dynamic + build_nested_inputs). COMFY_AUTOGROW_V3 subs
// (e.g. `images`) default to empty server-side and are exempt — same exemption
// the validator already applies to top-level autogrow inputs.
import { readFileSync, writeFileSync } from 'node:fs';

const TARGET = '/usr/local/lib/node_modules/comfyui-mcp/dist/services/workflow-validator.js';
let s = readFileSync(TARGET, 'utf8');
if (s.includes('COMFY_PATCH_DYNAMIC_V1 (v2)')) { console.log('validator already at v2 - nothing to do'); process.exit(0); }
if (!s.includes('COMFY_PATCH_DYNAMIC_V1')) throw new Error('v1 block not found - run patch-v2 first');

const startMarker = '        // 2b2. COMFY_PATCH_DYNAMIC_V1';
const endMarker = '        // 2c. Check connections point to existing nodes';
const si = s.indexOf(startMarker);
const ei = s.indexOf(endMarker);
if (si === -1 || ei === -1 || ei < si) throw new Error('block boundaries not found');

const block = `        // 2b2. COMFY_PATCH_DYNAMIC_V1 (v2): dynamic-combo parity with the server.
        // Submittable shape is flat ("model": "<key>", "model.<sub>": ...). A nested
        // dict validates but cannot execute; missing scalar subs fail server-side 400.
        // COMFY_AUTOGROW_V3 subs (e.g. images) default to empty server-side: exempt.
        for (const [inputName, inputSpec] of Object.entries(requiredInputs)) {
            const inputType = Array.isArray(inputSpec) ? inputSpec[0] : undefined;
            const spec = Array.isArray(inputSpec) ? inputSpec[1] : undefined;
            if (inputType !== "COMFY_DYNAMICCOMBO_V3" || !spec || !Array.isArray(spec.options))
                continue;
            const value = node.inputs[inputName];
            if (value !== undefined && typeof value === "object" && value !== null && !Array.isArray(value)) {
                issues.push({
                    severity: "error",
                    node_id: nodeId,
                    node_type: classType,
                    message: \`Dynamic input "\${inputName}" must use flat keys ("\${inputName}": "<option-key>", "\${inputName}.<setting>"...), not a nested object — the server accepts the object at validation but fails at execution\`,
                });
                continue;
            }
            if (typeof value !== "string")
                continue;
            const selected = spec.options.find((o) => o && o.key === value);
            if (!selected || !selected.inputs || typeof selected.inputs.required !== "object")
                continue;
            for (const [subKey, subSpec] of Object.entries(selected.inputs.required)) {
                const subType = Array.isArray(subSpec) ? subSpec[0] : undefined;
                if (subType === "COMFY_AUTOGROW_V3")
                    continue;
                if (!(\`\${inputName}.\${subKey}\` in node.inputs)) {
                    issues.push({
                        severity: "error",
                        node_id: nodeId,
                        node_type: classType,
                        message: \`Missing required input "\${inputName}.\${subKey}" for \${JSON.stringify(value)} (dynamic option of "\${inputName}")\`,
                    });
                }
            }
        }
`;
s = s.slice(0, si) + block + s.slice(ei);
writeFileSync(TARGET, s);
console.log('validator patch upgraded to v2 (flat-shape parity)');
