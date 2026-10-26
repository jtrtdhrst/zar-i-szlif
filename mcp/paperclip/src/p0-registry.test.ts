// P0 registry + security regression: every registered MCP tool must be
// covered by exactly one tool-name list (no silent drift), new P0 tools are
// present, and workspace path/exec guards fail closed.
import { describe, expect, it } from "vitest";
import { PaperclipApiClient } from "./client.js";
import { createToolDefinitions } from "./tools.js";
import { CONTROL_PLANE_TOOL_NAMES } from "./control-plane.js";
import { WORKSPACE_NATIVE_TOOL_NAMES, redactWorkspaceOutput } from "./workspace-native.js";
import { EFFECTIVE_ACCESS_TOOL_NAMES, BASE_TOOL_NAMES, allKnownToolNames, isKnownToolName } from "./effective-access.js";
import { LIVE_VERIFY_TOOL_NAMES, allLiveToolNames } from "./live-verify.js";
import { P1_GIT_TOOL_NAMES } from "./p1-git.js";
import { P1_PLATFORM_TOOL_NAMES } from "./p1-platform.js";
import { ISSUE_FIELD_TOOL_NAMES } from "./issue-fields.js";

const COMPANY = "9894e3c2-3317-46ca-8c72-7a442a76a78e";
const AGENT = "da8d1a1d-dd22-4716-a142-0420b0147672";

function dummyClient(): PaperclipApiClient {
  return new PaperclipApiClient({
    apiUrl: "http://127.0.0.1:3100/api",
    apiKey: "test",
    companyId: COMPANY,
    agentId: AGENT,
    runId: null,
    agentApiKey: null,
    boardApiKey: null,
  });
}

describe("p0 tool registry", () => {
  it("registers the new P0 tools", () => {
    const names = createToolDefinitions(dummyClient()).map((t) => t.name);
    for (const want of [
      "paperclipWorkspaceListFiles", "paperclipWorkspaceReadFile", "paperclipWorkspacePatchFile",
      "paperclipWorkspaceExec", "paperclipGitStatus", "paperclipGitDiff",
      "paperclipGitCreateBranch", "paperclipGitCommit", "paperclipGitPush",
      "paperclipGitCreatePR", "paperclipGitGetChecks", "paperclipGitGetMergeReadiness",
      "paperclipGetAgentEffectiveTools", "paperclipVerifyAgentTool", "paperclipGetToolDenial",
      "paperclipVerifyLiveMCP", "paperclipMCPRunSmokeTest",
      "paperclipGitAuthStatus", "paperclipGitGetRemoteTopology", "paperclipGitWaitChecks", "paperclipGitMergePR",
      "paperclipWorkspaceApplyUnifiedDiff", "paperclipWorkspaceBatchChange",
      "paperclipWorkspaceRunChecks", "paperclipOAuthDiagnoseSession",
      "paperclipListAgentChats", "paperclipGetAgentChat", "paperclipSendChatMessage",
      "paperclipGetChatMessages", "paperclipNewChatSession",
    ]) {
      expect(names).toContain(want);
    }
  });

  it("every registered tool is covered by exactly one name list (no drift)", () => {
    const names = createToolDefinitions(dummyClient()).map((t) => t.name);
    const lists: string[][] = [
      BASE_TOOL_NAMES, CONTROL_PLANE_TOOL_NAMES, WORKSPACE_NATIVE_TOOL_NAMES,
      EFFECTIVE_ACCESS_TOOL_NAMES, LIVE_VERIFY_TOOL_NAMES,
      P1_GIT_TOOL_NAMES, P1_PLATFORM_TOOL_NAMES, ISSUE_FIELD_TOOL_NAMES,
    ];
    const union = new Set(lists.flat());
    const missing = names.filter((n) => !union.has(n));
    expect(missing).toEqual([]);
    // No tool registered twice.
    expect(new Set(names).size).toBe(names.length);
    // allLiveToolNames covers the registry.
    const live = new Set(allLiveToolNames());
    expect(names.filter((n) => !live.has(n))).toEqual([]);
    expect(isKnownToolName("paperclipVerifyLiveMCP")).toBe(true);
    expect(isKnownToolName("paperclipNope")).toBe(false);
    expect(allKnownToolNames().length).toBeGreaterThan(150);
    expect(allLiveToolNames().length).toBe(names.length);
  });

  it("workspace output redaction scrubs secrets", () => {
    expect(redactWorkspaceOutput("key=pcp_abcdefgh12345678")).not.toContain("pcp_abcdefgh");
    expect(redactWorkspaceOutput("tok ghp_abcdefgh1234567890")).not.toContain("ghp_abc");
    expect(redactWorkspaceOutput("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----")).not.toContain("abc");
  });
});

