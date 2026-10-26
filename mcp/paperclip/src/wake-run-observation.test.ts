// KOMAA-1415 (owner P0): a checkout/wake 200 is not proof that a run exists.
// Live WakeIssueFresh returned woke:true twice while the authoritative
// issue-bound run set stayed empty and status remained falsely in_progress.
// A skipped/deferred wake must report woke:false, reconcile the false
// in_progress (guarded by review/hold), and never leave a green wake behind.
//
// Also covers the advertised-but-absent GET /issues/:id/retry-eligibility
// (404 API route not found in Paperclip 2026.1012.0): the compat fallback must
// derive the same fail-closed decision from supported endpoints.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaperclipApiClient } from "./client.js";
import { createControlPlaneTools } from "./control-plane.js";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const AGENT = "22222222-2222-2222-2222-222222222222";
const TARGET = "33333333-3333-3333-3333-333333333333";
const ISSUE = "44444444-4444-4444-8444-444444444444";
const RUN = "55555555-5555-5555-5555-555555555555";

function makeClient(): PaperclipApiClient {
  return new PaperclipApiClient({
    apiUrl: "http://localhost:3100/api",
    apiKey: "token-123",
    companyId: COMPANY,
    agentId: AGENT,
    runId: RUN,
    agentApiKey: "token-agent",
    boardApiKey: "token-board",
  });
}

function getTool(name: string) {
  const tool = createControlPlaneTools(makeClient()).find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool;
}

async function runTool(name: string, input: Record<string, unknown>) {
  const res = await getTool(name).execute(input);
  return JSON.parse(String(res.content[0]?.text ?? "{}")) as Record<string, unknown>;
}

type Rule = { method: string; match: string; body: unknown; status?: number };

function mockRoutes(rules: Rule[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const method = String(init?.method ?? "GET").toUpperCase();
    const rule = rules.find((r) => r.method === method && String(url).includes(r.match));
    const body = rule ? rule.body : { error: `no mock for ${method} ${url}` };
    const status = rule?.status ?? (rule ? 200 : 500);
    return Promise.resolve(new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const bodyOf = (call: { init: RequestInit } | undefined) =>
  call ? JSON.parse(String(call.init.body ?? "{}")) as Record<string, unknown> : {};

describe("KOMAA-1415 wake verification", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("refuses to re-checkout a false in_progress and reconciles it to todo", async () => {
    const calls = mockRoutes([
      { method: "GET", match: "/issues/", body: { id: ISSUE, status: "in_progress", assigneeAgentId: TARGET, executionRunId: null, checkoutRunId: null } },
      { method: "GET", match: "/live-runs", body: [] },
      { method: "GET", match: "/diagnostics/blockers", body: { blockers: [] } },
      { method: "GET", match: "/documents", body: [] },
      { method: "GET", match: "/approvals", body: [] },
      { method: "PATCH", match: "/issues/", body: { id: ISSUE, status: "todo", assigneeAgentId: TARGET } },
    ]);

    const result = await runTool("paperclipWakeIssueFresh", { issueId: ISSUE });

    expect(result).toMatchObject({
      woke: false,
      checkoutAccepted: false,
      reason: "false_progress_requires_reconciliation",
      reconciledTo: "todo",
      reconcile: { reconciled: true, reason: "no_issue_bound_run_observed" },
    });
    const patch = calls.find((c) => String(c.init.method).toUpperCase() === "PATCH" && c.url.includes(ISSUE));
    expect(bodyOf(patch)).toMatchObject({ status: "todo" });
    expect(calls.some((c) => String(c.init.method).toUpperCase() === "POST" && c.url.includes("/checkout"))).toBe(false);
    expect(calls.some((c) => String(c.init.method).toUpperCase() === "POST" && c.url.includes("/comments"))).toBe(false);
  });

  it("never reconciles away a status that has live review attention", async () => {
    const calls = mockRoutes([
      { method: "GET", match: "/issues/", body: { id: ISSUE, status: "in_progress", assigneeAgentId: TARGET, executionRunId: null, checkoutRunId: null, reviewAttention: { state: "pending" } } },
      { method: "GET", match: "/live-runs", body: [] },
      { method: "GET", match: "/diagnostics/blockers", body: { blockers: [] } },
      { method: "GET", match: "/documents", body: [] },
      { method: "GET", match: "/approvals", body: [] },
      { method: "POST", match: "/checkout", body: { ok: true } },
    ]);

    const result = await runTool("paperclipWakeIssueFresh", { issueId: ISSUE });

    expect(result).toMatchObject({
      woke: false,
      reconcile: { reconciled: false, reason: "review_attention_present" },
      reconciledTo: null,
    });
    expect(calls.some((c) => String(c.init.method).toUpperCase() === "PATCH")).toBe(false);
  });
});

describe("KOMAA-1415 retry-eligibility compat fallback", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("falls back to supported endpoints when retry-eligibility returns 404 and only counts an observed run", async () => {
    const calls = mockRoutes([
      { method: "GET", match: "/retry-eligibility", body: { error: "API route not found" }, status: 404 },
      { method: "GET", match: `/issues/${ISSUE}/runs`, body: [{ id: "run-old", status: "failed", errorCode: "ADAPTER_START", finishedAt: "2026-10-23T10:00:00Z" }] },
      { method: "GET", match: "/issues/", body: { id: ISSUE, status: "todo", assigneeAgentId: TARGET, updatedAt: "2026-10-23T10:00:00Z" } },
      { method: "GET", match: "/live-runs", body: [] },
      { method: "GET", match: "/diagnostics/blockers", body: { blockers: [] } },
      { method: "GET", match: "/documents", body: [] },
      { method: "POST", match: "/checkout", body: { checkoutRunId: "run-new" } },
      { method: "GET", match: "/heartbeat-runs/run-new", body: { id: "run-new", status: "queued", issueId: ISSUE } },
      { method: "POST", match: "/retry-attempts", body: { ok: true } },
    ]);

    const result = await runTool("paperclipRetryWithCausalGate", { issueId: ISSUE });

    expect(result).toMatchObject({
      retried: true,
      retryReason: "first_retry_for_fingerprint",
      eligibilitySource: "mcp-compat-fallback",
      nativeRouteAvailable: false,
      wake: { woke: true, observedFrom: "heartbeat-run" },
    });
    expect(calls.some((c) => c.url.includes("/checkout"))).toBe(true);
  });

  it("keeps the circuit open for a repeated identical failure with no input delta and mints no run", async () => {
    const calls = mockRoutes([
      { method: "GET", match: "/retry-eligibility", body: { error: "API route not found" }, status: 404 },
      {
        method: "GET",
        match: `/issues/${ISSUE}/runs`,
        body: [
          { id: "run-retry", status: "failed", errorCode: "ADAPTER_START", finishedAt: "2026-10-23T11:00:00Z" },
          { id: "run-original", status: "failed", errorCode: "ADAPTER_START", finishedAt: "2026-10-23T10:00:00Z" },
        ],
      },
      { method: "GET", match: "/issues/", body: { id: ISSUE, status: "todo", assigneeAgentId: TARGET, updatedAt: "2026-10-23T11:00:00Z" } },
      { method: "GET", match: "/live-runs", body: [] },
      { method: "GET", match: "/diagnostics/blockers", body: { blockers: [] } },
      { method: "GET", match: "/documents", body: [] },
    ]);

    const result = await runTool("paperclipRetryWithCausalGate", { issueId: ISSUE });

    expect(result).toMatchObject({
      retried: false,
      circuitOpen: true,
      retryReason: "circuit_open_identical_state",
      eligibilitySource: "mcp-compat-fallback",
    });
    expect(calls.some((c) => c.url.includes("/checkout"))).toBe(false);
  });

  it("reopens the gate when the issue record changed after the repeated failure", async () => {
    const calls = mockRoutes([
      { method: "GET", match: "/retry-eligibility", body: { error: "API route not found" }, status: 404 },
      {
        method: "GET",
        match: `/issues/${ISSUE}/runs`,
        body: [
          { id: "run-retry", status: "failed", errorCode: "ADAPTER_START", finishedAt: "2026-10-23T11:00:00Z" },
          { id: "run-original", status: "failed", errorCode: "ADAPTER_START", finishedAt: "2026-10-23T10:00:00Z" },
        ],
      },
      { method: "GET", match: "/issues/", body: { id: ISSUE, status: "todo", assigneeAgentId: TARGET, updatedAt: "2026-10-23T12:00:00Z" } },
      { method: "GET", match: "/live-runs", body: [] },
      { method: "GET", match: "/diagnostics/blockers", body: { blockers: [] } },
      { method: "GET", match: "/documents", body: [] },
      { method: "POST", match: "/checkout", body: { checkoutRunId: "run-new" } },
      { method: "GET", match: "/heartbeat-runs/run-new", body: { id: "run-new", status: "running", issueId: ISSUE } },
      { method: "POST", match: "/retry-attempts", body: { ok: true } },
    ]);

    const result = await runTool("paperclipRetryWithCausalGate", { issueId: ISSUE });

    expect(result).toMatchObject({
      retried: true,
      retryReason: "execution_input_delta",
      causalDelta: expect.arrayContaining(["issue_updated_after_failure"]),
    });
    expect(calls.some((c) => c.url.includes("/checkout"))).toBe(true);
  });
});
