#!/usr/bin/env node
/**
 * Headless Penpot MCP: stdio for local clients, stateless Streamable HTTP for
 * the self-hosted endpoint. HTTP mode uses Penpot RPC directly and never calls
 * the browser/plugin bridge.
 */

import { timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { loadConfig, type Config } from './config.js'
import { PenpotRpcClient, PenpotRpcError, PenpotStaleWriteError } from './rpc-client.js'
import { PenpotExporterClient } from './exporter-client.js'
import { initCheckpointStore } from './checkpoints.js'
import { projectFileTools, type ToolDefinition } from './tools/project-files.js'
import { contentTools } from './tools/content.js'
import { commentTools } from './tools/comments.js'
import { snapshotTools } from './tools/snapshots.js'
import { registerExportTool } from './tools/export.js'
import { pipelineTools } from './tools/pipeline.js'

// HTTP mode exposes the read/create/update pipeline plus the four headless
// design-pipeline tools (export, visual diff, asset import, hierarchy
// mutation). It still omits snapshot restore, checkpoints, arbitrary plugin
// JavaScript, raw local-path uploads, and any WebSocket/plugin operation.
const HEADLESS_HTTP_TOOLS = new Set([
  'penpot_list_teams',
  'penpot_list_projects',
  'penpot_list_files',
  'penpot_create_project',
  'penpot_create_file',
  'penpot_get_file_snapshot',
  'penpot_create_page',
  'penpot_list_pages',
  'penpot_rename_page',
  'penpot_add_shapes',
  'penpot_update_shapes',
  'penpot_get_shape',
  'penpot_find_shapes',
  'penpot_list_file_snapshots',
  'penpot_create_file_snapshot',
  'penpot_get_file_snapshot_data',
  'penpot_export_frame',
  'penpot_visual_diff',
  'penpot_import_asset',
  'penpot_mutate_hierarchy',
])

function registerTools(
  server: McpServer,
  client: PenpotRpcClient,
  tools: ToolDefinition<any>[],
  headlessOnly = false,
): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (input: unknown) => {
        let parsedInput: unknown
        try {
          parsedInput = tool.inputSchema.parse(input ?? {})
          const value = parsedInput as {
            pageId?: string
            shapes?: Array<{ id?: string }>
          }
          if (headlessOnly && tool.name === 'penpot_create_page' && !value.pageId) {
            throw new Error('Headless writes require an explicit pageId for safe read-back; do not retry an ambiguous create.')
          }
          if (headlessOnly && tool.name === 'penpot_add_shapes' && value.shapes?.some((shape) => !shape.id)) {
            throw new Error('Headless writes require an explicit id for every shape so the result can be read back without a blind retry.')
          }
          const result = await tool.handler(client, parsedInput)
          return { content: [{ type: 'text', text: JSON.stringify(result) }] }
        } catch (err) {
          if (headlessOnly && err instanceof PenpotStaleWriteError) {
            const value = parsedInput as {
              fileId?: string
              pageId?: string
              name?: string
              shapes?: Array<{ id?: string }>
              patches?: Array<{ shapeId?: string }>
            }
            const shapeIds = tool.name === 'penpot_add_shapes'
              ? value.shapes?.map((shape) => shape.id).filter((id): id is string => Boolean(id))
              : tool.name === 'penpot_update_shapes'
                ? value.patches?.map((patch) => patch.shapeId).filter((id): id is string => Boolean(id))
                : undefined
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  status: 'write_applied_with_lagged_changes',
                  writeApplied: true,
                  fileId: value.fileId,
                  pageId: value.pageId,
                  pageName: tool.name === 'penpot_create_page' ? value.name : undefined,
                  shapeIds,
                  revn: err.result.revn,
                  laggedChangeCount: err.laggedCount,
                  nextAction: 'Read back the identified page/shapes before any retry. The mutation has already been applied.',
                }),
              }],
            }
          }
          const message =
            err instanceof PenpotRpcError
              ? err.message
              : err instanceof Error
                ? err.message
                : 'Unknown error'
          return { content: [{ type: 'text', text: message }], isError: true }
        }
      },
    )
  }
}

function createMcpServer(config: Config, headlessOnly: boolean): McpServer {
  const client = new PenpotRpcClient(config.PENPOT_BASE_URL, config.PENPOT_ACCESS_TOKEN)
  const server = new McpServer({ name: 'penpot-headless', version: '0.3.0-selfhosted' })
  const select = (tools: ToolDefinition<any>[]) =>
    headlessOnly ? tools.filter((tool) => HEADLESS_HTTP_TOOLS.has(tool.name)) : tools

  registerTools(server, client, select(projectFileTools), headlessOnly)
  registerTools(server, client, select(contentTools(config.PENPOT_TOKENS_PATH)), headlessOnly)
  registerTools(server, client, select(pipelineTools()), headlessOnly)
  if (headlessOnly) {
    registerTools(server, client, select(snapshotTools), true)
  } else {
    registerTools(server, client, commentTools)
    registerTools(server, client, snapshotTools)

    if (config.PENPOT_LOGIN_EMAIL && config.PENPOT_LOGIN_PASSWORD) {
      registerExportTool(server, new PenpotExporterClient(config.PENPOT_BASE_URL, {
        mode: 'password',
        email: config.PENPOT_LOGIN_EMAIL,
        password: config.PENPOT_LOGIN_PASSWORD,
      }))
    } else if (config.PENPOT_OIDC_USERNAME && config.PENPOT_OIDC_PASSWORD) {
      registerExportTool(server, new PenpotExporterClient(config.PENPOT_BASE_URL, {
        mode: 'oidc',
        username: config.PENPOT_OIDC_USERNAME,
        password: config.PENPOT_OIDC_PASSWORD,
        provider: config.PENPOT_OIDC_PROVIDER,
      }))
    } else if (config.PENPOT_AUTH_TOKEN_COOKIE) {
      registerExportTool(server, new PenpotExporterClient(config.PENPOT_BASE_URL, {
        mode: 'cookie',
        authTokenCookie: config.PENPOT_AUTH_TOKEN_COOKIE,
      }))
    }
  }

  return server
}

function authorized(supplied: string | null, expected: string): boolean {
  if (!supplied) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(supplied)
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b)
}

async function serveHttp(config: Config): Promise<void> {
  const authFile = process.env.PENPOT_MCP_AUTH_TOKEN_FILE
  if (!authFile) throw new Error('PENPOT_MCP_AUTH_TOKEN_FILE is required for HTTP mode')
  let authToken = ''
  try {
    authToken = readFileSync(authFile, 'utf8').trim()
  } catch {
    throw new Error('Could not read MCP auth token file')
  }
  if (!authToken) throw new Error('MCP auth token file is empty')

  const port = Number(process.env.MCP_HTTP_PORT || 3000)
  const http = createHttpServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost')
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}')
      return
    }
    if (url.pathname !== '/mcp') {
      res.writeHead(404).end()
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' }).end()
      return
    }
    if (!authorized(url.searchParams.get('userToken'), authToken)) {
      res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"unauthorized"}')
      return
    }

    // The headless tools are stateless; create a fresh SDK server and transport
    // for each POST so MCP session state cannot depend on a browser tab.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    try {
      await createMcpServer(config, true).connect(transport)
      await transport.handleRequest(req, res)
    } catch {
      if (res.headersSent) res.destroy()
      else res.writeHead(500, { 'content-type': 'application/json' }).end('{"error":"internal"}')
    }
  })

  const host = process.env.MCP_HTTP_HOST || '0.0.0.0'
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject)
    http.listen(port, host, resolve)
  })
  process.stderr.write(`penpot-headless: HTTP MCP listening on ${port}\n`)
}

async function main(): Promise<void> {
  const config = loadConfig()
  if (process.env.MCP_TRANSPORT === 'http') {
    await serveHttp(config)
    return
  }

  if (config.PENPOT_CHECKPOINTS_PATH) {
    const { loaded } = await initCheckpointStore(config.PENPOT_CHECKPOINTS_PATH)
    if (loaded > 0) {
      process.stderr.write(`penpot-headless: loaded ${loaded} checkpoint(s) from ${config.PENPOT_CHECKPOINTS_PATH}\n`)
    }
  }

  await createMcpServer(config, false).connect(new StdioServerTransport())
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : 'Unknown error'
  process.stderr.write(`penpot-headless server failed to start: ${message}\n`)
  process.exitCode = 1
})
