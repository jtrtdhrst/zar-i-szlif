// Board fallback matrix for issue-scoped writes without a live run.
// Every AGENT_ISSUE_RUN_MATRIX route must, with a board key and no run,
// go out with Bearer board (no X-Paperclip-Run-Id); without a board key it
// must fail closed locally with RUN_CONTEXT_REQUIRED and zero fetches.
// Covers the KOMAA-793 class: PATCH owner/review + interaction accept/reject/cancel.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaperclipApiClient, PaperclipApiError } from "./client.js";
import { createToolDefinitions } from "./tools.js";
import { formatErrorResponse } from "./format.js";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const CALLER = "22222222-2222-2222-2222-222222222222";
const ISSUE = "44444444-4444-4444-8444-444444444444";
const IID = "55555555-5555-4555-8555-555555555555";
const REV = "66666666-6666-4666-8666-666666666666";

const ROUTES: Array<[string, string, unknown]> = [
  ["PATCH", `/issues/${ISSUE}`, { title: "x" }],
  ["POST", `/issues/${ISSUE}/comments`, { body: "hi" }],
  ["POST", `/issues/${ISSUE}/interactions`, { kind: "request_confirmation" }],
  ["POST", `/issues/${ISSUE}/interactions/${IID}/accept`, { selectedOptionIds: ["a"] }],
  ["POST", `/issues/${ISSUE}/interactions/${IID}/reject`, { reason: "r" }],
  ["POST", `/issues/${ISSUE}/interactions/${IID}/cancel`, {}],
  ["POST", `/issues/${ISSUE}/interactions/${IID}/skip`, {}],
  ["POST", `/issues/${ISSUE}/checkout`, { agentId: CALLER }],
  ["POST", `/issues/${ISSUE}/release`, {}],
  ["POST", `/issues/${ISSUE}/recovery-actions/resolve`, { outcome: "restored" }],
  ["PUT", `/issues/${ISSUE}/documents/plan`, { body: "x" }],
  ["POST", `/issues/${ISSUE}/documents/plan/revisions/${REV}/restore`, {}],
  ["POST", `/issues/${ISSUE}/approvals`, { approvalId: REV }],
  ["DELETE", `/issues/${ISSUE}/approvals/${REV}`, undefined],
];

function mockFetch() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }),
  );
  return calls;
}

const headersOf = (call: { init: RequestInit }) =>
  call.init.headers as Record<string, string>;

function boardClient() {
  return new PaperclipApiClient({
    apiUrl: "http://localhost:3100/api",
    apiKey: "token-agent",
    companyId: COMPANY,
    agentId: CALLER,
    runId: null,
    agentApiKey: null,
    boardApiKey: "token-board",
  });
}

describe("board fallback for issue-scoped writes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each(ROUTES)("%s %s goes out with the board key when no run", async (method, path, body) => {
    const calls = mockFetch();
    await boardClient().requestJson(method, path, body === undefined ? {} : { body });
    // The write call is the one under test; the KOMAA-468 checkout guard may
    // read the issue/workspace before it.
    const writes = calls.filter((call) => (call.init.method ?? "GET").toUpperCase() === method.toUpperCase());
    expect(writes).toHaveLength(1);
    expect(headersOf(writes[0]).Authorization).toBe("Bearer token-board");
    expect(headersOf(writes[0])["X-Paperclip-Run-Id"]).toBeUndefined();
  });

  it.each(ROUTES)("%s %s fails closed without a board key", async (method, path, body) => {
    const calls = mockFetch();
    const client = new PaperclipApiClient({
      apiUrl: "http://localhost:3100/api",
      apiKey: "token-agent",
      companyId: COMPANY,
      agentId: CALLER,
      runId: null,
      agentApiKey: null,
      boardApiKey: null,
    });
    let error: Error | null = null;
    try {
      await client.requestJson(method, path, body === undefined ? {} : { body });
    } catch (e) {
      error = e as Error;
    }
    expect(error?.message).toContain("[errorCode=RUN_CONTEXT_REQUIRED]");
    expect(calls).toHaveLength(0);
  });

  it("registers the cancel tool for interactions without accept/reject", () => {
    const defs = createToolDefinitions(boardClient());
    const cancel = defs.find((d) => d.name === "paperclipCancelIssueInteraction");
    expect(cancel?.description).toMatch(/ask_user_questions/);
    const accept = defs.find((d) => d.name === "paperclipAcceptInteraction");
    const reject = defs.find((d) => d.name === "paperclipRejectInteraction");
    expect(accept?.description).toMatch(/paperclipCancelIssueInteraction/);
    expect(reject?.description).toMatch(/paperclipCancelIssueInteraction/);
  });

  it("points 422 kind-impossibility at cancel instead of arg retry", () => {
    const res = formatErrorResponse(
      new PaperclipApiError({
        status: 422,
        method: "POST",
        path: `/issues/${ISSUE}/interactions/${IID}/accept`,
        body: { error: "Interactions of kind ask_user_questions cannot be accepted" },
        message: "POST /issues/x/interactions/y/accept failed with 422: Interactions of kind ask_user_questions cannot be accepted",
      }),
    );
    const parsed = JSON.parse(String(res.content[0]?.text ?? "{}"));
    expect(parsed.code).toBe("INVALID_ARGUMENTS");
    expect(parsed.requiredAction).toMatch(/paperclipCancelIssueInteraction/);
    expect(parsed.retryable).toBe(false);
  });

  it("keeps generic guidance for ordinary 422 argument errors", () => {
    const res = formatErrorResponse(
      new PaperclipApiError({
        status: 422,
        method: "POST",
        path: `/issues/${ISSUE}/comments`,
        body: { error: "Validation error" },
        message: "POST /issues/x/comments failed with 422: Validation error",
      }),
    );
    const parsed = JSON.parse(String(res.content[0]?.text ?? "{}"));
    expect(parsed.code).toBe("INVALID_ARGUMENTS");
    expect(parsed.requiredAction).not.toMatch(/paperclipCancelIssueInteraction/);
  });
});
