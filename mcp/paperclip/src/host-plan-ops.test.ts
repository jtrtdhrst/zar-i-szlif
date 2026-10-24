import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  REQUIRED_DEPLOY_OPS,
  canonicalOp,
  missingRequiredInPlan,
  hostPolicyDigest,
  noDeploymentExecutorResult,
  resolveDeploymentOps,
  unsupportedPlannedOps,
} from "./host-plan-ops.js";
import { capabilitiesDocument, hostLaneOperations } from "./host-ops.js";

const caps = capabilitiesDocument() as Record<string, unknown>;
const lane = hostLaneOperations();
const recreateTargets = Array.isArray(caps.recreateTargets) ? (caps.recreateTargets as string[]) : [];

describe("host deployment plan/apply fail-closed (KOMAA-1156)", () => {
  it("effective policy digest is identical for read, plan, and apply", () => {
    const read = caps.readOperations as string[];
    const writes = caps.mutatingOperations as string[];
    const digest = hostPolicyDigest(caps);
    const expected = createHash("sha256")
      .update(`${String(caps.policyVersion)}:${String(caps.supervisorVersion)}:${[...read, ...writes].join(",")}`)
      .digest("hex");
    expect(digest).toBe(expected);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    const oldBroken = createHash("sha256")
      .update(`${String(caps.policyVersion)}:${String(caps.supervisorVersion)}:${JSON.stringify(caps.supportedOperations ?? [])}`)
      .digest("hex");
    expect(digest).not.toBe(oldBroken);
  });

  it("never counts plan-only apply as a deployment", () => {
    const result = noDeploymentExecutorResult("test-plan", "test-operation", "plasmic-mcp");
    expect(result.status).toBe("refused");
    expect(result.state).toBe("FAILED");
    expect(result.errorCode).toBe("deployment_executor_missing");
    expect(result.operationIds).toEqual([]);
    expect(result.deployedImageDigest).toBeNull();
    expect(result.verification).toBeNull();
    expect(result.health).toBeNull();
    expect(result.rollbackAvailable).toBe(false);
    expect(result.possiblyCommitted).toBe(false);
  });
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
