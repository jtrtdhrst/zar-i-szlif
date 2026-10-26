// Security regression: generic stdio may resolve its enrolled AGENT secret,
// but must NEVER load the enrolled Board secret as a generic agent credential.
// The authorized gateway owns Board secret resolution separately and only
// projects it to allowlisted Wiki routes. Explicit Board env remains supported
// for non-agent sessions. Missing credentials always fail closed.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { readFileSync } = vi.hoisted(() => ({ readFileSync: vi.fn() }));

vi.mock("node:fs", () => ({ readFileSync }));

import { readConfigFromEnv } from "./config.js";

const BOARD_PATH = "/paperclip/instances/default/secrets/remote-mcp-board-key";
const AGENT_PATH = "/paperclip/instances/default/secrets/remote-mcp-agent-key";
const BASE_ENV = {
  PAPERCLIP_API_URL: "https://example.test/api",
  PAPERCLIP_API_KEY: "token-agent",
} as NodeJS.ProcessEnv;

describe("credential projection from the enrolled secret store", () => {
  beforeEach(() => {
    readFileSync.mockReset();
  });

  it("prefers the launcher env when it carries the credential", () => {
    readFileSync.mockReturnValue("secret-from-file");
    const cfg = readConfigFromEnv({ ...BASE_ENV, PAPERCLIP_BOARD_API_KEY: "board-from-env" });
    expect(cfg.boardApiKey).toBe("board-from-env");
    // env wins for the credential it carries: the enrolled file is not consulted for it.
    expect(readFileSync).not.toHaveBeenCalledWith(BOARD_PATH, "utf8");
  });

  it("never projects the enrolled Board key when the launcher env is empty", () => {
    readFileSync.mockImplementation((path: string) =>
      path === BOARD_PATH ? "board-from-file\n" : "agent-from-file\n",
    );
    const cfg = readConfigFromEnv(BASE_ENV);
    expect(cfg.boardApiKey).toBeNull();
    expect(cfg.agentApiKey).toBe("agent-from-file");
    expect(readFileSync).not.toHaveBeenCalledWith(BOARD_PATH, "utf8");
    expect(readFileSync).toHaveBeenCalledWith(AGENT_PATH, "utf8");
  });

  it("fails closed when the enrolled secret cannot be read", () => {
    readFileSync.mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    const cfg = readConfigFromEnv(BASE_ENV);
    expect(cfg.boardApiKey).toBeNull();
    expect(cfg.agentApiKey).toBeNull();
  });

  it("never projects a blank credential", () => {
    readFileSync.mockReturnValue("   \n");
    const cfg = readConfigFromEnv(BASE_ENV);
    expect(cfg.boardApiKey).toBeNull();
    expect(cfg.agentApiKey).toBeNull();
  });
});
