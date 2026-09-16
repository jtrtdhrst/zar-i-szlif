import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OdClient } from "../libs/od-client/client.ts";

const sha = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

interface BrandState {
  designMd: string;
  tokensCss: string;
  files: string[];
  patchBodies: string[];
  calls: Array<{ method: string; path: string }>;
  workspaceAsset?: Buffer;
  canonicalAsset?: Buffer;
}

function brandFetch(
  state: BrandState,
  options: {
    regenerateTokens?: (designMd: string, current: string) => string;
  } = {},
): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = String(init?.method ?? "GET").toUpperCase();
    state.calls.push({ method, path: `${url.pathname}${url.search}` });

    if (method === "GET" && url.pathname === "/api/design-systems/user%3Ads1") {
      return Response.json({
        id: "user:ds1",
        title: "Kompas",
        isEditable: true,
        source: "user",
      });
    }
    if (method === "GET" && url.pathname === "/api/design-systems/preset") {
      return Response.json({ id: "preset", title: "Preset", isEditable: false });
    }
    if (method === "GET" && url.pathname === "/api/design-systems/user%3Ads1/files") {
      return Response.json({ files: state.files.map((path) => ({ path })) });
    }
    if (method === "GET" && url.pathname === "/api/design-systems/user%3Ads1/file") {
      const path = url.searchParams.get("path");
      if (path === "DESIGN.md") return Response.json({ file: { content: state.designMd } });
      if (path === "tokens.css") return Response.json({ file: { content: state.tokensCss } });
      if (path === "manifest.json") {
        return Response.json({
          file: {
            content: JSON.stringify({
              schemaVersion: "od-design-system-project/v1",
              files: { design: "DESIGN.md", tokens: "tokens.css" },
              assetsDir: "assets",
            }),
          },
        });
      }
      if (path === "USAGE.md") return Response.json({ file: { content: "# Usage" } });
      if (path === "components.manifest.json") {
        return Response.json({ file: { content: JSON.stringify({ components: [] }) } });
      }
      return new Response("missing", { status: 404 });
    }
    if (method === "PATCH" && url.pathname === "/api/design-systems/user%3Ads1") {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { body?: string };
      assert.equal(typeof payload.body, "string");
      state.patchBodies.push(payload.body!);
      state.designMd = payload.body!;
      if (options.regenerateTokens) {
        state.tokensCss = options.regenerateTokens(state.designMd, state.tokensCss);
      }
      return Response.json({ id: "user:ds1", isEditable: true });
    }
    if (method === "POST" && url.pathname === "/api/design-systems/user%3Ads1/workspace") {
      return Response.json({ project: { id: "project-1" } });
    }
    if (method === "POST" && url.pathname === "/api/projects/project-1/files") {
      const payload = JSON.parse(String(init?.body ?? "{}")) as {
        name?: string;
        content?: string;
        encoding?: string;
      };
      assert.equal(payload.encoding, "base64");
      assert.ok(payload.name?.startsWith("assets/"));
      state.workspaceAsset = Buffer.from(payload.content ?? "", "base64");
      return Response.json({ ok: true });
    }
    if (method === "POST" && url.pathname === "/api/design-systems/user%3Ads1/sync-assets") {
      state.canonicalAsset = state.workspaceAsset;
      if (!state.files.includes("assets/logos/logo.svg")) {
        state.files.push("assets/logos/logo.svg");
      }
      return Response.json({ synced: ["assets/logos/logo.svg"] });
    }
    if (
      method === "GET" &&
      url.pathname === "/api/design-systems/user%3Ads1/static" &&
      url.searchParams.get("path") === "assets/logos/logo.svg"
    ) {
      if (!state.canonicalAsset) return new Response("missing", { status: 404 });
      return new Response(new Uint8Array(state.canonicalAsset), {
        status: 200,
        headers: { "Content-Type": "image/svg+xml" },
      });
    }
    return new Response(`unhandled ${method} ${url.pathname}${url.search}`, { status: 404 });
  }) as typeof fetch;
}

function initialState(): BrandState {
  return {
    designMd: "# Kompas\n\n## Colors\nPrimary: #112233\n",
    tokensCss: ":root { --color-primary: #112233; }\n",
    files: [
      "DESIGN.md",
      "tokens.css",
      "manifest.json",
      "USAGE.md",
      "components.manifest.json",
    ],
    patchBodies: [],
    calls: [],
  };
}

function client(state: BrandState, options?: Parameters<typeof brandFetch>[1]) {
  return new OdClient({
    baseUrl: "http://open-design",
    token: "test-token",
    fetchImpl: brandFetch(state, options),
  });
}

describe("OpenDesign canonical brand MCP client", () => {
  it("getBrand returns the canonical package and concurrency hashes", async () => {
    const state = initialState();
    const out = await client(state).getBrand("user:ds1");

    assert.equal(out.brand.id, "user:ds1");
    assert.equal(out.designMd, state.designMd);
    assert.equal(out.tokensCss, state.tokensCss);
    assert.equal(out.hashes.designMdSha256, sha(state.designMd));
    assert.equal(out.hashes.tokensCssSha256, sha(state.tokensCss));
    assert.deepEqual(out.assetPaths, []);
    assert.equal(
      (out.manifest as { schemaVersion: string }).schemaVersion,
      "od-design-system-project/v1",
    );
  });

  it("updateDesignMd rejects a stale hash without performing a PATCH", async () => {
    const state = initialState();
    await assert.rejects(
      () => client(state).updateDesignMd("user:ds1", "# New", "0".repeat(64)),
      /CONFLICT DESIGN\.md/,
    );
    assert.equal(state.patchBodies.length, 0);
  });

  it("updateDesignMd writes only when the optimistic hash matches and verifies read-back", async () => {
    const state = initialState();
    const before = sha(state.designMd);
    const next = `${state.designMd}\n## Voice\nClear and direct.\n`;
    const out = await client(state).updateDesignMd("user:ds1", next, before);

    assert.deepEqual(state.patchBodies, [next]);
    assert.equal(state.designMd, next);
    assert.equal(out.designMdSha256, sha(next));
    assert.equal(out.tokensCssSha256, sha(state.tokensCss));
  });

  it("updateTokens requires fresh DESIGN/tokens hashes and verifies regenerated tokens.css", async () => {
    const state = initialState();
    const oldTokens = state.tokensCss;
    const nextDesign = state.designMd.replace("#112233", "#00ff00");
    const od = client(state, {
      regenerateTokens: (designMd, current) =>
        designMd.includes("#00ff00")
          ? ":root { --color-primary: #00ff00; }\n"
          : current,
    });

    const out = await od.updateTokens(
      "user:ds1",
      nextDesign,
      sha(state.designMd),
      sha(oldTokens),
    );

    assert.equal(out.tokensChanged, true);
    assert.equal(state.designMd, nextDesign);
    assert.notEqual(state.tokensCss, oldTokens);
    assert.equal(out.tokensCssSha256, sha(state.tokensCss));
    assert.equal(state.patchBodies.length, 1);
  });

  it("updateTokens rolls DESIGN.md back when OpenDesign does not regenerate tokens", async () => {
    const state = initialState();
    const originalDesign = state.designMd;
    const originalTokens = state.tokensCss;
    const nextDesign = `${state.designMd}\n## Spacing\nUse 17px everywhere.\n`;

    await assert.rejects(
      () =>
        client(state).updateTokens(
          "user:ds1",
          nextDesign,
          sha(originalDesign),
          sha(originalTokens),
        ),
      /TOKENS_UNCHANGED rolled back/,
    );

    assert.deepEqual(state.patchBodies, [nextDesign, originalDesign]);
    assert.equal(state.designMd, originalDesign);
    assert.equal(state.tokensCss, originalTokens);
  });

  it("refuses to mutate a built-in/non-editable design system", async () => {
    const state = initialState();
    await assert.rejects(
      () => client(state).updateDesignMd("preset", "# Nope", "0".repeat(64)),
      /BRAND_NOT_EDITABLE/,
    );
    assert.equal(state.patchBodies.length, 0);
  });

  it("rejects traversal asset paths before any workspace write", async () => {
    const state = initialState();
    const svg = Buffer.from("<svg/>").toString("base64");
    await assert.rejects(
      () => client(state).uploadBrandAsset("user:ds1", "../logo.svg", svg),
      /INVALID_ASSET_PATH/,
    );
    assert.equal(
      state.calls.some((c) => c.method === "POST" && c.path.includes("/workspace")),
      false,
    );
  });

  it("requires explicit overwrite for an existing canonical asset", async () => {
    const state = initialState();
    state.files.push("assets/logos/logo.svg");
    const svg = Buffer.from("<svg/>").toString("base64");
    await assert.rejects(
      () => client(state).uploadBrandAsset("user:ds1", "logos/logo.svg", svg),
      /ASSET_EXISTS/,
    );
  });

  it("uploads via the official workspace path, syncs assets, and verifies canonical SHA", async () => {
    const state = initialState();
    const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>');
    const out = await client(state).uploadBrandAsset(
      "user:ds1",
      "logos/logo.svg",
      bytes.toString("base64"),
    );

    assert.equal(out.path, "assets/logos/logo.svg");
    assert.equal(out.sha256, sha(bytes));
    assert.equal(out.bytes, bytes.length);
    assert.deepEqual(out.synced, ["assets/logos/logo.svg"]);
    assert.equal(state.canonicalAsset?.equals(bytes), true);

    const writeIndex = state.calls.findIndex(
      (c) => c.method === "POST" && c.path === "/api/projects/project-1/files",
    );
    const syncIndex = state.calls.findIndex(
      (c) => c.method === "POST" && c.path === "/api/design-systems/user%3Ads1/sync-assets",
    );
    const verifyIndex = state.calls.findIndex(
      (c) => c.method === "GET" && c.path.startsWith("/api/design-systems/user%3Ads1/static?"),
    );
    assert.ok(writeIndex >= 0 && syncIndex > writeIndex && verifyIndex > syncIndex);
  });
});
