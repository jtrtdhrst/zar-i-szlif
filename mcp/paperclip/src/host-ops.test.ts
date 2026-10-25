import { beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HOST_TOOL_NAMES,
  capabilitiesDocument,
  configuredRecreateTargets,
  createHostTools,
  isMutatingOperation,
  payloadDigestForIntent,
  redactHostOutput,
} from "./host-ops.js";

function getTool(name: string) {
  const tool = createHostTools().find((t) => t.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool;
}

const AGENT = "22222222-2222-2222-2222-222222222222";
const RUN = "33333333-3333-3333-3333-333333333333";
const REQ = "44444444-4444-4444-4444-444444444444";

async function sandbox() {
  const base = await fs.mkdtemp(join(tmpdir(), "host-ops-"));
  const req = join(base, "requests");
  const res = join(base, "results");
  await fs.mkdir(req, { recursive: true });
  await fs.mkdir(res, { recursive: true });
  process.env.PAPERCLIP_HOST_OPS_REQUESTS_DIR = req;
  process.env.PAPERCLIP_HOST_OPS_RESULTS_DIR = res;
  return { base, req, res };
}

describe("host operations adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.PAPERCLIP_HOST_OPS_REQUESTS_DIR;
    delete process.env.PAPERCLIP_HOST_OPS_RESULTS_DIR;
    delete process.env.PAPERCLIP_RUN_ID;
  });

  it("registers exactly the two grouped tools", () => {
    expect(HOST_TOOL_NAMES).toEqual(["paperclipHostCapabilities", "paperclipHostOperation"]);
    expect(createHostTools().map((t) => t.name)).toEqual(HOST_TOOL_NAMES);
  });

  it("classifies mutating operations", () => {
    expect(isMutatingOperation("restart")).toBe(true);
    expect(isMutatingOperation("mcp.rollback")).toBe(true);
    expect(isMutatingOperation("ps")).toBe(false);
    expect(isMutatingOperation("host.health")).toBe(false);
  });

  it("capabilities document pins policy and gate thresholds", () => {
    const doc = capabilitiesDocument() as Record<string, unknown>;
    expect(doc.policyVersion).toBe("v3.11");
    expect(doc.supervisorVersion).toBe("1.0.20");
    expect(doc.deployGate).toEqual({ minFreeGib: 20, minFreePct: 10, deployNeedGib: 8 });
    expect(JSON.stringify(doc.auth)).toContain("except host.file.patch");
    expect(Array.isArray(doc.readOperations)).toBe(true);
  });

  it("does not advertise a gateway host recreate lane without all exact release pins", () => {
    const image = "sha256:e00d1ff3139d8671d38dc55e86855cbac577270577df82051b0cb206a777d104";
    const policy = "c15f036a7645b3f341878969f02850570b1710df96aa434644995464fbdeae99";
    const provisioned = {
      PAPERCLIP_HOST_RECREATE_TARGETS: "paperclip-mcp-gateway",
      PAPERCLIP_HOST_RECREATE_IMAGES: "paperclip-mcp-gateway=" + image,
      PAPERCLIP_HOST_SUPERVISOR_POLICY_SHA256: policy,
    };
    expect(configuredRecreateTargets({})).toEqual([]);
    expect(configuredRecreateTargets({ ...provisioned, PAPERCLIP_HOST_RECREATE_TARGETS: "" })).toEqual([]);
    expect(configuredRecreateTargets({ ...provisioned, PAPERCLIP_HOST_RECREATE_TARGETS: "*" })).toEqual([]);
    expect(configuredRecreateTargets({ ...provisioned, PAPERCLIP_HOST_RECREATE_IMAGES: "paperclip-mcp-gateway=sha256:wrong" })).toEqual([]);
    expect(configuredRecreateTargets({ ...provisioned, PAPERCLIP_HOST_SUPERVISOR_POLICY_SHA256: "wrong" })).toEqual([]);
    expect(configuredRecreateTargets(provisioned)).toEqual(["paperclip-mcp-gateway"]);
  });

  it("redacts keys and tokens from output", () => {
    const out = redactHostOutput("key pcp_abcdefgh12345678 and Bearer abcdefghijklmnop q");
    expect(out).not.toContain("pcp_abcdefgh12345678");
    expect(out).toContain("[REDACTED_API_KEY]");
    expect(out).toContain("Bearer [REDACTED]");
  });

  it("rejects ops without any live run context before touching the bridge", async () => {
    const { req } = await sandbox();
    const tool = getTool("paperclipHostOperation");
    const out = await tool.execute({ operation: "restart", target: "discord-mcp", agentId: AGENT, issueId: "x" });
    // 2026-10-17: no runId/operatorRunId/PAPERCLIP_RUN_ID — caller-fixable auth_failed, intent never written.
    const text = JSON.stringify(out);
    expect(text).toContain("auth_failed");
    expect(text).not.toContain("CAPABILITY_REMOVED");
    const files = await fs.readdir(req).catch(() => []);
    expect(files).toEqual([]);
  });

  it("submits a live runId without fabricating an operatorRunId", async () => {
    const { req, res } = await sandbox();
    const tool = getTool("paperclipHostOperation");
    const p = tool.execute({ operation: "restart", target: "discord-mcp", agentId: AGENT, issueId: "x", runId: RUN, requestId: REQ });
    await new Promise((r) => setTimeout(r, 150));
    await fs.writeFile(join(res, `${REQ}.json`), JSON.stringify({ requestId: REQ, operationId: REQ, bridge: "v3", status: "ok", ok: true, result: "restart-ok" }), "utf8");
    const out = await p;
    const text = JSON.stringify(out);
    expect(text).toContain("restart-ok");
    expect(text).not.toContain("CAPABILITY_REMOVED");
    const intent = JSON.parse(await fs.readFile(join(req, `${REQ}.json`), "utf8")) as Record<string, unknown>;
    expect(intent.runId).toBe(RUN);
    expect(intent).not.toHaveProperty("operatorRunId");
  });

  it("omits a stale legacy operatorRunId when a session run is present", async () => {
    const { req, res } = await sandbox();
    process.env.PAPERCLIP_RUN_ID = RUN;
    const tool = getTool("paperclipHostOperation");
    const p = tool.execute({ operation: "restart", target: "discord-mcp", agentId: AGENT, issueId: "KOMAA-1458", operatorRunId: "5d94e761-8b96-45f8-8155-51b9214df038", requestId: REQ });
    await new Promise((r) => setTimeout(r, 150));
    await fs.writeFile(join(res, `${REQ}.json`), JSON.stringify({ requestId: REQ, operationId: REQ, bridge: "v3", status: "ok", ok: true, result: "restart-ok" }), "utf8");
    await p;
    const intent = JSON.parse(await fs.readFile(join(req, `${REQ}.json`), "utf8")) as Record<string, unknown>;
    expect(intent.runId).toBe(RUN);
    expect(intent).not.toHaveProperty("operatorRunId");
  });

  it("rejects reads without any run context before touching the bridge", async () => {
    await sandbox();
    const tool = getTool("paperclipHostOperation");
    const out = await tool.execute({ operation: "ps", agentId: AGENT, issueId: "x" });
    expect(JSON.stringify(out)).toContain("auth_failed");
  });

  it("rejects disallowed restart targets fail-closed", async () => {
    await sandbox();
    const tool = getTool("paperclipHostOperation");
    const out = await tool.execute({ operation: "restart", target: "paperclip-db", agentId: AGENT, issueId: "x", operatorRunId: RUN });
    expect(JSON.stringify(out)).toContain("refused");
  });

  it("reads back a pre-seeded supervisor envelope (idempotent same-requestId)", async () => {
    const { res } = await sandbox();
    const envelope = { requestId: REQ, operationId: REQ, bridge: "v3", status: "ok", ok: true, result: "ps-output" };
    await fs.writeFile(join(res, `${REQ}.json`), JSON.stringify(envelope), "utf8");
    const tool = getTool("paperclipHostOperation");
    const out = await tool.execute({ operation: "ps", agentId: AGENT, issueId: "x", runId: RUN, requestId: REQ });
    expect(JSON.stringify(out)).toContain("ps-output");
  });

  it("payload digest is order-insensitive and distinguishes operations", () => {
    const a = payloadDigestForIntent({ operation: "health", target: "health" });
    const b = payloadDigestForIntent({ target: "health", operation: "health" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    const c = payloadDigestForIntent({ operation: "volumes", target: "volumes" });
    expect(c).not.toBe(a);
  });

  it("identical replay returns replayed:true without re-executing", async () => {
    const { res } = await sandbox();
    const digest = payloadDigestForIntent({ operation: "ps" });
    const envelope = { requestId: REQ, operationId: REQ, bridge: "v3", status: "ok", ok: true, result: "ps-output", payloadDigest: digest };
    await fs.writeFile(join(res, `${REQ}.json`), JSON.stringify(envelope), "utf8");
    const tool = getTool("paperclipHostOperation");
    const out = await tool.execute({ operation: "ps", agentId: AGENT, issueId: "x", runId: RUN, requestId: REQ });
    const text = JSON.stringify(out);
    expect(text).toContain("ps-output");
    expect(text).toContain("replayed");
  });

  it("same requestId with different payload fails closed with IDEMPOTENCY_CONFLICT", async () => {
    const { res } = await sandbox();
    const digestPs = payloadDigestForIntent({ operation: "ps" });
    const envelope = { requestId: REQ, operationId: REQ, bridge: "v3", status: "ok", ok: true, result: "ps-output", payloadDigest: digestPs };
    await fs.writeFile(join(res, `${REQ}.json`), JSON.stringify(envelope), "utf8");
    const tool = getTool("paperclipHostOperation");
    const out = await tool.execute({ operation: "health", agentId: AGENT, issueId: "x", runId: RUN, requestId: REQ });
    expect(JSON.stringify(out)).toContain("idempotency_conflict");
  });

  it("pending request with different payload conflicts without overwriting", async () => {
    const { req, res } = await sandbox();
    const pendingId = "55555555-5555-4555-8555-555555555555";
    await fs.writeFile(join(req, `${pendingId}.json`), JSON.stringify({ v: 1, requestId: pendingId, operation: "ps" }), "utf8");
    const tool = getTool("paperclipHostOperation");
    const out = await tool.execute({ operation: "health", agentId: AGENT, issueId: "x", runId: RUN, requestId: pendingId });
    expect(JSON.stringify(out)).toContain("idempotency_conflict");
    // No result was fabricated for the conflicting payload.
    await expect(fs.readFile(join(res, `${pendingId}.json`), "utf8")).rejects.toThrow();
  });
});
