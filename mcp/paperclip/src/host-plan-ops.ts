import { createHash } from "node:crypto";

// Fail-closed operation resolution for the host deployment plan/apply pair
// (paperclipHostPlanDeployment / paperclipHostApplyDeployment).
//
// KOMAA-1156 defect (planner v3.8 fail-open):
//   1. the planner read caps.supportedOperations - a field that does not exist
//      in capabilitiesDocument() - so the lane set was ALWAYS [] and
//      host.backup.create was force-included. Result: PLANNED / allow=true with
//      operations=['host.backup.create'] for a service whose recreate lane did
//      not exist (plan 467cb543-61f9-4da8-9693-6ce2672b2c9f).
//   2. the planner spelled the verify op "host.deployment.verify"; the supervisor
//      op is "host.deployment_verify", so verification was never planned.
//   3. the apply gate exempted backup.create/verify from the unsupported check,
//      so a backup-only plan was applied instead of refused.
// Fix: a plan is produced only when EVERY required operation has a real
// supervisor lane AND the service is a provisioned recreate target; the apply
// gate refuses any plan that does not cover every required operation.
//
// ponytail: pure functions, zero imports - the planner and the apply gate must
// agree on one definition of "the lane exists".

export const REQUIRED_DEPLOY_OPS = [
  "host.backup.create",
  "host.container.recreate",
  "host.deployment_verify",
] as const;

const ALIAS_SPELLING: Record<string, string> = {
  "host.deployment.verify": "host.deployment_verify",
  "host.service_reload": "host.service.reload",
  "host.container_recreate": "host.container.recreate",
  "host.deployment_rollback": "mcp.rollback",
};

export function canonicalOp(op: string): string {
  return ALIAS_SPELLING[op] ?? op;
}

export interface DeploymentLane {
  laneOperations: string[];
  recreateTargets: string[];
}

export interface DeploymentOpResolution {
  operations: string[];
  missingOps: string[];
  missingTargets: string[];
}

export function resolveDeploymentOps(lane: DeploymentLane, service: string): DeploymentOpResolution {
  const laneSet = new Set(lane.laneOperations.map(canonicalOp));
  const missingOps = REQUIRED_DEPLOY_OPS.filter((op) => !laneSet.has(op));
  const missingTargets =
    missingOps.length === 0 && !lane.recreateTargets.includes(service) ? [service] : [];
  return { operations: [...REQUIRED_DEPLOY_OPS], missingOps, missingTargets };
}

export function unsupportedPlannedOps(plannedOps: string[], laneOperations: string[]): string[] {
  const laneSet = new Set(laneOperations.map(canonicalOp));
  return plannedOps.filter((op) => !laneSet.has(canonicalOp(op)));
}

export function missingRequiredInPlan(plannedOps: string[]): string[] {
  const have = new Set(plannedOps.map(canonicalOp));
  return REQUIRED_DEPLOY_OPS.filter((op) => !have.has(op));
}

/**
 * A plan is not a deployment. Until the host executor is actually wired to
 * supervisor intents and their readbacks, fail closed instead of reporting
 * PREFLIGHT_PASSED as a successful deployment.
 */
export function noDeploymentExecutorResult(planId: string, operationId: string, service: string) {
  return {
    status: "refused" as const,
    operationId,
    deploymentId: operationId,
    planId,
    service,
    state: "FAILED" as const,
    errorCode: "deployment_executor_missing" as const,
    operationIds: [] as string[],
    deployedImageDigest: null,
    sourceSha: null,
    verification: null,
    health: null,
    rollbackAvailable: false,
    note: "No host deployment intents were submitted. Wire backup/recreate/verify/rollback to the supervisor with image-provenance readback before applying plans.",
    possiblyCommitted: false,
    evidenceReference: "ledger:" + operationId,
  };
}

/** Canonical digest for the host capabilities source of truth (read + mutation).
 * Never hash caps.supportedOperations: this field does not exist.
 */
export function hostPolicyDigest(caps: Record<string, unknown>): string {
  const reads = Array.isArray(caps.readOperations) ? (caps.readOperations as string[]) : [];
  const writes = Array.isArray(caps.mutatingOperations) ? (caps.mutatingOperations as string[]) : [];
  const canonical = `${String(caps.policyVersion)}:${String(caps.supervisorVersion)}:${[...reads, ...writes].join(",")}`;
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
