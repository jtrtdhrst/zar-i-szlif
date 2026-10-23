/**
 * MCP wire-format adapter for headless Penpot tool responses.
 *
 * Penpot shape records contain their own "content" property (text/path/bool).
 * Keep that raw payload under "shape" in the MCP-facing envelope so no client
 * can confuse the Penpot field with the MCP CallToolResult.content array.
 * Normal tools keep their original payload shape.
 */
export function toMcpToolResult(toolName: string, result: unknown) {
  if (toolName === 'penpot_get_shape' && result !== null && typeof result === 'object' && !Array.isArray(result)) {
    const shape = result as Record<string, unknown>
    const wrapped = { shape }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(wrapped) }],
      structuredContent: wrapped,
    }
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
}
