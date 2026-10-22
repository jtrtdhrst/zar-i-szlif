import { afterEach, describe, expect, it, vi } from "vitest";
import { PaperclipApiClient } from "./client.js";
import { createWorkspaceNativeTools, ghEnv } from "./workspace-native.js";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const AGENT = "22222222-2222-2222-2222-222222222222";
const ISSUE = "44444444-4444-4444-8444-444444444444";
const WORKSPACE = "55555555-5555-4555-8555-555555555555";

function client() {
  return new PaperclipApiClient({
    apiUrl: "http://localhost:3100/api",
    apiKey: "test",
    companyId: COMPANY,
    agentId: AGENT,
    runId: null,
    agentApiKey: null,
    boardApiKey: null,
  });
}

function tool(name: string) {
  const found = createWorkspaceNativeTools(client()).find((candidate) => candidate.name === name);
  if (!found) throw new Error(`missing ${name}`);
  return found;
}

describe("GitHub checks fail closed without prompting", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each(["paperclipGitGetChecks", "paperclipGitGetMergeReadiness"])("returns GITHUB_AUTH_MISSING for %s before workspace or gh access", async (name) => {
    vi.stubEnv("GH_TOKEN", "");
    vi.stubEnv("GITHUB_TOKEN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await tool(name).execute({ issueId: ISSUE, workspaceId: WORKSPACE });

    expect(result.content[0]?.text).toContain("GITHUB_AUTH_MISSING");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sets non-interactive GitHub and git environment flags", () => {
    vi.stubEnv("GH_TOKEN", "test-token");
    vi.stubEnv("GITHUB_TOKEN", "");
    expect(ghEnv()).toMatchObject({
      GH_TOKEN: "test-token",
      GH_PROMPT_DISABLED: "1",
      GIT_TERMINAL_PROMPT: "0",
    });
  });
});
