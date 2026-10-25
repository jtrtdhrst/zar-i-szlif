import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  REQUIRED_DEPLOY_OPS,
  canonicalOp,
  missingRequiredInPlan,
  resolveDeploymentOps,
  unsupportedPlannedOps,
} from "./host-plan-ops.js";
import { capabilitiesDocument, hostLaneOperations } from "./host-ops.js";
import { capabilityPolicyDigest, createP1PlatformTools } from "./p1-platform.js";

const caps = capabilitiesDocument() as Record<string, unknown>;
const lane = hostLaneOperations();
const recreateTargets = Array.isArray(caps.recreateTargets) ? (caps.recreateTargets as string[]) : [];

describe("host deployment plan/apply fail-closed (KOMAA-1156)", () => {
  it("root cause witness: the capabilities document never had supportedOperations", () => {
    expect(caps.supportedOperations).toBeUndefined();
    expect(Array.isArray(caps.supportedOperations)).toBe(false);
  });

  it("lane set carries the real supervisor operations", () => {
    for (const op of REQUIRED_DEPLOY_OPS) expect(lane).toContain(op);
    expect(lane).not.toContain("host.container_build");
  });

  it("pre-fix planner produced a backup-only PLANNED plan (defect witness)", () => {
    const legacySupported = Array.isArray(caps.supportedOperations) ? (caps.supportedOperations as string[]) : [];
    const legacyOperations = ["host.backup.create", "host.container.recreate", "host.deployment.verify"].filter(
      (op) => legacySupported.includes(op) || ["host.backup.create"].includes(op),
    );
    expect(legacyOperations).toEqual(["host.backup.create"]);
    expect(missingRequiredInPlan(legacyOperations).length).toBeGreaterThan(0);
  });

  it("plan fails closed while no recreate target is provisioned", () => {
    const res = resolveDeploymentOps({ laneOperations: lane, recreateTargets }, "mantic-mcp-http");
    expect(res.missingOps).toEqual([]);
    expect(res.missingTargets).toEqual(["mantic-mcp-http"]);
  });

  it("plan is produced only with every required lane AND a provisioned target", () => {
    const res = resolveDeploymentOps({ laneOperations: lane, recreateTargets: ["mantic-mcp-http"] }, "mantic-mcp-http");
    expect(res.missingOps).toEqual([]);
    expect(res.missingTargets).toEqual([]);
    expect(res.operations).toEqual([...REQUIRED_DEPLOY_OPS]);
  });

  it("a missing required lane is reported, never papered over", () => {
    const res = resolveDeploymentOps(
      { laneOperations: lane.filter((op) => op !== "host.container.recreate" && op !== "host.container_recreate"), recreateTargets: ["mantic-mcp-http"] },
      "mantic-mcp-http",
    );
    expect(res.missingOps).toEqual(["host.container.recreate"]);
    expect(res.missingTargets).toEqual([]);
  });

  it("apply gate refuses a backup-only plan and accepts the canonical op set", () => {
    expect(missingRequiredInPlan(["host.backup.create"])).toEqual(["host.container.recreate", "host.deployment_verify"]);
    expect(unsupportedPlannedOps(["host.backup.create"], lane)).toEqual([]);
    expect(missingRequiredInPlan([...REQUIRED_DEPLOY_OPS])).toEqual([]);
  });

  it("legacy op spelling is canonicalised instead of treated as unknown", () => {
    expect(canonicalOp("host.deployment.verify")).toBe("host.deployment_verify");
    expect(unsupportedPlannedOps(["host.deployment.verify"], lane)).toEqual([]);
  });
});

describe("host deployment policy digest consistency (KOMAA-1463)", () => {
  const deploymentArgs = {
    service: "paperclip-mcp-gateway",
    artifactDigest: "sha256:e00d1ff3139d8671d38dc55e86855cbac577270577df82051b0cb206a777d104",
    environment: "production",
  };

  it("accepts the effective-policy capability digest and reports the REAL missing target", async () => {
    const tool = createP1PlatformTools({} as never).find((entry) => entry.name === "paperclipHostPlanDeployment");
    expect(tool).toBeDefined();
    const response = await tool!.execute({ ...deploymentArgs, expectedPolicyDigest: capabilityPolicyDigest(caps) });
    const message = response.content.map((part) => part.text).join("\n");
    expect(message).toContain("not a provisioned container-recreate target");
    expect(message).not.toContain("version_conflict");
  });

  it("still denies a genuinely stale capability digest", async () => {
    const tool = createP1PlatformTools({} as never).find((entry) => entry.name === "paperclipHostPlanDeployment");
    expect(tool).toBeDefined();
    const response = await tool!.execute({ ...deploymentArgs, expectedPolicyDigest: "stale-version" });
    const message = response.content.map((part) => part.text).join("\n");
    expect(message).toContain("version_conflict");
  });

  it("never presents gateway compile-time versions as proven running-host policy drift", async () => {
    const tool = createP1PlatformTools({} as never).find((entry) => entry.name === "paperclipHostGetEffectivePolicy");
    expect(tool).toBeDefined();
    const response = await tool!.execute({});
    const policy = JSON.parse(response.content[0]!.text);
    expect(policy.runningSupervisorVersion).toBe("unverified");
    expect(policy.activePolicyVersion).toBe("unverified");
    expect(policy.driftVerified).toBe(false);
    expect(policy.driftStatus).toBe("unverified");
    expect(policy.driftDetected).toBe(false);
    expect(policy.gatewayCapabilityDigest).toBe(capabilityPolicyDigest(caps));
  });

  it("rejects a hand-written stale apply plan rather than faking PREFLIGHT_PASSED", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-apply-regression-"));
    const previous = process.env.PAPERCLIP_PLATFORM_OPS_LEDGER_DIR;
    process.env.PAPERCLIP_PLATFORM_OPS_LEDGER_DIR = dir;
    try {
      const planId = randomUUID();
      await writeFile(join(dir, `plan-${planId}.json`), JSON.stringify({
        planId,
        service: "paperclip-mcp-gateway",
        environment: "production",
        operations: [...REQUIRED_DEPLOY_OPS],
      }));
      // Board authority: any refusal here is from target/executor checks.
      const tool = createP1PlatformTools({ callerApiKey: "pcp_board_" } as never).find(
        (entry) => entry.name === "paperclipHostApplyDeployment",
      );
      expect(tool).toBeDefined();
      const response = await tool!.execute({ planId });
      const message = response.content.map((part) => part.text).join("\n");
      expect(message).toContain("configuration_missing");
      expect(message).toContain("not provisioned");
      expect(message).not.toContain('"state":"PREFLIGHT_PASSED"');
      const files = await readdir(dir);
      expect(files.some((file) => file.includes("PREFLIGHT_PASSED"))).toBe(false);
      expect(files.some((file) => file.includes("FAILED"))).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.PAPERCLIP_PLATFORM_OPS_LEDGER_DIR;
      else process.env.PAPERCLIP_PLATFORM_OPS_LEDGER_DIR = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
