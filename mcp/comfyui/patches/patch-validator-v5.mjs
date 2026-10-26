#!/usr/bin/env node
// COMFY_PATCH_CYCLE_V1 (fixed): MCP validate must reject multi-node dependency
// cycles exactly like ComfyUI at execution ("dependency_cycle detected"). The
// validator only caught self-references; A->B->A passed validation and died at
// execution. In-graph retry-until-PASS loops are therefore impossible by
// construction — retries are orchestrated by re-enqueueing (documented).
// Idempotent: skips when the fixed block is already present; upgrades a
// pristine file. (Revision: closes the bare block that v1 of this patch left
// open, which broke module parsing.)
import { readFileSync, writeFileSync } from 'node:fs';

const TARGET = '/usr/local/lib/node_modules/comfyui-mcp/dist/services/workflow-validator.js';
let s = readFileSync(TARGET, 'utf8');
if (s.includes('orchestrate retries by re-enqueueing (cap attempts).')) { console.log('cycle rule already present (fixed revision)'); process.exit(0); }
if (s.includes('COMFY_PATCH_CYCLE_V1')) throw new Error('unfixed v1 block present - remove it first (see runbook)');

const anchor = '    // 3. Check for cycles (basic: no self-references)';
if (!s.includes(anchor)) throw new Error('anchor 3 not found');

const block = `    // 3. Check for cycles. COMFY_PATCH_CYCLE_V1: multi-node cycles (A->B->A)
    // are rejected by ComfyUI at execution ("dependency_cycle detected"), so an
    // in-graph retry-until-PASS loop cannot exist — retries are orchestrated by
    // re-enqueueing. Detect real cycles here via DFS; self-references (below)
    // stay reported as before.
    {
        const deps = {};
        for (const nodeId of nodeIds) {
            const node = graph[nodeId];
            deps[nodeId] = [];
            for (const value of Object.values(node.inputs || {})) {
                if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && value[0] !== nodeId && nodeIds.includes(value[0])) {
                    deps[nodeId].push(value[0]);
                }
            }
        }
        const visitState = {};
        const stack = [];
        let cycleFound = null;
        const visit = (id) => {
            if (cycleFound) return;
            visitState[id] = 1;
            stack.push(id);
            for (const dep of deps[id] || []) {
                if (visitState[dep] === 1) {
                    cycleFound = stack.slice(stack.indexOf(dep)).concat(dep);
                    return;
                }
                if (!visitState[dep]) visit(dep);
                if (cycleFound) return;
            }
            stack.pop();
            visitState[id] = 2;
        };
        for (const nodeId of nodeIds) if (!visitState[nodeId]) visit(nodeId);
        if (cycleFound) {
            issues.push({
                severity: "error",
                node_id: cycleFound[0],
                node_type: graph[cycleFound[0]]?.class_type ?? "",
                message: \`Dependency cycle detected: \${cycleFound.join(" -> ")}. ComfyUI rejects cyclic graphs at execution; an in-graph retry loop is impossible — orchestrate retries by re-enqueueing (cap attempts).\`,
            });
        }
    }
`;
s = s.replace(anchor, block + anchor);
writeFileSync(TARGET, s);
console.log('patched workflow-validator.js with COMFY_PATCH_CYCLE_V1 (fixed)');
