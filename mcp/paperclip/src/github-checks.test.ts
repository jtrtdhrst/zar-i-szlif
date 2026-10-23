import { describe, expect, it } from "vitest";
import {
  deriveReviewDecision,
  evaluateCheckRunsPayload,
  parseRestPull,
} from "./github-checks.js";

describe("evaluateCheckRunsPayload (REST commit check-runs, fail-closed)", () => {
  it("reports success only when every run is completed with a pass conclusion", () => {
    const result = evaluateCheckRunsPayload({
      total_count: 2,
      check_runs: [
        { name: "verify-infrastructure", status: "completed", conclusion: "success" },
        { name: "paperclip-mcp-tests", status: "completed", conclusion: "success" },
      ],
    });
    expect(result.state).toBe("success");
    expect(result.total).toBe(2);
    expect(result.failures).toEqual([]);
  });

  it("treats neutral and skipped as passing but not unknown conclusions", () => {
    expect(evaluateCheckRunsPayload({
      total_count: 2,
      check_runs: [
        { name: "a", status: "completed", conclusion: "neutral" },
        { name: "b", status: "completed", conclusion: "skipped" },
      ],
    }).state).toBe("success");
    expect(evaluateCheckRunsPayload({
      total_count: 1,
      check_runs: [{ name: "a", status: "completed", conclusion: "stale" }],
    }).state).toBe("failure");
  });

  it("reports failure and pending distinctly", () => {
    const failed = evaluateCheckRunsPayload({
      total_count: 1,
      check_runs: [{ name: "ci", status: "completed", conclusion: "failure" }],
    });
    expect(failed.state).toBe("failure");
    expect(failed.failures[0]).toContain("ci");
    expect(evaluateCheckRunsPayload({
      total_count: 2,
      check_runs: [
        { name: "ci", status: "completed", conclusion: "success" },
        { name: "scan", status: "in_progress", conclusion: null },
      ],
    }).state).toBe("pending");
  });

  it("never infers green from an empty, denied or malformed payload", () => {
    expect(evaluateCheckRunsPayload({ total_count: 0, check_runs: [] })).toMatchObject({
      state: "unverified",
      total: 0,
    });
    expect(evaluateCheckRunsPayload({ check_runs: [] })).toMatchObject({ state: "unverified" });
    expect(evaluateCheckRunsPayload(null).state).toBe("unverified");
    expect(evaluateCheckRunsPayload("Resource not accessible by personal access token").state).toBe("unverified");
    expect(evaluateCheckRunsPayload({ total_count: 1, check_runs: [{ name: "ci", status: "completed", conclusion: "mystery" }] }).state).toBe("unverified");
  });
});

describe("parseRestPull / deriveReviewDecision", () => {
  it("maps REST pull fields into the merge gate vocabulary", () => {
    expect(parseRestPull({
      number: 98,
      html_url: "https://github.com/o/r/pull/98",
      state: "open",
      mergeable: true,
      mergeable_state: "clean",
      head: { sha: "5abd95ad87302696d0604e482b54239c2bc3620e" },
    })).toMatchObject({
      number: 98,
      state: "OPEN",
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      headRefOid: "5abd95ad87302696d0604e482b54239c2bc3620e",
    });
    expect(parseRestPull({ mergeable: null, mergeable_state: "unknown" })).toMatchObject({
      mergeable: "UNKNOWN",
      mergeStateStatus: "UNKNOWN",
    });
    expect(parseRestPull({ mergeable: false, mergeable_state: "dirty" })).toMatchObject({
      mergeable: "CONFLICTING",
      mergeStateStatus: "DIRTY",
    });
    expect(parseRestPull({ merged: true, state: "closed" })?.state).toBe("MERGED");
    expect(parseRestPull("not json")).toBeNull();
  });

  it("takes each reviewer's latest decision and prefers changes requested", () => {
    const reviews = [
      { user: { login: "cto" }, state: "CHANGES_REQUESTED", submitted_at: "2026-10-23T14:00:00Z" },
      { user: { login: "cto" }, state: "APPROVED", submitted_at: "2026-10-23T15:00:00Z" },
      { user: { login: "owner" }, state: "COMMENTED", submitted_at: "2026-10-23T15:30:00Z" },
    ];
    expect(deriveReviewDecision(reviews)).toBe("APPROVED");
    const changed = [
      { user: { login: "cto" }, state: "APPROVED", submitted_at: "2026-10-23T14:00:00Z" },
      { user: { login: "cto" }, state: "CHANGES_REQUESTED", submitted_at: "2026-10-23T16:00:00Z" },
    ];
    expect(deriveReviewDecision(changed)).toBe("CHANGES_REQUESTED");
    expect(deriveReviewDecision([])).toBe("");
    expect(deriveReviewDecision(null)).toBe("");
  });
});
