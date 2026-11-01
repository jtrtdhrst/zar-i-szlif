// Server-only, optional MCP analytics. Install posthog-node in the MCP package.
// Do not use in browser bundles; keep disabled until operator explicitly enables it.
// Do not capture tool inputs/outputs, prompt text, child data or bearer tokens.
import { PostHog } from 'posthog-node'

const permittedEvents = new Set(['mcp_tool_succeeded', 'mcp_tool_failed'])

export function createMcpAnalytics({
  projectToken,
  host = 'https://eu.i.posthog.com',
  enabled = false,
} = {}) {
  if (!enabled || !projectToken) {
    return { capture: () => false, shutdown: async () => {} }
  }

  const client = new PostHog(projectToken, {
    host,
    flushAt: 1,
    flushInterval: 0,
  })

  return {
    capture({ distinctId, event, toolCategory, durationMs } = {}) {
      if (!permittedEvents.has(event) || typeof distinctId !== 'string' || !distinctId) return false
      client.capture({
        distinctId,
        event,
        properties: {
          surface: 'product-mcp',
          $process_person_profile: false,
          ...(typeof toolCategory === 'string' ? { tool_category: toolCategory.slice(0, 60) } : {}),
          ...(Number.isFinite(durationMs) && durationMs >= 0 ? { duration_ms: Math.round(durationMs) } : {}),
        },
      })
      return true
    },
    shutdown: () => client.shutdown(),
  }
}
