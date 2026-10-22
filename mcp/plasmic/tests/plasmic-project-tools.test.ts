// Testy nowych narzędzi projektu: plasmic_list_projects + plasmic_create_project.
// Bez sieci — mock fetch. Kluczowe: brak duplikatu projektu (idempotencja) i brak zapisu w dryRun.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlasmicClient } from "../libs/plasmic-client/client.ts";
import { plasmicTools, type PlasmicCtx } from "../services/plasmic-mcp/tools.ts";

interface Call {
  method: string;
  path: string;
  body?: unknown;
}

function mockWab(calls: Call[], projects: { id: string; name: string }[]) {
  return (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    calls.push({
      method,
      path: u.replace("http://x", ""),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (u.includes("/api/v1/workspaces")) {
      return new Response("not found", { status: 404 });
    }
    if (u.includes("/api/v1/projects") && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { name: string };
      return new Response(
        JSON.stringify({ project: { id: `p-${body.name}`, name: body.name } }),
        { status: 200 },
      );
    }
    if (u.includes("/api/v1/projects")) {
      return new Response(JSON.stringify({ projects }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

async function ctxFor(calls: Call[], projects: { id: string; name: string }[]) {
  const stateDir = await mkdtemp(join(tmpdir(), "plasmic-mcp-test-"));
  const ctx: PlasmicCtx = {
    client: new PlasmicClient({ baseUrl: "http://x", fetchImpl: mockWab(calls, projects) }),
    stateDir,
    auditFile: join(stateDir, "audit.jsonl"),
    agent: "test",
    run: "run-1",
  };
  return ctx;
}

describe("plasmic_create_project", () => {
  it("tworzy projekt i zwraca id + nazwa", async () => {
    const calls: Call[] = [];
    const ctx = await ctxFor(calls, []);
    const tool = plasmicTools(ctx).find((t) => t.name === "plasmic_create_project")!;
    const out = (await tool.handler({
      name: "Żar i Szlif — Website",
      workspaceId: "ws1",
    })) as { project: { id: string; name: string } };

    assert.equal(out.project.id, "p-Żar i Szlif — Website");
    assert.equal(out.project.name, "Żar i Szlif — Website");
    const post = calls.find((c) => c.method === "POST");
    assert.ok(post, "musi być dokładnie jeden POST /api/v1/projects");
    assert.deepEqual(post!.body, { name: "Żar i Szlif — Website", workspaceId: "ws1" });
  });

  it("idempotencja: powtórka tej samej nazwy nie tworzy drugiego projektu", async () => {
    const calls: Call[] = [];
    const ctx = await ctxFor(calls, []);
    const tool = plasmicTools(ctx).find((t) => t.name === "plasmic_create_project")!;
    const args = { name: "Żar i Szlif — Website" };
    const a = (await tool.handler(args)) as { project: { id: string } };
    const b = (await tool.handler(args)) as { project: { id: string } };

    assert.equal(a.project.id, b.project.id);
    assert.equal(calls.filter((c) => c.method === "POST").length, 1);
  });

  it("dryRun nie zapisuje (tylko raportuje kolizję nazwy)", async () => {
    const calls: Call[] = [];
    const ctx = await ctxFor(calls, [{ id: "p-existing", name: "Żar i Szlif — Website" }]);
    const tool = plasmicTools(ctx).find((t) => t.name === "plasmic_create_project")!;
    const out = (await tool.handler({
      name: "Żar i Szlif — Website",
      dryRun: true,
    })) as { dryRun: boolean; wouldCreate: boolean; existing: string[] };

    assert.equal(out.dryRun, true);
    assert.equal(out.wouldCreate, false);
    assert.deepEqual(out.existing, ["p-existing"]);
    assert.equal(calls.filter((c) => c.method === "POST").length, 0);
  });
});

describe("plasmic_list_projects", () => {
  it("listuje projekty i zwraca null dla niedostępnych workspace'ów", async () => {
    const calls: Call[] = [];
    const ctx = await ctxFor(calls, [{ id: "p1", name: "Żar i Szlif — Website" }]);
    const tool = plasmicTools(ctx).find((t) => t.name === "plasmic_list_projects")!;
    const out = (await tool.handler({})) as {
      projects: { id: string; name: string }[];
      workspaces: unknown;
    };

    assert.equal(out.projects[0]?.id, "p1");
    assert.equal(out.workspaces, null);
  });
});
