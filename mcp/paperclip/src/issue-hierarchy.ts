// MCP-side fail-closed parent-hierarchy validator (MCP layer only, no Paperclip Core change).
//
// Paperclip Core 2026.1012.0 does NOT validate parentId cycles: the API
// accepted A.parentId = B.id followed by B.parentId = A.id and committed both
// writes. The MCP gateway therefore validates every parent-changing write
// before it reaches the backend.
//
// SCOPE HONESTY (do not overclaim):
//   * This guard protects traffic that flows through the Paperclip MCP gateway.
//   * Direct API clients and the Paperclip UI can still create hierarchy cycles
//     outside MCP. A global fix requires a Paperclip Core change
//     (server/src/services/issues.ts update path, parentId assignment) which is
//     routed to the Core owner; it is NOT claimed as fixed here.

export const MAX_HIERARCHY_DEPTH = 64;

export interface HierarchyIssueSnapshot {
  id: string;
  identifier?: string | null;
  companyId?: string | null;
  parentId?: string | null;
}

export interface HierarchyReader {
  getJsonOrNull<T>(path: string): Promise<T | null>;
}

export type HierarchyRejectionCode =
  | "PARENT_SELF_REFERENCE"
  | "PARENT_NOT_FOUND"
  | "PARENT_CROSS_COMPANY"
  | "PARENT_CYCLE"
  | "PARENT_CHAIN_UNREADABLE"
  | "PARENT_CHAIN_TRUNCATED"
  | "TARGET_ISSUE_UNREADABLE";

export interface HierarchyValidation {
  ok: boolean;
  code?: HierarchyRejectionCode;
  reason?: string;
  /** Parent chain as walked, nearest ancestor first. */
  chain: Array<{ id: string; identifier: string | null }>;
  scope: "mcp-gateway-only";
}

export class HierarchyViolationError extends Error {
  readonly code: HierarchyRejectionCode;
  readonly chain: Array<{ id: string; identifier: string | null }>;

  constructor(code: HierarchyRejectionCode, reason: string, chain: Array<{ id: string; identifier: string | null }>) {
    super(`${reason} (guard scope: MCP gateway only - direct API clients are not covered) [errorCode=${code}]`);
    this.name = "HierarchyViolationError";
    this.code = code;
    this.chain = chain;
    (this as unknown as Record<string, unknown>).detail = {
      errorCode: code,
      remediationOwner: "caller",
      remediation:
        "Fix the requested hierarchy (pick a parent outside the issue's own descendant chain, or clear parentId) and retry once. Do not bypass the guard with another route — direct API clients are not covered by this MCP-side guard.",
    };
  }
}

async function readSnapshot(reader: HierarchyReader, ref: string): Promise<HierarchyIssueSnapshot | null> {
  const row = await reader.getJsonOrNull<HierarchyIssueSnapshot>(`/issues/${encodeURIComponent(ref)}`);
  if (!row || typeof row.id !== "string") return null;
  return row;
}

/**
 * Validate a prospective parent assignment BEFORE it is written.
 *
 * Rejects: self-parent, missing parent, cross-company parent, any cycle
 * (including multi-node A -> B -> C -> A) and any chain that cannot be read or
 * that exceeds the traversal bound (fail closed, never silent success).
 */
export async function validateParentHierarchy(
  reader: HierarchyReader,
  input: { issueId: string; parentId: string | null | undefined },
): Promise<HierarchyValidation> {
  const chain: Array<{ id: string; identifier: string | null }> = [];
  const parentId = input.parentId;
  if (parentId === null || parentId === undefined || parentId === "") {
    return { ok: true, chain, scope: "mcp-gateway-only" };
  }

  const issue = await readSnapshot(reader, input.issueId);
  if (!issue) {
    throw new HierarchyViolationError(
      "TARGET_ISSUE_UNREADABLE",
      `Issue ${input.issueId} is not readable for this actor; the parent hierarchy cannot be verified, so the write is refused fail-closed.`,
      chain,
    );
  }
  if (parentId === issue.id) {
    throw new HierarchyViolationError(
      "PARENT_SELF_REFERENCE",
      `An issue cannot be its own parent (${issue.identifier ?? issue.id}).`,
      chain,
    );
  }

  const parent = await readSnapshot(reader, parentId);
  if (!parent) {
    throw new HierarchyViolationError(
      "PARENT_NOT_FOUND",
      `Parent issue ${parentId} does not exist or is not accessible to this actor.`,
      chain,
    );
  }
  if (issue.companyId && parent.companyId && parent.companyId !== issue.companyId) {
    throw new HierarchyViolationError(
      "PARENT_CROSS_COMPANY",
      `Parent ${parent.identifier ?? parent.id} belongs to another company; cross-company hierarchy edges are not allowed.`,
      chain,
    );
  }

  const visited = new Set<string>([issue.id]);
  let current = parent;
  for (let depth = 0; depth < MAX_HIERARCHY_DEPTH; depth += 1) {
    if (visited.has(current.id)) {
      throw new HierarchyViolationError(
        "PARENT_CYCLE",
        `Parent hierarchy cycle detected: ${(parent.identifier ?? parent.id)} is already a descendant of ${issue.identifier ?? issue.id}.`,
        chain,
      );
    }
    visited.add(current.id);
    chain.push({ id: current.id, identifier: current.identifier ?? null });
    if (!current.parentId) {
      return { ok: true, chain, scope: "mcp-gateway-only" };
    }
    const next = await readSnapshot(reader, current.parentId);
    if (!next) {
      throw new HierarchyViolationError(
        "PARENT_CHAIN_UNREADABLE",
        `Ancestor ${current.parentId} of ${current.identifier ?? current.id} is not readable; the hierarchy cannot be verified, so the write is refused fail-closed.`,
        chain,
      );
    }
    current = next;
  }

  throw new HierarchyViolationError(
    "PARENT_CHAIN_TRUNCATED",
    `Parent chain exceeded the ${MAX_HIERARCHY_DEPTH}-level traversal bound; the hierarchy cannot be verified, so the write is refused fail-closed.`,
    chain,
  );
}

/**
 * Creation variant: a brand new issue has no descendants, so only the
 * cross-company invariant can be violated. Still fail closed on unreadable
 * parents.
 */
export async function validateParentForCreate(
  reader: HierarchyReader,
  input: { parentId: string; companyId?: string | null },
): Promise<HierarchyValidation> {
  const chain: Array<{ id: string; identifier: string | null }> = [];
  const parent = await readSnapshot(reader, input.parentId);
  if (!parent) {
    throw new HierarchyViolationError(
      "PARENT_NOT_FOUND",
      `Parent issue ${input.parentId} does not exist or is not accessible to this actor.`,
      chain,
    );
  }
  if (input.companyId && parent.companyId && parent.companyId !== input.companyId) {
    throw new HierarchyViolationError(
      "PARENT_CROSS_COMPANY",
      `Parent ${parent.identifier ?? parent.id} belongs to another company; cross-company hierarchy edges are not allowed.`,
      chain,
    );
  }
  chain.push({ id: parent.id, identifier: parent.identifier ?? null });
  return { ok: true, chain, scope: "mcp-gateway-only" };
}
