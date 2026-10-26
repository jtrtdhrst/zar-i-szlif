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

// Exact gateway lane replaces the unsafe generic container recreation.
export const GATEWAY_DEPLOY_OPS = ["mcp.gateway.release", "host.deployment_verify"] as const;

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
  const required = service === "paperclip-mcp-gateway" ? GATEWAY_DEPLOY_OPS : REQUIRED_DEPLOY_OPS;
  const laneSet = new Set(lane.laneOperations.map(canonicalOp));
  const missingOps = required.filter((op) => !laneSet.has(op));
  const missingTargets =
    missingOps.length === 0 && service !== "paperclip-mcp-gateway" && !lane.recreateTargets.includes(service) ? [service] : [];
  return { operations: [...required], missingOps, missingTargets };
}

export function unsupportedPlannedOps(plannedOps: string[], laneOperations: string[]): string[] {
  const laneSet = new Set(laneOperations.map(canonicalOp));
  return plannedOps.filter((op) => !laneSet.has(canonicalOp(op)));
}

export function missingRequiredInPlan(plannedOps: string[], service?: string): string[] {
  const required = service === "paperclip-mcp-gateway" ? GATEWAY_DEPLOY_OPS : REQUIRED_DEPLOY_OPS;
  const have = new Set(plannedOps.map(canonicalOp));
  return required.filter((op) => !have.has(op));
}
