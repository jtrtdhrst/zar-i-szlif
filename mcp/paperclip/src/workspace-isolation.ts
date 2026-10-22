// MCP-side fail-closed workspace-isolation guard for child issue creation
// (KOMAA-468). MCP layer only, no Paperclip Core change.
//
// DEFECT (live, reproduced 2026-10-20 on this instance)
//
// Paperclip Core binds a child's execution workspace to the PARENT's
// workspace whenever `parentId` is set and the caller passes no explicit
// workspace fields:
//
//   server/src/services/issues.ts
//     const workspaceInheritanceIssueId = skipExecutionWorkspaceInheritance
//       ? null
//       : (inheritExecutionWorkspaceFromIssueId ?? issueData.parentId ?? null);
//     ...  executionWorkspaceId        = sourceWorkspace.id;
//          executionWorkspacePreference = "reuse_existing";
//
// The child therefore lands in the parent's worktree on the parent's branch.
// Measured on 2026-10-20: execution workspace f7ce6667 (branch KOMAA-774)
// was bound to 23 issues and carried two live runs of two DIFFERENT agents
// at the same time (KOMAA-1082 Harness run 2d5acc44, KOMAA-1086 Engineer
// run 60a92f9f). The project policy that should have prevented this
// (defaultMode=isolated_workspace, branchTemplate={{issue.identifier}})
// never applied: inheritance short-circuits provisioning, so no per-issue
// branch is ever created.
//
// WHAT THIS GUARD DOES
//
// When a child is created under a parent that owns an ISOLATED execution
// workspace, the gateway injects an explicit per-issue workspace preference
// derived from the source project policy. Paperclip Core then provisions the
// child's OWN branch ({{issue.identifier}}) instead of reusing the parent's
// worktree.
//
// A shared / project_primary parent workspace is left alone: that is an
// explicitly reusable shared workspace, and the existing shared-workspace
// holder gate serializes concurrent writers on it.
//
// SCOPE HONESTY (do not overclaim):
//   * This guard protects traffic that flows through the Paperclip MCP
//     gateway.
//   * Direct API clients and the Paperclip UI can still create an inheriting
//     child outside MCP. The global fix is a Paperclip Core change
//     (server/src/services/issues.ts, the workspace-inheritance block) which
//     is routed to the Core owner; it is NOT claimed as fixed here.

export interface WorkspaceIsolationReader {
  getJsonOrNull<T>(path: string): Promise<T | null>;
}

export type WorkspaceIsolationCode =
  | "EXPLICIT_OVERRIDE_ALLOWED"
  | "NO_PARENT"
  | "NO_PARENT_WORKSPACE"
  | "SHARED_WORKSPACE_REUSE_ALLOWED"
  | "ISOLATED_PARENT_WORKSPACE_ISOLATED"
  | "PARENT_UNREADABLE"
  | "PROJECT_OVERRIDE_FORBIDDEN"
  | "CROSS_ISSUE_LEASE_REFUSED"
  | "CROSS_ISSUE_LEASE_UNCONTENDED"
  | "GUARD_SKIPPED_UNREADABLE";

export interface WorkspaceIsolationDecision {
  code: WorkspaceIsolationCode;
  /** inherited = parent workspace may be reused; isolated = child gets its own. */
  isolation: "inherited" | "isolated" | "refused";
  reason: string;
  parentIssueId: string | null;
  parentWorkspaceId: string | null;
  /** Present when the caller body must be amended to keep the child isolated. */
  injected?: {
    executionWorkspacePreference: string;
    executionWorkspaceSettings: Record<string, unknown>;
  };
}

export class WorkspaceIsolationError extends Error {
  readonly code: WorkspaceIsolationCode;

  constructor(code: WorkspaceIsolationCode, message: string) {
    super(`${message} (guard scope: MCP gateway only - direct API clients are not covered) [errorCode=${code}]`);
    this.name = "WorkspaceIsolationError";
    this.code = code;
    (this as unknown as Record<string, unknown>).detail = {
      errorCode: code,
      remediationOwner: "caller",
      remediation:
        "Do not create a child that silently reuses the parent's worktree. Give the child its own issue branch, or use an explicitly shared workspace that the project policy serializes. Do not bypass the guard with another route - direct API clients are not covered by this MCP-side guard.",
    };
  }
}

interface ProjectPolicy {
  enabled?: boolean;
  defaultMode?: string;
  allowIssueOverride?: boolean;
  sharedWorkspaceConcurrency?: string;
  workspaceStrategy?: {
    type?: string;
    baseRef?: string;
    branchTemplate?: string;
  } | null;
}

const PER_ISSUE_BRANCH_TEMPLATE = "{{issue.identifier}}";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(source: unknown, key: string): string | null {
  if (!isRecord(source)) return null;
  const value = source[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readRecord(source: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(source)) return null;
  const value = source[key];
  return isRecord(value) ? value : null;
}

/**
 * The caller already decided where the child should run. Any explicit
 * workspace field (a pinned workspace id, explicit settings, or a concrete
 * preference) is caller authority and is never overridden. `inherit` is NOT
 * authority: it just restates the default inheritance this guard removes.
 */
export function hasExplicitWorkspaceOverride(body: Record<string, unknown>): boolean {
  if (body.executionWorkspaceId !== undefined && body.executionWorkspaceId !== null) return true;
  if (body.executionWorkspaceSettings !== undefined && body.executionWorkspaceSettings !== null) return true;
  const preference = body.executionWorkspacePreference;
  if (typeof preference === "string" && preference.trim() !== "" && preference !== "inherit") return true;
  return false;
}

/**
 * A branch template that is not per-issue would give the child the parent's
 * branch name, which is the second half of the same defect.
 */
export function perIssueBranchTemplate(template: string | null | undefined): string {
  if (typeof template !== "string") return PER_ISSUE_BRANCH_TEMPLATE;
  return template.includes("issue.identifier") ? template : PER_ISSUE_BRANCH_TEMPLATE;
}

function buildPerIssueWorkspaceOverride(policy: ProjectPolicy | null): {
  executionWorkspacePreference: string;
  executionWorkspaceSettings: Record<string, unknown>;
} {
  const shared = policy?.defaultMode === "shared_workspace";
  if (shared) {
    // The project authorizes a shared workspace; the child must use the
    // project's shared workspace, never the parent's isolated one.
    return {
      executionWorkspacePreference: "shared_workspace",
      executionWorkspaceSettings: {
        mode: "shared_workspace",
        ...(policy?.sharedWorkspaceConcurrency
          ? { sharedWorkspaceConcurrency: policy.sharedWorkspaceConcurrency }
          : {}),
      },
    };
  }
  const strategy = policy?.workspaceStrategy ?? null;
  const type =
    typeof strategy?.type === "string" && strategy.type !== "project_primary"
      ? strategy.type
      : "git_worktree";
  return {
    executionWorkspacePreference: "isolated_workspace",
    executionWorkspaceSettings: {
      mode: "isolated_workspace",
      workspaceStrategy: {
        type,
        ...(typeof strategy?.baseRef === "string" && strategy.baseRef ? { baseRef: strategy.baseRef } : {}),
        branchTemplate: perIssueBranchTemplate(strategy?.branchTemplate),
      },
    },
  };
}

async function readParentWorkspaceMode(
  reader: WorkspaceIsolationReader,
  parent: Record<string, unknown>,
  parentWorkspaceId: string,
): Promise<string | null> {
  const settings = readRecord(parent, "executionWorkspaceSettings");
  const mode = settings ? readString(settings, "mode") : null;
  if (mode) return mode;
  const workspace = await reader.getJsonOrNull<Record<string, unknown>>(
    `/execution-workspaces/${encodeURIComponent(parentWorkspaceId)}`,
  );
  return workspace ? readString(workspace, "mode") : null;
}

async function readProjectPolicy(
  reader: WorkspaceIsolationReader,
  projectId: string | null,
): Promise<ProjectPolicy | null> {
  if (!projectId) return null;
  const project = await reader.getJsonOrNull<Record<string, unknown>>(
    `/projects/${encodeURIComponent(projectId)}`,
  );
  const policy = project ? readRecord(project, "executionWorkspacePolicy") : null;
  return policy as ProjectPolicy | null;
}

/**
 * Decide whether a child may inherit its parent's execution workspace.
 *
 * Refuses (fail-closed) only what cannot be proven safe; otherwise returns the
 * explicit per-issue override that keeps the child on its own branch.
 */
export async function evaluateChildWorkspaceIsolation(
  reader: WorkspaceIsolationReader,
  input: { parentId: string; body: Record<string, unknown> },
): Promise<WorkspaceIsolationDecision> {
  const body = input.body;
  if (hasExplicitWorkspaceOverride(body)) {
    return {
      code: "EXPLICIT_OVERRIDE_ALLOWED",
      isolation: "inherited",
      reason:
        "Caller supplied an explicit workspace preference, settings or workspace id; the guard leaves caller authority untouched.",
      parentIssueId: input.parentId,
      parentWorkspaceId: null,
    };
  }

  const parent = await reader.getJsonOrNull<Record<string, unknown>>(
    `/issues/${encodeURIComponent(input.parentId)}`,
  );
  if (!parent) {
    throw new WorkspaceIsolationError(
      "PARENT_UNREADABLE",
      `Parent issue ${input.parentId} is not readable, so its workspace binding cannot be verified; the child create is refused fail-closed.`,
    );
  }

  const parentWorkspaceId = readString(parent, "executionWorkspaceId");
  if (!parentWorkspaceId) {
    return {
      code: "NO_PARENT_WORKSPACE",
      isolation: "inherited",
      reason: "Parent owns no execution workspace; there is nothing to inherit.",
      parentIssueId: input.parentId,
      parentWorkspaceId: null,
    };
  }

  const parentMode = await readParentWorkspaceMode(reader, parent, parentWorkspaceId);
  if (parentMode === "shared_workspace") {
    return {
      code: "SHARED_WORKSPACE_REUSE_ALLOWED",
      isolation: "inherited",
      reason:
        "Parent owns a shared workspace: an explicitly reusable shared workspace, serialized by the shared-workspace holder gate.",
      parentIssueId: input.parentId,
      parentWorkspaceId,
    };
  }

  const projectId = readString(body, "projectId") ?? readString(parent, "projectId");
  const policy = await readProjectPolicy(reader, projectId);
  if (policy && policy.enabled !== false && policy.allowIssueOverride === false) {
    throw new WorkspaceIsolationError(
      "PROJECT_OVERRIDE_FORBIDDEN",
      `Project ${projectId ?? "unknown"} forbids issue-level workspace overrides, so the child cannot be isolated from the parent's isolated workspace; the create is refused fail-closed instead of sharing one worktree.`,
    );
  }

  return {
    code: "ISOLATED_PARENT_WORKSPACE_ISOLATED",
    isolation: "isolated",
    reason:
      `Parent owns the isolated workspace ${parentWorkspaceId}; the child gets its own issue branch instead of the parent's worktree.`,
    parentIssueId: input.parentId,
    parentWorkspaceId,
    injected: buildPerIssueWorkspaceOverride(policy),
  };
}

/**
 * Checkout guard for issues that already carry an inherited cross-issue
 * workspace binding (created before this guard existed).
 *
 * Refuses only the harmful case: a cross-issue ISOLATED lease that another
 * live run currently holds. Two agents writing one worktree is the defect
 * this issue is about; an uncontended legacy binding stays runnable and is
 * reported instead of blocked.
 */
export async function evaluateCheckoutWorkspaceIsolation(
  reader: WorkspaceIsolationReader,
  input: { issueId: string },
): Promise<WorkspaceIsolationDecision> {
  let issue: Record<string, unknown> | null = null;
  try {
    issue = await reader.getJsonOrNull<Record<string, unknown>>(
      `/issues/${encodeURIComponent(input.issueId)}`,
    );
  } catch {
    // A denied/unavailable read must not block a legitimate checkout: the
    // create-side guard already keeps new bindings isolated. The lease check
    // is a safety net for legacy bindings, not an admission gate.
    return {
      code: "GUARD_SKIPPED_UNREADABLE",
      isolation: "inherited",
      reason: "Issue state is not readable for this actor; the lease check was skipped.",
      parentIssueId: null,
      parentWorkspaceId: null,
    };
  }
  const workspaceId = issue ? readString(issue, "executionWorkspaceId") : null;
  if (!workspaceId) {
    return {
      code: "NO_PARENT_WORKSPACE",
      isolation: "inherited",
      reason: "Issue owns no execution workspace; nothing to lease.",
      parentIssueId: null,
      parentWorkspaceId: null,
    };
  }

  const workspace = await reader.getJsonOrNull<Record<string, unknown>>(
    `/execution-workspaces/${encodeURIComponent(workspaceId)}`,
  );
  if (!workspace) {
    return {
      code: "NO_PARENT_WORKSPACE",
      isolation: "inherited",
      reason: "Execution workspace is not readable; the binding is left untouched.",
      parentIssueId: null,
      parentWorkspaceId: workspaceId,
    };
  }
  if (readString(workspace, "mode") === "shared_workspace") {
    return {
      code: "SHARED_WORKSPACE_REUSE_ALLOWED",
      isolation: "inherited",
      reason: "Workspace is shared; the shared-workspace holder gate serializes writers.",
      parentIssueId: readString(workspace, "sourceIssueId"),
      parentWorkspaceId: workspaceId,
    };
  }
  const ownerIssueId = readString(workspace, "sourceIssueId");
  if (!ownerIssueId || ownerIssueId === input.issueId) {
    return {
      code: "CROSS_ISSUE_LEASE_UNCONTENDED",
      isolation: "inherited",
      reason: "Workspace is owned by this issue; lawful same-issue reuse.",
      parentIssueId: ownerIssueId,
      parentWorkspaceId: workspaceId,
    };
  }

  const holders = await readLiveWorkspaceHolders(reader, workspaceId);
  if (holders.length > 0) {
    throw new WorkspaceIsolationError(
      "CROSS_ISSUE_LEASE_REFUSED",
      `Execution workspace ${workspaceId} is bound to issue ${ownerIssueId} and is currently held by ${holders.length} live run(s); checking out ${input.issueId} would put two agents in one worktree.`,
    );
  }
  return {
    code: "CROSS_ISSUE_LEASE_UNCONTENDED",
    isolation: "inherited",
    reason:
      "Workspace is bound to another issue but no live run holds it; the legacy binding is left untouched and reported, not blocked.",
    parentIssueId: ownerIssueId,
    parentWorkspaceId: workspaceId,
  };
}

export type WorkspaceBindingStatus =
  | "NO_WORKSPACE"
  | "OWN_WORKSPACE"
  | "SHARED_WORKSPACE"
  | "FOREIGN_UNCONTENDED"
  | "FOREIGN_CONTENDED"
  | "UNKNOWN";

export interface WorkspaceBindingVerdict {
  status: WorkspaceBindingStatus;
  /** True when the binding violates the per-issue worktree invariant. */
  violation: boolean;
  issueId: string;
  workspaceId: string | null;
  /** The issue that owns the workspace (execution_workspaces.source_issue_id). */
  ownerIssueId: string | null;
  branchName: string | null;
  holders: string[];
  reason: string;
}

/**
 * Classify one execution workspace against the issue that wants to use it.
 *
 * This is the read-side of the invariant that `evaluateChildWorkspaceIsolation`
 * (create) and `evaluateCheckoutWorkspaceIsolation` (checkout) enforce on the
 * write side: a `git_worktree` row is one checkout on one branch and that
 * branch belongs to one issue, so a per-issue worktree owned by another issue
 * is always a violation - contended (a second writer is live) or not.
 */
export async function classifyWorkspaceBinding(
  reader: WorkspaceIsolationReader,
  input: { issueId: string; workspaceId: string | null },
): Promise<WorkspaceBindingVerdict> {
  const base = {
    issueId: input.issueId,
    workspaceId: input.workspaceId,
    ownerIssueId: null as string | null,
    branchName: null as string | null,
    holders: [] as string[],
  };
  if (!input.workspaceId) {
    return {
      ...base,
      status: "NO_WORKSPACE",
      violation: false,
      reason: "The issue owns no execution workspace; nothing can cross issues.",
    };
  }
  let workspace: Record<string, unknown> | null = null;
  try {
    workspace = await reader.getJsonOrNull<Record<string, unknown>>(
      `/execution-workspaces/${encodeURIComponent(input.workspaceId)}`,
    );
  } catch {
    return {
      ...base,
      status: "UNKNOWN",
      violation: false,
      reason:
        "The execution workspace is not readable for this actor; the binding could not be classified and was left untouched.",
    };
  }
  if (!workspace) {
    return {
      ...base,
      status: "UNKNOWN",
      violation: false,
      reason:
        "The execution workspace is not readable for this actor; the binding could not be classified and was left untouched.",
    };
  }
  const mode = readString(workspace, "mode");
  const ownerIssueId = readString(workspace, "sourceIssueId");
  const branchName = readString(workspace, "branchName");
  const scoped = { ...base, ownerIssueId, branchName };
  if (mode === "shared_workspace") {
    return {
      ...scoped,
      status: "SHARED_WORKSPACE",
      violation: false,
      reason:
        "The workspace is shared and project-authorized; the shared-workspace holder gate serializes concurrent writers.",
    };
  }
  if (!ownerIssueId || ownerIssueId === input.issueId) {
    return {
      ...scoped,
      status: "OWN_WORKSPACE",
      violation: false,
      reason:
        ownerIssueId === input.issueId
          ? "The workspace is this issue's own worktree; lawful same-issue reuse."
          : "The workspace has no owning issue; it is not a per-issue worktree.",
    };
  }
  const holders = await readLiveWorkspaceHolders(reader, input.workspaceId);
  if (holders.length > 0) {
    return {
      ...scoped,
      status: "FOREIGN_CONTENDED",
      violation: true,
      holders,
      reason: `The workspace belongs to issue ${ownerIssueId} and is held by ${holders.length} live run(s); a second writer would put two agents in one worktree.`,
    };
  }
  return {
    ...scoped,
    status: "FOREIGN_UNCONTENDED",
    violation: true,
    reason: `The workspace belongs to issue ${ownerIssueId}; no live run holds it, but the binding still crosses issues.`,
  };
}

/**
 * The binding the task session would resolve to: the workspace the heartbeat
 * context reports for this issue, falling back to the issue's own pointer.
 *
 * A task session that resolves a foreign per-issue worktree runs its agent in
 * another issue's checkout - the same cross-issue contamination the create
 * guard prevents, reached through a different door.
 */
export async function evaluateTaskSessionWorkspaceIsolation(
  reader: WorkspaceIsolationReader,
  input: { issueId: string; resolvedWorkspaceId?: string | null },
): Promise<WorkspaceBindingVerdict> {
  let workspaceId = input.resolvedWorkspaceId ?? null;
  if (!workspaceId) {
    let issue: Record<string, unknown> | null = null;
    try {
      issue = await reader.getJsonOrNull<Record<string, unknown>>(
        `/issues/${encodeURIComponent(input.issueId)}`,
      );
    } catch {
      issue = null;
    }
    workspaceId = issue ? readString(issue, "executionWorkspaceId") : null;
  }
  return classifyWorkspaceBinding(reader, { issueId: input.issueId, workspaceId });
}

/**
 * Fail closed only where the harm is real: a task session that resolves a
 * foreign per-issue worktree held by a live run is refused. An uncontended
 * foreign binding is reported, not blocked, so a legacy issue stays runnable
 * while the operator sees the violation.
 */
export async function assertTaskSessionWorkspaceIsolation(
  reader: WorkspaceIsolationReader,
  input: { issueId: string; resolvedWorkspaceId?: string | null },
): Promise<WorkspaceBindingVerdict> {
  const verdict = await evaluateTaskSessionWorkspaceIsolation(reader, input);
  if (verdict.status === "FOREIGN_CONTENDED") {
    throw new WorkspaceIsolationError(
      "CROSS_ISSUE_LEASE_REFUSED",
      `The task session for issue ${input.issueId} resolves execution workspace ${verdict.workspaceId}, which belongs to issue ${verdict.ownerIssueId} and is held by ${verdict.holders.length} live run(s).`,
    );
  }
  return verdict;
}

/**
 * Live runs bound to a workspace, read from the company live-runs snapshot.
 * Tolerant of projection shape: only rows that name the workspace count.
 */
async function readLiveWorkspaceHolders(
  reader: WorkspaceIsolationReader,
  workspaceId: string,
): Promise<string[]> {
  const scoped = reader as unknown as {
    config?: { companyId?: string | null };
    resolveCompanyId?: () => string | null;
  };
  const companyId =
    scoped.config?.companyId ??
    (typeof scoped.resolveCompanyId === "function" ? scoped.resolveCompanyId() : null);
  if (!companyId) return [];
  const rows = await reader.getJsonOrNull<unknown>(
    `/companies/${encodeURIComponent(companyId)}/live-runs?limit=100`,
  );
  if (!Array.isArray(rows)) return [];
  const holders: string[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const status = readString(row, "status");
    if (status && status !== "running" && status !== "queued") continue;
    const bound = readString(row, "executionWorkspaceId")
      ?? readString(readRecord(row, "contextSnapshot"), "executionWorkspaceId")
      ?? readString(readRecord(readRecord(row, "context_snapshot"), "executionWorkspaceId"), "executionWorkspaceId");
    if (bound === workspaceId) holders.push(readString(row, "id") ?? "unknown");
  }
  return holders;
}
