/**
 * fonts.ts
 *
 * Resolves the fonts used by a file's text shapes to downloadable font bytes
 * for the headless rasterizer. Uses only supported PAT RPC:
 * teams -> projects -> get-file (find text shapes) -> get-team-font-variants
 * -> download-font (existing rpc-client method).
 *
 * Matching is best-effort: exact family + weight + style wins, otherwise the
 * first variant of the family, otherwise caller fallback. Every fallback is
 * reported as a warning — never silently substituted.
 */
import type { PenpotRpcClient, FontVariant } from '../rpc-client.js'

export type ResolvedFonts = {
  /** family name -> font bytes (first match wins per family) */
  buffers: Buffer[]
  warnings: string[]
  families: string[]
}

function collectFamilies(objects: Record<string, Record<string, unknown>>): Set<string> {
  const families = new Set<string>()
  const visit = (node: unknown): void => {
    const n = node as Record<string, unknown> | null
    if (!n || typeof n !== 'object') return
    if (typeof n['font-family'] === 'string' && (n['font-family'] as string).trim()) {
      families.add((n['font-family'] as string).trim())
    }
    const kids = n['children']
    if (Array.isArray(kids)) for (const k of kids) visit(k)
  }
  for (const shape of Object.values(objects)) {
    if (shape['type'] === 'text' && shape['content']) visit(shape['content'])
  }
  return families
}

function pickVariant(family: string, variants: FontVariant[]): FontVariant | undefined {
  const same = variants.filter((v) => v.fontFamily.toLowerCase() === family.toLowerCase())
  if (same.length === 0) return undefined
  const regular = same.find((v) => v.fontWeight === 400 && /normal|regular/i.test(v.fontStyle ?? ''))
  return regular ?? same[0]
}

async function findTeamForProject(client: PenpotRpcClient, projectId: string): Promise<string | undefined> {
  const teams = (await client.getTeams()) as Array<{ id: string }>
  for (const team of teams ?? []) {
    try {
      const projects = (await client.getProjects(team.id)) as Array<{ id: string }>
      if ((projects ?? []).some((p) => p.id === projectId)) return team.id
    } catch {
      // A team the token cannot read must not abort font resolution.
    }
  }
  return undefined
}

/**
 * Downloads one font buffer per distinct family used in the file.
 * `projectId` is required to scope the font-variant lookup to the right team.
 */
export async function resolveFileFonts(
  client: PenpotRpcClient,
  projectId: string,
  fileId: string,
  objects: Record<string, Record<string, unknown>>,
): Promise<ResolvedFonts> {
  const warnings: string[] = []
  const families = [...collectFamilies(objects)]
  if (families.length === 0) return { buffers: [], warnings, families }
  const teamId = await findTeamForProject(client, projectId)
  if (!teamId) {
    warnings.push('font team lookup failed; rasterizer will use fallback fonts')
    return { buffers: [], warnings, families }
  }
  let variants: FontVariant[] = []
  try {
    variants = (await client.getTeamFontVariants(teamId)) as FontVariant[]
  } catch {
    warnings.push('get-team-font-variants failed; rasterizer will use fallback fonts')
    return { buffers: [], warnings, families }
  }
  const buffers: Buffer[] = []
  for (const family of families) {
    const variant = pickVariant(family, variants ?? [])
    if (!variant) {
      warnings.push(`font family "${family}" has no downloadable variant; fallback font used`)
      continue
    }
    try {
      const bytes = await client.downloadFontVariantBytes(variant.id)
      buffers.push(bytes)
    } catch {
      warnings.push(`font "${family}" (${variant.id}) download failed; fallback font used`)
    }
  }
  return { buffers, warnings, families }
}
