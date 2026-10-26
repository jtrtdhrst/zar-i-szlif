#!/usr/bin/env node
// Durable patch for comfyui-mcp 0.52.206: upload_image data_base64 support + train_doctor ready flag.
// Idempotent: safe to run multiple times (checks markers).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const IMG_TOOL = '/usr/local/lib/node_modules/comfyui-mcp/dist/tools/image-management.js';
const TRAIN_TOOL = '/usr/local/lib/node_modules/comfyui-mcp/dist/tools/train.js';

function patchImageTool() {
  let s = readFileSync(IMG_TOOL, 'utf8');
  if (s.includes('COMFY_PATCH_DATA_BASE64_V1')) { console.log('image-management already patched'); return; }
  // 1. schema: add data_base64 after source_path field
  const anchor = `        source_path: z
            .string()
            .optional()
            .describe('Absolute path to the local file to upload. REQUIRED for actions "image", "video" and "audio".'),`;
  if (!s.includes(anchor)) throw new Error('schema anchor not found');
  s = s.replace(anchor, anchor + `
        // COMFY_PATCH_DATA_BASE64_V1: client-provided bytes for remote AI clients
        // (ChatGPT /mnt/data isolation). When present, source_path is not required;
        // filename IS required (no local path to infer from).
        data_base64: z
            .string()
            .optional()
            .describe('Base64-encoded file bytes for actions "image"/"video"/"audio". Use when the client cannot place a file at source_path (e.g. ChatGPT attachments). Requires filename. Max ~30MB decoded. Integrity: SHA-256 is computed and returned.'),`);
  // 2. handler: replace sourcePath require + fn call with base64-aware branch
  const handlerAnchor = `                    const { fn, nodeHint } = MEDIA_UPLOADS[args.action];
                    const sourcePath = requireField(args.source_path, args.action, "source_path", "the absolute path of the local file to upload");
                    const result = await fn(sourcePath, args.filename);`;
  if (!s.includes(handlerAnchor)) throw new Error('handler anchor not found');
  const replacement = `                    const { fn, nodeHint } = MEDIA_UPLOADS[args.action];
                    // COMFY_PATCH_DATA_BASE64_V1
                    let result;
                    let uploadSha256 = null;
                    if (args.data_base64 !== undefined) {
                        const b64 = args.data_base64;
                        if (typeof b64 !== "string" || b64.length === 0) throw new Error('upload_image action:"' + args.action + '" requires valid data_base64 — empty payload.');
                        // ~30MB decoded cap (b64 ~40MB). Prevents decompression-bomb/OOM on CPU host.
                        if (b64.length > 40 * 1024 * 1024) throw new Error('upload_image data_base64 exceeds 40MB encoded (~30MB decoded) limit.');
                        let data;
                        try { data = Buffer.from(b64, "base64"); } catch { throw new Error('upload_image data_base64 is not valid base64.'); }
                        if (data.length === 0) throw new Error('upload_image data_base64 decoded to 0 bytes.');
                        if (data.length > 30 * 1024 * 1024) throw new Error('upload_image decoded bytes exceed 30MB limit (' + data.length + ' bytes).');
                        const destName = requireField(args.filename, args.action, "filename", "destination filename in ComfyUI input/ (required with data_base64)");
                        if (destName.includes("..")) throw new Error('upload_image filename must not contain ".." (path traversal).');
                        // Magic-byte sniff (don't trust extension alone, don't silently re-encode).
                        const magic = data.subarray(0, 12);
                        const isPng = magic[0]===0x89&&magic[1]===0x50&&magic[2]===0x4E&&magic[3]===0x47;
                        const isJpg = magic[0]===0xFF&&magic[1]===0xD8&&magic[2]===0xFF;
                        const isGif = magic[0]===0x47&&magic[1]===0x49&&magic[2]===0x46;
                        const isBmp = magic[0]===0x42&&magic[1]===0x4D;
                        const isTiff = (magic[0]===0x49&&magic[1]===0x49&&magic[2]===0x2A&&magic[3]===0x00)||(magic[0]===0x4D&&magic[1]===0x4D&&magic[2]===0x00&&magic[3]===0x2A);
                        const isRiff = magic[0]===0x52&&magic[1]===0x49&&magic[2]===0x46&&magic[3]===0x46;
                        const isWebp = isRiff && data.length>11 && magic[8]===0x57&&magic[9]===0x45&&magic[10]===0x42&&magic[11]===0x50;
                        const kind = args.action;
                        if (kind === "image" && !(isPng||isJpg||isGif||isBmp||isTiff||isWebp)) throw new Error('upload_image data_base64 magic bytes do not match a supported image (png/jpg/gif/bmp/tiff/webp). Refusing disguised file.');
                        const { createHash: __ch, randomBytes: __rb } = await import("node:crypto");
                        uploadSha256 = __ch("sha256").update(data).digest("hex");
                        const { writeFile: __wf, mkdir: __md, unlink: __ul } = await import("node:fs/promises");
                        const { tmpdir: __td } = await import("node:os");
                        const { join: __jn } = await import("node:path");
                        await __md(__td(), { recursive: true }).catch(()=>{});
                        const tmpPath = __jn(__td(), "comfy-upload-" + Date.now().toString(36) + "-" + __rb(6).toString("hex") + ".bin");
                        await __wf(tmpPath, data);
                        try { result = await fn(tmpPath, destName); }
                        finally { await __ul(tmpPath).catch(()=>{}); }
                    } else {
                        const sourcePath = requireField(args.source_path, args.action, "source_path", "the absolute path of the local file to upload (or provide data_base64 + filename for remote clients)");
                        result = await fn(sourcePath, args.filename);
                    }`;
  s = s.replace(handlerAnchor, replacement);
  // 3. include SHA in response text when base64 path used (preserve shape otherwise)
  const respNeedle = 'Uploaded via HTTP.\\n\\nFilename: ${reference}\\n\\n';
  if (!s.includes(respNeedle)) throw new Error('response anchor not found');
  s = s.replace(respNeedle, 'Uploaded via HTTP.` + (uploadSha256 ? `\\nSHA-256: ${uploadSha256}\\n` : `\\n`) + `\\nFilename: ${reference}\\n\\n');
  writeFileSync(IMG_TOOL, s);
  console.log('patched image-management.js with data_base64');
}

function patchTrainDoctor() {
  let s = readFileSync(TRAIN_TOOL, 'utf8');
  if (s.includes('COMFY_PATCH_TRAIN_READY_V1')) { console.log('train.js already patched'); return; }
  const anchor = `                    return textEnvelope({
                        ...doctor,`;
  if (!s.includes(anchor)) throw new Error('train anchor not found');
  s = s.replace(anchor, `                    // COMFY_PATCH_TRAIN_READY_V1: separate diagnostic completion from readiness (no false success).
                    const __ready = Boolean(doctor?.data?.docker) && Boolean(doctor?.data?.gpu);
                    const __missing = [];
                    if (!doctor?.data?.docker) __missing.push("docker");
                    if (!doctor?.data?.gpu) __missing.push("gpu");
                    // native.ready and image presence are hints; localFs false means remote (expected for this deploy).
                    return textEnvelope({
                        ...doctor,
                        diagnostic_completed: true,
                        ready_for_training: __ready,
                        missing_requirements: __missing,
                        unsupported_environment: !__ready ? "cpu-remote-no-docker-gpu" : undefined,`);
  writeFileSync(TRAIN_TOOL, s);
  console.log('patched train.js with ready_for_training');
}

patchImageTool();
patchTrainDoctor();
