// Pure, fail-closed release admission mirrored from the reviewed supervisor.
// A gateway env declaration alone never grants host permissions: the supervisor
// independently validates the exact issue, run, target, image and host policy.
export const GATEWAY_RECREATE_IMAGE_SHA256 =
  "sha256:e00d1ff3139d8671d38dc55e86855cbac577270577df82051b0cb206a777d104";
export const GATEWAY_SUPERVISOR_POLICY_SHA256 =
  "c15f036a7645b3f341878969f02850570b1710df96aa434644995464fbdeae99";

export function configuredRecreateTargets(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  if (
    env.PAPERCLIP_HOST_RECREATE_TARGETS !== "paperclip-mcp-gateway" ||
    env.PAPERCLIP_HOST_RECREATE_IMAGES !==
      "paperclip-mcp-gateway=" + GATEWAY_RECREATE_IMAGE_SHA256 ||
    env.PAPERCLIP_HOST_SUPERVISOR_POLICY_SHA256 !== GATEWAY_SUPERVISOR_POLICY_SHA256
  ) return [];
  return ["paperclip-mcp-gateway"];
}
