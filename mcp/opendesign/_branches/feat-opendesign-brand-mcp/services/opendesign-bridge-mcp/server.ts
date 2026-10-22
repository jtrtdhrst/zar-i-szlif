// Remote OpenDesign MCP for canonical Design System read/write operations.
// The bridge uses only supported OpenDesign daemon APIs; it never mounts or edits
// OpenDesign's data directory directly.
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
const BRAND_WRITE_ENABLED = env("BRAND_WRITE_ENABLED", "false") === "true";
const BRAND_ASSET_MAX_BYTES = Number(env("BRAND_ASSET_MAX_BYTES", "5000000"));
const MCP_MAX_BODY_BYTES = Number(env("MCP_MAX_BODY_BYTES", "7500000"));

const od = new OdClient({
  baseUrl: OD_BASE_URL,
  token: req("OD_API_TOKEN"),
});

const legacyId = {
  projectId: z.string().describe("id design-systemu (z design_list_projects)"),
};
const brandId = {
  brandId: z
    .string()
    .min(1)
    .describe("Canonical OpenDesign design-system id. Writes require an editable user:* id."),
};

function requireBrandWrite(): void {
  if (!BRAND_WRITE_ENABLED) {
    throw new Error("BRAND_WRITE_DISABLED set BRAND_WRITE_ENABLED=true to allow mutations");
  }
}

await serve({
  name: "open-design-remote",
  version: "0.2.0",
  tools: [
    // Compatibility reads retained for existing design-stack clients.
    {
      name: "design_list_projects",
      description: "Lista design-systemów (canonical design tokens/components).",
      schema: {},
      handler: async () => od.listDesignSystems(),
    },
    {
      name: "design_get_project",
      description: "Meta design-systemu.",
      schema: { ...legacyId },
      handler: async (a) => od.getDesignSystem(a.projectId as string),
    },
    {
      name: "design_list_tokens",
      description: "READ: tokeny (colors, typography, spacing, radius, shadows).",
      schema: { ...legacyId },
      handler: async (a) => ({ tokens: await od.getTokens(a.projectId as string) }),
    },
    {
      name: "design_get_tokens",
      description: "READ: pełne tokeny (alias design_list_tokens).",
      schema: { ...legacyId },
      handler: async (a) => ({ tokens: await od.getTokens(a.projectId as string) }),
    },
    {
      name: "design_list_components",
      description: "READ: komponenty design-systemu.",
      schema: { ...legacyId },
      handler: async (a) => ({ components: await od.getComponents(a.projectId as string) }),
    },
    {
      name: "design_get_component",
      description: "READ: pojedynczy komponent po id/nazwie.",
      schema: { ...legacyId, componentId: z.string() },
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
      schema: { ...legacyId },
      handler: async (a) => od.listFiles(a.projectId as string),
    },
    {
      name: "design_read_file",
      description: "READ: zawartość pliku design-systemu.",
      schema: { ...legacyId, path: z.string() },
      handler: async (a) => ({
        content: await od.readFile(a.projectId as string, a.path as string),
      }),
    },
    {
      name: "design_get_context",
      description:
        "Zoptymalizowany kontekst dla agenta: project + tokens + components + constraints + refs.",
      schema: { ...legacyId },
      handler: async (a) => od.getContext(a.projectId as string),
    },

    // Canonical brand-maintenance API.
    {
      name: "get_brand",
      description:
        "Read the canonical OpenDesign brand package needed before any mutation: DESIGN.md, tokens.css, manifest, usage, component manifest, assets, and concurrency hashes.",
      schema: { ...brandId },
      handler: async (a) => od.getBrand(a.brandId as string),
    },
    {
      name: "update_design_md",
      description:
        "Atomically update canonical DESIGN.md for an editable user:* brand using the exact SHA returned by get_brand. Rejects stale writes and verifies read-back.",
      schema: {
        ...brandId,
        designMd: z.string().min(1).describe("Complete replacement DESIGN.md, not a fragment."),
        expectedSha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .describe("get_brand.hashes.designMdSha256 from the state being edited."),
      },
      handler: async (a) => {
        requireBrandWrite();
        return od.updateDesignMd(
          a.brandId as string,
          a.designMd as string,
          a.expectedSha256 as string,
        );
      },
    },
    {
      name: "update_tokens",
      description:
        "Update brand tokens through OpenDesign's canonical contract: submit the complete revised DESIGN.md plus both hashes from get_brand. OpenDesign regenerates tokens.css; the tool verifies that tokens changed and rolls DESIGN.md back if they did not.",
      schema: {
        ...brandId,
        designMd: z
          .string()
          .min(1)
          .describe("Complete revised DESIGN.md containing the intended token-contract changes."),
        expectedDesignMdSha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .describe("get_brand.hashes.designMdSha256 from the state being edited."),
        expectedTokensSha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable()
          .describe("get_brand.hashes.tokensCssSha256; null only when tokens.css does not exist."),
      },
      handler: async (a) => {
        requireBrandWrite();
        return od.updateTokens(
          a.brandId as string,
          a.designMd as string,
          a.expectedDesignMdSha256 as string,
          (a.expectedTokensSha256 as string | null) ?? null,
        );
      },
    },
    {
      name: "upload_brand_asset",
      description:
        "Upload an image/font into canonical assets/ through the OpenDesign workspace + sync-assets path. Verifies the canonical bytes by SHA-256. Existing assets require overwrite=true.",
      schema: {
        ...brandId,
        path: z
          .string()
          .min(1)
          .describe("Relative asset path, e.g. logos/logo-primary.svg or assets/logos/logo-primary.svg."),
        contentBase64: z.string().min(4).describe("Base64-encoded binary asset bytes."),
        overwrite: z.boolean().optional().default(false),
      },
      handler: async (a) => {
        requireBrandWrite();
        return od.uploadBrandAsset(
          a.brandId as string,
          a.path as string,
          a.contentBase64 as string,
          {
            overwrite: a.overwrite === true,
            maxBytes: BRAND_ASSET_MAX_BYTES,
          },
        );
      },
    },
  ],
  httpPort: env("MCP_HTTP_PORT") ? Number(env("MCP_HTTP_PORT")) : undefined,
  authTokens: [
    env("MCP_AUTH_TOKEN", ""),
    ...(env("MCP_AUTH_TOKENS", "")?.split(",") ?? []),
  ].filter((t): t is string => !!t),
  toolTimeoutMs: 60_000,
  maxBodyBytes: MCP_MAX_BODY_BYTES,
  rateLimitPerMin: 60,
  readyChecks: {
    odDaemon: async () => {
      try {
        const res = await fetch(`${OD_BASE_URL}/api/health`);
        return { ok: res.ok };
      } catch (e) {
        return { ok: false, detail: String(e).slice(0, 150) };
      }
    },
    designSystems: async () => {
      try {
        await od.listDesignSystems();
        return { ok: true };
      } catch (e) {
        return { ok: false, detail: String(e).slice(0, 150) };
      }
    },
  },
});
