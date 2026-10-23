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
        url: url.pathname,
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
    "/api/v1/comments/project-1.feature-branch",
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
