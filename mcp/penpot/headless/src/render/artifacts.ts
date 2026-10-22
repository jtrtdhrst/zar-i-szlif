/**
 * artifacts.ts
 *
 * Bounded in-memory artifact store for the headless pipeline. Rendered PNG/SVG
 * bytes and uploaded media live here under short artifact IDs so tools can
 * reference each other's outputs without touching the VPS disk (which is
 * critically full) and without exposing any public file URL.
 *
 * Limits are hard: exceeding the global byte cap fails the put with a typed
 * error instead of growing memory. Entries expire after ARTIFACT_TTL_MS.
 */
import { createHash, randomUUID } from 'node:crypto'

export const ARTIFACT_TTL_MS = 30 * 60 * 1000
const MAX_TOTAL_BYTES = 64 * 1024 * 1024
const MAX_SINGLE_BYTES = 8 * 1024 * 1024

export type Artifact = {
  id: string
  mimeType: string
  bytes: Buffer
  sha256: string
  createdAt: number
  label: string
}

const store = new Map<string, Artifact>()
let totalBytes = 0

function sweep(): void {
  const now = Date.now()
  for (const [id, a] of store) {
    if (now - a.createdAt > ARTIFACT_TTL_MS) {
      store.delete(id)
      totalBytes -= a.bytes.length
    }
  }
}

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function putArtifact(bytes: Buffer, mimeType: string, label: string): Artifact {
  if (bytes.length > MAX_SINGLE_BYTES) {
    throw new Error(
      `artifact too large: ${bytes.length} bytes exceeds ${MAX_SINGLE_BYTES} byte cap ` +
        `(render at a lower scale or export a smaller frame)`,
    )
  }
  sweep()
  if (totalBytes + bytes.length > MAX_TOTAL_BYTES) {
    // Evict oldest first; if still over cap, fail loudly.
    const ordered = [...store.values()].sort((a, b) => a.createdAt - b.createdAt)
    for (const old of ordered) {
      store.delete(old.id)
      totalBytes -= old.bytes.length
      if (totalBytes + bytes.length <= MAX_TOTAL_BYTES) break
    }
  }
  if (totalBytes + bytes.length > MAX_TOTAL_BYTES) {
    throw new Error('artifact store exhausted (64 MB cap); retry after older artifacts expire')
  }
  const artifact: Artifact = {
    id: randomUUID(),
    mimeType,
    bytes,
    sha256: sha256Hex(bytes),
    createdAt: Date.now(),
    label,
  }
  store.set(artifact.id, artifact)
  totalBytes += bytes.length
  return artifact
}

export function getArtifact(id: string): Artifact {
  const artifact = store.get(id)
  if (!artifact || Date.now() - artifact.createdAt > ARTIFACT_TTL_MS) {
    if (artifact) {
      store.delete(id)
      totalBytes -= artifact.bytes.length
    }
    throw new Error(`artifact ${id} not found or expired (30 min TTL)`)
  }
  return artifact
}

export function artifactStats(): { count: number; totalBytes: number } {
  sweep()
  return { count: store.size, totalBytes }
}
