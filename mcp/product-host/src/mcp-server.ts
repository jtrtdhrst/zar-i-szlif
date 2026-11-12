// MCP surface: exactly two read-only tools over the `sprawnosci` catalog.
// There is no write tool, no SQL executor, no arbitrary URL fetch and no admin
// surface in this service.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { SERVICE_NAME, SERVICE_VERSION } from "./config.ts";
import type { Logger } from "./logger.ts";
import {
  ASPEKTY,
  CountUnavailableError,
  InvalidArgumentError,
  POZIOMY,
  PostgrestError,
  SprawnoscNotFoundError,
  type SprawnoscRepository,
} from "./supabase.ts";

export interface McpServerDeps {
  repository: SprawnoscRepository;
  /** Bearer token of the calling user; PostgREST/RLS runs as that user. */
  accessToken: string;
  logger: Logger;
}

const LIMIT_DEFAULT = 25;
const LIMIT_MAX = 100;

function jsonResult(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function toolError(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

function describeFailure(error: unknown, tool: string, logger: Logger): string {
  if (error instanceof SprawnoscNotFoundError) return error.message;
  if (error instanceof InvalidArgumentError) return `invalid arguments: ${error.message}`;
  if (error instanceof CountUnavailableError) {
    logger.warn("postgrest total count unavailable", { tool });
    return error.message;
  }
  if (error instanceof PostgrestError) {
    logger.warn("postgrest request failed", { tool, status: error.status });
    return error.message;
  }
  logger.error("unexpected tool failure", {
    tool,
    reason: error instanceof Error ? error.name : typeof error,
  });
  return "internal error while reading the sprawnosci catalog";
}

export function createProductMcpServer(deps: McpServerDeps): McpServer {
  const { repository, accessToken, logger } = deps;

  const server = new McpServer(
    { name: SERVICE_NAME, version: SERVICE_VERSION },
    { instructions: "Read-only catalog of Żar i Szlif sprawności for the signed-in user." },
  );

  server.registerTool(
    "list_sprawnosci",
    {
      title: "List sprawności",
      description:
        "Read-only list of Żar i Szlif sprawności (skills) from the product catalog. " +
        "Filter by free-text query (tytul/opis), poziom, aspekt or grupa; paginated with limit/offset. " +
        "Returns the matching page in `items` and the exact total number of matching rows in `count`, " +
        "so `offset + items.length < count` means another page exists.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Case-insensitive match on tytul or opis."),
        poziom: z.enum(POZIOMY).optional().describe("Skill level."),
        aspekt: z.enum(ASPEKTY).optional().describe("Development aspect."),
        grupa: z.string().optional().describe("Exact group identifier."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIMIT_MAX)
          .optional()
          .describe(`Page size, 1-${LIMIT_MAX} (default ${LIMIT_DEFAULT}).`),
        offset: z.number().int().min(0).optional().describe("Rows to skip (default 0)."),
      },
    },
    async (args) => {
      try {
        const result = await repository.list(accessToken, {
          query: args.query,
          poziom: args.poziom,
          aspekt: args.aspekt,
          grupa: args.grupa,
          limit: args.limit ?? LIMIT_DEFAULT,
          offset: args.offset ?? 0,
        });
        return jsonResult(result);
      } catch (error) {
        return toolError(describeFailure(error, "list_sprawnosci", logger));
      }
    },
  );

  server.registerTool(
    "get_sprawnosc",
    {
      title: "Get sprawność",
      description: "Read one Żar i Szlif sprawność by its catalog id. Returns a tool error when absent.",
      inputSchema: {
        id: z.string().min(1).describe("Catalog id of the sprawność."),
      },
    },
    async (args) => {
      if (args.id.trim() === "") return toolError("invalid arguments: id must be a non-empty string");
      try {
        return jsonResult(await repository.get(accessToken, args.id));
      } catch (error) {
        return toolError(describeFailure(error, "get_sprawnosc", logger));
      }
    },
  );

  return server;
}
