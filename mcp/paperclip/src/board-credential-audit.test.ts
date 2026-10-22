import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaperclipApiClient, PaperclipApiError, isBoardPromotable, resolveCredentialClass } from "./client.js";

const CORE_ROUTES_DIR = "/app/server/src/routes";

/**
 * Board-only routes in the Paperclip Core. `assertBoard` is the gate that
 * produced "403 Board access required" on the MCP; every route behind it has
 * to stay reachable from the MCP or the operator hits a dead end.
 */
const BOARD_ASSERTIONS = ["assertBoard(", "assertInstanceAdmin(", "assertBoardOrgAccess(", "assertBoardOrAgent("];

interface CoreRoute {
  method: string;
  path: string;
  file: string;
}

/** Routers mounted under a prefix in app.ts; everything else sits at the root. */
const MOUNT_PREFIX: Record<string, string> = {
  "companies.ts": "/companies",
  "health.ts": "/health",
  "cloud.ts": "/cloud",
};

function coreRoutes(): CoreRoute[] {
  const routes: CoreRoute[] = [];
  let files: string[];
  try {
    files = readdirSync(CORE_ROUTES_DIR);
  } catch {
    return routes;
  }
  for (const file of files) {
    if (!file.endsWith(".ts") || file.includes(".test.")) continue;
    const src = readFileSync(join(CORE_ROUTES_DIR, file), "utf8");
    const re = /router\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(src)) !== null) {
      const body = src.slice(match.index, re.lastIndex + 4000);
      if (!BOARD_ASSERTIONS.some((assertion) => body.includes(assertion))) continue;
      routes.push({ method: match[1].toUpperCase(), path: `${MOUNT_PREFIX[file] ?? ""}${match[2]}`, file });
    }
  }
  return routes;
}

/** Core path ("/agents/:id/configuration") -> a concrete MCP path. */
function concretePath(corePath: string): string {
  return corePath.replace(/:[^/]+/g, "11111111-1111-1111-1111-111111111111");
}

function makeClient() {
  return new PaperclipApiClient({
    apiUrl: "http://localhost:3100/api",
    apiKey: "token-caller",
    companyId: "11111111-1111-1111-1111-111111111111",
    agentId: "22222222-2222-2222-2222-222222222222",
    runId: null,
    agentApiKey: "token-agent",
    boardApiKey: "token-board",
  });
}

describe("board credential audit", () => {
  it("finds the Core route table (guard must not silently pass on an empty scan)", () => {
    const routes = coreRoutes();
    expect(routes.length).toBeGreaterThan(20);
    expect(routes.some((r) => r.path.startsWith("/agents/"))).toBe(true);
    expect(routes.some((r) => r.path.startsWith("/companies/"))).toBe(true);
  });

  it("keeps every Board-gated read reachable from the MCP", () => {
    const routes = coreRoutes();
    const unreachable: string[] = [];
    for (const route of routes) {
      if (route.method !== "GET" && route.method !== "HEAD") continue;
      const path = concretePath(route.path);
      const boardRouted = resolveCredentialClass(route.method, path) === "board";
      // A read that the caller cannot perform is escalated to the Board
      // credential on the first 403, so it stays reachable either way.
      if (!boardRouted && !isBoardPromotable(route.method, path)) unreachable.push(`${route.method} ${route.path}`);
    }
    expect(unreachable).toEqual([]);
  });

  it("keeps Board-gated writes reachable outside the issue namespace", () => {
    const routes = coreRoutes();
    const unreachable: string[] = [];
    for (const route of routes) {
      if (route.method === "GET" || route.method === "HEAD") continue;
      // Issue-scoped writes keep the caller's own credential on purpose: the
      // credential decides who the audit records as the author, so they are
      // never escalated to the Board key.
      if (route.path.startsWith("/issues/")) continue;
      const path = concretePath(route.path);
      const boardRouted = resolveCredentialClass(route.method, path) === "board";
      if (!boardRouted && !isBoardPromotable(route.method, path)) unreachable.push(`${route.method} ${route.path}`);
    }
    expect(unreachable).toEqual([]);
  });

  it("routes the Company/instance admin reads the agent key cannot perform", () => {
    const client = makeClient();
    // Live-verified 2026-10-19: the agent key answers 403 on all of these.
    for (const path of [
      "/companies",
      "/companies/11111111-1111-1111-1111-111111111111/environments",
      "/companies/11111111-1111-1111-1111-111111111111/costs/quota-windows",
      "/instance/scheduler-heartbeats",
    ]) {
      expect(resolveCredentialClass("GET", path)).toBe("board");
    }
    // ...and the agent-scoped reads stay on the agent key until the server
    // denies them. The instruction bundle is the exception: Core gates it
    // behind instance-admin for external-mode agents, so it goes out on the
    // board credential instead of collecting a 403 first.
    expect(resolveCredentialClass("GET", "/agents/11111111-1111-1111-1111-111111111111/configuration")).toBe("agent");
    expect(resolveCredentialClass("GET", "/agents/11111111-1111-1111-1111-111111111111/instructions-bundle")).toBe("board");
    expect(client).toBeInstanceOf(PaperclipApiClient);
  });
});

describe("board escalation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function denyNonBoard(allowBoard: boolean) {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization ?? "";
      seen.push(auth);
      const ok = auth.includes("token-board") && allowBoard;
      return Promise.resolve(new Response(JSON.stringify(ok ? { ok: true } : { error: "Board access required" }), {
        status: ok ? 200 : 403,
        headers: { "Content-Type": "application/json" },
      }));
    }));
    return seen;
  }

  it("retries a denied read with the Board credential and returns its result", async () => {
    const seen = denyNonBoard(true);
    const res = await makeClient().requestJson<{ ok: boolean }>("GET", "/agents/11111111-1111-1111-1111-111111111111/configuration");
    expect(res.ok).toBe(true);
    expect(seen).toEqual(["Bearer token-agent", "Bearer token-board"]);
  });

  it("remembers a promoted route instead of asking twice", async () => {
    const seen = denyNonBoard(true);
    const client = makeClient();
    await client.requestJson("GET", "/agents/11111111-1111-1111-1111-111111111111/config-revisions");
    await client.requestJson("GET", "/agents/11111111-1111-1111-1111-111111111111/config-revisions");
    expect(seen).toEqual(["Bearer token-agent", "Bearer token-board", "Bearer token-board"]);
  });

  it("does not escalate an issue-scoped write - the author of the audit trail stays the caller", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      seen.push((init.headers as Record<string, string>).Authorization);
      return Promise.resolve(new Response(JSON.stringify({ error: "nope" }), { status: 403, headers: { "Content-Type": "application/json" } }));
    }));
    const client = new PaperclipApiClient({
      apiUrl: "http://localhost:3100/api",
      apiKey: "token-caller",
      companyId: "11111111-1111-1111-1111-111111111111",
      agentId: "22222222-2222-2222-2222-222222222222",
      // A live run context keeps the issue write on the caller's credential.
      runId: "33333333-3333-4333-8333-333333333333",
      agentApiKey: "token-agent",
      boardApiKey: "token-board",
    });
    await expect(
      client.requestJson("POST", "/issues/11111111-1111-1111-1111-111111111111/comments", { body: { body: "hi" } }),
    ).rejects.toBeInstanceOf(PaperclipApiError);
    expect(seen).toEqual(["Bearer token-caller"]);
  });

  it("reports both denials when the Board credential is refused too", async () => {
    denyNonBoard(false);
    // A route that no earlier test promoted - the promotion cache is
    // module-level and a promoted route skips the retry by design.
    await expect(makeClient().requestJson("GET", "/execution-workspaces/11111111-1111-1111-1111-111111111111")).rejects.toThrow(/boardRetry=denied/);
  });
});
