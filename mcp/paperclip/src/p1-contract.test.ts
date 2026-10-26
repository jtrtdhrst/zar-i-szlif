// P1 contract + regression tests: unified error contract (P1-D, BUG-08),
// smoke terminal semantics (BUG-01, SMOKE-02/03/04), host P0-D expansion,
// unified-diff applier (P0-F), operator scope (P0-A).
import { describe, expect, it } from "vitest";
import { formatErrorResponse } from "./format.js";
import { classifySmokeOutcome } from "./live-verify.js";
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

