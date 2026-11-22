#!/usr/bin/env node
/** Backward-compatible API/entrypoint; authoritative runtime is ops/mascot-worker/. */
export * from '../ops/mascot-worker/mascot-factory-service.mjs';
import { runMain } from '../ops/mascot-worker/mascot-factory-service.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) runMain();
