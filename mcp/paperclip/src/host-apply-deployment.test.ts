import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createP1PlatformTools } from "./p1-platform.js";

const AGENT = "22222222-2222-4222-8222-222222222222";
const COMPANY = "9894e3c2-3317-46ca-8c72-7a442a76a78e";
const RUN = "33333333-3333-4333-8333-333333333333";
const SOURCE = "a".repeat(40);
const IMAGE = "sha256:" + "b".repeat(64);
const ISSUE = "11111111-1111-4111-8111-111111111111";
const dirs: string[] = [];

async function fixture(board = false) {
  const root = await mkdtemp(join(tmpdir(), "gateway-apply-"));
  dirs.push(root);
  const ledger = join(root, "ledger"), req = join(root, "requests"), results = join(root, "results");
  await Promise.all([mkdir(ledger), mkdir(req), mkdir(results)]);
  process.env.PAPERCLIP_PLATFORM_OPS_LEDGER_DIR = ledger;
  process.env.PAPERCLIP_HOST_OPS_REQUESTS_DIR = req;
  process.env.PAPERCLIP_HOST_OPS_RESULTS_DIR = results;
  const client = board
    ? { callerApiKey: "pcp_board_", defaults: {}, requestJson: async () => { throw new Error("unused"); } }
    : {
        callerApiKey: "test-agent-session", defaults: { runId: RUN },
        resolveCompanyId: () => COMPANY,
        getJsonOrNull: async (endpoint: string) => {
          if (endpoint === "/heartbeat-runs/" + RUN) return {
            id: RUN, agentId: AGENT, companyId: COMPANY,
            status: "running", contextSnapshot: { issueId: ISSUE },
          };
          return null;
        },
        requestJson: async (_: string, endpoint: string) => {
          if (endpoint === "/agents/me") return { id: AGENT };
          if (endpoint === "/heartbeat-runs/" + RUN) return {
            id: RUN, agentId: AGENT, companyId: COMPANY,
            status: "running", contextSnapshot: { issueId: ISSUE },
          };
          throw new Error("unexpected endpoint: " + endpoint);
        },
      };
  const tools = createP1PlatformTools(client as never);
  const planTool = tools.find((t) => t.name === "paperclipHostPlanDeployment")!;
  const applyTool = tools.find((t) => t.name === "paperclipHostApplyDeployment")!;
  const planResponse = await planTool.execute({
    service: "paperclip-mcp-gateway", artifactDigest: IMAGE, sourceSha: SOURCE,
    issueId: ISSUE, environment: "production",
  });
  const plan = JSON.parse(planResponse.content[0]!.text);
  expect(plan.state).toBe("PLANNED");
  expect(plan.operations).toEqual(["mcp.gateway.release", "host.deployment_verify"]);
  return { applyTool, plan, req, results, ledger };
}

afterEach(async () => {
  delete process.env.PAPERCLIP_PLATFORM_OPS_LEDGER_DIR;
  delete process.env.PAPERCLIP_HOST_OPS_REQUESTS_DIR;
  delete process.env.PAPERCLIP_HOST_OPS_RESULTS_DIR;
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("gateway deployment E2E bridge (host supervisor simulated)", () => {
  it("requires live agent authority instead of board-only synthetic deploy", async () => {
    const { applyTool, plan, req } = await fixture(true);
    const result = await applyTool.execute({ planId: plan.planId });
    expect(JSON.stringify(result)).toContain("auth_failed");
    expect(await readdir(req)).toEqual([]);
  });

  it("submits exact run-bound intent and recognizes a host-confirmed image and health readback", async () => {
    const { applyTool, plan, req, results } = await fixture();
    const p = applyTool.execute({ planId: plan.planId, runId: RUN });
    await new Promise((resolve) => setTimeout(resolve, 350));
    const intent = JSON.parse(await readFile(join(req, plan.planId + ".json"), "utf8").catch(async (e) => { throw new Error("No host intent; early result " + JSON.stringify(await p) + " " + String(e)); }));
    expect(intent).toMatchObject({
      operation: "mcp.gateway.release", target: "paperclip-mcp-gateway",
      sourceSha: SOURCE, artifactDigest: IMAGE, issueId: ISSUE, agentId: AGENT, runId: RUN, requestId: plan.planId,
    });
    await writeFile(join(results, plan.planId + ".json"), JSON.stringify({
      requestId: plan.planId, target: "recreate-paperclip-mcp-gateway", status: "ok", ok: true,
      result: "DEPLOY_VERIFIED source_sha=" + SOURCE + " image_id=" + IMAGE,
    }));
    const response = JSON.parse((await p).content[0]!.text);
    expect(response).toMatchObject({
      status: "ok", state: "VERIFIED", sourceSha: SOURCE,
      deployedImageDigest: IMAGE, operationIds: [plan.planId],
    });
    expect(response.verification.gatewayHealth).toBe("healthy");
  });

  it("does not mark an unverified supervisor result as deployed", async () => {
    const { applyTool, plan, req, results, ledger } = await fixture();
    const p = applyTool.execute({ planId: plan.planId, runId: RUN });
    await new Promise((resolve) => setTimeout(resolve, 350));
    await readFile(join(req, plan.planId + ".json"), "utf8").catch(async (e) => { throw new Error("No host intent; early result " + JSON.stringify(await p) + " " + String(e)); });
    await writeFile(join(results, plan.planId + ".json"), JSON.stringify({
      requestId: plan.planId, target: "recreate-paperclip-mcp-gateway", status: "ok", ok: true, result: "PREFLIGHT_PASSED",
    }));
    const message = JSON.stringify(await p);
    expect(message).toContain("verification_failed");
    const files = await readdir(ledger);
    expect(files.some((f) => f.endsWith("-VERIFIED.json"))).toBe(false);
  });
  it("rejects host success with image ID different from the approved plan", async () => {
    const { applyTool, plan, req, results, ledger } = await fixture();
    const p = applyTool.execute({ planId: plan.planId, runId: RUN });
    await new Promise((resolve) => setTimeout(resolve, 350));
    const intent = JSON.parse(await readFile(join(req, plan.planId + ".json"), "utf8"));
    expect(intent.artifactDigest).toBe(IMAGE);
    await writeFile(join(results, plan.planId + ".json"), JSON.stringify({
      requestId: plan.planId, target: "recreate-paperclip-mcp-gateway", status: "ok", ok: true,
      result: "DEPLOY_VERIFIED source_sha=" + SOURCE + " image_id=sha256:" + "c".repeat(64),
    }));
    const response = JSON.stringify(await p);
    expect(response).toContain("verification_failed");
    expect((await readdir(ledger)).some((f) => f.endsWith("-VERIFIED.json"))).toBe(false);
  });

  it("finishes a completed host release from a later run without executing Docker again", async () => {
    const { applyTool, plan, req, results } = await fixture();
    await writeFile(join(results, plan.planId + ".json"), JSON.stringify({
      requestId: plan.planId, target: "recreate-paperclip-mcp-gateway",
      status: "ok", ok: true,
      result: "DEPLOY_VERIFIED source_sha=" + SOURCE + " image_id=" + IMAGE,
    }));
    const response = JSON.parse((await applyTool.execute({ planId: plan.planId, runId: RUN })).content[0]!.text);
    expect(response.state).toBe("VERIFIED");
    expect(await readdir(req)).toEqual([]);
  });

  it("does not submit a duplicate deployment while an earlier run's intent is pending", async () => {
    const { applyTool, plan, req } = await fixture();
    const path = join(req, plan.planId + ".json");
    const previous = { requestId: plan.planId, operation: "mcp.gateway.release", runId: "previous-live-run" };
    await writeFile(path, JSON.stringify(previous));
    const response = JSON.parse((await applyTool.execute({ planId: plan.planId, runId: RUN })).content[0]!.text);
    expect(response.status).toBe("pending");
    expect(response.state).toBe("DEPLOYING");
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(previous);
  });
});
