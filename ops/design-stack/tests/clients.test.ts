// Testy jednostkowe: klienci OD i Plasmic na mocku fetch (bez sieci).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OdClient } from "../libs/od-client/client.ts";
import { PlasmicClient } from "../libs/plasmic-client/client.ts";

function mockFetch(routes: Record<string, { status?: number; body: unknown }>): typeof fetch {
  return (async (url: unknown) => {
    const u = String(url);
    const hit = Object.entries(routes).find(([k]) => u.includes(k))?.[1];
    if (!hit) {
      return new Response("not found", { status: 404 });
    }
    return new Response(JSON.stringify(hit.body), { status: hit.status ?? 200 });
  }) as typeof fetch;
}

describe("od-client", () => {
  const od = new OdClient({
    baseUrl: "http://x",
    token: "t",
    fetchImpl: mockFetch({
      "/api/design-systems": { body: { designSystems: [{ id: "ds1", name: "DS" }] } },
      "/api/design-systems/ds1/files": { body: { files: [{ path: "design-tokens.json" }] } },
    }),
  });
  // Nadpisz readFile mockiem treści
  (od as unknown as Record<string, unknown>).readFile = async () =>
    JSON.stringify({ colors: { brand: { primary: "#123456" } } });
  (od as unknown as Record<string, unknown>).getDesignSystem = async () => ({
    id: "ds1",
    name: "DS",
  });

  it("getContext agreguje project/tokens/components/constraints/refs", async () => {
    (od as unknown as Record<string, unknown>).getComponents = async () => [
      { id: "c1", name: "Button" },
    ];
    const ctx = await od.getContext("ds1");
    assert.equal(ctx.version, "1");
    assert.equal(ctx.project.id, "ds1");
    assert.equal((ctx.tokens as Record<string, unknown>).colors !== undefined, true);
    assert.equal(ctx.components[0]?.source, "opendesign");
    assert.ok(ctx.constraints.length > 0);
    assert.ok(ctx.sourceRefs.length > 0);
  });
});

describe("plasmic-client", () => {
  const bundle = {
    map: {
      page1: { __type: "Component", name: "Home", pageMeta: { path: "/" } },
      comp1: { __type: "Component", name: "Button" },
      tok1: { __type: "StyleToken", name: "primary" },
    },
  };
  const pl = new PlasmicClient({
    baseUrl: "http://x",
    fetchImpl: mockFetch({
      "/api/v1/projects/p1": {
        body: {
          rev: { id: "r1", revision: 3, data: JSON.stringify(bundle) },
          project: { id: "p1", name: "P" },
        },
      },
    }),
  });

  it("parsuje rewizję i klasyfikuje strony/komponenty/tokeny", async () => {
    const rev = await pl.getProjectRev("p1");
    assert.equal(rev.revision, 3);
    assert.deepEqual(
      pl.listPages(rev.bundle).map((p) => p.name),
      ["Home"],
    );
    assert.deepEqual(
      pl.listComponents(rev.bundle).map((x) => x.name),
      ["Button"],
    );
    assert.deepEqual(
      pl.listStyleTokens(rev.bundle).map((x) => x.name),
      ["primary"],
    );
  });

  it("klasyfikuje strony vs komponenty (pageMeta null to nie strona)", async () => {
    const pl3 = new PlasmicClient({ baseUrl: "http://x", fetchImpl: mockFetch({}) });
    const bundle = {
      map: {
        p1: { __type: "Component", name: "Home", pageMeta: { path: "/" } },
        c1: { __type: "Component", name: "Card", pageMeta: null },
      },
    };
    assert.deepEqual(pl3.listPages(bundle).map((p) => p.name), ["Home"]);
    assert.deepEqual(pl3.listComponents(bundle).map((x) => x.name), ["Card"]);
  });

  it("mutate z dryRun nie zapisuje", async () => {
    let saved = 0;
    const pl2 = new PlasmicClient({
      baseUrl: "http://x",
      fetchImpl: (async (url: unknown, init?: RequestInit) => {
        if (String(url).includes("/revisions/")) saved++;
        return new Response(
          JSON.stringify({
            rev: { id: "r1", revision: 3, data: JSON.stringify(bundle) },
            project: { id: "p1", name: "P" },
          }),
        );
      }) as typeof fetch,
    });
    const out = await pl2.mutate("p1", undefined, () => ({ map: { x: { a: 1 } } }), {
      dryRun: true,
    });
    assert.equal(out.dryRun, true);
    assert.equal(saved, 0);
  });
});
