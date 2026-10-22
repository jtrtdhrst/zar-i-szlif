/**
 * Błędy MCP bez zależności od @modelcontextprotocol/sdk.
 *
 * Narzędzia (mcp/mantic/src) rzucają te błędy, a serwer stdio tłumaczy je na
 * SDK-owy McpError. Dzięki temu Worker (mcp/mantic/worker) nie bundluje SDK
 * (a z nim zoda) — bundle zostaje w kilkunastu KB.
 */
export const ErrorCode = {
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

export class McpError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "McpError";
    this.code = code;
    this.data = data;
  }
}
