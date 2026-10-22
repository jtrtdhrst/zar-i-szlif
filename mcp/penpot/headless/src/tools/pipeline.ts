/**
 * tools/pipeline.ts
 *
 * Headless design-pipeline tools: render, compare, import, restructure.
 * Registered in both stdio and HTTP modes; the HTTP allowlist in server.ts
 * gates exposure.
 */
import type { ToolDefinition } from './project-files.js'
import { exportFrameTool } from './export-frame.js'
import { visualDiffTool } from './visual-diff.js'
import { importAssetTool } from './import-asset.js'
import { mutateHierarchyTool } from './hierarchy.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pipelineTools(): ToolDefinition<any>[] {
  return [exportFrameTool, visualDiffTool, importAssetTool, mutateHierarchyTool]
}
