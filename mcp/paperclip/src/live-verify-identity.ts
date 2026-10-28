export function mcpSourceCommitFailures(
  expectedCommit: string | null | undefined,
  envCommit: string | null,
  mcpCommit: string | null,
): string[] {
  const failures: string[] = [];
  if (!mcpCommit) failures.push("MCP release identity unavailable");
  if (expectedCommit && mcpCommit && expectedCommit !== mcpCommit) failures.push(`commit mismatch: expected ${expectedCommit}, MCP source ${mcpCommit}`);
  if (envCommit && mcpCommit && envCommit !== mcpCommit) failures.push(`source/runtime mismatch: env ${envCommit} vs MCP source ${mcpCommit}`);
  return failures;
}
