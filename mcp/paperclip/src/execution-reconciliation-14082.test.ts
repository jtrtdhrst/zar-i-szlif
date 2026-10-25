// Regression for upstream paperclipai/paperclip#14082 on 2026.1012.0.
// A settled automatic recovery with replay=blocked is NOT lifted by outcome
// alone; Board evidence must match the exact action and source run.
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaperclipApiClient, requiresBoardAuth } from "./client.js";
import { createControlPlaneTools } from "./control-plane.js";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const AGENT = "22222222-2222-2222-2222-222222222222";
const ISSUE = "44444444-4444-4444-8444-444444444444";
const ACTION = "66666666-6666-4666-8666-666666666666";
const FAILED_RUN = "77777777-7777-4777-8777-777777777777";
const CURRENT_RUN = "55555555-5555-5555-5555-555555555555";
const reconciliation = {
  runId: FAILED_RUN,
  providerStopped: true as const,
  actionOutcome: "mixed" as const,
  outcomeEvidence: "Inspected the stopped source run; original external actions are not replayed, and unverifiable effects remain documented.",
};
const input = {
  issueId: ISSUE,
  actionId: ACTION,
  outcome: "restored" as const,
  sourceIssueStatus: "todo" as const,
  executionReconciliation: reconciliation,
};
const issue = (blocker: unknown, status = "in_progress") =>
  ({ id: ISSUE, status, executionBlocker: blocker });
const blocker = { recoveryActionId: ACTION, runId: FAILED_RUN, cause: "legacy_execution_requires_reconciliation" };

function client(boardApiKey: string | null = "board-token") {
  return new PaperclipApiClient({
    apiUrl: "https://paperclip.example/api",
    apiKey: "agent-token",
    agentApiKey: "agent-token",
    boardApiKey, companyId: COMPANY, agentId: AGENT, runId: CURRENT_RUN,
  });
}
const tool = (c: PaperclipApiClient) => {
  const found = createControlPlaneTools(c).find(t => t.name === "paperclipResolveRecoveryAction");
  if (!found) throw new Error("Missing recovery resolution MCP tool");
  return found;
};
const run = async (c: PaperclipApiClient, args: Record<string, unknown>) => {
  const result = await tool(c).execute(args);
  return JSON.parse(String(result.content[0]?.text ?? "{}")) as Record<string, unknown>;
};

function mockSequence(states: unknown[]) {
  const calls: Array<{ method: string; url: string; auth: string; body: unknown }> = [];
  let reads = 0;
  const fake = vi.fn().mockImplementation((url: string, init: RequestInit) => {
    const method = String(init.method ?? "GET").toUpperCase();
    const auth = (init.headers as Record<string, string>).Authorization;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, auth, body });
    const payload = method === "GET" ? states[reads++] : { issue: issue(null, "todo"), recoveryAction: { id: ACTION, status: "resolved" } };
    return Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }));
  });
  vi.stubGlobal("fetch", fake);
  return calls;
}

describe("KOMAA-1459 exact Board recovery reconciliation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requires Board authority ONLY when an evidence-backed reconciliation is present", () => {
    const route = `/issues/${ISSUE}/recovery-actions/resolve`;
    expect(requiresBoardAuth("POST", route, { outcome: "restored", sourceIssueStatus: "todo" })).toBe(false);
    expect(requiresBoardAuth("POST", route, { ...input })).toBe(true);
    expect(requiresBoardAuth("POST", route, { outcome: "blocked", sourceIssueStatus: "blocked" })).toBe(false);
  });

  it("sends exact evidence under Board key and verifies both issue status and cleared blocker", async () => {
    const calls = mockSequence([issue(blocker), issue(null, "todo")]);
    const result = await run(client(), input);
    expect(result).toMatchObject({ reconciled: true, verified: true, reason: "execution_blocker_cleared" });
    const write = calls.find(x => x.method === "POST");
    expect(write?.auth).toBe("Bearer board-token");
    expect(write?.body).toMatchObject({ actionId: ACTION, outcome: "restored", sourceIssueStatus: "todo", executionReconciliation: reconciliation });
    expect(calls.filter(x => x.method === "GET")).toHaveLength(2);
  });

  it("refuses a false success when an older resolved action remains a blocker", async () => {
    const older = { ...blocker, recoveryActionId: "88888888-8888-4888-8888-888888888888" };
    mockSequence([issue(blocker), issue(older, "todo")]);
    const result = await run(client(), input);
    expect(result).toMatchObject({
      reconciled: false, verified: true,
      reason: "another_or_unsettled_execution_blocker_remains",
      remainingExecutionBlocker: older,
    });
  });

  it("does not POST when the action and source run are not the current blocker", async () => {
    const calls = mockSequence([issue({ ...blocker, runId: "99999999-9999-4999-8999-999999999999" })]);
    try { await run(client(), input); } catch { /* fail-closed errors may propagate */ }
    expect(calls.filter(x => x.method === "POST")).toHaveLength(0);
  });

  it("does not silently fall back to agent authority when Board key is unavailable", async () => {
    const calls = mockSequence([issue(blocker)]);
    try { await run(client(null), input); } catch { /* expected permission error */ }
    expect(calls.filter(x => x.method === "POST")).toHaveLength(0);
  });

  it("never reports a verified recovery if post-commit issue projection lacks blocker readback", async () => {
    mockSequence([issue(blocker), { id: ISSUE, status: "todo" }]);
    const result = await run(client(), input);
    expect(result).toMatchObject({ reconciled: false, verified: false, reason: "execution_blocker_readback_unavailable" });
  });
});
