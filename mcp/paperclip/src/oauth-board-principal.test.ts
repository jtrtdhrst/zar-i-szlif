import { describe, expect, it, vi } from "vitest";
import { PaperclipApiClient } from "./client.js";
import { resolvePrincipal } from "../mcp-gateway/principal.mjs";
import { isVerifiedOwnerBoardGrant } from "../mcp-gateway/owner-oauth-policy.mjs";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";

function boardClient() {
  return new PaperclipApiClient({
    apiUrl: "http://127.0.0.1:3100/api",
    apiKey: "BOARD",
    companyId: COMPANY,
    agentId: null,
    runId: null,
    agentApiKey: null,
    boardApiKey: "BOARD",
    principalKind: "board",
  });
}
describe("external Board OAuth actor isolation", () => {
  it("routes peer wakeup under the caller Board credential", async () => {
    const requests: string[] = [];
    const mock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const h = init?.headers as Record<string, string>;
      requests.push(h.Authorization);
      return new Response(JSON.stringify({ok:true}), {status:200,headers:{"content-type":"application/json"}});
    });
    try {
      await boardClient().requestJson("POST", "/agents/" + AGENT + "/wakeup", {body:{reason:"test"}});
      expect(requests).toEqual(["Bearer BOARD"]);
    } finally {
      mock.mockRestore();
    }
  });

  it("validates owner OAuth against a real Board credential", async () => {
    const authBoard = async (token: string) => token === "BOARD";
    expect(await isVerifiedOwnerBoardGrant("BOARD", authBoard)).toBe(true);
    expect(await isVerifiedOwnerBoardGrant("AGENT", authBoard)).toBe(false);
  });

  it("separates a Board caller from the fixed service agent", async () => {
    const p = await resolvePrincipal({
      serviceTokens: ["SERVICE", "BOARD"],
      serviceAgentKey: "SERVICE",
      serviceAgentId: AGENT,
      serviceBoardKey: "server-key",
      companyId: COMPANY,
      authenticateBoard: async (key: string) => key === "BOARD",
      fetchAgentMe: async () => null,
    }, {token: "BOARD"});
    expect(p.kind).toBe("board");
    expect(p.agentId).toBeNull();
    expect(p.agentApiKey).toBeNull();
    expect(p.boardApiKey).toBe("BOARD");
  });
});
