import net from "node:net";
import { startRegistryMcpServer } from "../../kompas-ui-plugin/server/registry-mcp.mjs";

const portIndex = process.argv.indexOf("--port");
const port = portIndex === -1 ? Number(process.env.PORT || 4173) : Number(process.argv[portIndex + 1]);

function portIsListening(portToCheck) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port: portToCheck });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

await startRegistryMcpServer({ port });
console.log(`@kompas shadcn MCP: http://127.0.0.1:${port}/mcp`);
