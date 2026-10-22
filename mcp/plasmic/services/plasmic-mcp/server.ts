// plasmic-mcp: cienki semantyczny adapter nad WAB REST (Etap 1).
// Transport: stdio (OpenCode) i/lub Streamable HTTP na 127.0.0.1 (v0) — Etap 2.
// Chrome/CDP nie jest używane: WAB REST w zupełności wystarcza.
import { PlasmicClient } from "@design-stack/plasmic-client";
import { serve } from "@design-stack/mcp-server";
import { plasmicTools, type PlasmicCtx } from "./tools.ts";

const env = (k: string, d?: string) => process.env[k] ?? d;
const req = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};

const PLASMIC_BASE_URL = (
  process.env.PLASMIC_BASE_URL ??
  `http://${process.env.PLASMIC_HOST ?? "plasmic-wab"}:${process.env.PLASMIC_PORT ?? "3004"}`
).replace(/\/$/, "");

const client = new PlasmicClient({
  baseUrl: PLASMIC_BASE_URL,
  email: env("PLASMIC_EMAIL"),
  password: env("PLASMIC_PASSWORD"),
  teamToken: env("PLASMIC_TEAM_TOKEN"),
});

const ctx: PlasmicCtx = {
  client,
  stateDir: env("PLASMIC_STATE_DIR", "./var/plasmic-mcp") as string,
  auditFile:
    env("PLASMIC_AUDIT_FILE") ??
    `${env("PLASMIC_STATE_DIR", "./var/plasmic-mcp")}/audit.jsonl`,
  agent: env("PAPERCLIP_AGENT_ID"),
  run: env("PAPERCLIP_RUN_ID"),
};

const httpPort = env("MCP_HTTP_PORT") ? Number(env("MCP_HTTP_PORT")) : undefined;
const authTokens: string[] = [
  env("MCP_AUTH_TOKEN", ""),
  ...(env("MCP_AUTH_TOKENS", "")?.split(",") ?? []),
].filter((t): t is string => !!t);

await serve({
  name: "plasmic",
  version: "0.1.0",
  tools: plasmicTools(ctx),
  httpPort,
  authTokens,
  readyChecks: {
    wab: async () => {
      try {
        const res = await fetch(`${PLASMIC_BASE_URL}/healthcheck`);
        return { ok: res.ok };
      } catch (e) {
        return { ok: false, detail: String(e).slice(0, 150) };
      }
    },
    plasmicSession: async () => {
      try {
        await client.listProjects();
        return { ok: true };
      } catch (e) {
        return { ok: false, detail: String(e).slice(0, 150) };
      }
    },
  },
});
