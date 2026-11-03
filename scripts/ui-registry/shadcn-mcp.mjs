import { spawn } from "node:child_process";
import path from "node:path";
const pnpmCommand = process.platform === "win32"
  ? [process.execPath, [path.join(process.env.APPDATA, "npm", "node_modules", "pnpm", "bin", "pnpm.mjs"), "exec", "shadcn", "mcp"]]
  : ["pnpm", ["exec", "shadcn", "mcp"]];
const child = spawn(pnpmCommand[0], pnpmCommand[1], { cwd: process.cwd(), stdio: "inherit" });

const stop = () => child.kill();

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 1));
