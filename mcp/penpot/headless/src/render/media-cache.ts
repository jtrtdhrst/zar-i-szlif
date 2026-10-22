/**
 * media-cache.ts
 *
 * In-process cache of raster bytes this MCP server itself uploaded via
 * `penpot_import_asset`. Lets `penpot_export_frame` embed pipeline-imported
 * images as data URIs without any privileged media-download path (Penpot
 * exposes no PAT-readable media-byte RPC). Pre-existing file images whose
 * bytes were never uploaded through this server render as placeholders.
 */
export type MediaEntry = { bytes: Buffer; mtype: string }

const cache = new Map<string, MediaEntry>()
const MAX_ENTRIES = 200

export function rememberMedia(mediaId: string, bytes: Buffer, mtype: string): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  cache.set(mediaId, { bytes, mtype })
}

export function recallMedia(): Map<string, MediaEntry> {
  return new Map(cache)
}
