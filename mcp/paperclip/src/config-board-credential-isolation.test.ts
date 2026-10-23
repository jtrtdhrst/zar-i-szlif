// Security regression: an enrolled Board key must NEVER flow into stdio/agent
// configuration. The gateway reads it separately for strictly allowlisted routes.
import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn((path: string) => {
    if (path.endsWith("/remote-mcp-board-key")) return "enrolled-board-secret";
    if (path.endsWith("/remote-mcp-agent-key")) return "enrolled-agent-secret";
    throw new Error("unexpected secret path");
  }),
}));

import { readConfigFromEnv } from "./config.js";

const common = {
  PAPERCLIP_API_URL: "http://localhost:3100",
  PAPERCLIP_API_KEY: "caller-api-key",
  PAPERCLIP_COMPANY_ID: "11111111-1111-1111-1111-111111111111",
};

describe("stdio configuration Board credential isolation", () => {
  it("never reads the enrolled Board secret for a generic agent", () => {
    const cfg = readConfigFromEnv({
      ...common,
      PAPERCLIP_AGENT_ID: "22222222-2222-2222-2222-222222222222",
    });
    expect(cfg.agentApiKey).toBe("enrolled-agent-secret");
    expect(cfg.boardApiKey).toBeNull();
    expect(cfg.wikiBoardApiKey).toBeUndefined();
  });

  it("rejects accidental Board environment projection into an agent process", () => {
    const cfg = readConfigFromEnv({
      ...common,
      PAPERCLIP_AGENT_ID: "22222222-2222-2222-2222-222222222222",
      PAPERCLIP_BOARD_API_KEY: "mistakenly-injected-board-key",
    });
    expect(cfg.boardApiKey).toBeNull();
  });

  it("does not load enrolled Board secret into an ordinary service process", () => {
    const cfg = readConfigFromEnv(common);
    expect(cfg.boardApiKey).toBeNull();
  });

  it("preserves explicitly supplied credentials for a non-agent Board caller", () => {
    const cfg = readConfigFromEnv({ ...common, PAPERCLIP_BOARD_API_KEY: "explicit-board-key" });
    expect(cfg.boardApiKey).toBe("explicit-board-key");
  });
});
