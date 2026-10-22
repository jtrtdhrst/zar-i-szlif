import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PaperclipApiClient } from "./client.js";
import type { ToolDefinition } from "./tools.js";
import { formatErrorResponse, formatTextResponse } from "./format.js";

export const AGENT_CHAT_TOOL_NAMES = [
  "paperclipListAgentChats",
  "paperclipGetAgentChat",
  "paperclipSendChatMessage",
  "paperclipGetChatMessages",
  "paperclipNewChatSession",
];

function makeTool<TSchema extends z.ZodRawShape>(
  name: string,
  description: string,
  schema: z.ZodObject<TSchema>,
  execute: (input: z.infer<typeof schema>) => Promise<unknown>,
): ToolDefinition {
  return {
    name,
    description,
    schema,
    execute: async (input) => {
      try {
        const parsed = schema.parse(input);
        return formatTextResponse(await execute(parsed));
      } catch (error) {
        return formatErrorResponse(error);
      }
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function enc(value: string): string {
  return encodeURIComponent(value);
}

function chatIssueSummary(issue: Record<string, unknown>) {
  return {
    chatId: issue.id ?? null,
    identifier: issue.identifier ?? null,
    title: issue.title ?? null,
    agentId: issue.conversationAgentId ?? null,
    status: issue.status ?? null,
    conversationState: issue.conversationState ?? null,
    sessionGeneration: issue.conversationSessionGeneration ?? null,
    boundaryCommentId: issue.conversationBoundaryCommentId ?? null,
    updatedAt: issue.updatedAt ?? null,
  };
}

function assertChatIssue(issue: unknown): asserts issue is Record<string, unknown> & {
  id: string;
  conversationAgentId: string;
  conversationUserId: string;
} {
  if (!isRecord(issue) || typeof issue.id !== "string"
    || typeof issue.conversationAgentId !== "string"
    || typeof issue.conversationUserId !== "string") {
    throw new Error("chatId does not identify an Agent Chat owned by the authenticated user [errorCode=INVALID_ARGUMENTS]");
  }
}

async function getOwnedChatIssue(client: PaperclipApiClient, chatId: string) {
  const issue = await client.requestJson<unknown>("GET", `/issues/${enc(chatId)}`, {
    callerKey: true,
    includeRunId: false,
  });
  assertChatIssue(issue);
  return issue;
}

export function createAgentChatTools(client: PaperclipApiClient): ToolDefinition[] {
  return [
    makeTool(
      "paperclipListAgentChats",
      "List Agent Chat conversations owned by the authenticated Board user in this company, newest first. Read-only: does not create a chat or wake an agent. Returns compact chatId/agent/status/session summaries. `limit` bounds the returned array client-side (1..500; default 100); the server route currently returns the user's full list.",
      z.object({ limit: z.number().int().min(1).max(500).optional().default(100) }),
      async ({ limit }) => {
        const result = await client.requestJson<unknown>("GET", `/companies/${client.resolveCompanyId()}/chats`, {
          callerKey: true,
          includeRunId: false,
        });
        const chats = Array.isArray(result)
          ? result.filter(isRecord)
          : isRecord(result) && Array.isArray(result.chats)
            ? result.chats.filter(isRecord)
            : null;
        if (!chats) return result;
        return {
          chats: chats.slice(0, limit).map(chatIssueSummary),
          total: chats.length,
          returned: Math.min(chats.length, limit),
          truncated: chats.length > limit,
        };
      },
    ),
    makeTool(
      "paperclipGetAgentChat",
      "Open an existing Agent Chat by agent UUID or URL key for the authenticated Board user. Read-only and non-creating: returns `{chat:null, exists:false}` when that user has not opened a chat with this agent. Use `paperclipNewChatSession` to create/reuse the chat and start a fresh `/new` context.",
      z.object({ agentRef: z.string().trim().min(1).max(128) }),
      async ({ agentRef }) => {
        const chat = await client.requestJson<unknown>(
          "GET",
          `/companies/${client.resolveCompanyId()}/chats/${enc(agentRef)}`,
          { callerKey: true, includeRunId: false },
        );
        return {
          agentRef,
          exists: isRecord(chat) && typeof chat.id === "string",
          chat: isRecord(chat) ? chatIssueSummary(chat) : null,
        };
      },
    ),
    makeTool(
      "paperclipSendChatMessage",
      "Send a non-empty user message to an existing Agent Chat and enqueue the agent's asynchronous response. Requires a chatId owned by the authenticated Board user; it refuses regular issues and `/new` commands. `clientRequestId` is an idempotency key: reuse it only for an identical retry; omitted keys are generated. Returns the saved user comment, not the agent reply—read `paperclipGetChatMessages` for the response.",
      z.object({
        chatId: z.string().trim().min(1).max(128),
        message: z.string().min(1).max(100_000),
        clientRequestId: z.string().uuid().optional(),
      }),
      async ({ chatId, message, clientRequestId }) => {
        const chat = await getOwnedChatIssue(client, chatId);
        if (message.trim() === "/new") {
          throw new Error("Use paperclipNewChatSession for the /new command [errorCode=INVALID_ARGUMENTS]");
        }
        const requestId = clientRequestId ?? randomUUID();
        const comment = await client.requestJson<unknown>("POST", `/issues/${enc(String(chat.id))}/comments`, {
          body: { body: message, clientRequestId: requestId },
          callerKey: true,
          chatConversation: true,
          includeRunId: false,
        });
        return {
          chatId: chat.id,
          clientRequestId: requestId,
          comment,
          responsePending: true,
          next: "Read paperclipGetChatMessages after the agent run completes to retrieve its reply.",
        };
      },
    ),
    makeTool(
      "paperclipGetChatMessages",
      "Read messages and agent replies from an Agent Chat owned by the authenticated Board user. Defaults to chronological order and 100 comments; `after` is a comment-ID cursor and `limit` is 1..500. Does not wake the agent.",
      z.object({
        chatId: z.string().trim().min(1).max(128),
        after: z.string().trim().min(1).max(128).optional(),
        order: z.enum(["asc", "desc"]).default("asc"),
        limit: z.number().int().min(1).max(500).default(100),
      }),
      async ({ chatId, after, order, limit }) => {
        const chat = await getOwnedChatIssue(client, chatId);
        const params = new URLSearchParams({ order, limit: String(limit) });
        if (after) params.set("after", after);
        const messages = await client.requestJson<unknown>(
          "GET",
          `/issues/${enc(String(chat.id))}/comments?${params.toString()}`,
          { callerKey: true, includeRunId: false },
        );
        return { chatId: chat.id, order, after: after ?? null, messages };
      },
    ),
    makeTool(
      "paperclipNewChatSession",
      "Create or reuse the authenticated Board user's Agent Chat for an agent UUID/URL key, then submit `/new` with an idempotent clientRequestId. This starts a fresh conversation context without deleting prior comments or history and queues the agent asynchronously. Returns the observed session generation and whether the reset is still pending. Use `paperclipGetAgentChat`/`paperclipGetChatMessages` to verify the boundary and retained history; use `paperclipSendChatMessage` to start the new topic.",
      z.object({
        agentRef: z.string().trim().min(1).max(128),
        clientRequestId: z.string().uuid().optional(),
      }),
      async ({ agentRef, clientRequestId }) => {
        const chat = await client.requestJson<unknown>(
          "POST",
          `/companies/${client.resolveCompanyId()}/chats/${enc(agentRef)}`,
          { callerKey: true, includeRunId: false },
        );
        assertChatIssue(chat);
        const previousGeneration = typeof chat.conversationSessionGeneration === "number"
          ? chat.conversationSessionGeneration
          : 0;
        const requestId = clientRequestId ?? randomUUID();
        const boundaryComment = await client.requestJson<unknown>("POST", `/issues/${enc(chat.id)}/comments`, {
          body: { body: "/new", clientRequestId: requestId },
          callerKey: true,
          chatConversation: true,
          includeRunId: false,
        });
        const refreshed = await client.requestJson<unknown>("GET", `/issues/${enc(chat.id)}`, {
          callerKey: true,
          includeRunId: false,
        });
        const refreshedSummary = isRecord(refreshed) ? chatIssueSummary(refreshed) : chatIssueSummary(chat);
        const boundary = isRecord(boundaryComment) ? boundaryComment : null;
        const boundaryId = typeof boundary?.id === "string" ? boundary.id : refreshedSummary.boundaryCommentId;
        const observedGeneration = typeof refreshedSummary.sessionGeneration === "number"
          ? refreshedSummary.sessionGeneration
          : previousGeneration;
        const sessionResetPending = observedGeneration <= previousGeneration;
        return {
          chat: { ...refreshedSummary, boundaryCommentId: boundaryId },
          clientRequestId: requestId,
          boundaryComment,
          historyDeleted: false,
          sessionReset: {
            status: sessionResetPending ? "pending" : "applied",
            previousGeneration,
            observedGeneration,
            boundaryCommentId: boundaryId,
          },
          sessionResetPending,
        };
      },
    ),
  ];
}
