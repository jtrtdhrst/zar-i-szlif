// P1 contract + regression tests: unified error contract (P1-D, BUG-08),
// smoke terminal semantics (BUG-01, SMOKE-02/03/04), host P0-D expansion,
// unified-diff applier (P0-F), operator scope (P0-A).
import { describe, expect, it } from "vitest";
import { formatErrorResponse } from "./format.js";
import { classifySmokeOutcome } from "./live-verify.js";
import {
  capabilitiesDocument,
  isMutatingOperation,
  resolveHostOperationAlias,
  hostOperationWithoutLane,
  payloadDigestForIntent,
} from "./host-ops.js";
import { parseUnifiedDiff, applyUnifiedDiffToText } from "./p1-platform.js";

function textOf(error: unknown): Record<string, unknown> {
  const res = formatErrorResponse(error);
  return JSON.parse(res.content[0]!.text) as Record<string, unknown>;
}

function coded(code: string, msg = "probe"): Error {
  const e = new Error(`${msg} [errorCode=${code}]`);
  (e as unknown as Record<string, unknown>).detail = { errorCode: code };
  return e;
}

describe("p1 unified error contract (P1-D, BUG-08)", () => {
  it("preserves command_denied instead of UPSTREAM_INTERNAL_ERROR", () => {
    const body = textOf(coded("command_denied", "git subcommand not allowlisted: rm"));
    expect(body.code).toBe("COMMAND_DENIED");
    expect(body.category).toBe("COMMAND_DENIED");
    expect(body.retryable).toBe(false);
    expect(body.remediationOwner).toBeTruthy();
    expect(body.requiredAction).toBeTruthy();
  });
  it("maps auth_failed to AUTHORIZATION with an owner", () => {
    const body = textOf(coded("auth_failed", "mutating op requires operatorRunId"));
    expect(body.code).toBe("AUTH_FAILED");
    expect(body.category).toBe("AUTHORIZATION");
    expect(body.remediationOwner).toBe("caller");
  });
  it("maps idempotency_conflict to IDEMPOTENCY_CONFLICT", () => {
    const body = textOf(coded("idempotency_conflict", "IDEMPOTENCY_CONFLICT: requestId x"));
    expect(body.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(body.category).toBe("IDEMPOTENCY_CONFLICT");
  });
  it("maps github_auth_missing to AUTHENTICATION owned by CTO", () => {
    const body = textOf(coded("github_auth_missing", "GitHub authentication missing"));
    expect(body.code).toBe("GITHUB_AUTH_MISSING");
    expect(body.category).toBe("AUTHENTICATION");
    expect(body.remediationOwner).toBe("CTO");
  });
  it("keeps validation errors as INVALID_ARGUMENTS", () => {
    const body = textOf(new Error("invalid arguments: expected uuid"));
    expect(body.code).toBe("INVALID_ARGUMENTS");
  });
});

describe("smoke terminal semantics (BUG-01)", () => {
  it("SMOKE-02: pending is UNVERIFIED, never pass", () => {
    expect(classifySmokeOutcome('{"requestId":"x","state":"pending"}')).toBe("unverified");
  });
  it("SMOKE-03: pending then success is pass", () => {
    expect(classifySmokeOutcome('{"status":"succeeded","result":"planned-only dryRun report"}')).toBe("pass");
  });
  it("SMOKE-04: pending then auth_failed is fail", () => {
    expect(classifySmokeOutcome('{"status":"failed","errorCode":"auth_failed: issue not owned by agent"}')).toBe("fail");
  });
  it("empty/evidence-less output is unverified", () => {
    expect(classifySmokeOutcome("{}")).toBe("unverified");
  });
});

describe("host P0-D expansion", () => {
  it("resolves underscore aliases to dotted lanes", () => {
    expect(resolveHostOperationAlias("host.service_reload")).toBe("host.service.reload");
    expect(resolveHostOperationAlias("host.container_recreate")).toBe("host.container.recreate");
    expect(resolveHostOperationAlias("host.deployment_rollback")).toBe("mcp.rollback");
    expect(resolveHostOperationAlias("ps")).toBe("ps");
  });
  it("flags operations without a supervisor lane", () => {
    expect(hostOperationWithoutLane("host.container_build")).toBe(true);
    expect(hostOperationWithoutLane("host.service_start")).toBe(true);
    expect(hostOperationWithoutLane("host.backup.verify")).toBe(true);
    expect(hostOperationWithoutLane("host.migration.dry_run")).toBe(true);
    expect(hostOperationWithoutLane("ps")).toBe(false);
    expect(hostOperationWithoutLane("host.service_reload")).toBe(false);
  });
  it("deployment_verify is a read; aliases are mutating", () => {
    expect(isMutatingOperation("host.deployment_verify")).toBe(false);
    expect(isMutatingOperation("host.service_reload")).toBe(true);
    expect(isMutatingOperation("host.container_build")).toBe(true);
    expect(isMutatingOperation("host.migration.dry_run")).toBe(true);
  });
  it("no operation is both a working read and fail-closed without a lane", () => {
    const doc = capabilitiesDocument() as Record<string, unknown>;
    const read = new Set(doc.readOperations as string[]);
    const nolane = (doc.p1Expansion as Record<string, unknown>).failClosedNoLane as string[];
    expect(nolane).toContain("host.migration.dry_run");
    expect(read.has("host.migration.dry_run")).toBe(false);
    for (const op of nolane) expect(read.has(op)).toBe(false);
    const mut = new Set(doc.mutatingOperations as string[]);
    for (const op of nolane) expect(mut.has(op)).toBe(true);
  });
  it("digest matches the supervisor canonical list (watcher.sh parity)", async () => {
    // Supervisor vector: keys operation/target/path/content/contentSha/
    // expectedSha/image/backupName/migrationId/sourceRef/digest/dryRun/tail.
    const { createHash } = await import("node:crypto");
    const ks = ["operation", "target", "path", "content", "contentSha", "expectedSha", "image", "backupName", "migrationId", "sourceRef", "digest", "dryRun", "tail"];
    const intent = { v: 1, requestId: "x", agentId: "y", operation: "mcp.rollback", dryRun: true, reason: "smoke probe", service: "paperclip", artifactDigest: "abc" };
    const pyStr = (v: unknown) => (v === true ? "True" : v === false ? "False" : String((v as unknown) ?? ""));
    const sup = createHash("sha256").update(ks.map((k) => pyStr((intent as Record<string, unknown>)[k])).join("|"), "utf8").digest("hex");
    // Extra MCP-side fields (service/artifactDigest) must NOT perturb the digest.
    // Python-str boolean canonicalization: dryRun true -> "True" (not "true").
    const pyTrue = createHash("sha256").update(ks.map((k) => { const v = (intent as Record<string, unknown>)[k]; return v === true ? "True" : v === false ? "False" : String(v ?? ""); }).join("|"), "utf8").digest("hex");
    expect(payloadDigestForIntent(intent)).toBe(sup);
    expect(payloadDigestForIntent(intent)).toBe(pyTrue);
    expect(payloadDigestForIntent({ operation: "ps", dryRun: true })).not.toBe(payloadDigestForIntent({ operation: "ps", dryRun: false }));
    const a = payloadDigestForIntent({ operation: "ps", target: "paperclip" });
    const b = payloadDigestForIntent({ target: "paperclip", operation: "ps" });
    const c = payloadDigestForIntent({ operation: "ps", target: "paperclip-db" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("unified diff applier (P0-F)", () => {
  const base = "line1\nline2\nline3\n";
  it("applies a clean single-hunk diff", () => {
    const hunks = parseUnifiedDiff("@@ -1,3 +1,3 @@\n line1\n-line2\n+LINE2\n line3\n");
    const { text, appliedHunks } = applyUnifiedDiffToText(base, hunks);
    expect(text).toBe("line1\nLINE2\nline3\n");
    expect(appliedHunks).toBe(1);
  });
  it("rejects mismatched context without partial writes (WS-08)", () => {
    const hunks = parseUnifiedDiff("@@ -1,3 +1,3 @@\n line1\n-WRONG\n+LINE2\n line3\n");
    expect(() => applyUnifiedDiffToText(base, hunks)).toThrowError(/mismatch/i);
  });
  it("rejects hunks beyond EOF", () => {
    const hunks = parseUnifiedDiff("@@ -10,2 +10,2 @@\n a\n-b\n+B\n");
    expect(() => applyUnifiedDiffToText(base, hunks)).toThrowError();
  });
  it("rejects diffs without hunks", () => {
    expect(() => parseUnifiedDiff("just some text\n")).toThrowError();
  });
});
