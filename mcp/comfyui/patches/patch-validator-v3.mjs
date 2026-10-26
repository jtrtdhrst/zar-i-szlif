#!/usr/bin/env node
// COMFY_PATCH_COMBO_SUBFOLDER_V1: LoadImage-style combos list only top-level
// input files, but ComfyUI EXECUTES subfolder references ("brand/x.png") fine
// (verified live: brand_probe_00001_.png). Flagging them as errors contradicts
// the server, so media-looking slash paths become warnings: the file may still
// be absent (server then rejects pre-execution, free), but a present file must
// not red-flag validation. Idempotent.
import { readFileSync, writeFileSync } from 'node:fs';

const TARGET = '/usr/local/lib/node_modules/comfyui-mcp/dist/services/workflow-validator.js';
let s = readFileSync(TARGET, 'utf8');
if (s.includes('COMFY_PATCH_COMBO_SUBFOLDER_V1')) { console.log('combo-subfolder already patched'); process.exit(0); }

const anchor = `        const isModel = /\\.(safetensors|gguf|ckpt|pt|pth|bin|sft)$/i.test(value);`;
if (!s.includes(anchor)) throw new Error('combo anchor not found');

const block = `        // COMFY_PATCH_COMBO_SUBFOLDER_V1: subfolder media refs ("brand/x.png")
        // execute fine on the server although the loader combo omits them.
        const looksLikeMedia = /\\/[^/]+\\.(png|jpg|jpeg|webp|bmp|gif|tiff|tif|avif|mp4|mov|webm|avi|mkv|m4v|wav|mp3|flac|ogg|m4a|aac)$/i.test(value);
        if (looksLikeMedia) {
            issues.push({
                severity: "warning",
                node_id: nodeId,
                node_type: classType,
                kind: "subfolder_reference",
                input: inputName,
                value,
                message: \`"\${inputName}" = "\${value}" is not in the loader combo (top-level files only), but the server resolves subfolder paths at execution. If the file is absent there, the server rejects pre-execution at no cost.\`,
            });
            continue;
        }
`;
s = s.replace(anchor, block + anchor);
writeFileSync(TARGET, s);
console.log('patched checkComboValues with subfolder rule');
