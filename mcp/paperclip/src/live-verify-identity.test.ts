import { describe, expect, it } from "vitest";
import { mcpSourceCommitFailures } from "./live-verify-identity.js";

describe("MCP source identity comparison", () => {
  const mcpSha = "7e43018de9a401f6163edbd44c0b4f5cea769e91";

  it("does not compare an expected MCP SHA to an unrelated Core commit", () => {
    expect(mcpSourceCommitFailures(mcpSha, mcpSha, mcpSha)).toEqual([]);
  });

  it("reports an unavailable MCP release identity", () => {
    expect(mcpSourceCommitFailures(mcpSha, null, null)).toEqual(["MCP release identity unavailable"]);
  });

  it("reports expected and runtime MCP source mismatches", () => {
    expect(mcpSourceCommitFailures(mcpSha, "b".repeat(40), "a".repeat(40))).toEqual([
      `commit mismatch: expected ${mcpSha}, MCP source ${"a".repeat(40)}`,
      `source/runtime mismatch: env ${"b".repeat(40)} vs MCP source ${"a".repeat(40)}`,
    ]);
  });
});
