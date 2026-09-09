// Run analytics: pure, deterministic derivation of AI-run telemetry from
// existing OpenCode run/session/message metadata. No guessing: every numeric
// field carries a measurementSource of provider_reported | opencode_reported |
// locally_tokenized | unavailable, or is explicitly null.

export const MEASUREMENT_SOURCES = Object.freeze(["provider_reported", "opencode_reported", "locally_tokenized", "unavailable"]);

// Documented local estimator: ~4 characters per token. Used ONLY for fields
// labeled locally_tokenized; never mixed into provider-reported numbers.
export function estimateTokens(text) {
  if (typeof text !== "string" || !text.length) return 0;
  return Math.ceil(text.length / 4);
}

function num(value) { return Number.isFinite(Number(value)) ? Number(value) : null; }
function iso(value) {
  const ms = typeof value === "number" ? value : Date.parse(value || "");
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}
function unavailable(_field, reason) { return { value: null, measurementSource: "unavailable", reason }; }
function measured(value, source) { return { value, measurementSource: value === null ? "unavailable" : source }; }

export function normalizeSessionMessages(rawMessages) {
  const list = Array.isArray(rawMessages) ? rawMessages : [];
  const out = [];
  for (const entry of list) {
    const info = entry?.info && typeof entry.info === "object" ? entry.info : entry;
    if (!info || typeof info !== "object") continue;
    const parts = Array.isArray(entry?.parts) ? entry.parts : Array.isArray(info.parts) ? info.parts : [];
    out.push({ info, parts });
  }
  return out.sort((left, right) => (num(left.info.time?.created) || 0) - (num(right.info.time?.created) || 0));
}

function partText(part) {
  if (typeof part?.text === "string") return part.text;
  return "";
}

function toolOutputText(part) {
  const state = part?.state && typeof part.state === "object" ? part.state : {};
  const output = state.metadata?.output;
  if (typeof output === "string") return output;
  if (output == null) return "";
  try { return JSON.stringify(output); } catch { return String(output); }
}

const MCP_TOOL_PATTERN = /^(mcp[_-]|mcp__)|[._-]mcp[_-]/i;
const SEARCH_TOOLS = /^(grep|glob|find|webfetch|websearch|search)/i;
const WRITE_TOOLS = /^(write|edit|multiedit|patch|applypatch|notebookedit)/i;
const READ_TOOLS = /^(read|view|cat)/i;
const TEST_PATTERN = /test|--check|vitest|jest|pytest|playwright|lint/i;

export function classifyToolStep(toolName, title = "") {
  const source = `${toolName} ${title}`;
  if (MCP_TOOL_PATTERN.test(toolName || "")) return "mcp_tool_call";
  if (/^bash$|^shell$|^terminal$|^command$/i.test(toolName || "")) return TEST_PATTERN.test(title) ? "test_build" : /^(\s*git\b|\bgit\b)/i.test(title) ? "git_operation" : "shell_command";
  if (SEARCH_TOOLS.test(source)) return "search";
  if (WRITE_TOOLS.test(toolName || "")) return "file_write";
  if (READ_TOOLS.test(toolName || "")) return "file_read";
  if (TEST_PATTERN.test(title)) return "test_build";
  if (/^task\b|^agent\b/i.test(toolName || "")) return "subagent";
  return "native_tool_call";
}

function toolSourceFor(stepType) {
  if (stepType === "mcp_tool_call") return "mcp";
  if (stepType === "shell_command" || stepType === "test_build" || stepType === "git_operation") return "shell";
  if (stepType === "search" || stepType === "file_read" || stepType === "file_write") return "native";
  return stepType === "native_tool_call" || stepType === "subagent" ? "native" : "internal";
}

// Ordered chronological inventory of generated content and tool activity.
function collectTimeline(messages) {
  const entries = [];
  for (const message of messages) {
    const created = num(message.info.time?.created);
    for (const part of message.parts) {
      const start = num(part.time?.start) || created;
      const end = num(part.time?.end) || start;
      const base = { messageId: message.info.id, messageCreated: created, message };
      if (part.type === "tool") {
        entries.push({ ...base, at: start || created, kind: "tool", part });
      } else if (part.type === "text" || part.type === "reasoning") {
        entries.push({ ...base, at: start || created, kind: "generated", part });
      }
    }
  }
  return entries.filter((entry) => entry.at).sort((a, b) => a.at - b.at);
}

// Each step-start..step-finish pair inside an assistant message is one model
// invocation (model turn). Tokens come from the step-finish part when present,
// otherwise from message info.tokens.
export function buildModelTurns(rawMessages, options = {}) {
  const messages = normalizeSessionMessages(rawMessages);
  const limits = options.modelLimits || {};
  const timeline = collectTimeline(messages);
  const turns = [];
  let turnIndex = 0;
  for (const message of messages) {
    if (message.info.role !== "assistant") continue;
    const infoTokens = message.info.tokens && typeof message.info.tokens === "object" ? message.info.tokens : null;
    const steps = message.parts.filter((part) => part.type === "step-finish");
    const starts = message.parts.filter((part) => part.type === "step-start");
    const groups = steps.length ? steps.map((step, index) => ({ finish: step, start: starts[index] || starts[starts.length - 1] || null })) : [{ finish: null, start: starts[0] || null }];
    for (const group of groups) {
      const tokensSourcePart = group.finish?.tokens || infoTokens;
      const hasProviderTokens = Boolean(tokensSourcePart && typeof tokensSourcePart === "object");
      const cache = tokensSourcePart?.cache && typeof tokensSourcePart.cache === "object" ? tokensSourcePart.cache : {};
      const input = hasProviderTokens ? num(tokensSourcePart.input) : null;
      const output = hasProviderTokens ? num((tokensSourcePart.output || 0) + (tokensSourcePart.reasoning || 0)) : null;
      const modelKey = `${message.info.providerID}/${message.info.modelID}`;
      const limitContext = limits[modelKey]?.context != null ? num(limits[modelKey].context) : null;
      const startedMs = num(group.start?.time?.start) || num(message.info.time?.created);
      // Generated content before this turn's inference window feeds its input.
      const priorGenerated = timeline.filter((entry) => entry.kind === "generated" && entry.messageID !== message.info.id);
      const priorToolOutputs = timeline.filter((entry) => entry.kind === "tool" && entry.part.callID && entry.at <= (startedMs || 0));
      const historyText = priorGenerated.map((entry) => `${entry.message.info.role}: ${partText(entry.part)}`).join("\n");
      const taskBoundary = options.taskBoundaryMs || (priorGenerated.length ? null : startedMs);
      const userTexts = [];
      for (const messageEntry of messages) {
        if (messageEntry.info.role !== "user") continue;
        if (taskBoundary && (num(messageEntry.info.time?.created) || 0) >= taskBoundary) continue;
        for (const part of messageEntry.parts) if (part.type === "text") userTexts.push(partText(part));
      }
      const taskText = userTexts.join("\n");
      const toolResultTokens = priorToolOutputs.reduce((total, entry) => total + estimateTokens(toolOutputText(entry.part)), 0);
      const historyTokens = estimateTokens(historyText);
      const taskTokens = estimateTokens(taskText);
      const knownBreakdown = toolResultTokens + historyTokens + taskTokens;
      const contextUtilizationPct = input != null && limitContext ? Math.round(((input + (hasProviderTokens ? num(cache.read) || 0 : 0)) / limitContext) * 10000) / 100 : null;
      const finishedMs = num(group.finish?.time?.end) || null;
      const durationMs = startedMs && finishedMs ? Math.max(0, finishedMs - startedMs) : null;
      turns.push({
        messageId: message.info.id,
        turnIndex,
        agent: message.info.agent ?? null,
        providerId: message.info.providerID ?? null,
        modelId: message.info.modelID ?? null,
        startedAt: iso(startedMs),
        finishedAt: iso(finishedMs),
        durationMs,
        cost: group.finish?.cost != null ? num(group.finish.cost) : num(message.info.cost),
        inputTokens: measured(input, "provider_reported"),
        outputTokens: measured(output, "provider_reported"),
        reasoningTokens: measured(hasProviderTokens ? num(tokensSourcePart.reasoning) : null, "provider_reported"),
        cacheReadTokens: measured(hasProviderTokens ? num(cache.read) : null, "provider_reported"),
        cacheWriteTokens: measured(hasProviderTokens ? num(cache.write) : null, "provider_reported"),
        totalTokens: measured(hasProviderTokens ? num(tokensSourcePart.total) : null, "provider_reported"),
        contextWindowTokens: measured(limitContext, "opencode_reported"),
        contextUtilizationPct: measured(contextUtilizationPct, contextUtilizationPct == null ? "unavailable" : "provider_reported"),
        contextBreakdown: {
          systemTokens: unavailable("systemTokens", "OpenCode does not expose per-message system prompt size"),
          roleInstructionTokens: unavailable("roleInstructionTokens", "AGENTS/role prompt sizes are not exposed per message"),
          taskTokens: measured(taskTokens, "locally_tokenized"),
          wakeTokens: unavailable("wakeTokens", "wake payload is not distinguishable in OpenCode message metadata"),
          continuationTokens: unavailable("continuationTokens", "checkpoint/continuation payloads are not distinguishable in OpenCode message metadata"),
          historyTokens: measured(historyTokens, "locally_tokenized"),
          toolSchemaTokens: unavailable("toolSchemaTokens", "exact tool schemas included by the runtime are not exposed per message"),
          toolResultTokens: measured(toolResultTokens, "locally_tokenized"),
          otherInputTokens: input != null ? measured(Math.max(0, input - knownBreakdown), "locally_tokenized") : unavailable("otherInputTokens", "inputTokens not reported"),
          note: "system/role/wake/tool-schema components are unknown; otherInputTokens is a residual estimate over all unattributed input and must not be read as a single category.",
        },
      });
      turnIndex += 1;
    }
  }
  return turns;
}

export function buildOrderedSteps(run, rawMessages, turns) {
  const messages = normalizeSessionMessages(rawMessages);
  const steps = [];
  for (const turn of turns) {
    steps.push({ timestamp: turn.startedAt, stepType: "model_turn", toolName: null, toolSource: null, status: turn.outputTokens.value > 0 ? "success" : "unknown", durationMs: turn.durationMs, messageId: turn.messageId, turnIndex: turn.turnIndex, detail: { providerId: turn.providerId, modelId: turn.modelId, inputTokens: turn.inputTokens.value, outputTokens: turn.outputTokens.value } });
  }
  for (const message of messages) {
    const created = num(message.info.time?.created);
    for (const part of message.parts) {
      if (part.type !== "tool" || !part.tool) continue;
      const state = part.state && typeof part.state === "object" ? part.state : {};
      const title = typeof state.title === "string" ? state.title : "";
      const stepType = classifyToolStep(part.tool, title);
      const start = num(state.time?.start) || created;
      const end = num(state.time?.end) || start;
      const status = state.status === "completed" ? "success" : state.status === "error" ? "error" : state.status === "pending" ? "permission_wait" : "running";
      steps.push({ timestamp: iso(start), stepType, toolName: part.tool, toolSource: toolSourceFor(stepType), status: status === "permission_wait" ? "waiting" : status, durationMs: start && end ? Math.max(0, end - start) : null, messageId: message.info.id, callId: part.callID ?? null, detail: { title: title || undefined } });
    }
  }
  for (const event of run.events || []) {
    if (event.kind === "permission") {
      steps.push({ timestamp: event.timestamp, stepType: "permission_wait", toolName: event.tool || null, toolSource: "runtime", status: event.status || "waiting", durationMs: event.durationMs ?? null, messageId: null, detail: { errorCode: event.errorCode } });
      continue;
    }
    if (event.kind === "error" || Number(event.retry) > 0 || /PROCESS_LOST|PROVIDER|ENGINE_EXITED|RECOVERY/i.test(String(event.errorCode || ""))) {
      steps.push({ timestamp: event.timestamp, stepType: "retry_recovery", toolName: event.tool || null, toolSource: "runtime", status: event.status || "error", durationMs: event.durationMs ?? null, messageId: null, detail: { errorCode: event.errorCode } });
    }
  }
  const seen = new Set();
  const deduped = steps.filter((step) => {
    const fingerprint = `${step.timestamp}|${step.stepType}|${step.toolName || ""}|${step.callId || ""}`;
    if (step.stepType !== "model_turn" && seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
  deduped.sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp)));
  deduped.forEach((step, index) => { step.stepIndex = index; });
  return deduped;
}

const USEFUL_ACTION_TYPES = new Set(["file_write", "test_build", "git_operation", "shell_command"]);

export function computeTimings(run, steps, turns) {
  const startedMs = Date.parse(run.createdAt || "") || null;
  const elapsed = (timestamp) => startedMs && timestamp ? Math.max(0, Date.parse(timestamp) - startedMs) : null;
  const firstTurn = turns[0] || null;
  const firstTool = steps.find((step) => ["native_tool_call", "mcp_tool_call", "shell_command", "search", "file_read", "file_write", "test_build", "git_operation"].includes(step.stepType));
  const firstUseful = steps.find((step) => USEFUL_ACTION_TYPES.has(step.stepType) && step.status === "success");
  const firstWrite = steps.find((step) => step.stepType === "file_write" && step.status === "success");
  const firstTest = steps.find((step) => step.stepType === "test_build");
  const disposition = run.status === "completed" ? "completed" : run.status === "failed" ? "failed" : "running";
  const finishedAt = iso(run.finishedAt);
  return {
    timeToFirstModelTokenMs: measured(firstTurn ? elapsed(firstTurn.startedAt) : null, firstTurn ? "opencode_reported" : "unavailable"),
    timeToFirstModelTokenNote: firstTurn ? "measured to first assistant content timestamp (reasoning/text/tool start), the earliest observable generation signal; per-token stream timing is not exposed" : null,
    timeToFirstToolCallMs: measured(firstTool ? elapsed(firstTool.timestamp) : null, firstTool ? "opencode_reported" : "unavailable"),
    timeToFirstUsefulActionMs: measured(firstUseful ? elapsed(firstUseful.timestamp) : null, firstUseful ? "opencode_reported" : "unavailable"),
    firstUsefulActionDefinition: "first successful file write, shell command, test/build or git operation",
    timeToFirstFileWriteMs: measured(firstWrite ? elapsed(firstWrite.timestamp) : null, firstWrite ? "opencode_reported" : "unavailable"),
    timeToFirstTestMs: measured(firstTest ? elapsed(firstTest.timestamp) : null, firstTest ? "opencode_reported" : "unavailable"),
    finalDisposition: disposition,
    finalDispositionAt: finishedAt,
    timeToFinalDispositionMs: measured(finishedAt ? elapsed(finishedAt) : null, finishedAt ? "opencode_reported" : "unavailable"),
  };
}

export function classifyInvocation(run, rawMessages, turns, paperclipSignals = {}) {
  const messages = normalizeSessionMessages(rawMessages);
  const signals = [];
  let kind = "fresh_invocation";
  if (paperclipSignals.checkpoint) { kind = "reconstructed_continuation"; signals.push("paperclip_checkpoint_present"); }
  const events = run.events || [];
  const failureEvent = events.find((event) => event.kind === "error" || /PROCESS_LOST|PROVIDER|ENGINE_EXITED|RECOVERY/i.test(String(event.errorCode || "")));
  const retryCount = events.reduce((total, event) => total + (Number(event.retry) || 0), 0);
  if (failureEvent || retryCount > 0 || run.retries > 0 || run.status === "failed") {
    kind = "retry_after_failure";
    signals.push(failureEvent?.errorCode ? `failure_event:${failureEvent.errorCode}` : "run_marked_failed_or_retried");
  }
  const runStartMs = Date.parse(run.createdAt || "") || 0;
  const priorAssistant = messages.some((message) => message.info.role === "assistant" && runStartMs && (num(message.info.time?.created) || 0) < runStartMs - 2000);
  if (kind !== "reconstructed_continuation" && priorAssistant) { kind = "continuation_same_session"; signals.push("assistant_messages_predate_run_start"); }
  if (!signals.length) signals.push("no_continuation_or_failure_signals");
  return { invocationKind: kind, signals };
}

export function contextOverheadProfile(turns) {
  const totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, taskTokens: 0, historyTokens: 0, toolResultTokens: 0 };
  let reportedTurns = 0;
  for (const turn of turns) {
    if (turn.inputTokens.value != null) { totals.inputTokens += turn.inputTokens.value; reportedTurns += 1; }
    totals.outputTokens += turn.outputTokens.value || 0;
    totals.cacheReadTokens += turn.cacheReadTokens.value || 0;
    totals.cacheWriteTokens += turn.cacheWriteTokens.value || 0;
    totals.taskTokens += turn.contextBreakdown.taskTokens.value || 0;
    totals.historyTokens += turn.contextBreakdown.historyTokens.value || 0;
    totals.toolResultTokens += turn.contextBreakdown.toolResultTokens.value || 0;
  }
  const directlyMeasuredOverhead = 0; // system/role/wake/schema/continuation are unavailable in OpenCode metadata
  const nonTaskInputTokens = reportedTurns ? Math.max(0, totals.inputTokens - totals.taskTokens - totals.toolResultTokens) : null;
  return {
    totalModelTurns: turns.length,
    reportedModelTurns: reportedTurns,
    totalInputTokens: measured(reportedTurns ? totals.inputTokens : null, "provider_reported"),
    totalOutputTokens: measured(turns.length ? totals.outputTokens : null, "provider_reported"),
    totalCacheReadTokens: measured(turns.some((t) => t.cacheReadTokens.measurementSource === "provider_reported") ? totals.cacheReadTokens : null, "provider_reported"),
    totalCacheWriteTokens: measured(turns.some((t) => t.cacheWriteTokens.measurementSource === "provider_reported") ? totals.cacheWriteTokens : null, "provider_reported"),
    contextOverheadTokens: measured(directlyMeasuredOverhead, "unavailable"),
    contextOverheadComponents: {
      systemTokens: unavailable("systemTokens", "not exposed"),
      roleInstructionTokens: unavailable("roleInstructionTokens", "not exposed"),
      runtimeContractTokens: unavailable("runtimeContractTokens", "heartbeat/runtime contract not exposed per message"),
      toolSchemaTokens: unavailable("toolSchemaTokens", "not exposed"),
      continuationMetadataTokens: unavailable("continuationMetadataTokens", "not exposed"),
    },
    contextOverheadRatio: measured(null, "unavailable"),
    contextOverheadRatioNote: "exact overhead numerator (system+role+runtime contract+schemas+continuation) is not measurable; use nonTaskInputRatio as documented upper-bound proxy",
    taskUsefulContextTokens: measured(reportedTurns ? totals.taskTokens + totals.toolResultTokens : null, "locally_tokenized"),
    nonTaskInputTokens: measured(nonTaskInputTokens, "locally_tokenized"),
    nonTaskInputRatio: measured(nonTaskInputTokens != null && totals.inputTokens ? Math.round((nonTaskInputTokens / totals.inputTokens) * 10000) / 100 : null, "locally_tokenized"),
    nonTaskInputRatioDefinition: "(inputTokens - taskTokens - toolResultTokens) / inputTokens; upper bound on true overhead because session history is included here but is neither overhead nor task context per contract",
  };
}

export function supportedObservability(turns, timings, overhead) {
  const has = (value) => value != null;
  const anyCacheField = turns.some((t) => t.cacheReadTokens.measurementSource === "provider_reported" || t.cacheWriteTokens.measurementSource === "provider_reported");
  const entry = (available, source, reason) => ({ available: Boolean(available), measurementSource: available ? source : "unavailable", ...(reason ? { reason } : {}) });
  return {
    supportedObservability: {
      providerModelIdentity: entry(turns.some((t) => t.providerId && t.modelId), "opencode_reported"),
      modelTurnCount: entry(turns.length > 0, "opencode_reported"),
      tokenUsagePerTurn: entry(turns.some((t) => t.inputTokens.measurementSource === "provider_reported"), "provider_reported"),
      cacheUsage: entry(anyCacheField, "provider_reported", anyCacheField ? undefined : "provider does not report cache fields for these turns"),
      contextWindowAndUtilization: entry(turns.some((t) => t.contextWindowTokens.value != null), "opencode_reported"),
      orderedStepTimeline: entry(true, "opencode_reported"),
      contextBreakdownExact: entry(false, "unavailable", "system/role/wake/tool-schema/continuation sections are not exposed by OpenCode; task/history/tool-result sections only, locally tokenized"),
      exactTimeToFirstModelToken: entry(false, "unavailable", "stream-level first-token timing is not exposed; proxy uses first assistant content timestamp"),
    },
  };
}

export function buildRunAnalytics(run, rawMessages, options = {}) {
  const turns = buildModelTurns(rawMessages, options);
  const steps = buildOrderedSteps(run, rawMessages, turns);
  const timings = computeTimings(run, steps, turns);
  const overhead = contextOverheadProfile(turns);
  const invocation = classifyInvocation(run, rawMessages, turns, options.paperclipSignals || {});
  return {
    runId: run.runId,
    sessionId: run.runId,
    status: run.status,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
    paperclipIssueId: run.paperclipIssueId ?? null,
    mode: run.mode ?? null,
    directory: run.directory ?? null,
    invocationKind: invocation.invocationKind,
    invocationSignals: invocation.signals,
    metrics: metricsSummary(run, turns, steps, timings, overhead),
    turns,
    steps,
    timings,
    overhead,
  };
}

function metricsSummary(run, turns, steps, timings, overhead) {
  const toolSteps = steps.filter((step) => step.stepType !== "model_turn" && step.stepType !== "retry_recovery" && step.stepType !== "permission_wait");
  return {
    modelTurnCount: turns.length,
    toolStepCount: toolSteps.length,
    stepCount: steps.length,
    stepTypes: steps.reduce((acc, step) => { acc[step.stepType] = (acc[step.stepType] || 0) + 1; return acc; }, {}),
    providers: [...new Set(turns.map((t) => `${t.providerId}/${t.modelId}`).filter(Boolean))],
    totalInputTokens: overhead.totalInputTokens,
    totalOutputTokens: overhead.totalOutputTokens,
    totalCacheReadTokens: overhead.totalCacheReadTokens,
    totalCacheWriteTokens: overhead.totalCacheWriteTokens,
    avgContextUtilizationPct: turns.some((t) => t.contextUtilizationPct.value != null)
      ? measured(Math.round((turns.filter((t) => t.contextUtilizationPct.value != null).reduce((sum, t) => sum + t.contextUtilizationPct.value, 0) / turns.filter((t) => t.contextUtilizationPct.value != null).length) * 100) / 100, "provider_reported")
      : measured(null, "unavailable"),
    retries: (run.events || []).reduce((total, event) => total + (Number(event.retry) || 0), 0),
    failedToolCalls: toolSteps.filter((step) => step.status === "error").length,
    timeToFirstUsefulActionMs: timings.timeToFirstUsefulActionMs,
    finalDisposition: timings.finalDisposition,
  };
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return Math.round(sorted[index] * 100) / 100;
}

export function aggregateRunAnalytics(analyticsList) {
  const runs = analyticsList.filter(Boolean);
  const successful = runs.filter((item) => item.timings.finalDisposition === "completed");
  const usefulTimes = runs.map((item) => item.metrics.timeToFirstUsefulActionMs.value).filter((value) => value != null);
  const utilizations = runs.flatMap((item) => item.turns.map((turn) => turn.contextUtilizationPct.value)).filter((value) => value != null);
  const ratios = runs.map((item) => item.overhead.nonTaskInputRatio.value).filter((value) => value != null);
  return {
    runCount: runs.length,
    totalModelTurns: runs.reduce((total, item) => total + item.metrics.modelTurnCount, 0),
    totalToolSteps: runs.reduce((total, item) => total + item.metrics.toolStepCount, 0),
    totalInputTokens: runs.reduce((total, item) => total + (item.metrics.totalInputTokens.value || 0), 0),
    totalOutputTokens: runs.reduce((total, item) => total + (item.metrics.totalOutputTokens.value || 0), 0),
    totalCacheReadTokens: runs.reduce((total, item) => total + (item.metrics.totalCacheReadTokens.value || 0), 0),
    totalCacheWriteTokens: runs.reduce((total, item) => total + (item.metrics.totalCacheWriteTokens.value || 0), 0),
    completedRuns: successful.length,
    failedRuns: runs.filter((item) => item.timings.finalDisposition === "failed").length,
    firstPassSuccessRate: runs.length ? Math.round((successful.filter((item) => !item.invocationKind.startsWith("retry")).length / runs.length) * 10000) / 100 : null,
    retriesPerSuccessfulTask: successful.length ? Math.round((runs.reduce((total, item) => total + item.metrics.retries, 0) / successful.length) * 100) / 100 : null,
    tokensPerSuccessfulTask: successful.length ? Math.round(successful.reduce((total, item) => total + (item.metrics.totalInputTokens.value || 0), 0) / successful.length) : null,
    averageNonTaskInputRatioPct: ratios.length ? Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100) / 100 : null,
    averageContextUtilizationPct: utilizations.length ? Math.round((utilizations.reduce((a, b) => a + b, 0) / utilizations.length) * 100) / 100 : null,
    p50TimeToFirstUsefulActionMs: percentile(usefulTimes, 0.5),
    p95TimeToFirstUsefulActionMs: percentile(usefulTimes, 0.95),
    p50TokensBeforeFirstUsefulAction: null,
    p50TokensBeforeFirstUsefulActionNote: "per-turn attribution of tokens-before-useful-action requires interleaved streaming telemetry that OpenCode does not expose; served as null instead of an estimate",
  };
}

export function compareRunMetrics(analyticsList) {
  const entries = analyticsList.map((item) => ({
    runId: item.runId,
    invocationKind: item.invocationKind,
    modelTurnCount: item.metrics.modelTurnCount,
    toolStepCount: item.metrics.toolStepCount,
    totalInputTokens: item.metrics.totalInputTokens.value,
    totalOutputTokens: item.metrics.totalOutputTokens.value,
    avgContextUtilizationPct: item.metrics.avgContextUtilizationPct.value,
    nonTaskInputTokens: item.overhead.nonTaskInputTokens.value,
    nonTaskInputRatioPct: item.overhead.nonTaskInputRatio.value,
    contextOverheadTokensExact: item.overhead.contextOverheadTokens.value,
    finalDisposition: item.timings.finalDisposition,
    durationMs: item.timings.timeToFinalDispositionMs.value,
  }));
  const measurable = entries.filter((entry) => entry.nonTaskInputTokens != null);
  const worst = measurable.slice().sort((a, b) => b.nonTaskInputTokens - a.nonTaskInputTokens)[0] || null;
  return {
    runs: entries,
    moreContextOverheadRunId: worst?.runId ?? null,
    comparisonBasis: measurable.length ? "nonTaskInputTokens (documented upper-bound proxy; exact overhead components are not exposed)" : "unavailable",
    delta: measurable.length >= 2 ? { field: "nonTaskInputTokens", values: Object.fromEntries(entries.map((entry) => [entry.runId, entry.nonTaskInputTokens])) } : null,
  };
}
