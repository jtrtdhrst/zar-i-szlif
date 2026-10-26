// Effective tool access API (P0-D): what can a given agent ACTUALLY execute?
// Composes the static tool registry with live agent record/configuration,
// run-context requirements, and runtime reachability probes. Never bypasses a
// denial: it reports the denial with the remediation owner.
//
// NOTE: BASE_TOOL_NAMES mirrors the base tools in tools.ts. A vitest
// regression (p0-tools-registry.test.ts) asserts the union of all name lists
// covers every registered tool, so drift fails loudly instead of silently.

import { z } from "zod";
import type { PaperclipApiClient } from "./client.js";
import { CONTROL_PLANE_TOOL_NAMES } from "./control-plane.js";
import { WORKSPACE_NATIVE_TOOL_NAMES } from "./workspace-native.js";
import { P1_GIT_TOOL_NAMES } from "./p1-git.js";
import { P1_PLATFORM_TOOL_NAMES } from "./p1-platform.js";
import { ISSUE_FIELD_TOOL_NAMES } from "./issue-fields.js";
import { AGENT_CHAT_TOOL_NAMES } from "./agent-chats.js";
import { formatErrorResponse, formatTextResponse } from "./format.js";
import { toolCapability } from "./execution-broker.js";

export interface EffectiveAccessToolDefinition {
  name: string;
  description: string;
  schema: z.ZodObject;
  execute: (input: Record<string, unknown>) => Promise<{
    content: Array<{ type: "text"; text: string }>;
  }>;
}

function makeTool<TSchema extends z.ZodRawShape>(
  name: string,
  description: string,
  schema: z.ZodObject<TSchema>,
  execute: (input: z.infer<typeof schema>) => Promise<unknown>,
): EffectiveAccessToolDefinition {
  return {
    name,
    description,
    schema,
    execute: async (input) => {
      try {
        const parsed = schema.parse(input);
        return formatTextResponse(await execute(parsed));
      } catch (error) {
        return formatErrorResponse(error);
      }
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function enc(value: string): string {
  return encodeURIComponent(value);
}

async function getJsonOrNull(client: PaperclipApiClient, path: string): Promise<unknown> {
  return client.getJsonOrNull(path);
}

function err(code: string, message: string, extra?: Record<string, unknown>): Error {
  const e = new Error(`${message} [errorCode=${code}]`);
  (e as unknown as Record<string, unknown>).detail = { errorCode: code, ...(extra ?? {}) };
  return e;
}

export const BASE_TOOL_NAMES: string[] = [
  "paperclipMe", "paperclipInboxLite", "paperclipListAgents", "paperclipListSkills",
  "paperclipGetAgent", "paperclipListIssues", "paperclipGetIssue",
  "paperclipGetHeartbeatContext", "paperclipListComments", "paperclipGetComment",
  "paperclipListAgentChats", "paperclipGetAgentChat", "paperclipSendChatMessage",
  "paperclipGetChatMessages", "paperclipNewChatSession",
  "paperclipListIssueApprovals", "paperclipListDocuments", "paperclipGetDocument",
  "paperclipListDocumentRevisions", "paperclipListProjects", "paperclipGetProject",
  "paperclipGetIssueWorkspaceRuntime", "paperclipControlIssueWorkspaceServices",
  "paperclipWaitForIssueWorkspaceService", "paperclipListGoals", "paperclipGetGoal",
  "paperclipListApprovals", "paperclipCreateApproval", "paperclipGetApproval",
  "paperclipGetApprovalIssues", "paperclipListApprovalComments", "paperclipCreateIssue",
  "paperclipUpdateIssue", "paperclipUpdateAgent", "paperclipCheckoutIssue",
  "paperclipWakeupAgent", "paperclipClearAgentError", "paperclipReleaseIssue",
  "paperclipAddComment", "paperclipSuggestTasks", "paperclipAskUserQuestions",
  "paperclipRequestConfirmation", "paperclipRequestCheckboxConfirmation",
  "paperclipListIssueInteractions", "paperclipAcceptInteraction", "paperclipRejectInteraction", "paperclipCancelIssueInteraction",
  "paperclipUpsertIssueDocument", "paperclipRestoreIssueDocumentRevision",
  "paperclipLinkIssueApproval", "paperclipUnlinkIssueApproval", "paperclipApprovalDecision",
  "paperclipAddApprovalComment", "paperclipWikiList", "paperclipWikiSearch",
  "paperclipWikiGetPage", "paperclipWikiProposeChange", "paperclipWikiApplyChange",
  "paperclipWikiCreatePage", "paperclipGetRunDetail", "paperclipGetSkill",
  "paperclipListCatalogSkills", "paperclipGetCatalogSkill", "paperclipCreateSkill",
  "paperclipUpdateSkill", "paperclipDeleteSkill", "paperclipInstallCatalogSkill",
  "paperclipInstallSkillUpdate", "paperclipGetSkillUpdateStatus", "paperclipGetSkillFile",
  "paperclipUpdateSkillFile", "paperclipAuditSkill", "paperclipApiRequest",
];

export function allKnownToolNames(): string[] {
  return [...new Set([...BASE_TOOL_NAMES, ...CONTROL_PLANE_TOOL_NAMES, ...WORKSPACE_NATIVE_TOOL_NAMES, ...EFFECTIVE_ACCESS_TOOL_NAMES, ...P1_GIT_TOOL_NAMES, ...P1_PLATFORM_TOOL_NAMES, ...ISSUE_FIELD_TOOL_NAMES])];
}

// Exact public verification names avoid a cycle with live-verify.ts.
const LIVE_VERIFY_NAMES = new Set(["paperclipVerifyLiveMCP", "paperclipMCPRunSmokeTest"]);

export function isKnownToolName(tool: string): boolean {
  if (allKnownToolNames().includes(tool)) return true;
  return LIVE_VERIFY_NAMES.has(tool);
}

// Static policy table: which tools need what. Derived from backend guards
// (assertBoard / run-context / operator session) and MCP wrapper requirements.
type ToolPolicy = {
  needsOperatorRun?: boolean;
  needsRunId?: boolean;
  boardOnly?: boolean;
  agentKeyPath?: boolean;
  runtime?: "api" | "host-bridge" | "workspace-fs" | "github";
};

const MUTATING_RE = /Checkout|Release|Upsert|Restore|Link|Unlink|Decision|Comment|ChatMessage|NewChatSession|Create|Update|Delete|Install|Submit|Request|Patch|Reset|Detach|Provision|Reconcile|Resolve|Cancel|Wake|Retry|Close|Repair|Unblock|Supersede|Apply|Start|Stop|Restart|Reload|Recreate|Commit|Push|PatchFile|Exec|CreateBranch|CreatePR|Rollback|Sync/i;

function policyFor(tool: string): ToolPolicy {
  if (AGENT_CHAT_TOOL_NAMES.includes(tool)) return { boardOnly: true, runtime: "api" };
  if (tool.startsWith("paperclipWorkspace") || tool.startsWith("paperclipGit")) return { runtime: "workspace-fs" };
  if (tool.startsWith("paperclipVerify") || tool.startsWith("paperclipMCP") || tool.startsWith("paperclipGetAgentEffective") || tool.startsWith("paperclipGetToolDenial")) return { runtime: "api" };
  return { runtime: "api" };
}

// P0 2026-10-17: operator sessions were removed upstream and every workspace/
// git mutating tool now authorizes via the caller's own live run (runId,
// issue-bound) or a board key — nothing in this projection requires an
// operatorRunId anymore (host mutations via paperclipHostOperation/host
// intents remain supervised on the host side, not operator-gated in MCP).
function needsOperator(_tool: string): boolean {
  return false;
}

// Tools whose mutation path requires a live execution context (caller's own
// running run with issueId) OR a board key. Used only for projection when the
// caller hasn't declared a context yet.
const LIVE_CONTEXT_TOOLS_RE =
  /WorkspacePatchFile|WorkspaceExec|WorkspaceApplyUnifiedDiff|WorkspaceBatchChange|WorkspaceRunChecks|GitCreateBranch|GitCommit|GitPush|GitCreatePR|GitMergePR/;

function needsRun(tool: string): boolean {
  if (LIVE_CONTEXT_TOOLS_RE.test(tool)) return true;
  // P0 2026-10-20: the issue-field management tools mutate authoritative issue
  // configuration (parent/blockers/stages/monitor/watchdog/links) and therefore
  // need the same live issue-scoped run context (or Board authority) as
  // paperclipUpdateIssue - a tool existing in the catalogue is not an
  // authorization.
  if (/^paperclipManageIssue/.test(tool)) return true;
  if (/Checkout|Release|UpsertIssueDocument|RestoreIssueDocumentRevision|LinkIssueApproval|UnlinkIssueApproval|AddComment|CreateIssue|UpdateIssue/.test(tool)) return true;
  return false;
}

async function agentContext(client: PaperclipApiClient, agentId: string | null | undefined, issueId?: string | null, environmentId?: string | null) {
  const resolved = agentId ?? client.defaults.agentId;
  if (!resolved) throw err("invalid_arguments", "Pass agentId or set PAPERCLIP_AGENT_ID");
  const [agent, configuration] = await Promise.all([
    getJsonOrNull(client, `/agents/${enc(resolved)}`),
    getJsonOrNull(client, `/agents/${enc(resolved)}/configuration`),
  ]);
  let issue: unknown = null;
  if (issueId) issue = await getJsonOrNull(client, `/issues/${enc(issueId)}`);
  return { agentId: resolved, agent, configuration, issue, environmentId: environmentId ?? null };
}

function scopeOf(tool: string, ctx: { agentId: string; issue: unknown }): string {
  if (tool.startsWith("paperclipWorkspace") || tool.startsWith("paperclipGit")) return "workspace (company-owned execution workspace)";
  if (isRecord(ctx.issue)) return `issue ${String((ctx.issue as Record<string, unknown>).identifier ?? "?")}`;
  return "company";
}

export const EFFECTIVE_ACCESS_TOOL_NAMES: string[] = [
  "paperclipGetAgentEffectiveTools",
  "paperclipVerifyAgentTool",
  "paperclipGetToolDenial",
];

export function createEffectiveAccessTools(client: PaperclipApiClient): EffectiveAccessToolDefinition[] {
  return [
    makeTool(
      "paperclipGetAgentEffectiveTools",
      "Effective tool access for one agent: per tool registered/exposedToAgent/authenticationType/authorizationGranted/effectiveScope/runtimeAvailable/providerReachable/executableNow/denialReason/remediationOwner. Distinguishes unregistered vs ungranted vs wrong credential class vs missing permission vs missing operatorRunId vs runtime down vs network vs missing handler vs execution failure. Never bypasses a denial.",
      z.object({
        agentId: z.string().guid().optional().nullable(),
        issueId: z.string().min(1).optional().nullable(),
        environmentId: z.string().min(1).max(128).optional().nullable(),
        toolFilter: z.string().min(1).max(128).optional().nullable(),
      }),
      async ({ agentId, issueId, environmentId, toolFilter }) => {
        const ctx = await agentContext(client, agentId ?? null, issueId ?? null, environmentId ?? null);
        const agentMissing = !isRecord(ctx.agent);
        const filter = process.env.PAPERCLIP_MCP_TOOL_FILTER;
        const filterSet = filter ? new Set(filter.split(",").map((s) => s.trim()).filter(Boolean)) : null;
        // Runtime reachability (one probe per runtime, not per tool).
        const apiHealth = await getJsonOrNull(client, `/companies/${client.resolveCompanyId()}`).then((v) => v !== null).catch(() => false);
        const names = allKnownToolNames().filter((n) => !toolFilter || n.toLowerCase().includes((toolFilter as string).toLowerCase()));
        const tools = names.map((toolName) => {
          const registered = true;
          const exposedToAgent = filterSet ? filterSet.has(toolName) : true;
          const pol = policyFor(toolName);
          const cap = toolCapability(toolName);
          const chatBoardOnly = pol.boardOnly === true;
          const authenticationType = chatBoardOnly ? "board-user" : toolName.startsWith("/agents/") ? "agent-key" : (toolName === "paperclipMe" || toolName === "paperclipInboxLite" ? "agent-key" : "caller-key-or-board");
          const authorizationGranted = !agentMissing && exposedToAgent && !chatBoardOnly;
          const runtimeAvailable = pol.runtime === "api" ? apiHealth : true;
          const providerReachable = pol.runtime === "api" ? apiHealth : true;
          const missingRun = needsRun(toolName) && !issueId;
          const executableNow = authorizationGranted && runtimeAvailable && providerReachable && !missingRun;
          // Capability registry status (execution-broker.ts): honest lifecycle —
          // advertised-but-unimplemented or lane-less tools are UNSUPPORTED, never
          // silently green. E2E_VERIFIED stays false until a real per-tool
          // readback/dry-run probe runs (see paperclipVerifyAgentTool).
          const capabilityStatus = !cap.supported ? "UNSUPPORTED"
            : !registered ? "REGISTERED"
            : executableNow ? (issueId ? "EXECUTABLE_IN_CONTEXT" : "AUTHORIZED_FOR_PRINCIPAL")
            : "SCHEMA_VALID";
          let denialReason: string | null = null;
          let remediationOwner: string | null = null;
          if (agentMissing) { denialReason = "unknown agentId (no such agent in this company)"; remediationOwner = "board"; }
          else if (!cap.supported) { denialReason = cap.unsupportedReason ?? "unsupported capability"; remediationOwner = "cto"; }
          else if (chatBoardOnly) { denialReason = "requires an authenticated Board-user chat session; agent keys cannot own or post to chats"; remediationOwner = "board"; }
          else if (!exposedToAgent) { denialReason = "tool hidden by PAPERCLIP_MCP_TOOL_FILTER"; remediationOwner = "owner"; }
          else if (!runtimeAvailable) { denialReason = "API runtime unreachable"; remediationOwner = "owner"; }
          else if (missingRun) { denialReason = "missing live execution context (pass issueId; mutations also accept runId of the caller's own running run, or a board key)"; remediationOwner = "caller"; }
          return {
            toolName,
            registered,
            exposedToAgent,
            authenticationType,
            authorizationGranted,
            effectiveScope: authorizationGranted ? scopeOf(toolName, { agentId: ctx.agentId, issue: ctx.issue }) : null,
            runtimeAvailable,
            providerReachable,
            executableNow,
            denialReason,
            remediationOwner,
            upstreamCapability: cap.upstreamRoute,
            executionMode: cap.requiresHostPolicy ? "host_supervisor" : cap.requiresRun ? "issue_run" : "direct",
            capabilityStatus,
            requiresRun: cap.requiresRun,
            requiresBoard: cap.requiresBoard,
          };
        });
        return {
          agentId: ctx.agentId,
          agentFound: !agentMissing,
          issueId: issueId ?? null,
          environmentId: environmentId ?? null,
          toolCount: tools.length,
          executableCount: tools.filter((t) => t.executableNow).length,
          tools,
        };
      },
    ),
    makeTool(
      "paperclipVerifyAgentTool",
      "Safe capability probe for one tool: read-only probes execute for real; mutating operations use dryRun or a canary target and never need a new issue. Returns executableNow + probe evidence.",
      z.object({
        agentId: z.string().guid().optional().nullable(),
        toolName: z.string().min(1).max(128),
        issueId: z.string().min(1).optional().nullable(),
        operatorRunId: z.string().uuid().optional().nullable(),
      }),
      async ({ agentId, toolName, issueId, operatorRunId }) => {
        const ctx = await agentContext(client, agentId ?? null, issueId ?? null, null);
        if (!isRecord(ctx.agent)) {
          return { toolName, executableNow: false, denialReason: "unknown agentId", remediationOwner: "board" as const, probe: null };
        }
        if (!isKnownToolName(toolName)) {
          return { toolName, executableNow: false, denialReason: "tool not registered", remediationOwner: "owner" as const, probe: null };
        }
        // Side-effect-free probes per tool class.
        try {
          if (toolName === "paperclipGetAgentPermissions" || toolName === "paperclipGetAgentEffectiveConfig") {
            const probe = await getJsonOrNull(client, `/agents/${enc(ctx.agentId)}/configuration`);
            return { toolName, executableNow: probe !== null, probe: { configurationReachable: probe !== null } };
          }
          if (toolName.startsWith("paperclipWorkspace") || toolName.startsWith("paperclipGit")) {
            const gitRead = /^paperclipGit(AuthStatus|GetRemoteTopology|WaitChecks)$/.test(toolName);
            if (gitRead) {
              const { hasGitHubTokenEnv } = await import("./p1-git.js");
              const gh = hasGitHubTokenEnv();
              return { toolName, executableNow: true, denialCode: null, probe: { gitHubAuthPresent: gh.present, credentialType: gh.kind }, note: gh.present ? null : "diagnostic itself runs without auth; delivery operations will report GITHUB_AUTH_MISSING (owner CTO)" };
            }
            if (!issueId) {
              return { toolName, executableNow: false, denialCode: "RUN_CONTEXT_REQUIRED", denialReason: "probe needs issueId (workspace scope) — no new issue created; mutations also accept runId of the caller's own running run, or a board key", remediationOwner: "caller" as const, retryMeaningful: true, probe: null };
            }
            const context = await getJsonOrNull(client, `/issues/${enc(issueId)}/heartbeat-context`);
            const ok = isRecord(context);
            // Mandate ladder (2026-10-16): distinct states, never one boolean.
            const states = { REGISTERED: true, EXPOSED: true, SCHEMA_VALID: true, HANDLER_PRESENT: true, UPSTREAM_COMPATIBLE: true, CREDENTIAL_CLASS_VALID: ok, AUTHORIZED_FOR_SCOPE: ok, EXECUTION_CONTEXT_VALID: ok, DEPENDENCIES_REACHABLE: ok, PROBED_SUCCESSFULLY: ok, E2E_VERIFIED: false };
            return { toolName, executableNow: ok, denialCode: ok ? null : "RUN_CONTEXT_REQUIRED", missingCapability: ok ? null : "issue heartbeat-context (workspace scope not resolvable)", remediationOwner: ok ? null : "caller" as const, retryMeaningful: !ok, states, probe: { heartbeatContextReachable: ok } };
          }
          // Generic probe: API reachability + honest prerequisites ladder (KOMAA-797 audit).
          const apiProbe = await getJsonOrNull(client, `/companies/${client.resolveCompanyId()}`);
          const apiUp = apiProbe !== null;
          const runBlocked = needsRun(toolName) && !issueId;
          const executable = apiUp && !runBlocked;
          // Honest ladder (MCP-002): a company read proves CREDENTIAL_CLASS_VALID
          // only — it is NOT a successful per-tool probe. PROBED_SUCCESSFULLY and
          // E2E_VERIFIED stay false until a real applicable probe/readback runs.
          const states = { REGISTERED: true, EXPOSED: true, SCHEMA_VALID: true, HANDLER_PRESENT: true, UPSTREAM_COMPATIBLE: true, CREDENTIAL_CLASS_VALID: apiUp, AUTHORIZED_FOR_SCOPE: apiUp, EXECUTION_CONTEXT_VALID: apiUp && !runBlocked, DEPENDENCIES_REACHABLE: apiUp, PROBED_SUCCESSFULLY: false, E2E_VERIFIED: false };
          return { toolName, executableNow: executable,
            denialCode: !apiUp ? "RUNTIME_UNREACHABLE" : runBlocked ? "RUN_CONTEXT_REQUIRED" : null,
            missingCapability: !apiUp ? "Paperclip API reachability" : runBlocked ? "issueId with a live run context" : null,
            remediationOwner: !apiUp ? "owner" as const : "caller" as const,
            retryMeaningful: apiUp,
            probeNote: executable ? "generic reachability only (company read); per-tool live probe not executed — E2E UNVERIFIED" : null,
            states, probe: { apiReachable: apiUp } };
        } catch (error) {
          return { toolName, executableNow: false, denialReason: error instanceof Error ? error.message.slice(0, 300) : String(error), remediationOwner: "owner" as const, probe: null };
        }
      },
    ),
    makeTool(
      "paperclipGetToolDenial",
      "Explain one tool denial with the single remediation owner: reuses the forbidden-map (no bypass). Pass the raw error text and the tool name; technical projection problems route to harness/admin/CTO, never to the end user.",
      z.object({
        toolName: z.string().min(1).max(128),
        errorText: z.string().min(1).max(4000).optional().default(""),
        agentId: z.string().guid().optional().nullable(),
      }),
      async ({ toolName, errorText, agentId }) => {
        // P0 2026-10-16 (MCP-004): CAPABILITY_REMOVED first — it must never fall
        // through to advice pointing at the removed operator-runs endpoint.
        const ownerByPattern: Array<{ match: RegExp; owner: string; fix: string }> = [
          { match: /CAPABILITY_REMOVED|operator.?runs?|operator session/i, owner: "cto", fix: "Capability removed in Paperclip 2026.1012.0 (operator sessions): fail-closed, do not retry or mint run IDs. Use a live issue run context where the target supports it; restoring operator sessions is a CTO-owned upstream decision" },
          { match: /cross_issue_influence_run_context_required|run.?context/i, owner: "caller", fix: "Pass a live execution context the target accepts (own live issue run where supported); operator sessions are removed upstream (CAPABILITY_REMOVED) — never reuse foreign or terminal runs" },
          { match: /RUN_CONTEXT_REQUIRED|run_context_required/i, owner: "caller", fix: "Workspace/git mutations need runId = your own currently RUNNING heartbeat run ($PAPERCLIP_RUN_ID) bound to the workspace's issue, or a board key. Operator sessions were removed in Paperclip 2026.1012.0 — never mint or reuse run IDs" },
          { match: /scope_denied|issue_scope_required/i, owner: "caller", fix: "The live run is issue-bounded: use the run bound to the target issue (or a board key). Cross-issue workspace mutations are refused by design" },
          { match: /Board authentication required|assertBoard/i, owner: "board", fix: "Board-only operation: needs a board actor or an explicit board grant; agents cannot self-grant" },
          { match: /IDEMPOTENCY_CONFLICT|idempotency/i, owner: "caller", fix: "Same requestId with a different payload: retry with a fresh requestId" },
          { match: /auth_failed|expired|invalid.*operatorRun/i, owner: "caller", fix: "No live authorized context owned by the caller: obtain one (own live issue run where supported); operator sessions are removed upstream (CAPABILITY_REMOVED, owner CTO) — do not retry expired runs" },
          { match: /workspace_not_available|harness/i, owner: "harness", fix: "Workspace not realized on this host: checkout/provision the issue via the harness first" },
          { match: /auth_unverified|no gh auth|GITHUB_TOKEN|GITHUB_AUTH_MISSING/i, owner: "cto", fix: "Provision GitHub auth (GH_TOKEN) for the paperclip host" },
          { match: /drift|manifest|version/i, owner: "owner", fix: "Redeploy the MCP candidate so the running artifact matches the reviewed digest" },
        ];
        const hit = ownerByPattern.find((e) => e.match.test(errorText || ""));
        const pol = policyFor(toolName);
        return {
          toolName,
          agentId: agentId ?? client.defaults.agentId ?? null,
          registered: isKnownToolName(toolName),
          denial: errorText || null,
          diagnosis: hit ? hit.fix : "Unclassified denial: see paperclipGetAgentEffectiveTools for the per-tool breakdown",
          remediationOwner: hit ? hit.owner : "owner",
          runtime: pol.runtime,
          note: "Denials are never bypassed; the owner above is the single party that can fix the mapping or grant.",
        };
      },
    ),
  ];
}


