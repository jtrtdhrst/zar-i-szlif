// opendesign-bridge-mcp (Etap 4): READ-ONLY mostek dla v0.
// Lokalny OD MCP jest stdio; zdalni klienci potrzebują remote HTTP — ten serwis wystawia
// wyłącznie odczyt przez daemon REST. Write-back celowo niezaimplementowany
// (propozycje: v0 → proposal → Paperclip/OpenCode → walidacja → OpenDesign).
import { OdClient } from "@design-stack/od-client";
import { serve } from "@design-stack/mcp-server";
import { z } from "zod";

const env = (k: string, d?: string) => process.env[k] ?? d;
const req = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};

const OD_BASE_URL = (
  process.env.OD_BASE_URL ??
  `http://${process.env.OD_HOST ?? "open-design"}:${process.env.OD_PORT ?? "7456"}`
).replace(/\/$/, "");
// Ten kontener MUSI być w sieci open-design_default (docker network connect)
// — chyba że OD_BASE_URL wskazuje publiczny URL.
const od = new OdClient({
  baseUrl: OD_BASE_URL,
  token: req("OD_API_TOKEN"),
});

const id = { projectId: z.string().describe("id design-systemu (z design_list_projects)") };

await serve({
  name: "open-design-remote",
  version: "0.1.0",
  tools: [
    {
      name: "design_list_projects",
      description: "Lista design-systemów (canonical design tokens/components).",
      schema: {},
      handler: async () => od.listDesignSystems(),
    },
    {
      name: "design_get_project",
      description: "Meta design-systemu.",
      schema: { ...id },
      handler: async (a) => od.getDesignSystem(a.projectId as string),
    },
    {
      name: "design_list_tokens",
      description: "READ: tokeny (colors, typography, spacing, radius, shadows).",
      schema: { ...id },
      handler: async (a) => ({ tokens: await od.getTokens(a.projectId as string) }),
    },
    {
      name: "design_get_tokens",
      description: "READ: pełne tokeny (alias design_list_tokens).",
      schema: { ...id },
      handler: async (a) => ({ tokens: await od.getTokens(a.projectId as string) }),
    },
    {
      name: "design_list_components",
      description: "READ: komponenty design-systemu.",
      schema: { ...id },
      handler: async (a) => ({ components: await od.getComponents(a.projectId as string) }),
    },
    {
      name: "design_get_component",
      description: "READ: pojedynczy komponent po id/nazwie.",
      schema: { ...id, componentId: z.string() },
      handler: async (a) => {
        const all = await od.getComponents(a.projectId as string);
        const found = all.find(
          (c) =>
            c.id === a.componentId ||
            c.name.toLowerCase() === String(a.componentId).toLowerCase(),
        );
        if (!found) throw new Error(`NOT_FOUND component ${a.componentId}`);
        return { component: found };
      },
    },
    {
      name: "design_list_files",
      description: "READ: pliki design-systemu.",
      schema: { ...id },
      handler: async (a) => od.listFiles(a.projectId as string),
    },
    {
      name: "design_read_file",
      description: "READ: zawartość pliku design-systemu.",
      schema: { ...id, path: z.string() },
      handler: async (a) =>
        ({ content: await od.readFile(a.projectId as string, a.path as string) }),
    },
    {
      name: "design_get_context",
      description:
        "Zoptymalizowany kontekst dla agenta: project + tokens + components + constraints + refs (limit rozmiaru).",
      schema: { ...id },
      handler: async (a) => od.getContext(a.projectId as string),
    },
  ],
  httpPort: env("MCP_HTTP_PORT") ? Number(env("MCP_HTTP_PORT")) : undefined,
  authTokens: [
    env("MCP_AUTH_TOKEN", ""),
    ...(env("MCP_AUTH_TOKENS", "")?.split(",") ?? []),
  ].filter((t): t is string => !!t),
  readyChecks: {
    odDaemon: async () => {
      try {
        const res = await fetch(`${OD_BASE_URL}/api/health`);
        return { ok: res.ok };
      } catch (e) {
        return { ok: false, detail: String(e).slice(0, 150) };
      }
    },
  },
});
