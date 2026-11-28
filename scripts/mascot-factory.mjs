#!/usr/bin/env node
/** Backward-compatible CLI/import path; authoritative runtime is ops/mascot-worker/. */
export * from '../ops/mascot-worker/mascot-factory.mjs';
import { cli } from '../ops/mascot-worker/mascot-factory.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  cli(process.argv.slice(2)).catch(err => { console.error('MASCOT_FACTORY_FAILED:', err.message); process.exitCode = 1; });
}
