import { readFileSync } from "node:fs";

const ENROLLED_SECRET_PATHS = {
  agentApiKey: "/paperclip/instances/default/secrets/remote-mcp-agent-key",
} as const;

export interface PaperclipMcpConfig {
  apiUrl: string;
  apiKey: string;
  companyId: string | null;
  agentId: string | null;
  runId: string | null;
  operatorRunId?: string | null; // KOMAA-630: first-class operator session
  agentApiKey: string | null;
  boardApiKey: string | null;
  // KOMAA-1415: route-scoped Board projection for the llm-wiki plugin only.
  // The gateway resolves this from its own enrolled secret; it is never part
  // of the principal descriptor, never returned to the client and never used
  // for any route outside the wiki plugin data/actions allowlist.
  wikiBoardApiKey?: string | null;
  /** Explicit gateway caller principal; absent for legacy stdio agent runtimes. */
  principalKind?: "agent" | "board" | "service" | null;
}

function nonEmpty(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Only the agent key may be resolved from the enrolled file in a generic MCP
 * process. The enrolled Board key is exclusively read by the trusted gateway,
 * which projects it to the narrow allowlisted Wiki routes and never puts it
 * into ordinary agent/service session configuration. A caller-provided Board
 * key must be explicitly configured for a non-agent session. Missing keys
 * fail closed; no filesystem Board fallback is allowed in this module.
 */
function readEnrolledSecret(path: string): string | null {
  try {
    return nonEmpty(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function normalizeApiUrl(apiUrl: string): string {
  const trimmed = stripTrailingSlash(apiUrl.trim());
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PaperclipMcpConfig {
  const apiUrl = nonEmpty(env.PAPERCLIP_API_URL);
  if (!apiUrl) {
    throw new Error("Missing PAPERCLIP_API_URL");
  }
  const apiKey = nonEmpty(env.PAPERCLIP_API_KEY);
  if (!apiKey) {
    throw new Error("Missing PAPERCLIP_API_KEY");
  }

  const agentId = nonEmpty(env.PAPERCLIP_AGENT_ID);
  return {
    apiUrl: normalizeApiUrl(apiUrl),
    apiKey,
    companyId: nonEmpty(env.PAPERCLIP_COMPANY_ID),
    agentId,
    runId: nonEmpty(env.PAPERCLIP_RUN_ID),
    operatorRunId: nonEmpty(env.PAPERCLIP_OPERATOR_RUN_ID),
    agentApiKey: nonEmpty(env.PAPERCLIP_AGENT_API_KEY) ?? readEnrolledSecret(ENROLLED_SECRET_PATHS.agentApiKey),
    // Never promote a generic agent to Board, even if someone accidentally
    // injects PAPERCLIP_BOARD_API_KEY into its environment.
    boardApiKey: agentId ? null : nonEmpty(env.PAPERCLIP_BOARD_API_KEY),
  };
}
