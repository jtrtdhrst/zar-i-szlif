#!/usr/bin/env node
// COMFY_PATCH_SWITCH_V4: ComfySwitchNode (hard If/Else, core) with an unwired
// on_true/on_false branch whose output is consumed downstream ALWAYS crashes
// on that path: execute() passes None through and the consumer dies with
// TypeError: 'NoneType' object is not subscriptable (observed 2026-10-26 on a
// REJECT path: StringCompare -> ComfySwitchNode[on_false unwired] -> SaveImage).
// Soft switches are EXCLUDED: SoftSwitchNode.execute falls back to the wired
// branch and validate_inputs already guards both-missing.
// Idempotent: skips if already applied.
import { readFileSync, writeFileSync } from 'node:fs';

const TARGET = '/usr/local/lib/node_modules/comfyui-mcp/dist/services/workflow-validator.js';
let s = readFileSync(TARGET, 'utf8');
if (s.includes('COMFY_PATCH_SWITCH_V4')) { console.log('switch rule already present'); process.exit(0); }

const anchor = '        // 2c. Check connections point to existing nodes';
if (!s.includes(anchor)) throw new Error('anchor 2c not found');

const block = `        // 2b3. COMFY_PATCH_SWITCH_V4: hard-switch unwired branch with a
        // consumed output is a guaranteed NoneType crash on that path.
        if (classType === "ComfySwitchNode") {
            const consumed = Object.entries(graph).some(([otherId, otherNode]) => otherId !== nodeId &&
                Object.values(otherNode.inputs || {}).some((v) => Array.isArray(v) && v.length === 2 && v[0] === nodeId));
            if (consumed) {
                for (const branch of ["on_true", "on_false"]) {
                    if (!(branch in node.inputs)) {
                        issues.push({
                            severity: "error",
                            node_id: nodeId,
                            node_type: classType,
                            message: \`Unwired switch branch "\${branch}" with a consumed output: on that path the switch emits None and the downstream node crashes (TypeError: 'NoneType' object is not subscriptable). Wire "\${branch}" (e.g. to the candidate image for a controlled reject) or handle the case upstream.\`,
                        });
                    }
                }
            }
        }
`;
s = s.replace(anchor, block + anchor);
writeFileSync(TARGET, s);
console.log('patched workflow-validator.js with COMFY_PATCH_SWITCH_V4');
