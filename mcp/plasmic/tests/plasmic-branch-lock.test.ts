import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlasmicClient } from "../libs/plasmic-client/client.ts";
import { plasmicTools } from "../services/plasmic-mcp/tools.ts";

test("plasmic_create_branch serializes competing calls and dedupes completed retries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plasmic-branch-concurrency-"));
  const branches: { id: string; name: string }[] = [];
  const posts: Record<string, unknown>[] = [];
  const json = (value: unknown) => new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
  const client = new PlasmicClient({
    baseUrl: "https://wab.test.invalid",
    teamToken: "fixture-only",
    fetchImpl: async (input, init) => {
      const path = new URL(String(input)).pathname;
      assert.equal(path, "/api/v1/projects/project-1/branches");
      if ((init?.method ?? "GET") === "GET") return json({ branches });
      assert.equal(init?.method, "POST");
      const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
      assert.equal(payload.base, "latest"); // never "new" (auto-publish)
      posts.push(payload);
      // Yield deliberately, to expose race conditions without the project lock.
      await new Promise((r) => setTimeout(r, 25));
      const branch = { id: "fixture-branch", name: String(payload.name) };
      branches.push(branch);
      return json({ branch });
    },
  });
  try {
    const tool = plasmicTools({
      client, stateDir: dir, auditFile: join(dir, "audit.jsonl"),
    }).find((t) => t.name === "plasmic_create_branch");
    assert.ok(tool);
    const payload = {
      projectId: "project-1", name: "feature-only", idempotencyKey: "test-retry-key",
    };
    const dry = await tool.handler({ ...payload, dryRun: true });
    assert.equal((dry as { dryRun: boolean }).dryRun, true);
    assert.equal(posts.length, 0);
    const [first, replay] = await Promise.all([
      tool.handler(payload),
      tool.handler(payload),
    ]) as Array<{ branch: { id: string }; deduped: boolean }>;
    assert.equal(posts.length, 1);
    assert.equal(branches.length, 1);
    assert.equal(first.branch.id, replay.branch.id);
    assert.deepEqual([first.deduped, replay.deduped].sort(), [false, true]);
    const third = await tool.handler(payload) as { deduped: boolean };
    assert.equal(third.deduped, true);
    assert.equal(posts.length, 1);
    // Reusing a successful key with different arguments is a conflict, not
    // an accidental "success" pointing to someone else's branch.
    await assert.rejects(
      tool.handler({ ...payload, name: "different-feature" }),
      /IDEMPOTENCY_CONFLICT/,
    );
    await assert.rejects(
      tool.handler({ ...payload, sourceBranchId: "other-source" }),
      /IDEMPOTENCY_CONFLICT/,
    );
    assert.equal(posts.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
