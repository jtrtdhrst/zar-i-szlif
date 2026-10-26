import { z } from "zod";
import {
  addIssueCommentSchema,
  askUserQuestionsPayloadSchema,
  catalogSkillListQuerySchema,
  checkoutIssueSchema,
  companySkillCreateSchema,
  companySkillFileUpdateSchema,
  companySkillInstallCatalogSchema,
  companySkillInstallUpdateSchema,
  companySkillUpdateSchema,
  createApprovalSchema,
  createIssueInputSchema,
  issueThreadInteractionContinuationPolicySchema,
  requestCheckboxConfirmationPayloadSchema,
  requestConfirmationPayloadSchema,
  suggestTasksPayloadSchema,
  updateIssueSchema,
  upsertIssueDocumentSchema,
  linkIssueApprovalSchema,
} from "@paperclipai/shared";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { PaperclipApiClient } from "./client.js";
import { CONTROL_PLANE_TOOL_NAMES, createControlPlaneTools } from "./control-plane.js";
import { WORKSPACE_NATIVE_TOOL_NAMES, createWorkspaceNativeTools } from "./workspace-native.js";
import { EFFECTIVE_ACCESS_TOOL_NAMES, createEffectiveAccessTools } from "./effective-access.js";
import { LIVE_VERIFY_TOOL_NAMES, createLiveVerifyTools } from "./live-verify.js";
import { P1_GIT_TOOL_NAMES, createP1GitTools } from "./p1-git.js";
import { P1_PLATFORM_TOOL_NAMES, createP1PlatformTools } from "./p1-platform.js";
import { ISSUE_FIELD_TOOL_NAMES, createIssueFieldTools } from "./issue-fields.js";
import {
  CRITICAL_API_REQUEST,
  CRITICAL_CREATE_ISSUE,
  CRITICAL_GET_ISSUE,
  CRITICAL_UPDATE_ISSUE,
} from "./critical-notice.js";
import { createAgentChatTools } from "./agent-chats.js";

// FIX 2026-10-14 (audyt MCP 132): po autoryzacji MCP MUSI udostepniac WSZYSTKIE
// operacje. Wczesniejszy whitelist ukrywal 24 zdefiniowane narzedzia
// (ListAgents/GetAgent/approvals/goals/interactions/workspaces/release/...),
// mimo ze backend je obslugiwal. Domyslnie wlaczamy wszystko; filtr tylko gdy
// jawnie ustawiony przez PAPERCLIP_MCP_TOOL_FILTER.
const ALL_TOOL_NAMES = new Set<string>([
  ...CONTROL_PLANE_TOOL_NAMES,
  ...WORKSPACE_NATIVE_TOOL_NAMES,
  ...EFFECTIVE_ACCESS_TOOL_NAMES,
  ...LIVE_VERIFY_TOOL_NAMES,
  ...P1_GIT_TOOL_NAMES,
  ...P1_PLATFORM_TOOL_NAMES,
  ...ISSUE_FIELD_TOOL_NAMES,
]);
function isToolEnabled(name: string): boolean {
  void ALL_TOOL_NAMES;
  const filter = process.env.PAPERCLIP_MCP_TOOL_FILTER;
  if (filter) {
    const set = new Set(filter.split(",").map(s=>s.trim()).filter(Boolean));
    return set.has(name);
  }
  return true;
}

import { formatErrorResponse, formatTextResponse } from "./format.js";

export interface ToolDefinition {
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
): ToolDefinition {
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

function parseOptionalJson(raw: string | undefined | null): unknown {
  if (!raw || raw.trim().length === 0) return undefined;
  return JSON.parse(raw);
}

const companyIdOptional = z.string().guid().optional().nullable();
const agentIdOptional = z.string().guid().optional().nullable();
const issueIdSchema = z.string().min(1);
const projectIdSchema = z.string().trim().min(1).max(128).superRefine((value, ctx) => {
  // A UUID-looking value must be a complete UUID; do not leak malformed IDs
  // to GET /projects/:id, where the upstream route can turn them into 500s.
  if (/^[0-9a-f]{8}-/i.test(value) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    ctx.addIssue({ code: "custom", message: "Invalid arguments: projectId must be a complete UUID or a company-scoped short reference" });
  }
});
const goalIdSchema = z.string().guid();
const approvalIdSchema = z.string().guid();
const documentKeySchema = z.string().trim().min(1).max(64);

const WIKI_PLUGIN_ID = "paperclipai.plugin-llm-wiki";

const wikiPagePathSchema = z
  .string()
  .min(1)
  .max(256)
  .refine(
    (value: string) =>
      value.startsWith("wiki/") &&
      value.endsWith(".md") &&
      !value.includes("..") &&
      !value.startsWith("/"),
    { message: 'path must look like "wiki/.../*.md" without ".." or a leading "/"' },
  );

const wikiScopeFields = {
  wikiId: z.string().min(1).max(64).optional(),
  spaceSlug: z.string().min(1).max(64).optional(),
};

function wikiScopeParams(input: { wikiId?: string; spaceSlug?: string }): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (input.wikiId) params.wikiId = input.wikiId;
  if (input.spaceSlug) params.spaceSlug = input.spaceSlug;
  return params;
}


// 1012 compat (MCP-side): the llm-wiki worker has no built entrypoints in the
// 1012 image, and Board-gated plugin routes fail closed for agent principals.
// Either way /plugins/paperclipai.plugin-llm-wiki/{data,actions}/* is not
// callable, which used to make every wiki tool unusable. Wiki pages are plain
// files under the managed wiki-root, so reads AND writes fall back to the same
// hash-checked local store for the default space.
function wikiFileRoot(): string {
  return process.env.PAPERCLIP_WIKI_ROOT || "/paperclip/instances/default/data/wiki-root";
}

function wikiScopeIsLocal(input: { wikiId?: string; spaceSlug?: string }): boolean {
  return (!input.wikiId || input.wikiId === "default") && (!input.spaceSlug || input.spaceSlug === "default");
}

function wikiLocalPath(input: { wikiId?: string; spaceSlug?: string; path: string }): string | null {
  if (!wikiScopeIsLocal(input)) return null;
  const root = wikiFileRoot();
  const full = resolve(root + sep + input.path);
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

function isWikiWorkerDown(error: unknown): boolean {
  const msg = String((error as any)?.message ?? error ?? "");
  return /502|WORKER_UNAVAILABLE|not ready|API route not found|failed with 502|failed with 404/i.test(msg);
}

function wikiTitleFrom(contents: string, fallbackPath: string): string | null {
  const heading = contents.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim();
  const name = fallbackPath.split("/").pop() ?? fallbackPath;
  return name.replace(/\.md$/i, "");
}

function wikiFileList(input: { wikiId?: string; spaceSlug?: string; limit?: number }): WikiPageListItem[] {
  const root = wikiFileRoot();
  if (!wikiScopeIsLocal(input) || !existsSync(root)) return [];
  const pages: WikiPageListItem[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
      const path = full.slice(root.length + 1).split(sep).join("/");
      if (!path.startsWith("wiki/") || path.includes("..")) continue;
      const contents = (() => {
        try { return readFileSync(full, "utf8"); } catch { return ""; }
      })();
      pages.push({ path, title: wikiTitleFrom(contents, path) });
    }
  };
  walk(root);
  pages.sort((a, b) => a.path.localeCompare(b.path));
  return pages.slice(0, input.limit ?? 100);
}

function wikiFileGetPage(input: { wikiId?: string; spaceSlug?: string; path: string }): { contents: string; hash: string; title: string | null } | null {
  const file = wikiLocalPath(input);
  if (!file || !existsSync(file)) return null;
  const contents = readFileSync(file, "utf8");
  return { contents, hash: sha256Hex(contents), title: wikiTitleFrom(contents, input.path) };
}

function wikiFileApply(input: { wikiId?: string; spaceSlug?: string; path: string; contents: string; expectedHash?: string; summary?: string }): Record<string, unknown> {
  const file = wikiLocalPath(input);
  if (!file) throw new Error(`Wiki file fallback supports only the default space (got wikiId=${input.wikiId ?? "-"} spaceSlug=${input.spaceSlug ?? "-"}).`);
  if (!existsSync(file)) throw new Error(`No such wiki page: ${input.path} [errorCode=NOT_FOUND]`);
  const current = readFileSync(file, "utf8");
  const currentHash = createHash("sha256").update(current, "utf8").digest("hex");
  if (input.expectedHash && currentHash !== input.expectedHash.trim()) {
    throw new Error(`Wiki conflict: expectedHash ${input.expectedHash} != current ${currentHash}; re-read the page and retry. Nothing was written. [errorCode=VERSION_CONFLICT]`);
  }
  writeFileSync(file, input.contents, "utf8");
  const hash = createHash("sha256").update(input.contents, "utf8").digest("hex");
  return { path: input.path, previousHash: currentHash, hash, bytesWritten: Buffer.byteLength(input.contents, "utf8"), fallback: "file", summary: input.summary ?? null };
}

function wikiFileCreate(input: { wikiId?: string; spaceSlug?: string; path: string; contents: string; summary?: string }): Record<string, unknown> {
  const file = wikiLocalPath(input);
  if (!file) throw new Error(`Wiki file fallback supports only the default space (got wikiId=${input.wikiId ?? "-"} spaceSlug=${input.spaceSlug ?? "-"}).`);
  if (existsSync(file)) throw new Error(`Wiki page already exists: ${input.path}. Read it and use paperclipWikiProposeChange/paperclipWikiApplyChange to edit.`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, input.contents, "utf8");
  const hash = createHash("sha256").update(input.contents, "utf8").digest("hex");
  return { path: input.path, hash, bytesWritten: Buffer.byteLength(input.contents, "utf8"), fallback: "file", summary: input.summary ?? null };
}

// Unavailable plugins never authorize a direct filesystem bypass. Proof of
// Board authority comes from the independent, Board-guarded upstream route.
async function assertWikiFileFallbackAuthorized(client: PaperclipApiClient): Promise<void> {
  if (!client.hasBoardCredential || client.defaults.principalKind === "agent") {
    throw new Error("Wiki file fallback requires Board authorization [errorCode=BOARD_ACCESS_REQUIRED]");
  }
  await client.requestJson("GET", "/plugins");
}

async function wikiWriteWithFallback<T>(client: PaperclipApiClient, input: any, viaPlugin: () => Promise<T>, viaFile: () => T): Promise<T> {
  try {
    return await viaPlugin();
  } catch (error) {
    if (!isWikiWorkerDown(error)) throw error;
    await assertWikiFileFallbackAuthorized(client);
    return viaFile();
  }
}

function sha256Hex(contents: string): string {
  return createHash("sha256").update(contents, "utf8").digest("hex");
}

function wikiDiffStat(before: string, after: string): { added: number; removed: number } {
  const beforeLines = new Set(before.split("\n"));
  const afterLines = after.split("\n");
  let added = 0;
  for (const line of afterLines) {
    if (!beforeLines.has(line)) added += 1;
  }
  const afterSet = new Set(afterLines);
  let removed = 0;
  for (const line of beforeLines) {
    if (!afterSet.has(line)) removed += 1;
  }
  return { added, removed };
}

interface WikiPageListItem {
  path: string;
  title?: string | null;
}

async function wikiListPages(
  client: PaperclipApiClient,
  input: { wikiId?: string; spaceSlug?: string; pageType?: string; limit?: number },
): Promise<WikiPageListItem[]> {
  const companyId = client.resolveCompanyId();
  try {
    const result = await client.requestJson<{ data?: { pages?: WikiPageListItem[] } }>(
      "POST",
      `/plugins/${WIKI_PLUGIN_ID}/data/pages`,
      {
        body: {
                  companyId: client.resolveCompanyId(),
                  params: {
                    ...wikiScopeParams(input),
                    ...(input.pageType ? { pageType: input.pageType } : {}),
                    limit: input.limit ?? 100,
                  },
        },
      },
    );
    return result.data?.pages ?? [];
  } catch (error) {
    if (!isWikiWorkerDown(error)) throw error;
    await assertWikiFileFallbackAuthorized(client);
    return wikiFileList(input);
  }
}

async function wikiGetPage(
  client: PaperclipApiClient,
  input: { wikiId?: string; spaceSlug?: string; path: string },
): Promise<{ contents?: string; hash?: string; title?: string | null }> {
  const companyId = client.resolveCompanyId();
  const scope: Record<string, unknown> = {};
  if (input.wikiId) scope.wikiId = input.wikiId;
  if (input.spaceSlug) scope.spaceSlug = input.spaceSlug;
  try {
    const result = await client.requestJson<{ data?: { contents?: string; hash?: string; title?: string | null } }>(
      "POST",
      `/plugins/${WIKI_PLUGIN_ID}/data/page-content`,
      {
        body: {
                  companyId: client.resolveCompanyId(),
                  params: { ...scope, path: input.path } },
      },
    );
    return result.data ?? {};
  } catch (error) {
    if (!isWikiWorkerDown(error)) throw error;
    await assertWikiFileFallbackAuthorized(client);
    const local = wikiFileGetPage(input);
    if (!local) throw new Error(`No such wiki page: ${input.path} [errorCode=NOT_FOUND]`);
    return local;
  }
}

function isMissingPageError(error: unknown): boolean {
  const parts: string[] = [error instanceof Error ? error.message : String(error)];
  const body = (error as { body?: unknown })?.body;
  if (body !== undefined) {
    try {
      parts.push(typeof body === "string" ? body : JSON.stringify(body));
    } catch {
      // ignore serialization issues; message check below still applies
    }
  }
  return /ENOENT|no such (file|wiki page)/i.test(parts.join(" "));
}

async function wikiGetPageOrNull(
  client: PaperclipApiClient,
  input: { wikiId?: string; spaceSlug?: string; path: string },
): Promise<{ contents?: string; hash?: string; title?: string | null } | null> {
  try {
    return await wikiGetPage(client, input);
  } catch (error) {
    if (isMissingPageError(error)) return null;
    throw error;
  }
}


const skillIdSchema = z.string().min(1);
const skillFilePathSchema = z.string().min(1).max(512);

const listSkillsSchema = z.object({
  q: z.string().min(1).optional(),
  sort: z.enum(["alphabetical", "recent", "installs", "stars", "agents", "forks"]).optional(),
  scope: z.enum(["private", "company", "public_link"]).optional(),
  categories: z.array(z.string().min(1)).max(50).optional(),
});

const getSkillSchema = z.object({
  skillId: skillIdSchema,
});

const listCatalogSkillsSchema = z.object({
  kind: z.string().optional(),
  category: z.string().optional(),
  q: z.string().optional(),
});

const getCatalogSkillSchema = z.object({
  catalogId: z.string().min(1),
});

const createSkillToolSchema = z.object({}).merge(companySkillCreateSchema);

const updateSkillToolSchema = z.object({
  skillId: skillIdSchema,
}).merge(asObjectSchema(companySkillUpdateSchema));

const deleteSkillToolSchema = z.object({
  skillId: skillIdSchema,
});

const installCatalogSkillToolSchema = z.object({}).merge(companySkillInstallCatalogSchema);

const installSkillUpdateToolSchema = z.object({
  skillId: skillIdSchema,
}).merge(asObjectSchema(companySkillInstallUpdateSchema));





const getSkillFileToolSchema = z.object({
  skillId: skillIdSchema,
  path: skillFilePathSchema.optional().default("SKILL.md"),
});

const updateSkillFileToolSchema = z.object({
  skillId: skillIdSchema,
}).merge(companySkillFileUpdateSchema);


function asObjectSchema(schema: z.ZodTypeAny): z.ZodObject<any> {
  let current: unknown = schema;
  while (current instanceof z.ZodType && current.constructor?.name !== "ZodObject") {
    const inner = (current._def as unknown as { innerType?: unknown }).innerType;
    if (inner === undefined) break;
    current = inner;
  }
  if (!(current instanceof z.ZodObject)) {
    throw new Error("Expected an object schema for skill tool merge");
  }
  return current as z.ZodObject<any>;
}

function skillQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) search.append(key, String(entry));
    } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

function assertNoSkillApiRequestFallback(path: string): void {
  const normalized = path.split("?", 1)[0];
  if (/^\/companies\/[^/]+\/skills(\/|$)/.test(normalized) || normalized.startsWith("/skills/catalog")) {
    throw new Error("Use the dedicated paperclip*Skill tools instead of paperclipApiRequest for skill routes");
  }
}

const listIssuesSchema = z.object({
  // P1 2026-10-14: jawna paginacja — wczesniej brak limit/offset, wiec narzedzie
  // zawsze zwracalo domyslne 500 i cicho gubilo reszte (783 zadan w firmie).
  // Limit backendu: 1..1000, offset od 0; krotsza strona niz limit = koniec.
  limit: z.number().int().positive().max(1000).optional(),
  offset: z.number().int().nonnegative().optional(),
  status: z.string().optional(),
  projectId: z.string().guid().optional(),
  assigneeAgentId: z.string().guid().optional(),
  participantAgentId: z.string().guid().optional(),
  assigneeUserId: z.string().optional(),
  touchedByUserId: z.string().optional(),
  inboxArchivedByUserId: z.string().optional(),
  unreadForUserId: z.string().optional(),
  labelId: z.string().guid().optional(),
  executionWorkspaceId: z.string().guid().optional(),
  originKind: z.string().optional(),
  originId: z.string().optional(),
  includeRoutineExecutions: z.boolean().optional(),
  includeLiveDescendantSummary: z.boolean().optional(),
  q: z.string().optional(),
});

const listCommentsSchema = z.object({
  issueId: issueIdSchema,
  after: z.string().guid().optional(),
  order: z.enum(["asc", "desc"]).optional(),
  limit: z.number().int().positive().max(500).optional(),
});

const upsertDocumentToolSchema = z.object({
  issueId: issueIdSchema,
  key: documentKeySchema,
  title: z.string().trim().max(200).nullable().optional(),
  format: z.enum(["markdown"]).default("markdown"),
  body: z.string().max(524288),
  changeSummary: z.string().trim().max(500).nullable().optional(),
  baseRevisionId: z.string().guid().nullable().optional(),
});

const createIssueToolSchema = z.object({}).merge(createIssueInputSchema).extend({
  assigneeAgentId: z.string().guid().describe("Required agent owner for this task"),
});

const updateIssueToolSchema = z.object({
  issueId: issueIdSchema,
  runId: z.string().guid().optional(),
  operatorRunId: z.string().guid().optional(), // KOMAA-630: first-class operator alternative to runId
}).merge(updateIssueSchema);

const updateAgentToolSchema = z.object({
  agentId: z.string().guid(),
  reportsTo: agentIdOptional,
  capabilities: z.string().nullable().optional(),
}).refine(
  (input) => input.reportsTo !== undefined || input.capabilities !== undefined,
  { message: "Provide reportsTo or capabilities" },
);

const checkoutIssueToolSchema = z.object({
  issueId: issueIdSchema,
  agentId: agentIdOptional,
  expectedStatuses: checkoutIssueSchema.shape.expectedStatuses.optional(),
  runId: z.string().guid().optional().nullable(),
  operatorRunId: z.string().guid().optional().nullable(),
});

const addCommentToolSchema = z.object({
  issueId: issueIdSchema,
}).merge(addIssueCommentSchema);

const createSuggestTasksToolSchema = z.object({
  issueId: issueIdSchema,
  idempotencyKey: z.string().trim().max(255).nullable().optional(),
  sourceCommentId: z.string().guid().nullable().optional(),
  sourceRunId: z.string().guid().nullable().optional(),
  title: z.string().trim().max(240).nullable().optional(),
  summary: z.string().trim().max(1000).nullable().optional(),
  continuationPolicy: issueThreadInteractionContinuationPolicySchema.optional().default("wake_assignee"),
  payload: suggestTasksPayloadSchema.superRefine((value, ctx) => {
    for (const [index, task] of value.tasks.entries()) {
      if (!task.assigneeAgentId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Every suggested task must have an assigneeAgentId",
          path: ["tasks", index, "assigneeAgentId"],
        });
      }
    }
  }),
});

const createAskUserQuestionsToolSchema = z.object({
  issueId: issueIdSchema,
  idempotencyKey: z.string().trim().max(255).nullable().optional(),
  sourceCommentId: z.string().guid().nullable().optional(),
  sourceRunId: z.string().guid().nullable().optional(),
  title: z.string().trim().max(240).nullable().optional(),
  summary: z.string().trim().max(1000).nullable().optional(),
  continuationPolicy: issueThreadInteractionContinuationPolicySchema.optional().default("wake_assignee"),
  payload: askUserQuestionsPayloadSchema,
});

const createRequestConfirmationToolSchema = z.object({
  issueId: issueIdSchema,
  idempotencyKey: z.string().trim().max(255).nullable().optional(),
  sourceCommentId: z.string().guid().nullable().optional(),
  sourceRunId: z.string().guid().nullable().optional(),
  title: z.string().trim().max(240).nullable().optional(),
  summary: z.string().trim().max(1000).nullable().optional(),
  continuationPolicy: issueThreadInteractionContinuationPolicySchema.optional().default("none"),
  payload: requestConfirmationPayloadSchema,
});

const createRequestCheckboxConfirmationToolSchema = z.object({
  issueId: issueIdSchema,
  idempotencyKey: z.string().trim().max(255).nullable().optional(),
  sourceCommentId: z.string().guid().nullable().optional(),
  sourceRunId: z.string().guid().nullable().optional(),
  title: z.string().trim().max(240).nullable().optional(),
  summary: z.string().trim().max(1000).nullable().optional(),
  continuationPolicy: issueThreadInteractionContinuationPolicySchema.optional().default("wake_assignee"),
  payload: requestCheckboxConfirmationPayloadSchema,
});

const approvalDecisionSchema = z.object({
  approvalId: approvalIdSchema,
  action: z.enum(["approve", "reject", "requestRevision", "resubmit"]),
  decisionNote: z.string().optional(),
  payloadJson: z.string().optional(),
});

const createApprovalToolSchema = z.object({}).merge(createApprovalSchema);

// KOMAA-1171: the status-card write-back contract is published as an absolute
// API path ("PUT /api/status-cards/{id}/summary"), while this tool takes a
// path relative to /api. Accept the absolute form as an alias so the published
// instruction and the tool contract agree; without it the proxy answers
// 404 "API route not found" for a route that does exist.
function normalizeApiRelativePath(path: string): string {
  if (path === "/api") return "/";
  return path.startsWith("/api/") ? path.slice("/api".length) : path;
}

const apiRequestSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string().min(1),
  jsonBody: z.string().optional(),
  runId: z.string().guid().optional(),
  operatorRunId: z.string().guid().optional(), // KOMAA-630
});

const getRunDetailSchema = z.object({
  runId: z.string().guid(),
  includePrompt: z.boolean().optional().default(false),
  promptMaxChars: z.number().int().positive().max(20000).optional().default(4000),
});

function getJsonOrNull(client: PaperclipApiClient, path: string): Promise<unknown> {
  return client.requestJson("GET", path).catch((error: unknown) => ({
    error: error instanceof Error ? error.message : String(error),
  }));
}

function summarizeRunRecord(run: unknown): Record<string, unknown> | null {
  if (!isRecord(run)) return null;
  const usage = isRecord(run.usageJson) ? run.usageJson : null;
  const environment = isRecord(run.environment) ? run.environment : null;
  return {
    runId: (run.id ?? run.runId) ?? null,
    status: run.status ?? null,
    agentId: run.agentId ?? null,
    adapterType: run.adapterType ?? null,
    invocationSource: run.invocationSource ?? null,
    createdAt: run.createdAt ?? null,
    startedAt: run.startedAt ?? null,
    finishedAt: run.finishedAt ?? null,
    errorCode: run.errorCode ?? null,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    cachedInputTokens: usage?.cachedInputTokens ?? usage?.cache_read_input_tokens ?? null,
    costUsd: usage?.costUsd ?? usage?.total_cost_usd ?? null,
    logBytes: run.logBytes ?? null,
    livenessState: run.livenessState ?? null,
    livenessReason: run.livenessReason ?? null,
    environment: environment?.name ?? null,
  };
}

function summarizeAdapterInvoke(
  payload: unknown,
  opts: { includePrompt: boolean; promptMaxChars: number },
): Record<string, unknown> | null {
  if (!isRecord(payload)) return null;
  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  const promptMetrics = isRecord(payload.promptMetrics) ? payload.promptMetrics : null;
  const commandArgs = Array.isArray(payload.commandArgs) ? payload.commandArgs.map(String) : [];
  const joinedArgs = commandArgs.join(" ");
  const envKeys = isRecord(payload.env) ? Object.keys(payload.env).sort() : [];
  const context = isRecord(payload.context) ? payload.context : null;
  const wake = context && isRecord(context.paperclipWake) ? context.paperclipWake : null;
  const issue = wake && isRecord(wake.issue) ? wake.issue : null;
  const comments = wake && Array.isArray(wake.comments) ? wake.comments : [];
  const continuation = wake && isRecord(wake.continuationSummary) ? wake.continuationSummary : null;
  const taskMarkdown = context && typeof context.paperclipTaskMarkdown === "string"
    ? context.paperclipTaskMarkdown
    : "";
  const executionWorkspace = wake && isRecord(wake.executionWorkspace) ? wake.executionWorkspace : null;
  return {
    cwd: typeof payload.cwd === "string" ? payload.cwd : null,
    adapterType: typeof payload.adapterType === "string" ? payload.adapterType : null,
    model: joinedArgs.match(/--model\s+(\S+)/)?.[1] ?? null,
    agent: joinedArgs.match(/--agent\s+(\S+)/)?.[1] ?? null,
    promptChars: prompt.length,
    promptMetrics,
    envKeyCount: envKeys.length,
    envKeys,
    contextKeys: context ? Object.keys(context).sort() : [],
    wakeReason: context && typeof context.wakeReason === "string" ? context.wakeReason : null,
    issueIdentifier: issue && typeof issue.identifier === "string" ? issue.identifier : null,
    issueTitle: issue && typeof issue.title === "string" ? issue.title : null,
    issueStatus: issue && typeof issue.status === "string" ? issue.status : null,
    commentCount: comments.length,
    continuationSummaryChars: continuation && typeof continuation.body === "string"
      ? continuation.body.length
      : 0,
    taskMarkdownChars: taskMarkdown.length,
    workspaceBranch: executionWorkspace && typeof executionWorkspace.branchName === "string"
      ? executionWorkspace.branchName
      : null,
    prompt: opts.includePrompt
      ? {
        fullChars: prompt.length,
        truncated: prompt.length > opts.promptMaxChars,
        text: prompt.slice(0, opts.promptMaxChars),
      }
      : { included: false },
  };
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireAgentAssignee(body: unknown, operation: string): asserts body is Record<string, unknown> {
  if (!isRecord(body) || typeof body.assigneeAgentId !== "string" || body.assigneeAgentId.trim().length === 0) {
    throw new Error(`${operation} requires a non-empty assigneeAgentId; unassigned tasks are not allowed through Paperclip MCP`);
  }
}

function enforceTaskAssignmentPolicy(method: string, path: string, body: unknown) {
  const normalizedPath = path.split("?", 1)[0].replace(/\/+$/, "") || "/";
  const normalizedMethod = method.toUpperCase();

  if (normalizedMethod === "POST" && /^\/companies\/[^/]+\/issues$/.test(normalizedPath)) {
    requireAgentAssignee(body, "Task creation");
    return;
  }

  if (normalizedMethod === "POST" && /^\/issues\/[^/]+\/children$/.test(normalizedPath)) {
    requireAgentAssignee(body, "Child task creation");
    return;
  }

  if (normalizedMethod === "POST" && /^\/issues\/[^/]+\/accepted-plan-decompositions$/.test(normalizedPath)) {
    if (!isRecord(body) || !Array.isArray(body.children) || body.children.length === 0) {
      throw new Error("Accepted task decompositions require children with assigneeAgentId");
    }
    body.children.forEach((child, index) => requireAgentAssignee(child, `Accepted child task ${index + 1}`));
    return;
  }

  if (normalizedMethod === "POST" && /^\/issues\/[^/]+\/interactions$/.test(normalizedPath)) {
    if (!isRecord(body) || body.kind !== "suggest_tasks") return;
    const payload = body.payload;
    if (!isRecord(payload) || !Array.isArray(payload.tasks) || payload.tasks.length === 0) {
      throw new Error("Suggested tasks require tasks with assigneeAgentId");
    }
    payload.tasks.forEach((task, index) => requireAgentAssignee(task, `Suggested task ${index + 1}`));
    return;
  }

  if (normalizedMethod === "PATCH" && /^\/issues\/[^/]+$/.test(normalizedPath) && isRecord(body)) {
    if (
      ("assigneeAgentId" in body && (body.assigneeAgentId === null || body.assigneeAgentId === ""))
      || ("assigneeUserId" in body && body.assigneeUserId !== undefined && body.assigneeUserId !== null)
    ) {
      throw new Error("Task assignment cannot be removed or changed to a user through Paperclip MCP; keep an agent assignee");
    }
  }
}

const workspaceRuntimeControlTargetSchema = z.object({
  workspaceCommandId: z.string().min(1).optional().nullable(),
  runtimeServiceId: z.string().guid().optional().nullable(),
  serviceIndex: z.number().int().nonnegative().optional().nullable(),
});

const issueWorkspaceRuntimeControlSchema = z.object({
  issueId: issueIdSchema,
  action: z.enum(["start", "stop", "restart"]),
}).merge(workspaceRuntimeControlTargetSchema);

const waitForIssueWorkspaceServiceSchema = z.object({
  issueId: issueIdSchema,
  runtimeServiceId: z.string().guid().optional().nullable(),
  serviceName: z.string().min(1).optional().nullable(),
  timeoutSeconds: z.number().int().positive().max(300).optional(),
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readCurrentExecutionWorkspace(context: unknown): Record<string, unknown> | null {
  if (!context || typeof context !== "object") return null;
  const workspace = (context as { currentExecutionWorkspace?: unknown }).currentExecutionWorkspace;
  return workspace && typeof workspace === "object" ? workspace as Record<string, unknown> : null;
}

function readWorkspaceRuntimeServices(workspace: Record<string, unknown> | null): Array<Record<string, unknown>> {
  const raw = workspace?.runtimeServices;
  return Array.isArray(raw)
    ? raw.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    : [];
}

function selectRuntimeService(
  services: Array<Record<string, unknown>>,
  input: { runtimeServiceId?: string | null; serviceName?: string | null },
) {
  if (input.runtimeServiceId) {
    return services.find((service) => service.id === input.runtimeServiceId) ?? null;
  }
  if (input.serviceName) {
    return services.find((service) => service.serviceName === input.serviceName) ?? null;
  }
  return services.find((service) => service.status === "running" || service.status === "starting")
    ?? services[0]
    ?? null;
}

async function getIssueWorkspaceRuntime(client: PaperclipApiClient, issueId: string) {
  const context = await client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}/heartbeat-context`);
  const workspace = readCurrentExecutionWorkspace(context);
  return {
    context,
    workspace,
    runtimeServices: readWorkspaceRuntimeServices(workspace),
  };
}

export function createToolDefinitions(client: PaperclipApiClient): ToolDefinition[] {
  const all: ToolDefinition[] = [
    ...createAgentChatTools(client),
    makeTool(
      "paperclipMe",
      "Get the current authenticated Paperclip actor details",
      z.object({}),
      async () => client.defaults.principalKind === "board"
        ? {
          kind: "board", type: "board", role: "board",
          agentId: null, companyId: client.resolveCompanyId(),
          humanUserId: null, boardAuthorized: client.hasBoardCredential,
        }
        : client.requestJson("GET", "/agents/me"),
    ),
    makeTool(
      "paperclipInboxLite",
      "Get the current authenticated agent inbox-lite assignment list",
      z.object({}),
      async () => {
        if (client.defaults.principalKind === "board") {
          throw new Error("paperclipInboxLite is only available to agent principals");
        }
        return client.requestJson("GET", "/agents/me/inbox-lite");
      },
    ),
    makeTool(
      "paperclipListAgents",
      "List agents in a company",
      z.object({}),
      async () => client.requestJson("GET", `/companies/${client.resolveCompanyId()}/agents`),
    ),
    makeTool(
      "paperclipListSkills",
      "List the company skill library (all installed skills, independent of which agents have them enabled)",
      listSkillsSchema,
      async (input) =>
        client.requestJson("GET", `/companies/${client.resolveCompanyId()}/skills${skillQueryString(input)}`),
    ),
    makeTool(
      "paperclipGetAgent",
      "Get a single agent by id",
      z.object({ agentId: z.string().min(1) }),
      async ({ agentId }) => {
        const qs = "";
        return client.requestJson("GET", `/agents/${encodeURIComponent(agentId)}${qs}`);
      },
    ),
    makeTool(
      "paperclipListIssues",
      "List issues for a company with optional filters. Paged: pass limit (up to 1000) + offset; a short page means end. Default backend limit is 500, so unpaged calls silently miss records.",
      listIssuesSchema,
      async (input) => {
        const companyId = client.resolveCompanyId();
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(input)) {
          if (key === "companyId" || value === undefined || value === null) continue;
          params.set(key, String(value));
        }
        const qs = params.toString();
        return client.requestJson("GET", `/companies/${companyId}/issues${qs ? `?${qs}` : ""}`);
      },
    ),
    makeTool(
      "paperclipGetIssue",
      CRITICAL_GET_ISSUE,
      z.object({ issueId: issueIdSchema }),
      async ({ issueId }) => client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}`),
    ),
    makeTool(
      "paperclipGetHeartbeatContext",
      "Get compact heartbeat context for an issue",
      z.object({ issueId: issueIdSchema, wakeCommentId: z.string().guid().optional() }),
      async ({ issueId, wakeCommentId }) => {
        const qs = wakeCommentId ? `?wakeCommentId=${encodeURIComponent(wakeCommentId)}` : "";
        return client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}/heartbeat-context${qs}`);
      },
    ),
    makeTool(
      "paperclipListComments",
      "List issue comments with incremental options",
      listCommentsSchema,
      async ({ issueId, after, order, limit }) => {
        const params = new URLSearchParams();
        if (after) params.set("after", after);
        if (order) params.set("order", order);
        if (limit) params.set("limit", String(limit));
        const qs = params.toString();
        return client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}/comments${qs ? `?${qs}` : ""}`);
      },
    ),
    makeTool(
      "paperclipGetComment",
      "Get a specific issue comment by id",
      z.object({ issueId: issueIdSchema, commentId: z.string().guid() }),
      async ({ issueId, commentId }) =>
        client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}/comments/${encodeURIComponent(commentId)}`),
    ),
    makeTool(
      "paperclipListIssueApprovals",
      "List approvals linked to an issue",
      z.object({ issueId: issueIdSchema }),
      async ({ issueId }) => client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}/approvals`),
    ),
    makeTool(
      "paperclipListDocuments",
      "List issue documents",
      z.object({ issueId: issueIdSchema }),
      async ({ issueId }) => client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}/documents`),
    ),
    makeTool(
      "paperclipGetDocument",
      "Get one issue document by key",
      z.object({ issueId: issueIdSchema, key: documentKeySchema }),
      async ({ issueId, key }) =>
        client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}/documents/${encodeURIComponent(key)}`),
    ),
    makeTool(
      "paperclipListDocumentRevisions",
      "List revisions for an issue document",
      z.object({ issueId: issueIdSchema, key: documentKeySchema }),
      async ({ issueId, key }) =>
        client.requestJson(
          "GET",
          `/issues/${encodeURIComponent(issueId)}/documents/${encodeURIComponent(key)}/revisions`,
        ),
    ),
    makeTool(
      "paperclipListProjects",
      "List projects in a company",
      z.object({}),
      async () => client.requestJson("GET", `/companies/${client.resolveCompanyId()}/projects`),
    ),
    makeTool(
      "paperclipGetProject",
      "Get a project by id or company-scoped short reference",
      z.object({ projectId: projectIdSchema }),
      async ({ projectId }) => {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId);
        let id = projectId;
        if (!isUuid) {
          const listed = await client.requestJson<unknown>("GET", `/companies/${client.resolveCompanyId()}/projects`);
          const projects = Array.isArray(listed)
            ? listed
            : isRecord(listed) && Array.isArray(listed.projects)
              ? listed.projects
              : [];
          const match = projects.find((project) => isRecord(project) && (project.urlKey === projectId || project.id === projectId));
          if (!isRecord(match) || typeof match.id !== "string") {
            throw new Error(`Project short reference not found [errorCode=NOT_FOUND]`);
          }
          id = match.id;
        }
        return client.requestJson("GET", `/projects/${encodeURIComponent(id)}`);
      },
    ),
    makeTool(
      "paperclipGetIssueWorkspaceRuntime",
      "Get the current execution workspace and runtime services for an issue, including service URLs",
      z.object({ issueId: issueIdSchema }),
      async ({ issueId }) => getIssueWorkspaceRuntime(client, issueId),
    ),
    makeTool(
      "paperclipControlIssueWorkspaceServices",
      "Start, stop, or restart the current issue execution workspace runtime services",
      issueWorkspaceRuntimeControlSchema,
      async ({ issueId, action, ...target }) => {
        const runtime = await getIssueWorkspaceRuntime(client, issueId);
        const workspaceId = typeof runtime.workspace?.id === "string" ? runtime.workspace.id : null;
        if (!workspaceId) {
          throw new Error("Issue has no current execution workspace");
        }
        return client.requestJson(
          "POST",
          `/execution-workspaces/${encodeURIComponent(workspaceId)}/runtime-services/${action}`,
          { body: target },
        );
      },
    ),
    makeTool(
      "paperclipWaitForIssueWorkspaceService",
      "Wait until an issue execution workspace runtime service is running and has a URL when one is exposed",
      waitForIssueWorkspaceServiceSchema,
      async ({ issueId, runtimeServiceId, serviceName, timeoutSeconds }) => {
        const deadline = Date.now() + (timeoutSeconds ?? 60) * 1000;
        let latest: Awaited<ReturnType<typeof getIssueWorkspaceRuntime>> | null = null;
        while (Date.now() <= deadline) {
          latest = await getIssueWorkspaceRuntime(client, issueId);
          const service = selectRuntimeService(latest.runtimeServices, { runtimeServiceId, serviceName });
          if (service?.status === "running" && service.healthStatus !== "unhealthy") {
            return {
              workspace: latest.workspace,
              service,
            };
          }
          await sleep(1000);
        }

        return {
          timedOut: true,
          latestWorkspace: latest?.workspace ?? null,
          latestRuntimeServices: latest?.runtimeServices ?? [],
        };
      },
    ),
    makeTool(
      "paperclipListGoals",
      "List goals in a company",
      z.object({}),
      async () => client.requestJson("GET", `/companies/${client.resolveCompanyId()}/goals`),
    ),
    makeTool(
      "paperclipGetGoal",
      "Get a goal by id",
      z.object({ goalId: goalIdSchema }),
      async ({ goalId }) => client.requestJson("GET", `/goals/${encodeURIComponent(goalId)}`),
    ),
    makeTool(
      "paperclipListApprovals",
      "List approvals in a company",
      z.object({ status: z.string().optional() }),
      async ({ status }) => {
        const qs = status ? `?status=${encodeURIComponent(status)}` : "";
        return client.requestJson("GET", `/companies/${client.resolveCompanyId()}/approvals${qs}`);
      },
    ),
    makeTool(
      "paperclipCreateApproval",
      "Create a board approval request, optionally linked to one or more issues",
      createApprovalToolSchema.extend({
        runId: z.string().guid().optional().nullable(),
        operatorRunId: z.string().guid().optional().nullable(),
      }),
      async ({ runId, operatorRunId, ...body }: any) =>
        client.requestJson("POST", `/companies/${client.resolveCompanyId()}/approvals`, {
          body,
          runId: runId ?? undefined,
          operatorRunId: operatorRunId ?? undefined,
        }),
    ),
    makeTool(
      "paperclipGetApproval",
      "Get an approval by id",
      z.object({ approvalId: approvalIdSchema }),
      async ({ approvalId }) => client.requestJson("GET", `/approvals/${encodeURIComponent(approvalId)}`),
    ),
    makeTool(
      "paperclipGetApprovalIssues",
      "List issues linked to an approval",
      z.object({ approvalId: approvalIdSchema }),
      async ({ approvalId }) => client.requestJson("GET", `/approvals/${encodeURIComponent(approvalId)}/issues`),
    ),
    makeTool(
      "paperclipListApprovalComments",
      "List comments for an approval",
      z.object({ approvalId: approvalIdSchema }),
      async ({ approvalId }) => client.requestJson("GET", `/approvals/${encodeURIComponent(approvalId)}/comments`),
    ),
    makeTool(
      "paperclipCreateIssue",
      CRITICAL_CREATE_ISSUE,
      createIssueToolSchema.extend({
        runId: z.string().guid().optional().nullable(),
        operatorRunId: z.string().guid().optional().nullable(),
      }),
      async ({ runId, operatorRunId, ...body }: any) =>
        client.requestJson("POST", `/companies/${client.resolveCompanyId()}/issues`, {
          body,
          runId: runId ?? undefined,
          operatorRunId: operatorRunId ?? undefined,
        }),
    ),
    makeTool(
      "paperclipUpdateIssue",
      CRITICAL_UPDATE_ISSUE,
      updateIssueToolSchema,
      async ({ issueId, runId, operatorRunId, ...body }) => {
        const issuePath = `/issues/${encodeURIComponent(issueId)}`;
        enforceTaskAssignmentPolicy("PATCH", issuePath, body);
        // KOMAA-1415: a metadata-only PATCH (title/description/comment) of a
        // terminal issue has been observed to return it to `todo` upstream.
        // Pin the observed terminal status and prove it survived the write.
        let pinnedTerminalStatus: string | null = null;
        if (body.status === undefined && body.reopen !== true) {
          const current = await client.requestJson("GET", issuePath);
          const currentStatus = isRecord(current) && typeof current.status === "string" ? current.status : "";
          if (currentStatus === "done" || currentStatus === "cancelled") {
            pinnedTerminalStatus = currentStatus;
          }
        }
        const effectiveBody = pinnedTerminalStatus ? { ...body, status: pinnedTerminalStatus } : body;
        const result = await client.requestJson("PATCH", issuePath, { body: effectiveBody, runId, operatorRunId });
        if (pinnedTerminalStatus) {
          let after = await client.requestJson("GET", issuePath);
          let afterStatus = isRecord(after) && typeof after.status === "string" ? after.status : "";
          if (afterStatus !== pinnedTerminalStatus) {
            // Upstream ignored the pinned status: restore terminal state once,
            // then prove it. Never report success on an unexpected reopen.
            await client.requestJson("PATCH", issuePath, { body: { status: pinnedTerminalStatus }, runId, operatorRunId });
            after = await client.requestJson("GET", issuePath);
            afterStatus = isRecord(after) && typeof after.status === "string" ? after.status : "";
          }
          if (afterStatus !== pinnedTerminalStatus) {
            throw new Error(
              `Issue ${issueId} was ${pinnedTerminalStatus} and a metadata-only update left it ${afterStatus || "unknown"}; refusing to report success [errorCode=TERMINAL_STATUS_REOPENED]`,
            );
          }
        }
        return result;
      },
    ),
    makeTool(
      "paperclipUpdateAgent",
      "Update an agent's reportsTo or capabilities. Requires the persistent agents:configure policy grant.",
      updateAgentToolSchema,
      async ({ agentId, ...body }) =>
        client.requestJson("PATCH", `/agents/${encodeURIComponent(agentId)}`, { body }),
    ),
    makeTool(
      "paperclipCheckoutIssue",
      "Checkout an issue for an agent. REQUIRED for agent-actor callers: pass a live runId (own live issue run where supported); operator sessions are removed in Paperclip 2026.1012.0 (CAPABILITY_REMOVED) — without a live context cross-agent checkout fails. Checkout as board auto-wakes the assignee via the server.",
      checkoutIssueToolSchema,
      async ({ issueId, agentId, expectedStatuses, runId, operatorRunId }) =>
        client.requestJson("POST", `/issues/${encodeURIComponent(issueId)}/checkout`, {
          body: {
            agentId: client.resolveAgentId(agentId),
            expectedStatuses: expectedStatuses ?? ["todo", "backlog", "blocked"],
          },
          runId: runId ?? undefined, // FIX 2026-10-14: wczesniej brak forward
          operatorRunId: operatorRunId ?? undefined,
        }),
    ),
    makeTool(
      "paperclipWakeupAgent",
      "Direct agent wakeup via POST /agents/:id/wakeup (board-authorized for peer wakeup, agent self-invoke allowed). Uses board key for cross-agent wakeup so COO can wake Harness/Engineer without 403 'Agent can only invoke itself'. Optional operatorRunId is forwarded as audit scope. Prefer paperclipWakeIssueFresh/paperclipUnblockAndWake for issue-scoped wakes; use this for direct agent-level wakeup.",
      z.object({
        agentId: z.string().guid(),
        source: z.enum(["timer", "assignment", "on_demand", "automation"]).optional().default("on_demand"),
        triggerDetail: z.enum(["manual", "ping", "callback", "system"]).optional().default("manual"),
        reason: z.string().trim().max(1000).optional(),
        forceFreshSession: z.boolean().optional(),
        runId: z.string().guid().optional().nullable(),
        operatorRunId: z.string().guid().optional().nullable(),
      }),
      async ({ agentId, source, triggerDetail, reason, forceFreshSession, runId, operatorRunId }) =>
        client.requestJson("POST", `/agents/${encodeURIComponent(agentId)}/wakeup`, {
          body: {
            source: source ?? "on_demand",
            triggerDetail: triggerDetail ?? "manual",
            ...(reason ? { reason } : {}),
            ...(forceFreshSession !== undefined ? { forceFreshSession } : {}),
          },
          runId: runId ?? undefined,
          operatorRunId: operatorRunId ?? undefined,
        }),
    ),
    makeTool(
      "paperclipClearAgentError",
      "Clear an agent error flag via POST /agents/:id/clear-error (board-authorized; agents with invalid_org_chain get 409 with repair guidance instead). Uses board key like paperclipWakeupAgent.",
      z.object({
        agentId: z.string().guid(),
        runId: z.string().guid().optional().nullable(),
        operatorRunId: z.string().guid().optional().nullable(),
      }),
      async ({ agentId, runId, operatorRunId }) =>
        client.requestJson("POST", `/agents/${encodeURIComponent(agentId)}/clear-error`, {
          body: {},
          runId: runId ?? undefined,
          operatorRunId: operatorRunId ?? undefined,
        }),
    ),
    makeTool(
      "paperclipReleaseIssue",
      // P1 2026-10-14: brak forward -> 401 Agent run id required dla agent-actora.
      "Release an issue checkout. REQUIRED for agent-actor callers: pass a live runId (own live issue run where supported); operator sessions are removed in Paperclip 2026.1012.0 (CAPABILITY_REMOVED) — without a live context the call fails 401.",
      z.object({
        issueId: issueIdSchema,
        runId: z.string().guid().optional().nullable(),
        operatorRunId: z.string().guid().optional().nullable(),
      }),
      async ({ issueId, runId, operatorRunId }) =>
        client.requestJson("POST", `/issues/${encodeURIComponent(issueId)}/release`, {
          body: {},
          runId: runId ?? undefined,
          operatorRunId: operatorRunId ?? undefined,
        }),
    ),
    makeTool(
      "paperclipAddComment",
      "Add a comment to an issue; include resume=true when intentionally requesting follow-up on resumable closed work. For cross-issue writes, pass runId (X-Paperclip-Run-Id); operatorRunId (operator sessions) is removed in Paperclip 2026.1012.0 (CAPABILITY_REMOVED).",
      addCommentToolSchema.extend({
        runId: z.string().guid().optional().nullable(),
        operatorRunId: z.string().guid().optional().nullable(),
      }),
      async ({ issueId, runId, operatorRunId, ...body }) =>
        client.requestJson("POST", `/issues/${encodeURIComponent(issueId)}/comments`, { body, runId, operatorRunId }),
    ),
    makeTool(
      "paperclipSuggestTasks",
      "Create a suggest_tasks interaction on an issue; every suggested task requires assigneeAgentId",
      createSuggestTasksToolSchema.extend({
        runId: z.string().guid().optional().nullable(),
        operatorRunId: z.string().guid().optional().nullable(),
      }),
      // P1 2026-10-14: backend wymaga run-id dla agent-actora; forward jak w AddComment.
      async ({ issueId, runId, operatorRunId, ...body }) =>
        client.requestJson("POST", `/issues/${encodeURIComponent(issueId)}/interactions`, {
          body: {
            kind: "suggest_tasks",
            ...body,
          },
          runId: runId ?? undefined,
          operatorRunId: operatorRunId ?? undefined,
        }),
    ),
    makeTool(
      "paperclipAskUserQuestions",
      "Create an ask_user_questions interaction on an issue",
      createAskUserQuestionsToolSchema.extend({
        runId: z.string().guid().optional().nullable(),
        operatorRunId: z.string().guid().optional().nullable(),
      }),
      // P1 2026-10-14: backend wymaga run-id dla agent-actora; forward jak w AddComment.
      async ({ issueId, runId, operatorRunId, ...body }) =>
        client.requestJson("POST", `/issues/${encodeURIComponent(issueId)}/interactions`, {
          body: {
            kind: "ask_user_questions",
            ...body,
          },
          runId: runId ?? undefined,
          operatorRunId: operatorRunId ?? undefined,
        }),
    ),
    makeTool(
      "paperclipRequestConfirmation",
      "Create a request_confirmation interaction on an issue",
      createRequestConfirmationToolSchema.extend({
        runId: z.string().guid().optional().nullable(),
        operatorRunId: z.string().guid().optional().nullable(),
      }),
      // P1 2026-10-14: backend wymaga run-id dla agent-actora; forward jak w AddComment.
      async ({ issueId, runId, operatorRunId, ...body }) =>
        client.requestJson("POST", `/issues/${encodeURIComponent(issueId)}/interactions`, {
          body: {
            kind: "request_confirmation",
            ...body,
          },
          runId: runId ?? undefined,
          operatorRunId: operatorRunId ?? undefined,
        }),
    ),
    makeTool(
      "paperclipRequestCheckboxConfirmation",
      "Create a request_checkbox_confirmation interaction on an issue",
      createRequestCheckboxConfirmationToolSchema.extend({
        runId: z.string().guid().optional().nullable(),
        operatorRunId: z.string().guid().optional().nullable(),
      }),
      // P1 2026-10-14: backend wymaga run-id dla agent-actora; forward jak w AddComment.
      async ({ issueId, runId, operatorRunId, ...body }) =>
        client.requestJson("POST", `/issues/${encodeURIComponent(issueId)}/interactions`, {
          body: {
            kind: "request_checkbox_confirmation",
            ...body,
          },
          runId: runId ?? undefined,
          operatorRunId: operatorRunId ?? undefined,
        }),
    ),
    makeTool(
      "paperclipListIssueInteractions",
      "List thread interactions (confirmations, questions, checkbox confirmations) on an issue, including pending ones awaiting accept/reject",
      z.object({
        issueId: issueIdSchema,
      }),
      async ({ issueId }) =>
        client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}/interactions`),
    ),
    makeTool(
      "paperclipAcceptInteraction",
      "Accept a pending issue-thread interaction (e.g. request_confirmation). Anyone allowed by the interaction resolverPolicy may accept; reject only with reason via paperclipRejectInteraction. Not for ask_user_questions — close those with paperclipCancelIssueInteraction.",
      z.object({
        issueId: issueIdSchema,
        interactionId: z.string().guid(),
        selectedClientKeys: z.array(z.string().trim().min(1).max(120)).min(1).max(50).optional(),
        selectedOptionIds: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
        runId: z.string().guid().optional().nullable(),
        operatorRunId: z.string().guid().optional().nullable(),
      }),
      async ({ issueId, interactionId, runId, operatorRunId, ...body }) =>
        client.requestJson(
          "POST",
          `/issues/${encodeURIComponent(issueId)}/interactions/${encodeURIComponent(interactionId)}/accept`,
          { body, runId: runId ?? undefined, operatorRunId: operatorRunId ?? undefined },
        ),
    ),
    makeTool(
      "paperclipRejectInteraction",
      "Reject/dismiss a pending issue-thread interaction with an optional reason (required by some confirmation kinds). Not for ask_user_questions — those cannot be rejected; close them with paperclipCancelIssueInteraction.",
      z.object({
        issueId: issueIdSchema,
        interactionId: z.string().guid(),
        reason: z.string().trim().max(4000).optional(),
        runId: z.string().guid().optional().nullable(),
        operatorRunId: z.string().guid().optional().nullable(),
      }),
      async ({ issueId, interactionId, reason, runId, operatorRunId }) =>
        client.requestJson(
          "POST",
          `/issues/${encodeURIComponent(issueId)}/interactions/${encodeURIComponent(interactionId)}/reject`,
          { body: { ...(reason ? { reason } : {}) }, runId: runId ?? undefined, operatorRunId: operatorRunId ?? undefined },
        ),
    ),
    makeTool(
      "paperclipCancelIssueInteraction",
      "Cancel a pending issue-thread interaction with no accept/reject path (e.g. ask_user_questions). Anyone allowed by the interaction resolverPolicy; the prompt is recorded cancelled, never answered.",
      z.object({
        issueId: issueIdSchema,
        interactionId: z.string().guid(),
        runId: z.string().guid().optional().nullable(),
        operatorRunId: z.string().guid().optional().nullable(),
      }),
      async ({ issueId, interactionId, runId, operatorRunId }) =>
        client.requestJson(
          "POST",
          `/issues/${encodeURIComponent(issueId)}/interactions/${encodeURIComponent(interactionId)}/cancel`,
          { body: {}, runId: runId ?? undefined, operatorRunId: operatorRunId ?? undefined },
        ),
    ),
    makeTool(
      "paperclipUpsertIssueDocument",
      "Create or update an issue document",
      upsertDocumentToolSchema.extend({
        runId: z.string().guid().optional().nullable(),
        operatorRunId: z.string().guid().optional().nullable(),
      }),
      // P1 2026-10-14: PUT documents wymaga run-context dla agent-actora.
      async ({ issueId, key, runId, operatorRunId, ...body }) =>
        client.requestJson(
          "PUT",
          `/issues/${encodeURIComponent(issueId)}/documents/${encodeURIComponent(key)}`,
          { body, runId: runId ?? undefined, operatorRunId: operatorRunId ?? undefined },
        ),
    ),
    makeTool(
      "paperclipRestoreIssueDocumentRevision",
      "Restore a prior revision of an issue document",
      z.object({
        issueId: issueIdSchema,
        key: documentKeySchema,
        revisionId: z.string().guid(),
        runId: z.string().guid().optional().nullable(),
        operatorRunId: z.string().guid().optional().nullable(),
      }),
      async ({ issueId, key, revisionId, runId, operatorRunId }) =>
        client.requestJson(
          "POST",
          `/issues/${encodeURIComponent(issueId)}/documents/${encodeURIComponent(key)}/revisions/${encodeURIComponent(revisionId)}/restore`,
          { body: {}, runId: runId ?? undefined, operatorRunId: operatorRunId ?? undefined },
        ),
    ),
    makeTool(
      "paperclipLinkIssueApproval",
      "Link an approval to an issue",
      z.object({ issueId: issueIdSchema }).merge(linkIssueApprovalSchema).extend({
        runId: z.string().guid().optional().nullable(),
        operatorRunId: z.string().guid().optional().nullable(),
      }),
      async ({ issueId, approvalId, runId, operatorRunId }) =>
        client.requestJson("POST", `/issues/${encodeURIComponent(issueId)}/approvals`, {
          body: { approvalId },
          runId: runId ?? undefined,
          operatorRunId: operatorRunId ?? undefined,
        }),
    ),
    makeTool(
      "paperclipUnlinkIssueApproval",
      "Unlink an approval from an issue",
      z.object({
        issueId: issueIdSchema,
        approvalId: approvalIdSchema,
        runId: z.string().guid().optional().nullable(),
        operatorRunId: z.string().guid().optional().nullable(),
      }),
      async ({ issueId, approvalId, runId, operatorRunId }) =>
        client.requestJson(
          "DELETE",
          `/issues/${encodeURIComponent(issueId)}/approvals/${encodeURIComponent(approvalId)}`,
          { runId: runId ?? undefined, operatorRunId: operatorRunId ?? undefined },
        ),
    ),
    makeTool(
      "paperclipApprovalDecision",
      "Approve, reject, request revision, or resubmit an approval",
      approvalDecisionSchema.extend({
        runId: z.string().guid().optional().nullable(),
        operatorRunId: z.string().guid().optional().nullable(),
      }),
      async ({ approvalId, action, decisionNote, payloadJson, runId, operatorRunId }) => {
        const path =
          action === "approve"
            ? `/approvals/${encodeURIComponent(approvalId)}/approve`
            : action === "reject"
              ? `/approvals/${encodeURIComponent(approvalId)}/reject`
              : action === "requestRevision"
                ? `/approvals/${encodeURIComponent(approvalId)}/request-revision`
                : `/approvals/${encodeURIComponent(approvalId)}/resubmit`;

        const body =
          action === "resubmit"
            ? { payload: parseOptionalJson(payloadJson) ?? {} }
            : { decisionNote };

        return client.requestJson("POST", path, { body, runId: runId ?? undefined, operatorRunId: operatorRunId ?? undefined });
      },
    ),
    makeTool(
      "paperclipAddApprovalComment",
      "Add a comment to an approval",
      z.object({
        approvalId: approvalIdSchema,
        body: z.string().min(1),
        runId: z.string().guid().optional().nullable(),
        operatorRunId: z.string().guid().optional().nullable(),
      }),
      async ({ approvalId, body, runId, operatorRunId }) =>
        client.requestJson("POST", `/approvals/${encodeURIComponent(approvalId)}/comments`, {
          body: { body },
          runId: runId ?? undefined,
          operatorRunId: operatorRunId ?? undefined,
        }),
    ),
    makeTool(
      "paperclipWikiList",
      "List wiki pages (path + title). Use for routing, not full reads.",
      z.object({
        ...wikiScopeFields,
        pageType: z.string().min(1).max(32).optional(),
        limit: z.number().int().positive().max(200).optional(),
      }),
      async (input: any) => {
        const pages = await wikiListPages(client, {
          ...input,
          limit: input.limit ?? 100,
        });
        return { data: { pages } };
      },
    ),
    makeTool(
      "paperclipWikiSearch",
      "Substring search over wiki page paths and titles. Returns up to 20 matches.",
      z.object({
        ...wikiScopeFields,
        query: z.string().trim().min(1).max(200),
        limit: z.number().int().positive().max(200).optional(),
      }),
      async (input: any) => {
        const pages = await wikiListPages(client, { ...input, limit: input.limit ?? 200 });
        const needle = (input.query as string).toLowerCase();
        const matches = pages
          .filter((page) =>
            page.path.toLowerCase().includes(needle) ||
            (page.title ?? "").toLowerCase().includes(needle),
          )
          .slice(0, 20);
        return { query: input.query, matchCount: matches.length, matches };
      },
    ),
    makeTool(
      "paperclipWikiGetPage",
      "Read one full wiki page as markdown, with its current hash for edits.",
      z.object({ ...wikiScopeFields, path: wikiPagePathSchema }),
      async (input: any) => {
        try {
          return { data: await wikiGetPage(client, input) };
        } catch (error) {
          if (isMissingPageError(error)) {
            throw new Error(`No such wiki page: ${input.path} [errorCode=NOT_FOUND]`);
          }
          throw error;
        }
      },
    ),
    makeTool(
      "paperclipWikiProposeChange",
      "Dry-run a wiki page write: returns current/proposed hashes plus added/removed line counts. Does NOT write.",
      z.object({
        ...wikiScopeFields,
        path: wikiPagePathSchema,
        contents: z.string().min(1).max(524288),
        summary: z.string().trim().max(500).optional(),
      }),
      async (input: any) => {
        const current = await wikiGetPageOrNull(client, input);
        const currentContents = current?.contents ?? "";
        const stat = wikiDiffStat(currentContents, input.contents as string);
        return {
          path: input.path,
          summary: input.summary ?? null,
          currentHash: current?.hash ?? sha256Hex(currentContents),
          proposedHash: sha256Hex(input.contents as string),
          addedLines: stat.added,
          removedLines: stat.removed,
          proposedContents: input.contents,
          note: "Review proposedContents, then call paperclipWikiApplyChange with expectedHash=currentHash.",
        };
      },
    ),
    makeTool(
      "paperclipWikiApplyChange",
      "Write a wiki page. Requires expectedHash from GetPage/ProposeChange; refuses on conflict instead of overwriting.",
      z.object({
        ...wikiScopeFields,
        path: wikiPagePathSchema,
        contents: z.string().min(1).max(524288),
        expectedHash: z.string().trim().min(8).max(128),
        summary: z.string().trim().max(500).optional(),
      }),
      async (input: any) => wikiWriteWithFallback(client, input,
        () => client.requestJson(
          "POST",
          `/plugins/${WIKI_PLUGIN_ID}/actions/write-page`,
          {
            body: {
                companyId: client.resolveCompanyId(),
                params: {
                ...wikiScopeParams(input),
                path: input.path,
                contents: input.contents,
                expectedHash: input.expectedHash,
                ...(input.summary ? { summary: input.summary } : {}),
              },
            },
          },
        ),
        () => wikiFileApply(input),
      ),
    ),
    makeTool(
      "paperclipWikiCreatePage",
      "Create a new wiki page (parent folders are created automatically). Fails if the page already exists.",
      z.object({
        ...wikiScopeFields,
        path: wikiPagePathSchema,
        contents: z.string().min(1).max(524288),
        summary: z.string().trim().max(500).optional(),
      }),
      async (input: any) => {
        const existing = await wikiGetPageOrNull(client, input);
        if (existing?.contents) {
          throw new Error(
            `Wiki page already exists: ${input.path}. Read it and use paperclipWikiProposeChange/paperclipWikiApplyChange to edit.`,
          );
        }
        return wikiWriteWithFallback(client, input,
          () => client.requestJson(
            "POST",
            `/plugins/${WIKI_PLUGIN_ID}/actions/write-page`,
            {
              body: {
                  companyId: client.resolveCompanyId(),
                  params: {
                  ...wikiScopeParams(input),
                  path: input.path,
                  contents: input.contents,
                  ...(input.summary ? { summary: input.summary } : {}),
                },
              },
            },
          ),
          () => wikiFileCreate(input),
        );
      },
    ),
    makeTool(
      "paperclipGetRunDetail",
      "Get a single run with token usage, lifecycle stages and a redacted summary of the agent input (adapter.invoke envelope: prompt metrics, env key names only, context keys, wake issue). Full prompt text only when includePrompt=true (truncated, secrets never included).",
      getRunDetailSchema,
      async ({ runId, includePrompt, promptMaxChars }) => {
        const encoded = encodeURIComponent(runId);
        const [run, events, issues, operations] = await Promise.all([
          client.requestJson("GET", `/heartbeat-runs/${encoded}`),
          client.requestJson("GET", `/heartbeat-runs/${encoded}/events`),
          getJsonOrNull(client, `/heartbeat-runs/${encoded}/issues`),
          getJsonOrNull(client, `/heartbeat-runs/${encoded}/workspace-operations`),
        ]);
        const eventList = Array.isArray(events) ? events : [];
        const invoke = eventList.find((event) => isRecord(event) && event.eventType === "adapter.invoke");
        const invokePayload = invoke && isRecord(invoke) ? invoke.payload : null;
        return {
          run: summarizeRunRecord(run),
          stages: eventList.map((event) => {
            if (!isRecord(event)) return { raw: event };
            const result = isRecord(event.payload) ? event.payload : null;
            return {
              seq: event.seq ?? null,
              eventType: event.eventType ?? null,
              message: event.message ?? null,
              createdAt: event.createdAt ?? null,
              status: result && typeof result.status === "string" ? result.status : null,
              exitCode: result && typeof result.exitCode === "number" ? result.exitCode : null,
            };
          }),
          agentInput: summarizeAdapterInvoke(invokePayload, { includePrompt, promptMaxChars }),
          linkedIssues: Array.isArray(issues)
            ? issues.map((entry) => isRecord(entry)
              ? {
                issueId: entry.issueId ?? null,
                identifier: entry.identifier ?? null,
                title: entry.title ?? null,
                status: entry.status ?? null,
              }
              : { raw: entry })
            : issues,
          workspaceOperations: Array.isArray(operations)
            ? operations.map((op) => isRecord(op)
              ? {
                phase: op.phase ?? null,
                status: op.status ?? null,
                exitCode: op.exitCode ?? null,
                cwd: op.cwd ?? null,
                logBytes: op.logBytes ?? null,
              }
              : { raw: op })
            : operations,
        };
      },
    ),
    makeTool(
      "paperclipGetSkill",
      "Get a single company skill with versions, agent usage and update status",
      getSkillSchema,
      async ({ skillId }) =>
        client.requestJson("GET", `/companies/${client.resolveCompanyId()}/skills/${encodeURIComponent(skillId)}`),
    ),
    makeTool(
      "paperclipListCatalogSkills",
      "List installable skills from the Paperclip catalog (use the catalogId with paperclipInstallCatalogSkill)",
      listCatalogSkillsSchema,
      async (input) =>
        client.requestJson("GET", `/skills/catalog${skillQueryString(input)}`),
    ),
    makeTool(
      "paperclipGetCatalogSkill",
      "Get one catalog skill with its file inventory",
      getCatalogSkillSchema,
      async ({ catalogId }) =>
        client.requestJson("GET", `/skills/catalog/${encodeURIComponent(catalogId)}`),
    ),
    makeTool(
      "paperclipCreateSkill",
      "Create a company skill from inline markdown (policy: skills.create)",
      createSkillToolSchema,
      async (body) =>
        client.requestJson("POST", `/companies/${client.resolveCompanyId()}/skills`, { body }),
    ),
    makeTool(
      "paperclipUpdateSkill",
      "Update company skill metadata: description, icon, categories, sharing scope (policy: skills.edit)",
      updateSkillToolSchema,
      async ({ skillId: rawSkillId, ...body }) =>
        client.requestJson("PATCH", `/companies/${client.resolveCompanyId()}/skills/${encodeURIComponent(rawSkillId as string)}`, { body }),
    ),
    makeTool(
      "paperclipDeleteSkill",
      "Delete a company skill (policy: skills.remove)",
      deleteSkillToolSchema,
      async ({ skillId }) =>
        client.requestJson("DELETE", `/companies/${client.resolveCompanyId()}/skills/${encodeURIComponent(skillId)}`),
    ),
    makeTool(
      "paperclipInstallCatalogSkill",
      "Install or update a skill from the catalog by catalogSkillId (policy: skills.install)",
      installCatalogSkillToolSchema,
      async (body) =>
        client.requestJson("POST", `/companies/${client.resolveCompanyId()}/skills/install-catalog`, { body }),
    ),
    makeTool(
      "paperclipInstallSkillUpdate",
      "Install the pending origin update for a skill; set force=true to overwrite local modifications (policy: skills.update). Check paperclipGetSkillUpdateStatus first.",
      installSkillUpdateToolSchema,
      async ({ skillId: rawSkillId, ...body }) =>
        client.requestJson(
          "POST",
          `/companies/${client.resolveCompanyId()}/skills/${encodeURIComponent(rawSkillId as string)}/install-update`,
          { body },
        ),
    ),
    makeTool(
      "paperclipGetSkillUpdateStatus",
      "Check whether a skill has a pending origin update and why it may be held (local_modifications, audit_hard_stop, ...)",
      getSkillSchema,
      async ({ skillId }) =>
        client.requestJson(
          "GET",
          `/companies/${client.resolveCompanyId()}/skills/${encodeURIComponent(skillId)}/update-status`,
        ),
    ),
    makeTool(
      "paperclipGetSkillFile",
      "Read one skill file (default SKILL.md)",
      getSkillFileToolSchema,
      async ({ skillId, path }) =>
        client.requestJson(
          "GET",
          `/companies/${client.resolveCompanyId()}/skills/${encodeURIComponent(skillId)}/files${skillQueryString({ path })}`,
        ),
    ),
    makeTool(
      "paperclipUpdateSkillFile",
      "Create or overwrite one skill file (policy: skills.edit)",
      updateSkillFileToolSchema,
      async ({ skillId, ...body }) =>
        client.requestJson(
          "PATCH",
          `/companies/${client.resolveCompanyId()}/skills/${encodeURIComponent(skillId)}/files`,
          { body },
        ),
    ),
    makeTool(
      "paperclipAuditSkill",
      "Audit a skill against its origin and content checks (policy: skills.test)",
      getSkillSchema,
      async ({ skillId }) =>
        client.requestJson(
          "POST",
          `/companies/${client.resolveCompanyId()}/skills/${encodeURIComponent(skillId)}/audit`,
          { body: {} },
        ),
    ),
    makeTool(
      "paperclipApiRequest",
      CRITICAL_API_REQUEST,
      apiRequestSchema,
      async ({ method, path, jsonBody, runId, operatorRunId }) => {
        if (!path.startsWith("/") || path.includes("..")) {
          throw new Error("path must start with / and be relative to /api, and must not contain '..'");
        }
        const apiPath = normalizeApiRelativePath(path); // KOMAA-1171
        assertNoSkillApiRequestFallback(apiPath);
        const body = parseOptionalJson(jsonBody);
        enforceTaskAssignmentPolicy(method, apiPath, body);
        return client.requestJson(method, apiPath, { body, runId, operatorRunId }); // KOMAA-630
      },
    ),
    ];
  all.push(...createControlPlaneTools(client));
  all.push(...createWorkspaceNativeTools(client));
  all.push(...createEffectiveAccessTools(client));
  all.push(...createLiveVerifyTools(client));
  all.push(...createP1GitTools(client));
  all.push(...createP1PlatformTools(client));
  all.push(...createIssueFieldTools(client));
  // --- Filter to whitelist / env override ---
  const filtered = all.filter(t => isToolEnabled(t.name));
  if (filtered.length !== all.length) {
    console.error(`[paperclip-mcp] Tool filter active: ${filtered.length}/${all.length} tools enabled`);
  }
  return filtered;
}



