import test from "node:test";
import assert from "node:assert/strict";
import { findHostMcpViolations, parseNameStatus } from "../scripts/check-mcp-repository-fence.mjs";

test("product MCP and product Supabase migrations stay allowed", () => {
  assert.deepEqual(findHostMcpViolations([
    { status: "M", path: "app/mcp-worker/src/index.ts" },
    { status: "A", path: "supabase/migrations/20261022.sql" },
    { status: "M", path: "app/web/src/App.tsx" },
  ]), []);
});

test("legacy and new host-only roots cannot be modified in product repo", () => {
  const paths = ["mcp/mantic/src/server.ts", "mcp/qdrant/main.py", "mcp/penpot/server.ts",
    "mcp/plasmic/server.ts", "mcp/supabase/main.py", "mcp/ubuntu/index.ts",
    "mantic-mcp-http/server.ts", "mcp-qdrant/main.py", "penpot/mcp/server.ts",
    "plasmic-mcp/server.ts", "supabase-mcp/main.ts", "ubuntu-mcp/server.ts",
    "ops/design-stack/services/plasmic-mcp/server.ts",
    "dev/integrations/opencode-mcp/server.mjs",
    "dev/integrations/paperclip-mcp/public-mcp-proxy.mjs"];
  assert.equal(findHostMcpViolations(paths.map(path => ({ status: "M", path }))).length, paths.length);
});

test("legacy host-only deletions allowed but rename tricks fail closed", () => {
  assert.deepEqual(findHostMcpViolations([{ status: "D", path: "ops/design-stack/Dockerfile.mcp" }]), []);
  assert.equal(findHostMcpViolations([
    { status: "R", previousPath: "ops/design-stack/services/plasmic-mcp/server.ts", path: "app/web/plasmic-copy.ts" },
  ]).length, 1);
  assert.equal(findHostMcpViolations([{ status: "A", path: "mcp/opencode/server.mjs" }]).length, 1);
});

test("name-status parser handles modifications, deletions and renames", () => {
  assert.deepEqual(parseNameStatus("M\tapp/mcp-worker/index.ts\nD\tops/design-stack/old.ts\nR100\tops/design-stack/file.ts\tapp/web/file.ts"), [
    { status: "M", path: "app/mcp-worker/index.ts" },
    { status: "D", path: "ops/design-stack/old.ts" },
    { status: "R", previousPath: "ops/design-stack/file.ts", path: "app/web/file.ts" },
  ]);
});
