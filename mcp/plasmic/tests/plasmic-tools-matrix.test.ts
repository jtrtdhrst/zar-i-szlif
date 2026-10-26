import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlasmicClient } from "../libs/plasmic-client/client.ts";
import { plasmicTools } from "../services/plasmic-mcp/tools.ts";

// Tool-level integration matrix over a local WAB fixture. No network, no
// credentials, no real project. NOT production E2E: live authenticated calls
// remain a separate gate.

type Map = Record<string, Record<string, unknown>>;

const seed = (): Map => ({
  site: { __type: "Site", name: "Site", components: [], pageArenas: [] },
  comp1: { __type: "Component", name: "Card", uuid: "u-comp1", vsettings: [{ __ref: "vs1" }] },
  page1: {
    __type: "Component", name: "Home", uuid: "u-page1",
    pageMeta: { __ref: "pm1" }, vsettings: [{ __ref: "vs1" }],
  },
  pm1: { __type: "PageMeta", path: "/" },
  vs1: { __type: "VariantSetting", attrs: {}, rs: { __ref: "rs1" } },
  rs1: { __type: "RuleSet", values: {} },
  tag1: { __type: "TplTag", name: "div", vsettings: [{ __ref: "vs1" }] },
  holder: { __type: "TplTag", name: "holder", child: { __ref: "tag1" } },
  inst1: { __type: "TplComponent", name: "Inst", component: { __ref: "comp1" } },
  tok1: { __type: "StyleToken", name: "brand", uuid: "u-tok1", value: "#fff" },
  orphan: { __type: "TplTag", name: "orphan" },
});

async function setup() {
  let map = seed();
  let revision = 4;
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const client = new PlasmicClient({
    baseUrl: "https://wab.fixture.invalid",
    teamToken: "test-token-no-production-secret",
    fetchImpl: async () => { throw new Error("NO_NETWORK_IN_FIXTURE"); },
  });
  Object.assign(client, {
    listProjects: async () => [{
      id: "project-1", name: "Fixture", projectApiToken: "fixture-secret-never-return",
      settings: [{ nested: { projectApiToken: "nested-fixture-secret-never-return", label: "safe" } }],
    }],
    listBranches: async () => ({ branches: [] }),
    previewMerge: async () => ({ status: "can be merged", pretend: true }),
    getComments: async () => ({ threads: [] }),
    getProjectRev: async () => ({
      revision, revId: "revision", project: { id: "project-1", name: "Fixture", projectApiToken: "fixture-secret-never-return" },
      bundle: { map: structuredClone(map) },
    }),
    mutate: async (
      _projectId: string,
      _branchId: string | undefined,
      fn: (b: { map: Map }) => { map?: Map; toDeleteIids?: string[] } | undefined,
      opts?: { dryRun?: boolean },
    ) => {
      const patch = fn({ map: structuredClone(map) });
      const changed = [
        ...Object.keys(patch?.map ?? {}),
        ...(patch?.toDeleteIids ?? []).map((i) => `-${i}`),
      ];
      if (!patch || changed.length === 0) return { revision, dryRun: true, changed: [] };
      if (opts?.dryRun) return { revision, dryRun: true, changed };
      map = { ...map, ...(patch.map ?? {}) };
      for (const iid of patch.toDeleteIids ?? []) delete map[iid];
      revision += 1;
      return { revision, dryRun: false, changed };
    },
  });
  // Record calls without changing behaviour.
  const toolDefs = plasmicTools({
    client, stateDir: await mkdtemp(join(tmpdir(), "plasmic-matrix-")),
    auditFile: join(await mkdtemp(join(tmpdir(), "plasmic-audit-")), "audit.jsonl"),
    agent: "matrix-test",
  });
  for (const t of toolDefs) {
    const h = t.handler;
    t.handler = async (args) => { calls.push({ method: t.name, args: [args] }); return h(args); };
  }
  const tool = (name: string) => {
    const found = toolDefs.find((t) => t.name === name);
    assert.ok(found, `missing tool ${name}`);
    return found!;
  };
  return { tool, calls, mapNow: () => map, revisionNow: () => revision };
}

test("matrix: list_projects returns the fixture project", async () => {
  const { tool } = await setup();
  const out = await tool("plasmic_list_projects").handler({}) as {
    projects: Array<{ id: string; settings: Array<{ nested: { label: string } }> }>;
  };
  assert.equal(out.projects.length, 1);
  assert.equal(JSON.stringify(out).includes("fixture-secret-never-return"), false);
  assert.equal(JSON.stringify(out).includes("nested-fixture-secret-never-return"), false);
  assert.equal(out.projects[0]!.settings[0]!.nested.label, "safe");
});

test("matrix: get_project redacts projectApiToken", async () => {
  const { tool } = await setup();
  const out = await tool("plasmic_get_project").handler({ projectId: "project-1" });
  assert.equal(JSON.stringify(out).includes("fixture-secret-never-return"), false);
});

test("matrix: list_tokens returns StyleToken entries", async () => {
  const { tool } = await setup();
  const out = await tool("plasmic_list_tokens").handler({ projectId: "project-1" }) as {
    tokens: Array<{ id: string }>;
  };
  assert.ok(out.tokens.some((t) => t.id === "tok1"));
});

test("matrix: create_page mutates and advances revision", async () => {
  const { tool, mapNow } = await setup();
  const out = await tool("plasmic_create_page").handler({
    projectId: "project-1", name: "Pricing", path: "/pricing", idempotencyKey: "m1",
  }) as { revision: number; changed: string[] };
  assert.equal(out.revision, 5);
  assert.ok(out.changed.length > 0);
  const added = out.changed.filter((k) => (mapNow()[k] as { __type?: string })?.__type === "Component");
  assert.ok(added.length >= 1, "new Page component entry is present");
});

test("matrix: create_component mutates and advances revision", async () => {
  const { tool, mapNow } = await setup();
  const out = await tool("plasmic_create_component").handler({
    projectId: "project-1", name: "Badge", idempotencyKey: "m2",
  }) as { revision: number; id: string | null };
  assert.equal(out.revision, 5);
  assert.ok(out.id);
  assert.equal((mapNow()[out.id!] as { name?: string }).name, "Badge");
});

test("matrix: insert upserts a raw entry", async () => {
  const { tool, mapNow } = await setup();
  const out = await tool("plasmic_insert").handler({
    projectId: "project-1", elementId: "new1",
    entry: { __type: "TplTag", name: "Inserted" }, idempotencyKey: "m3",
  }) as { id: string };
  assert.equal(out.id, "new1");
  assert.equal(mapNow().new1!.name, "Inserted");
});

test("matrix: update merges fields after readback", async () => {
  const { tool, mapNow } = await setup();
  await tool("plasmic_update").handler({
    projectId: "project-1", elementId: "tag1", patch: { name: "Renamed" },
  });
  assert.equal(mapNow().tag1!.name, "Renamed");
});

test("matrix: delete refuses dangling refs without force, then deletes with force", async () => {
  const { tool, mapNow } = await setup();
  await assert.rejects(
    tool("plasmic_delete").handler({ projectId: "project-1", elementId: "tag1" }),
    /DANGLING_REFS/,
  );
  await tool("plasmic_delete").handler({ projectId: "project-1", elementId: "tag1", force: true });
  assert.equal(mapNow().tag1, undefined);
  await tool("plasmic_delete").handler({ projectId: "project-1", elementId: "orphan" });
  assert.equal(mapNow().orphan, undefined);
});

test("matrix: set_props writes attrs for TplTag", async () => {
  const { tool, mapNow } = await setup();
  await tool("plasmic_set_props").handler({
    projectId: "project-1", elementId: "tag1",
    props: { title: "hello", count: 2, visible: true },
  });
  const attrs = (mapNow().vs1 as { attrs?: Record<string, unknown> }).attrs ?? {};
  assert.deepEqual(Object.keys(attrs).sort(), ["count", "title", "visible"]);
  for (const ref of Object.values(attrs)) {
    const iid = (ref as { __ref: string }).__ref;
    assert.equal((mapNow()[iid] as { __type?: string }).__type, "CustomCode");
  }
});

test("matrix: use_component clones an existing instance", async () => {
  const { tool, mapNow } = await setup();
  const before = Object.keys(mapNow()).length;
  const out = await tool("plasmic_use_component").handler({
    projectId: "project-1", componentId: "comp1", idempotencyKey: "m4",
  }) as { changed: string[] };
  assert.equal(Object.keys(mapNow()).length, before + 1);
  assert.equal(out.changed.length, 1);
  assert.equal(mapNow()[out.changed[0]!]!.__type, "TplComponent", "only a TplComponent instance is cloned");
});

test("matrix: validate reports a structurally valid fixture", async () => {
  const { tool } = await setup();
  const out = await tool("plasmic_validate").handler({ projectId: "project-1" }) as {
    valid: boolean; entries: number;
  };
  assert.equal(out.valid, true);
  assert.ok(out.entries > 0);
});

test("fixtures: page/component templates have no unresolved refs", () => {
  for (const file of ["page-template.json", "comp-template.json"]) {
    const fixture = JSON.parse(
      readFileSync(new URL(`../services/plasmic-mcp/${file}`, import.meta.url), "utf8"),
    ) as { entries: Record<string, unknown> };
    const iids = new Set(Object.keys(fixture.entries));
    const dangling = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (!v || typeof v !== "object") return;
      const o = v as Record<string, unknown>;
      if (typeof o.__ref === "string" && !iids.has(o.__ref)) dangling.add(o.__ref);
      Object.values(o).forEach(walk);
    };
    walk(fixture.entries);
    assert.deepEqual([...dangling], [], `${file} references entries outside its own map`);
  }
});
