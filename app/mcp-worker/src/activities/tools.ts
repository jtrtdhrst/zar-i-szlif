/**
 * Calendar D (KOMAA-1278) — rejestracja narzędzi aktywności w produkcyjnym MCP.
 *
 * Wycinek calendar-D kontraktu TARGET: `list_activities`, `get_activity`,
 * `manage_activity`. Bez osobnego `manage_google_event`, bez OAuth Google
 * Calendar, bez odczytu prywatnych kalendarzy i bez własnego magazynu wydarzeń.
 *
 * Narzędzia są rejestrowane TYLKO wtedy, gdy skonfigurowany jest backend
 * aplikacji. Bez backendu manifest pozostaje dokładnie czterema narzędziami
 * wiedzy — MCP nie obiecuje narzędzi, których nie obsłuży.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { canonicalUserId, type VerifiedGrant } from "../../../cloudflare-worker/src/identity.js";
import {
  MANAGE_ACTIVITY_ACTIONS,
  MANAGE_ACTIVITY_FIELDS,
  parseGetActivityArgs,
  parseListActivitiesArgs,
  parseManageActivityArgs,
} from "./contract.js";
import {
  ActivityBackendError,
  createActivityBackend,
  isActivityBackendConfigured,
  type ActivityBackendEnv,
} from "./backend.js";

const READ_SCOPE = "knowledge.read";

/** Nazwy narzędzi wycinka calendar-D — bez osobnego narzędzia Google. */
export const ACTIVITY_TOOL_NAMES = ["list_activities", "get_activity", "manage_activity"] as const;

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function errorResult(message: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}

function okResult(payload: Record<string, unknown>) {
  return {
    structuredContent: payload,
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}

export function registerActivityTools(
  server: McpServer,
  env: ActivityBackendEnv,
  grant: VerifiedGrant | null | undefined,
  origin: string,
): void {
  if (!isActivityBackendConfigured(env)) return;
  const subject = canonicalUserId(grant);
  const backend = createActivityBackend({
    baseUrl: env.APP_ACTIVITY_API_BASE as string,
    token: env.APP_ACTIVITY_API_TOKEN as string,
  });
  const meta = { securitySchemes: [{ type: "oauth2", issuer: origin, scopes: [READ_SCOPE] }] };

  server.registerTool(
    "list_activities",
    {
      title: "Lista aktywności drużyny",
      description:
        "Zwraca autoryzowane aktywności drużyny (nagłówek: tytuł, data, czas, status, tryb) z kanonicznym activity_id. Zespół i uprawnienia wynikają z tokenu, nie z argumentów.",
      inputSchema: {
        date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        status: z.string().trim().min(1).max(64).optional(),
        type: z.string().trim().min(1).max(64).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().trim().min(1).max(256).optional(),
      },
      annotations: readAnnotations,
      _meta: meta,
    },
    async (args) => {
      try {
        const result = await backend.listActivities(subject, parseListActivitiesArgs(args));
        return okResult(result);
      } catch (error) {
        return errorResult(
          error instanceof ActivityBackendError ? error.message : "Nie udało się pobrać aktywności.",
        );
      }
    },
  );

  server.registerTool(
    "get_activity",
    {
      title: "Pobierz aktywność",
      description:
        "Zwraca bezpieczny nagłówek jednej aktywności (ten sam kanoniczny activity_id co w panelu) wraz ze statusem synchronizacji kalendarza. Bez danych prywatnych kalendarza i bez sekretów.",
      inputSchema: { activity_id: z.string().trim().min(1).max(128) },
      annotations: readAnnotations,
      _meta: meta,
    },
    async (args) => {
      try {
        const { activity_id } = parseGetActivityArgs(args);
        return okResult({ ...(await backend.getActivity(subject, activity_id)) });
      } catch (error) {
        return errorResult(
          error instanceof ActivityBackendError ? error.message : "Nie udało się pobrać aktywności.",
        );
      }
    },
  );

  server.registerTool(
    "manage_activity",
    {
      title: "Zaktualizuj nagłówek aktywności",
      description:
        "Aktualizuje nagłówek istniejącej aktywności (tytuł, data, czas). Zapis idzie do kanonicznej aktywności w aplikacji; ewentualna zmiana połączonego kalendarza Google realizowana jest przez backend aplikacji, nie przez MCP.",
      inputSchema: {
        action: z.enum(MANAGE_ACTIVITY_ACTIONS),
        activity_id: z.string().trim().min(1).max(128),
        fields: z
          .object({
            title: z.string().trim().min(1).max(200).optional(),
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            start_at: z.string().trim().min(1).max(40).optional(),
            end_at: z.string().trim().min(1).max(40).optional(),
            timezone: z.string().trim().min(1).max(64).optional(),
          })
          .strict(),
        expected_version: z.union([z.number(), z.string()]).optional(),
        idempotency_key: z.string().trim().min(1).max(128).optional(),
      },
      annotations: writeAnnotations,
      _meta: meta,
    },
    async (args) => {
      try {
        const mutation = parseManageActivityArgs(args);
        return okResult({ ...(await backend.manageActivity(subject, mutation)) });
      } catch (error) {
        return errorResult(
          error instanceof ActivityBackendError ? error.message : "Nie udało się zapisać aktywności.",
        );
      }
    },
  );

  // Strażnik kontraktu: nazwy pól muszą pozostać zgodne z modułem kontraktu.
  if ((MANAGE_ACTIVITY_FIELDS as readonly string[]).length === 0) {
    throw new Error("Contract drift: brak dozwolonych pól mutacji aktywności.");
  }
}
