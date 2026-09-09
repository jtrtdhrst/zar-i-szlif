import assert from "node:assert/strict";
import {
  aggregateRunAnalytics,
  buildModelTurns,
  buildOrderedSteps,
  buildRunAnalytics,
  classifyInvocation,
  classifyToolStep,
  compareRunMetrics,
  computeTimings,
  estimateTokens,
  supportedObservability,
} from "./run-analytics.mjs";

const LIMITS = { "opencode/x-preview-f-free": { context: 1000000, output: 131072 } };

function assistantMessage({ id, created, input, output = 10, reasoning = 0, cacheRead = 0, cacheWrite = 0, tools = [], text = "Done.", agent = "build", providerID = "opencode", modelID = "x-preview-f-free" }) {
  const parts = [{ id: `${id}-ss`, type: "step-start", snapshot: "s1" }];
  for (const tool of tools) {
    parts.push({ id: `${id}-${tool.name}-${tool.start}`, type: "tool", callID: `call_${id}_${tool.name}`, tool: tool.name, state: { status: tool.status || "completed", title: tool.title || "", input: {}, metadata: { output: tool.output }, time: { start: tool.start, end: tool.end ?? (tool.start || 0) + 100 } } });
  }
  parts.push({ id: `${id}-txt`, type: "text", text });
  parts.push({ id: `${id}-sf`, type: "step-finish", reason: tools.length ? "tool-calls" : "stop", cost: 0, tokens: { total: input + output + reasoning, input, output, reasoning, cache: { read: cacheRead, write: cacheWrite } } });
  return { info: { id, sessionID: "ses_fixture", role: "assistant", time: { created }, providerID, modelID, agent, mode: agent, cost: 0, tokens: { total: input + output + reasoning, input, output, reasoning, cache: { read: cacheRead, write: cacheWrite } } }, parts };
}

function userMessage({ id, created, text }) {
  return { info: { id, sessionID: "ses_fixture", role: "user", time: { created } }, parts: [{ id: `${id}-t`, type: "text", text }] };
}

function emptyRun(overrides = {}) {
  return { runId: "ses_fixture", paperclipIssueId: null, status: "completed", createdAt: new Date(1787594700000).toISOString(), finishedAt: new Date(1787594800000).toISOString(), events: [], retries: 0, ...overrides };
}

// 1. Simple inference: real provider/model identity and exact provider-reported tokens.
{
  const messages = [userMessage({ id: "msg_u1", created: 1787594700000, text: "Zwróć PASS".repeat(8) }), assistantMessage({ id: "msg_a1", created: 1787594705000, input: 34082, output: 140, reasoning: 38 })];
  const turns = buildModelTurns(messages, { modelLimits: LIMITS });
  assert.equal(turns.length, 1);
  assert.equal(turns[0].providerId, "opencode");
  assert.equal(turns[0].modelId, "x-preview-f-free");
  assert.equal(turns[0].inputTokens.value, 34082);
  assert.equal(turns[0].outputTokens.value, 178);
  assert.equal(turns[0].inputTokens.measurementSource, "provider_reported");
  assert.equal(turns[0].contextWindowTokens.value, 1000000);
  assert.ok(Math.abs(turns[0].contextUtilizationPct.value - 3.4082) < 0.01);
  assert.equal(turns[0].contextBreakdown.systemTokens.value, null);
  assert.equal(turns[0].contextBreakdown.systemTokens.measurementSource, "unavailable");
  assert.ok(turns[0].contextBreakdown.taskTokens.value > 0);
  assert.equal(turns[0].contextBreakdown.taskTokens.measurementSource, "locally_tokenized");
  console.log("Scenario simple inference (provider identity, tokens, context window): PASS");
}

// 2. Run with shell command and file read: ordered steps, useful action timing.
{
  const t0 = 1787594705000;
  const messages = [
    userMessage({ id: "msg_u2", created: t0 - 1000, text: "Przeczytaj package.json i uruchom testy" }),
    assistantMessage({ id: "msg_a2", created: t0, input: 12000, output: 50, tools: [
      { name: "read", title: "package.json", start: t0 + 2000, end: t0 + 2200, output: '{"name":"x"}'.repeat(32) },
      { name: "bash", title: "npm run test:all", start: t0 + 3000, end: t0 + 9000, output: "all tests passed" },
    ] }),
  ];
  const run = emptyRun({ createdAt: new Date(t0).toISOString(), finishedAt: new Date(t0 + 20000).toISOString() });
  const turns = buildModelTurns(messages, { modelLimits: LIMITS });
  const steps = buildOrderedSteps(run, messages, turns);
  const types = steps.map((step) => step.stepType);
  assert.deepEqual(types.filter((type) => type !== "model_turn"), ["file_read", "test_build"]);
  const timings = computeTimings(run, steps, turns);
  assert.equal(timings.timeToFirstToolCallMs.value, 2000);
  assert.equal(timings.timeToFirstFileWriteMs.value, null);
  assert.equal(timings.timeToFirstUsefulActionMs.value, 3000);
  assert.equal(timings.finalDisposition, "completed");
  console.log("Scenario shell/file-read run (ordered steps, timings): PASS");
}

// 3. MCP tool call classification and tool-result token attribution.
{
  assert.equal(classifyToolStep("mcp_nocobase_list_records"), "mcp_tool_call");
  assert.equal(classifyToolStep("bash", "git status --short"), "git_operation");
  assert.equal(classifyToolStep("bash", "node --check server.mjs"), "test_build");
  assert.equal(classifyToolStep("bash", "npm run build"), "shell_command");
  assert.equal(classifyToolStep("grep"), "search");
  assert.equal(classifyToolStep("edit"), "file_write");
  console.log("Scenario MCP tool + step-type classification: PASS");
}

// 4. Continuation of the same OpenCode session.
{
  const t0 = 1787594800000;
  const messages = [
    userMessage({ id: "msg_u0", created: t0 - 60000, text: "starsze zadanie" }),
    assistantMessage({ id: "msg_a0", created: t0 - 55000, input: 900, output: 5 }),
    userMessage({ id: "msg_u1", created: t0 - 1000, text: "kontynuacja" }),
    assistantMessage({ id: "msg_a1", created: t0 + 500, input: 15000, output: 20 }),
  ];
  const run = emptyRun({ createdAt: new Date(t0).toISOString() });
  const turns = buildModelTurns(messages, { modelLimits: LIMITS, taskBoundaryMs: t0 });
  const invocation = classifyInvocation(run, messages, turns);
  assert.equal(invocation.invocationKind, "continuation_same_session");
  assert.equal(turns.length, 2);
  assert.ok(turns[1].contextBreakdown.historyTokens.value > 0);
  console.log("Scenario continuation of same session: PASS");
}

// 5. Provider/process failure retry classification.
{
  const run = emptyRun({ status: "failed", events: [{ kind: "error", errorCode: "PROCESS_LOST", status: "error", timestamp: new Date().toISOString(), retry: 1 }] });
  const invocation = classifyInvocation(run, [], []);
  assert.equal(invocation.invocationKind, "retry_after_failure");
  assert.match(invocation.signals.join("|"), /PROCESS_LOST/);
  console.log("Scenario provider/process failure retry: PASS");
}

// 6. Honesty contract: no fake supportedObservability, explicit nulls.
{
  const turns = [];
  const observability = supportedObservability(turns, {}, {});
  for (const [key, entry] of Object.entries(observability.supportedObservability)) {
    if (!entry.available) assert.equal(entry.measurementSource, "unavailable", key);
  }
  assert.equal(observability.supportedObservability.contextBreakdownExact.available, false);
  assert.equal(observability.supportedObservability.exactTimeToFirstModelToken.available, false);
  console.log("Honesty contract (no false positives in supportedObservability): PASS");
}

// 7. Compare and aggregate over mixed runs.
{
  const baseMessages = [userMessage({ id: "msg_u", created: 1787594700000, text: "task" }), assistantMessage({ id: "msg_a", created: 1787594705000, input: 30000, output: 100 })];
  const heavyRun = emptyRun({ runId: "ses_heavy" });
  const lightRun = emptyRun({ runId: "ses_light" });
  const heavy = buildRunAnalytics(heavyRun, baseMessages, { modelLimits: LIMITS });
  const lightAnalytics = buildRunAnalytics(lightRun, [userMessage({ id: "msg_u", created: 1787594700000, text: "task" }), assistantMessage({ id: "msg_a", created: 1787594705000, input: 8000, output: 40 })], { modelLimits: LIMITS });
  const comparison = compareRunMetrics([heavy, lightAnalytics]);
  assert.equal(comparison.moreContextOverheadRunId, "ses_heavy");
  assert.match(comparison.comparisonBasis, /nonTaskInputTokens/);
  const aggregate = aggregateRunAnalytics([heavy, lightAnalytics]);
  assert.equal(aggregate.runCount, 2);
  assert.equal(aggregate.totalInputTokens, 38000);
  assert.ok(aggregate.p95TimeToFirstUsefulActionMs === null || typeof aggregate.p95TimeToFirstUsefulActionMs === "number");
  assert.equal(aggregate.p50TokensBeforeFirstUsefulAction, null);
  console.log("Compare runs + aggregates (overhead winner, p50/p95, honest nulls): PASS");
}

// estimateTokens sanity
assert.equal(estimateTokens(""), 0);
assert.equal(estimateTokens("a".repeat(9)), 3);

console.log("run-analytics regression suite: ALL PASS");
