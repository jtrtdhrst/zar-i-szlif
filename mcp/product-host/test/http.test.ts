import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createAuthenticator } from "../src/auth.ts";
import type { Config } from "../src/config.ts";
import { createApp } from "../src/http.ts";
import { createLogger } from "../src/logger.ts";
import { createSprawnoscRepository } from "../src/supabase.ts";
import { createFetchStub, sampleRow, type StubHandler } from "./helpers/postgrest.ts";
import { TEST_SECRET, TEST_USER_ID, signToken, validClaims, validToken } from "./helpers/jwt.ts";

const config: Config = {
  port: 8080,
  publicOrigin: "https://mcp.zariszlif.pl",
  // Deliberately different from the public origin: self-hosted Supabase serves
  // PostgREST on an internal Docker alias that no MCP client can resolve.
  supabaseUrl: "http://api-gw-r2gnunvpkqwmuew1tupbf7lx:8000",
  supabasePublicUrl: "https://supabase-staging.example.test",
  supabasePublicUrlSource: "explicit",
  supabaseAnonKey: "anon-key-for-tests",
  jwtSecret: TEST_SECRET,
  jwtIssuer: undefined,
  logLevel: "debug",
};

interface Harness {
  origin: string;
  logs: string[];
  calls: Array<{ url: string; init: RequestInit }>;
}

async function withApp(handler: StubHandler, run: (harness: Harness) => Promise<void>): Promise<void> {
  const stub = createFetchStub(handler);
  const logs: string[] = [];
  const app = createApp({
    config,
    logger: createLogger("debug", (line) => logs.push(line)),
    authenticate: createAuthenticator({ secret: TEST_SECRET }),
    repository: createSprawnoscRepository({
      config: { url: config.supabaseUrl, anonKey: config.supabaseAnonKey },
      fetchImpl: stub.fetchImpl,
    }),
  });
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  const { port } = app.address() as AddressInfo;
  try {
    await run({ origin: `http://127.0.0.1:${port}`, logs, calls: stub.calls });
  } finally {
    await new Promise<void>((resolve) => app.close(() => resolve()));
  }
}

function mcpPost(origin: string, body: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return fetch(`${origin}/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
}

const initializeBody = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "product-host-contract-test", version: "0.1.0" },
  },
};

test("a valid Supabase token can initialize, list tools and read the catalog", async () => {
  await withApp(
    () => ({ body: [sampleRow()] }),
    async ({ origin, calls }) => {
      const token = validToken();

      const initialize = await mcpPost(origin, initializeBody, token);
      assert.equal(initialize.status, 200);
      const initializeJson = (await initialize.json()) as {
        result?: { serverInfo?: { name?: string; version?: string } };
      };
      assert.equal(initializeJson.result?.serverInfo?.name, "zar-i-szlif-product-host-mcp");

      const toolsResponse = await mcpPost(origin, { jsonrpc: "2.0", id: 2, method: "tools/list" }, token);
      assert.equal(toolsResponse.status, 200);
      const toolsJson = (await toolsResponse.json()) as { result?: { tools?: Array<{ name: string }> } };
      assert.deepEqual(
        toolsJson.result?.tools?.map((tool) => tool.name).sort(),
        ["get_sprawnosc", "list_sprawnosci"],
      );

      const callResponse = await mcpPost(
        origin,
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "list_sprawnosci", arguments: { query: "ogień", limit: 3, offset: 0 } },
        },
        token,
      );
      assert.equal(callResponse.status, 200);
      const callJson = (await callResponse.json()) as {
        result?: { isError?: boolean; content?: Array<{ type: string; text: string }> };
      };
      assert.equal(callJson.result?.isError, undefined);
      const payload = JSON.parse(callJson.result?.content?.[0]?.text ?? "{}") as {
        items: Array<{ tytul: string }>;
        count: number;
        limit: number;
        offset: number;
      };
      assert.equal(payload.count, 1);
      assert.equal(payload.limit, 3);
      assert.equal(payload.offset, 0);
      assert.equal(payload.items[0]?.tytul, "Rozpalanie ognia");

      assert.equal(calls.length, 1);
      const forwarded = calls[0];
      assert.ok(forwarded);
      assert.equal((forwarded.init.headers as Record<string, string>).authorization, `Bearer ${token}`);
      assert.match(forwarded.url, /tytul\.ilike\.\*ogie%C5%84\*/);
      assert.match(forwarded.url, /limit=3/);
    },
  );
});

test("get_sprawnosc returns a tool error when the record is absent", async () => {
  await withApp(
    () => ({ body: [] }),
    async ({ origin }) => {
      const response = await mcpPost(
        origin,
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "get_sprawnosc", arguments: { id: "00000000-0000-4000-8000-000000000000" } },
        },
        validToken(),
      );
      const json = (await response.json()) as {
        result?: { isError?: boolean; content?: Array<{ text: string }> };
      };
      assert.equal(json.result?.isError, true);
      assert.match(json.result?.content?.[0]?.text ?? "", /not found/);
    },
  );
});

test("a PostgREST failure becomes a tool error, not a crash or a token leak", async () => {
  await withApp(
    () => ({ status: 500, body: { message: "internal database error" } }),
    async ({ origin }) => {
      const token = validToken();
      const response = await mcpPost(
        origin,
        {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: { name: "list_sprawnosci", arguments: {} },
        },
        token,
      );
      const json = (await response.json()) as {
        result?: { isError?: boolean; content?: Array<{ text: string }> };
      };
      assert.equal(json.result?.isError, true);
      const text = json.result?.content?.[0]?.text ?? "";
      assert.match(text, /500/);
      assert.equal(text.includes(token), false);
    },
  );
});

test("missing token is rejected with an RFC 9728 challenge and no upstream call", async () => {
  await withApp(
    () => ({ body: [] }),
    async ({ origin, calls }) => {
      const response = await mcpPost(origin, initializeBody);
      assert.equal(response.status, 401);
      assert.equal(
        response.headers.get("www-authenticate"),
        'Bearer resource_metadata="https://mcp.zariszlif.pl/.well-known/oauth-protected-resource"',
      );
      const json = (await response.json()) as { error?: string };
      assert.equal(json.error, "invalid_token");
      assert.equal(calls.length, 0);
    },
  );
});

test("expired, forged, wrong-audience and alg:none tokens are all rejected", async () => {
  await withApp(
    () => ({ body: [] }),
    async ({ origin, calls, logs }) => {
      const now = Math.floor(Date.now() / 1000);
      const tokens = {
        expired: signToken(validClaims({ iat: now - 7200, exp: now - 10 })),
        forged: signToken(validClaims(), { secret: "not-the-deployment-secret" }),
        wrongAudience: signToken(validClaims({ aud: "anon" })),
        algNone: `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${Buffer.from(
          JSON.stringify(validClaims()),
        ).toString("base64url")}.`,
      };

      for (const [name, token] of Object.entries(tokens)) {
        const response = await mcpPost(origin, initializeBody, token);
        assert.equal(response.status, 401, `${name} token must be rejected`);
        assert.ok(response.headers.get("www-authenticate")?.includes("resource_metadata"));
        assert.equal(logs.join("\n").includes(token), false, `${name} token leaked into logs`);
      }

      // A structurally valid token signed with the deployment secret still works,
      // proving the rejections above are about the token and not the endpoint.
      const ok = await mcpPost(origin, initializeBody, validToken());
      assert.equal(ok.status, 200);
      assert.equal(calls.length, 0);
    },
  );
});

test("GET and DELETE on /mcp are 405 and no other route is exposed", async () => {
  await withApp(
    () => ({ body: [] }),
    async ({ origin }) => {
      for (const method of ["GET", "DELETE", "PUT"]) {
        const response = await fetch(`${origin}/mcp`, { method });
        assert.equal(response.status, 405, `${method} /mcp`);
        assert.equal(response.headers.get("allow"), "POST");
      }
      const unknown = await fetch(`${origin}/admin`);
      assert.equal(unknown.status, 404);
      const sql = await fetch(`${origin}/rest/v1/sprawnosci`);
      assert.equal(sql.status, 404);
    },
  );
});

test("public endpoints expose health, service info and protected-resource metadata", async () => {
  await withApp(
    () => ({ body: [] }),
    async ({ origin }) => {
      const health = await fetch(`${origin}/health`);
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), {
        ok: true,
        name: "zar-i-szlif-product-host-mcp",
        version: "0.1.0",
      });

      const root = await fetch(`${origin}/`);
      assert.equal(root.status, 200);
      const rootJson = (await root.json()) as { mcp?: string };
      assert.equal(rootJson.mcp, "/mcp");

      const metadata = await fetch(`${origin}/.well-known/oauth-protected-resource`);
      assert.equal(metadata.status, 200);
      assert.deepEqual(await metadata.json(), {
        resource: "https://mcp.zariszlif.pl/mcp",
        // The advertised auth server must be the client-visible origin, never
        // the internal PostgREST URL used server-side.
        authorization_servers: ["https://supabase-staging.example.test/auth/v1"],
        bearer_methods_supported: ["header"],
        scopes_supported: ["openid", "email", "profile"],
      });
      assert.equal(
        JSON.stringify(await (await fetch(`${origin}/.well-known/oauth-protected-resource`)).json()).includes(
          "api-gw",
        ),
        false,
        "an internal Docker alias leaked into client-visible metadata",
      );
    },
  );
});

test("an authenticated but malformed JSON body is a 400", async () => {
  await withApp(
    () => ({ body: [] }),
    async ({ origin }) => {
      const response = await fetch(`${origin}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${validToken()}`,
        },
        body: "{not json",
      });
      assert.equal(response.status, 400);
    },
  );
});

test("the caller subject is never the service identity: each request forwards its own token", async () => {
  await withApp(
    () => ({ body: [sampleRow()] }),
    async ({ origin, calls }) => {
      const first = validToken();
      const second = validToken({ sub: "11111111-2222-4333-8444-555555555555" });
      await mcpPost(origin, { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "list_sprawnosci", arguments: {} } }, first);
      await mcpPost(origin, { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "list_sprawnosci", arguments: {} } }, second);
      assert.deepEqual(
        calls.map((call) => (call.init.headers as Record<string, string>).authorization),
        [`Bearer ${first}`, `Bearer ${second}`],
      );
      assert.equal(calls[0]?.url.includes(TEST_USER_ID), false, "actor id must not be injected into SQL-facing URLs");
    },
  );
});
