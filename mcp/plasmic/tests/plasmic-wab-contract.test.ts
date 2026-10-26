import assert from "node:assert/strict";
import test from "node:test";
import { PlasmicClient } from "../libs/plasmic-client/client.ts";

// Contract tests against the REST routes in plasmicapp/plasmic:
// platform/wab/src/wab/server/AppServer.ts and routes/projects.ts.
// No network access, credentials or real project mutations required.
function mockWab() {
  const requests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
  const branches: Array<{ id: string; name: string }> = [];
  let revision = 4;
  let bundle = {
    version: "fixture",
    root: "root",
    deps: [],
    map: { root: { __type: "Site", name: "Test site" } } as Record<string, Record<string, unknown>>,
  };
  let suppressReadback = false;
  let tamperReadback = false;
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status, headers: { "content-type": "application/json" },
    });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    requests.push({ method, path: url.pathname, body });
    assert.equal((init?.headers as Record<string, string>)?.["x-plasmic-team-token"], "test-token");
    const project = "/api/v1/projects/project-1";
    if (url.pathname === project + "/branches") {
      if (method === "GET") return json({ branches });
      if (method === "POST") {
        const name = body?.name;
        if (typeof name !== "string") return json({ error: "bad name" }, 400);
        const created = { id: `branch-${branches.length + 1}`, name };
        branches.push(created);
        return json({ branch: created });
      }
    }
    const branchDelete = url.pathname.match(/^\/api\/v1\/projects\/project-1\/branches\/([^/]+)$/);
    if (branchDelete && method === "DELETE") {
      const index = branches.findIndex((branch) => branch.id === decodeURIComponent(branchDelete[1]!));
      if (index < 0) return json({ error: "not found" }, 404);
      branches.splice(index, 1);
      return json({});
    }
    if (url.pathname === project + "/merge" && method === "POST") {
      return json({ status: "can be merged", pretend: body?.pretend });
    }
    if (url.pathname === project && method === "GET") {
      return json({
        project: { id: "project-1", name: "Fixture" },
        rev: { id: "revision", revision, data: JSON.stringify(bundle) },
        modelVersion: 1, hostlessDataVersion: 1,
      });
    }
    if (url.pathname === project + "/revisions/5" && method === "POST") {
      // Structural saves use a full WAB bundle, while small edits stay incremental.
      const patch = JSON.parse(String(body?.data)) as typeof bundle;
      if (!suppressReadback) {
        revision = 5;
        bundle = body?.incremental === true
          ? { ...bundle, map: { ...bundle.map, ...patch.map } }
          : patch;
        if (tamperReadback && bundle.map.child) {
          bundle.map.child = { ...bundle.map.child, name: "Unexpected server value" };
        }
      }
      return json({ revision: 5 });
    }
    return json({ error: "unmocked route", path: url.pathname }, 404);
  };
  const client = new PlasmicClient({
    baseUrl: "https://wab.example.test",
    teamToken: "test-token", fetchImpl,
  });
  return { client, requests, setSuppressReadback: (v: boolean) => { suppressReadback = v; },
    setTamperReadback: (v: boolean) => { tamperReadback = v; } };
}

test("Plasmic design branches use native WAB REST, not GitHub", async () => {
  const { client, requests } = mockWab();
  assert.deepEqual((await client.listBranches("project-1")).branches, []);
  const result = await client.createBranch("project-1", "mcp-preview", { base: "latest" });
  assert.equal(result.branch.name, "mcp-preview");
  assert.equal((await client.listBranches("project-1")).branches.length, 1);
  assert.equal(requests.filter((r) => r.method === "POST").length, 1);
  assert.deepEqual(requests.find((r) => r.method === "POST")?.body,
    { name: "mcp-preview", base: "latest" });
  // WAB base:new can publish the project; reject this before POST.
  await assert.rejects(
    client.createBranch("project-1", "unsafe", { base: "new" } as never),
    /BRANCH_BASE_FORBIDDEN/,
  );
  const safe = await client.createBranch("project-1", "safe-default");
  assert.equal(safe.branch.name, "safe-default");
  assert.deepEqual(requests.filter((r) => r.method === "POST").at(-1)?.body,
    { name: "safe-default", base: "latest" });
  await assert.rejects(client.createBranch("project-1", "mcp-preview"), /BRANCH_EXISTS/);
  assert.equal(requests.filter((r) => r.method === "POST").length, 2);
  await assert.rejects(
    client.createBranch("project-1", "second", { sourceBranchId: "a", base: "latest" }),
    /INVALID_BRANCH_BASE/,
  );
});

test("branch cleanup deletes only an existing non-main branch and verifies readback", async () => {
  const { client, requests } = mockWab();
  await client.createBranch("project-1", "mcp-e2e-test", { base: "latest" });
  await client.deleteBranch("project-1", "branch-1");
  assert.deepEqual(requests.find((r) => r.method === "DELETE"), {
    method: "DELETE", path: "/api/v1/projects/project-1/branches/branch-1", body: undefined,
  });
  assert.equal((await client.listBranches("project-1")).branches.length, 0);
  await assert.rejects(client.deleteBranch("project-1", "main"), /INVALID_BRANCH_DELETE_TARGET/);
  await assert.rejects(client.deleteBranch("project-1", "missing"), /BRANCH_NOT_FOUND/);
});

test("merge preview is WAB pretend=true without a commit", async () => {
  const { client, requests } = mockWab();
  const result = await client.previewMerge("project-1", "feature", "main");
  assert.deepEqual(result, { status: "can be merged", pretend: true });
  assert.deepEqual(requests.find((r) => r.path.endsWith("/merge"))?.body, {
    subject: { fromBranchId: "feature", toBranchId: "main" },
    pretend: true, autoCommitOnToBranch: false,
  });
  await assert.rejects(client.previewMerge("project-1", "main", "main"), /INVALID_MERGE_BRANCHES/);
});

test("incremental write verifies saved state through a fresh read", async () => {
  const { client, requests } = mockWab();
  const result = await client.mutate("project-1", undefined, () => ({
    map: { child: { __type: "TplTag", name: "Child" } },
  }));
  assert.equal(result.revision, 5);
  assert.equal(result.dryRun, false);
  assert.ok(requests.some((r) => r.path.endsWith("/revisions/5")));
  assert.equal(requests.filter((r) => r.method === "GET" && r.path === "/api/v1/projects/project-1").length, 2);
});

test("structural full save keeps existing WAB bundle references", async () => {
  const { client, requests } = mockWab();
  const result = await client.mutate("project-1", undefined, () => ({
    map: { child: { __type: "TplTag", name: "New element", parent: { __ref: "root" } } },
  }), { saveMode: "full" });
  assert.equal(result.revision, 5);
  const save = requests.find((r) => r.method === "POST" && r.path.endsWith("/revisions/5"));
  assert.ok(save);
  assert.equal(save.body?.incremental, undefined);
  const saved = JSON.parse(String(save.body?.data)) as { map: Record<string, Record<string, unknown>> };
  assert.equal(saved.map.root.__type, "Site");
  assert.equal(saved.map.child.name, "New element");
  assert.equal((await client.getProjectRev("project-1")).bundle.map.root.__type, "Site");
});

test("unverified write fails closed and requests inspection instead of silent success", async () => {
  const { client, setSuppressReadback } = mockWab();
  setSuppressReadback(true);
  await assert.rejects(
    client.mutate("project-1", undefined, () => ({
      map: { child: { __type: "TplTag", name: "Child" } },
    })),
    /WRITE_READBACK_UNVERIFIED/,
  );
});

test("readback rejects changed field values even when revision advances", async () => {
  const { client, setTamperReadback } = mockWab();
  setTamperReadback(true);
  await assert.rejects(
    client.mutate("project-1", undefined, () => ({
      map: { child: { __type: "TplTag", name: "Expected" } },
    })),
    /WRITE_READBACK_UNVERIFIED/,
  );
});
