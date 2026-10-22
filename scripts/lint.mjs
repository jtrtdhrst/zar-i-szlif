import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const files = [
  "app/web/scripts/build-static.mjs",
  "app/web/scripts/skill-completion-task-test.mjs",
  "app/plugin/index.ts",
  "app/plugin/server.ts",
  "app/plugin/ui.ts",
  "app/plugin/rag.ts",
  "app/plugin/auth.ts",
  "app/plugin/knowledge/schema.ts",
  "app/plugin/knowledge/embeddings.ts",
  "app/plugin/knowledge/qdrant.ts",
  "app/plugin/knowledge/memory.ts",
  "app/plugin/knowledge/pipeline.ts",
  "app/plugin/knowledge/retrieval.ts",
  "app/plugin/knowledge/mcp-tools.ts",
  "app/plugin/knowledge/sources.ts",
  "app/plugin/contract.test.mjs",
  "scripts/mcp-qdrant-verify.mjs",
  "app/cloudflare-worker/build-worker.mjs",
  "app/cloudflare-worker/worker.js",
  "scripts/assert-release-provenance.mjs",
  "scripts/release-targets.mjs",
  "scripts/check-mcp-endpoints.mjs",
  "scripts/validate-frontend.mjs",
  "tests/release-gate.test.mjs",
  "tests/repo-structure.test.mjs",
];

for (const file of files) {
  execFileSync(process.execPath, ["--check", resolve(file)], { stdio: "inherit" });
}
