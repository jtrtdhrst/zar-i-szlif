// KOMAA-1001: dryRun/live izolacja idempotencji + kanoniczne 17 narzędzi.
// Mock klienta (bez sieci, bez mutacji produkcyjnego projektu Plasmic).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plasmicTools, type PlasmicCtx } from "../services/plasmic-mcp/tools.ts";
import type { BundleDoc, PlasmicClient } from "../libs/plasmic-client/client.ts";

type Patch = {
  map?: Record<string, Record<string, unknown>>;
  toDeleteIids?: string[];
} | null;

function mockSetup() {
  const state = {
    revision: 3,
    saves: 0,
    bundle: {
      map: {
        site1: { __type: "Site", name: "Site", components: [], pageArenas: [] },
      },
    } as BundleDoc,
  };
  const client = {
    async getProjectRev() {
      return {
        revision: state.revision,
        revId: "r",
        bundle: JSON.parse(JSON.stringify(state.bundle)) as BundleDoc,
        project: { id: "p1", name: "P" },
      };
    },
    async mutate(
      _pid: string,
      _br: string | undefined,
      fn: (b: BundleDoc) => Patch,
      opts?: { dryRun?: boolean },
    ) {
      const snap = JSON.parse(JSON.stringify(state.bundle)) as BundleDoc;
      const patch = fn(snap);
      const changed = [
        ...Object.keys(patch?.map ?? {}),
        ...((patch?.toDeleteIids ?? []).map((i) => `-${i}`)),
      ];
      if (!patch || changed.length === 0) {
        return { revision: state.revision, dryRun: true, changed: [] };
      }
      if (opts?.dryRun) {
        return { revision: state.revision, dryRun: true, changed };
      }
      state.saves++;
      Object.assign(state.bundle.map, patch.map);
      state.revision++;
      return { revision: state.revision, dryRun: false, changed };
    },
  };
  return { state, client: client as unknown as PlasmicClient };
}

async function makeCtx() {
  const dir = await mkdtemp(join(tmpdir(), "komaa-1001-"));
  const { state, client } = mockSetup();
  const ctx: PlasmicCtx = { client, stateDir: dir, auditFile: join(dir, "audit.jsonl") };
  return { dir, state, tools: plasmicTools(ctx) };
}

const handler = (tools: ReturnType<typeof plasmicTools>, name: string) =>
  tools.find((t) => t.name === name)!.handler;

const countNamed = (state: { bundle: BundleDoc }, name: string) =>
  Object.values(state.bundle.map).filter(
    (v) => (v as Record<string, unknown>).__type === "Component" &&
      (v as Record<string, unknown>).name === name,
  ).length;

describe("KOMAA-1001: dryRun nie tłumi live (create_page)", () => {
  it("dryRun=true -> live=false ten sam klucz = dokładnie jeden zapis, rewizja +1, replay bez duplikatu", async () => {
    const { state, tools } = await makeCtx();
    const create = handler(tools, "plasmic_create_page");
    const base = { projectId: "p1", name: "T", path: "/t", idempotencyKey: "K" };

    const d = (await create({ ...base, dryRun: true })) as { dryRun: boolean; revision: number };
    assert.equal(d.dryRun, true);
    assert.equal(d.revision, 3);
    assert.equal(state.saves, 0, "dryRun nigdy nie zapisuje");
    assert.equal(countNamed(state, "T"), 0);

    const l1 = (await create({ ...base, dryRun: false })) as { dryRun: boolean; revision: number };
    assert.equal(l1.dryRun, false);
    assert.equal(l1.revision, 4);
    assert.equal(state.saves, 1, "live po dryRun musi zapisać (1 write)");
    assert.equal(countNamed(state, "T"), 1);

    const l2 = (await create({ ...base, dryRun: false })) as Record<string, unknown>;
    assert.equal(state.saves, 1, "powtórka live to replay, nie duplikat");
    assert.deepEqual(l2, l1 as unknown as Record<string, unknown>);
    assert.equal(countNamed(state, "T"), 1);
  });

  it("współbieżne retry live z tym samym kluczem serializują się do jednego zapisu", async () => {
    const { state, tools } = await makeCtx();
    const create = handler(tools, "plasmic_create_page");
    const args = { projectId: "p1", name: "C", path: "/c", idempotencyKey: "KC" };
    await Promise.all([create(args), create(args)]);
    assert.equal(state.saves, 1);
    assert.equal(countNamed(state, "C"), 1);
  });
});

describe("KOMAA-1001: dryRun nie tłumi live (create_component)", () => {
  it("dryRun=true -> live ten sam klucz = jeden zapis", async () => {
    const { state, tools } = await makeCtx();
    const create = handler(tools, "plasmic_create_component");
    const base = { projectId: "p1", name: "Btn", idempotencyKey: "KB" };
    const d = (await create({ ...base, dryRun: true })) as { dryRun: boolean };
    assert.equal(d.dryRun, true);
    assert.equal(state.saves, 0);
    const l = (await create(base)) as { dryRun: boolean; revision: number };
    assert.equal(l.dryRun, false);
    assert.equal(l.revision, 4);
    assert.equal(state.saves, 1);
  });
});

// Kontrakt katalogu (17 narzędzi == tools/list żywego serwera, negatyw
// plasmic_import_html na poziomie protokołu) jest w tests/plasmic-mcp-catalog.test.ts.
