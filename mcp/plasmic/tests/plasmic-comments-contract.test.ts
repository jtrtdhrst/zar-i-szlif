import assert from "node:assert/strict";
import test from "node:test";
import { PlasmicClient } from "../libs/plasmic-client/client.ts";
import { plasmicCommentTools } from "../services/plasmic-mcp/comment-tools.ts";

// Based on plasmicapp/plasmic WAB routes/comments.ts and ApiSchema.ts.
// Fixtures are local; no real project, secrets, or WAB network is used.
const fixture = () => ({
  threads: [
    {
      id: "thread-1", resolved: false,
      location: {
        subject: { iid: "elem-iid-a", uuid: "elem-uuid-a" },
        variants: [{ iid: "variant-iid", uuid: "variant-uuid" }],
      },
      createdAt: "2026-10-20T10:00:00Z",
      comments: [
        { id: "c1", body: "Increase the card padding on mobile", createdById: "u1", createdAt: "2026-10-20T10:00:00Z", commentThreadId: "thread-1" },
        { id: "c2", body: "", deletedAt: "2026-10-21T10:00:00Z", commentThreadId: "thread-1" },
      ],
    },
    {
      id: "thread-2", resolved: true,
      location: { subject: { iid: "elem-iid-b", uuid: "elem-uuid-b" }, variants: [] },
      comments: [{ id: "c3", body: "Approved", createdById: "u2", commentThreadId: "thread-2" }],
    },
  ],
  reactions: [{ id: "reaction-1", commentId: "c1", createdById: "u1" }],
  users: [
    { id: "u1", firstName: "Jan", lastName: "Kowalski", email: "private@example.com" },
    { id: "u2", name: "Reviewer", email: "other-private@example.com" },
    { id: "u3", firstName: "Unrelated", email: "uninvolved@example.com" },
  ],
});

function setup(body: unknown = fixture(), status = 200) {
  const requests: Array<{ url: string; method: string; token?: string }> = [];
  const client = new PlasmicClient({
    baseUrl: "https://wab.fixture.invalid",
    teamToken: "test-token-no-production-secret",
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      const headers = init?.headers as Record<string, string>;
      requests.push({
        url: decodeURIComponent(url.pathname),
        method: init?.method ?? "GET",
        token: headers?.["x-plasmic-team-token"],
      });
      return new Response(JSON.stringify(body), {
        status, headers: { "content-type": "application/json" },
      });
    },
  });
  const tools = plasmicCommentTools({ client, stateDir: "/unused", auditFile: "/unused/audit" });
  return {
    client, tools, requests,
    list: tools.find((t) => t.name === "plasmic_list_comments")!,
    element: tools.find((t) => t.name === "plasmic_get_element_comments")!,
  };
}

test("read-only WAB comments are scoped to project main or exact Plasmic design branch", async () => {
  const { client, requests } = setup();
  const a = await client.getComments("project-1");
  assert.equal(a.threads.length, 2);
  await client.getComments("project-1", "feature-branch");
  assert.deepEqual(requests.map((r) => r.url), [
    "/api/v1/comments/project-1",
    "/api/v1/comments/project-1@feature-branch",
  ]);
  assert.ok(requests.every((r) => r.method === "GET"));
  assert.ok(requests.every((r) => r.token === "test-token-no-production-secret"));
  await assert.rejects(client.getComments(""), /INVALID_COMMENT_PROJECT_BRANCH/);
  await assert.rejects(client.getComments("project-1", " "), /INVALID_COMMENT_PROJECT_BRANCH/);
  assert.equal(requests.length, 2, "invalid IDs must not cause remote calls");
});

test("AI list returns replies, precise element addresses, safe author names and filters", async () => {
  const { list, requests } = setup();
  assert.equal(list.annotations?.readOnlyHint, true);
  const result = await list.handler({ projectId: "project-1" }) as Record<string, any>;
  assert.equal(result.threadCount, 1);
  assert.equal(result.threads[0].threadId, "thread-1");
  assert.deepEqual(result.threads[0].subject, { iid: "elem-iid-a", uuid: "elem-uuid-a" });
  assert.deepEqual(result.threads[0].variants, [{ iid: "variant-iid", uuid: "variant-uuid" }]);
  assert.equal(result.threads[0].comments.length, 1);
  assert.equal(result.threads[0].comments[0].body, "Increase the card padding on mobile");
  assert.equal(result.threads[0].comments[0].authorName, "Jan Kowalski");
  assert.ok(!JSON.stringify(result).includes("private@example.com"));
  assert.ok(!JSON.stringify(result).includes("uninvolved@example.com"));
  assert.ok(requests.every((r) => r.method === "GET"));
  const everything = await list.handler({ projectId: "project-1", includeResolved: true, includeDeleted: true }) as Record<string, any>;
  assert.equal(everything.threadCount, 2);
  assert.equal(everything.threads[0].comments.length, 2);
  assert.deepEqual(everything.threads[0].comments[1].body, "");
  assert.equal(everything.threads[0].comments[1].deleted, true);
  assert.equal(everything.threads[1].resolved, true);
  const page = await list.handler({
    projectId: "project-1", includeResolved: true, limit: 1, offset: 1,
  }) as Record<string, any>;
  assert.equal(page.threadCount, 2);
  assert.equal(page.threads.length, 1);
  assert.equal(page.threads[0].threadId, "thread-2");
  assert.equal(page.hasMore, false);
  const firstPage = await list.handler({
    projectId: "project-1", includeResolved: true, limit: 1,
  }) as Record<string, any>;
  assert.equal(firstPage.threadCount, 2);
  assert.equal(firstPage.threads.length, 1);
  assert.equal(firstPage.hasMore, true);
});

test("element tool exact-match filters using IID and/or UUID; never fuzzy-matches", async () => {
  const { element } = setup();
  assert.equal(element.annotations?.readOnlyHint, true);
  await assert.rejects(element.handler({ projectId: "p" }), /ELEMENT_ID_REQUIRED/);
  const a = await element.handler({ projectId: "p", elementIid: "elem-iid-a" }) as Record<string, any>;
  assert.equal(a.threadCount, 1);
  const b = await element.handler({ projectId: "p", elementUuid: "elem-uuid-b", includeResolved: true }) as Record<string, any>;
  assert.equal(b.threadCount, 1);
  assert.equal(b.threads[0].threadId, "thread-2");
  const none = await element.handler({
    projectId: "p", elementIid: "elem-iid-a", elementUuid: "elem-uuid-b",
    includeResolved: true,
  }) as Record<string, any>;
  assert.equal(none.threadCount, 0);
});

test("403 or wrong WAB comments shape fails closed; no empty success invented", async () => {
  const denied = setup({ error: "forbidden" }, 403);
  await assert.rejects(denied.list.handler({ projectId: "p" }), /Plasmic 403/);
  const wrong = setup({ threads: {}, users: [], reactions: [] });
  await assert.rejects(wrong.list.handler({ projectId: "p" }), /COMMENTS_RESPONSE_INVALID/);
  const badLoc = setup({
    ...fixture(),
    threads: [{ id: "broken", resolved: false, comments: [], location: { subject: { iid: "x" }, variants: [] } }],
  });
  await assert.rejects(badLoc.element.handler({ projectId: "p", elementIid: "x" }), /COMMENTS_RESPONSE_INVALID/);
});

test("branch-scoped project reads use the real WAB @ separator", async () => {
  const seen: string[] = [];
  const client = new PlasmicClient({
    baseUrl: "https://wab.fixture.invalid",
    teamToken: "test-token",
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      seen.push(decodeURIComponent(url.pathname));
      return new Response(JSON.stringify({
        rev: { id: "rev-1", revision: 7, data: JSON.stringify({ map: {} }) },
        project: { id: "project-1", name: "P" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  await client.getProjectRev("project-1", "feature-branch");
  assert.deepEqual(seen, ["/api/v1/projects/project-1@feature-branch"]);
});

test("expired WAB session re-authenticates once and retries the read", async () => {
  let commentsCalls = 0;
  let logins = 0;
  const client = new PlasmicClient({
    baseUrl: "https://wab.fixture.invalid",
    email: "agent@example.invalid",
    password: "not-a-real-secret",
    fetchImpl: async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/v1/auth/csrf") {
        return new Response(JSON.stringify({ csrf: "csrf" }), { status: 200 });
      }
      if (path === "/api/v1/auth/login") {
        logins++;
        return new Response(JSON.stringify({ status: true }), { status: 200 });
      }
      if (path === "/api/v1/comments/project-1") {
        commentsCalls++;
        if (commentsCalls === 1) {
          return new Response(JSON.stringify({ error: { message: "Must be a normal user" } }), { status: 403 });
        }
        return new Response(JSON.stringify(fixture()), { status: 200 });
      }
      throw new Error(`unexpected ${path}`);
    },
  });
  const res = await client.getComments("project-1");
  assert.equal(res.threads.length, 2);
  assert.equal(logins, 2, "a lost session is replaced exactly once");
  assert.equal(commentsCalls, 2, "the read is retried exactly once");
});

test("expired session on a write is not transparently replayed", async () => {
  let posts = 0;
  let logins = 0;
  const client = new PlasmicClient({
    baseUrl: "https://wab.fixture.invalid",
    email: "agent@example.invalid",
    password: "not-a-real-secret",
    fetchImpl: async (input, init) => {
      const path = new URL(String(input)).pathname;
      const method = (init?.method ?? "GET").toUpperCase();
      if (path === "/api/v1/auth/csrf") {
        return new Response(JSON.stringify({ csrf: "csrf" }), { status: 200 });
      }
      if (path === "/api/v1/auth/login") {
        logins++;
        return new Response(JSON.stringify({ status: true }), { status: 200 });
      }
      if (path === "/api/v1/projects" && method === "POST") {
        posts++;
        return new Response(JSON.stringify({ error: { message: "Must be a normal user" } }), { status: 403 });
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
  });
  await assert.rejects(client.createProject("x"), /session lost during POST/);
  assert.equal(posts, 1, "a possibly committed write must never be replayed");
  assert.equal(logins, 1, "only the initial explicit login ran");
});

test("a permanent authorization denial is retried once and still fails", async () => {
  let commentsCalls = 0;
  const client = new PlasmicClient({
    baseUrl: "https://wab.fixture.invalid",
    email: "agent@example.invalid",
    password: "not-a-real-secret",
    fetchImpl: async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/v1/auth/csrf") {
        return new Response(JSON.stringify({ csrf: "csrf" }), { status: 200 });
      }
      if (path === "/api/v1/auth/login") {
        return new Response(JSON.stringify({ status: true }), { status: 200 });
      }
      if (path === "/api/v1/comments/project-1") {
        commentsCalls++;
        return new Response(JSON.stringify({ error: { message: "Must be a normal user" } }), { status: 403 });
      }
      throw new Error(`unexpected ${path}`);
    },
  });
  await assert.rejects(client.getComments("project-1"), /Plasmic 403/);
  assert.equal(commentsCalls, 2, "no unbounded retry loop");
});
