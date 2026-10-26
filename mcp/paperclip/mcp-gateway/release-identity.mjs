export function getReleaseIdentity(env = process.env) {
  const sourceSha = env.SOURCE_COMMIT;
  const resourceUuid = env.COOLIFY_RESOURCE_UUID;
  const containerName = env.COOLIFY_CONTAINER_NAME;
  if (!/^[a-f0-9]{40}$/.test(sourceSha || '') ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(resourceUuid || '') ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/.test(containerName || '')) return null;
  return { sourceSha, resourceUuid, containerName };
}
