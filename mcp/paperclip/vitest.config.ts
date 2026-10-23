import { defineConfig } from "vitest/config";

// The gateway tests use node:test (mcp-gateway/test/*.mjs) and are run with
// `node --test`; vitest owns the TypeScript source suite.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
