export interface HostRunContextInput {
  runId?: string | null;
  operatorRunId?: string | null;
}

export interface HostRunContext {
  runId: string;
  operatorRunId: string;
}

export function resolveHostRunContext(
  input: HostRunContextInput,
  sessionRunId: string | null = process.env.PAPERCLIP_RUN_ID ?? null,
): HostRunContext | null {
  const runId = input.runId ?? sessionRunId ?? input.operatorRunId ?? null;
  return runId ? { runId, operatorRunId: runId } : null;
}
