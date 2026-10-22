import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PaperclipApiClient } from "./client.js";
import { readConfigFromEnv, type PaperclipMcpConfig } from "./config.js";
import { createToolDefinitions } from "./tools.js";

export function createPaperclipMcpServer(
  config: PaperclipMcpConfig = readConfigFromEnv(),
  opts?: { toolAllowlist?: Set<string> },
) {
  const server = new McpServer({
    name: "paperclip",
    version: "0.2.0", // KOMAA-631b: delivery-cycle catalog
  });

  const client = new PaperclipApiClient(config);
  const tools = createToolDefinitions(client).filter((t) => !opts?.toolAllowlist || opts.toolAllowlist.has(t.name));
  for (const tool of tools) {
    server.tool(tool.name, tool.description, tool.schema.shape, tool.execute);
  }

  return {
    server,
    tools,
    client,
  };
}

export async function runServer(config: PaperclipMcpConfig = readConfigFromEnv()) {
  const { server } = createPaperclipMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
