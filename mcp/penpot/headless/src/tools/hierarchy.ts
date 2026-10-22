/**
 * tools/hierarchy.ts
 *
 * penpot_mutate_hierarchy — validated structural batch operations over one
 * page: delete, clone, reparent, group, ungroup, reorder, bringToFront,
 * sendToBack. Built on the same proven change builders as the existing
 * single-purpose tools (del-obj, add-obj overwrite, group/ungroup reparent
 * pattern); mov-objects is deliberately NOT used (verified silent no-op for
 * reparenting in this backend version).
 *
 * Safety: protected-root rejection (the page root object), cycle prevention,
 * sibling/parent existence checks, optional expectedRevision precondition,
 * dryRun planning, single updateFile round-trip, and mandatory readback
 * verification. Partial failure is impossible by construction — validation
 * runs fully before the single write; a backend rejection therefore reports
 * which planned op could not be applied.
 */
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { PenpotStaleWriteError } from '../rpc-client.js'
import type { PenpotRpcClient, FileSummary } from '../rpc-client.js'
import type { ToolDefinition } from './project-files.js'
import {
  addObj,
  delObj,
  group as groupBuilder,
  cloneShapes as cloneShapesBuilder,
  reorderChildren,
  ROOT_FRAME_ID,
  type ShapeNode,
  type ReorderAction,
} from '../shape-builders.js'
import type { Change } from '../rpc-client.js'

type Objects = Record<string, ShapeNode>

function parentIdOf(s: ShapeNode): string | undefined {
  return (s['parent-id'] as string | undefined) ?? (s.parentId as string | undefined)
}
function frameIdOf(s: ShapeNode): string | undefined {
  return (s['frame-id'] as string | undefined) ?? (s.frameId as string | undefined)
}
function shapesOf(s: ShapeNode): string[] {
  return [...((s['shapes'] as string[] | undefined) ?? (s.shapes as string[] | undefined) ?? [])]
}

function isContainer(s: ShapeNode): boolean {
  return s['type'] === 'frame' || s['type'] === 'group'
}

function descendants(objects: Objects, id: string): Set<string> {
  const out = new Set<string>()
  const walk = (sid: string): void => {
    const s = objects[sid]
    if (!s) return
    for (const c of shapesOf(s)) {
      if (!out.has(c)) {
        out.add(c)
        walk(c)
      }
    }
  }
  walk(id)
  return out
}

function boxOf(s: ShapeNode): { x1: number; y1: number; x2: number; y2: number } {
  const sel = (s['selrect'] ?? s['selrect']) as { x1?: number; y1?: number; x2?: number; y2?: number } | undefined
  if (sel && sel.x1 !== undefined && sel.y1 !== undefined && sel.x2 !== undefined && sel.y2 !== undefined) {
    return { x1: sel.x1, y1: sel.y1, x2: sel.x2, y2: sel.y2 }
  }
  const x = (s['x'] as number) ?? 0
  const y = (s['y'] as number) ?? 0
  const w = (s['width'] as number) ?? 0
  const h = (s['height'] as number) ?? 0
  return { x1: x, y1: y, x2: x + w, y2: y + h }
}

/** Reparent change: same fields, new parents (mirrors the proven group/ungroup pattern). */
function reparentChange(pageId: string, child: ShapeNode, newParentId: string, newFrameId: string): Change {
  const merged: Record<string, unknown> = {
    ...child,
    'parent-id': newParentId,
    'frame-id': newFrameId,
    'transform-inverse': (child as Record<string, unknown>)['transformInverse'] ?? child['transform-inverse'],
    'hide-fill-on-export':
      (child as Record<string, unknown>)['hideFillOnExport'] ?? child['hide-fill-on-export'] ?? false,
  }
  delete merged['parentId']
  delete merged['frameId']
  delete merged['transformInverse']
  delete merged['hideFillOnExport']
  delete merged['growType']
  return addObj(pageId, merged)
}

function parentShapesChange(pageId: string, parent: ShapeNode, newShapes: string[]): Change {
  const merged: Record<string, unknown> = {
    ...parent,
    shapes: newShapes,
    'parent-id': parentIdOf(parent) ?? ROOT_FRAME_ID,
    'frame-id': frameIdOf(parent) ?? ROOT_FRAME_ID,
    'transform-inverse': (parent as Record<string, unknown>)['transformInverse'] ?? parent['transform-inverse'],
    'hide-fill-on-export':
      (parent as Record<string, unknown>)['hideFillOnExport'] ?? parent['hide-fill-on-export'] ?? false,
  }
  delete merged['parentId']
  delete merged['frameId']
  delete merged['transformInverse']
  delete merged['hideFillOnExport']
  delete merged['growType']
  return addObj(pageId, merged)
}

const deleteOp = z.object({ op: z.literal('delete'), shapeIds: z.array(z.string().min(1)).min(1) })
const cloneOp = z.object({
  op: z.literal('clone'),
  shapeIds: z.array(z.string().min(1)).min(1),
  dx: z.number().default(0),
  dy: z.number().default(0),
})
const reparentOp = z.object({
  op: z.literal('reparent'),
  shapeIds: z.array(z.string().min(1)).min(1),
  newParentId: z.string().min(1),
  index: z.number().int().min(0).optional(),
})
const groupOp = z.object({
  op: z.literal('group'),
  shapeIds: z.array(z.string().min(1)).min(1),
  name: z.string().min(1).default('Group'),
  groupId: z.string().uuid().optional(),
})
const ungroupOp = z.object({ op: z.literal('ungroup'), groupId: z.string().min(1) })
const reorderOp = z.object({
  op: z.literal('reorder'),
  shapeId: z.string().min(1),
  action: z.enum(['front', 'back', 'forward', 'backward', 'before', 'after']),
  targetId: z.string().min(1).optional(),
})
const frontBackOp = z.object({ op: z.enum(['bringToFront', 'sendToBack']), shapeId: z.string().min(1) })

const operationSchema = z.union([deleteOp, cloneOp, reparentOp, groupOp, ungroupOp, reorderOp, frontBackOp])

export const mutateHierarchyInput = z.object({
  fileId: z.string().min(1),
  pageId: z.string().min(1),
  operations: z.array(operationSchema).min(1).max(50),
  expectedRevision: z.number().int().optional(),
  dryRun: z.boolean().default(false),
})

export type MutateHierarchyInput = z.infer<typeof mutateHierarchyInput>

export const mutateHierarchyTool: ToolDefinition<MutateHierarchyInput> = {
  name: 'penpot_mutate_hierarchy',
  description:
    'Structural batch edits on one page: delete, clone, reparent, group, ungroup, reorder, bringToFront, ' +
    'sendToBack. All operations validate first (existence, containers, no cycles, protected page root) and ' +
    'apply in a single update-file round-trip with mandatory readback verification. Supports expectedRevision ' +
    'preconditions and dryRun planning. Clone generates fresh ids (returned as sourceToCloneIds); reparent ' +
    'preserves absolute geometry; deletes of the page root object are rejected.',
  inputSchema: mutateHierarchyInput,
  handler: async (client, { fileId, pageId, operations, expectedRevision, dryRun }) => {
    const warnings: string[] = []
    const file = (await client.getFile(fileId)) as FileSummary
    if (expectedRevision !== undefined && file.revn !== expectedRevision) {
      throw new Error(
        `penpot_mutate_hierarchy: revision conflict (expected ${expectedRevision}, current ${file.revn}); ` +
          `re-read the file and retry deliberately`,
      )
    }
    const page = file.data.pagesIndex[pageId] as unknown as { objects: Objects } | undefined
    if (!page) throw new Error(`penpot_mutate_hierarchy: page ${pageId} not found in file ${fileId}`)
    const objects: Objects = Object.fromEntries(Object.entries(page.objects).map(([k, v]) => [k, { ...(v as ShapeNode) }]))

    const requireShape = (id: string, what: string): ShapeNode => {
      const s = objects[id]
      if (!s) throw new Error(`penpot_mutate_hierarchy: ${what} shape ${id} not found on page ${pageId}`)
      return s
    }
    const detachFromParent = (shapeId: string): void => {
      const s = objects[shapeId]!
      const pid = parentIdOf(s)
      if (pid && objects[pid]) {
        objects[pid] = { ...objects[pid]!, shapes: shapesOf(objects[pid]!).filter((c) => c !== shapeId) } as ShapeNode
      }
    }

    const changes: Change[] = []
    const operationResults: Array<Record<string, unknown>> = []
    const createdShapeIds: string[] = []
    const modifiedShapeIds: string[] = []
    const deletedShapeIds: string[] = []
    const sourceToCloneIds: Record<string, string> = {}

    operations.forEach((op, index) => {
      const tag = `op ${index} (${op.op})`
      if (op.op === 'delete') {
        for (const sid of op.shapeIds) {
          if (sid === ROOT_FRAME_ID || sid === pageId) {
            throw new Error(`penpot_mutate_hierarchy: ${tag}: refusing to delete the protected page root ${sid}`)
          }
          requireShape(sid, tag)
        }
        for (const sid of op.shapeIds) {
          const sub = descendants(objects, sid)
          changes.push(delObj(pageId, sid))
          detachFromParent(sid)
          delete objects[sid]
          for (const d of sub) delete objects[d]
          deletedShapeIds.push(sid)
        }
        operationResults.push({ op: op.op, deletedShapeIds: [...op.shapeIds] })
      } else if (op.op === 'clone') {
        const roots: string[] = []
        for (const sid of op.shapeIds) {
          if (sid === ROOT_FRAME_ID || sid === pageId) {
            throw new Error(`penpot_mutate_hierarchy: ${tag}: refusing to clone the protected page root`)
          }
          const src = requireShape(sid, tag)
          const cloned = cloneShapesBuilder({
            pageId,
            objects,
            rootId: sid,
            dx: op.dx,
            dy: op.dy,
          })
          for (const c of cloned) {
            changes.push(c)
            objects[c.id] = c.obj as ShapeNode
            createdShapeIds.push(c.id)
          }
          const newRoot = cloned[0]!.id
          // Keep the in-memory parent order in sync so later ops in this batch see the clone.
          const srcParentId = parentIdOf(src) ?? ROOT_FRAME_ID
          if (objects[srcParentId]) {
            const list = shapesOf(objects[srcParentId]!)
            if (!list.includes(newRoot)) {
              objects[srcParentId] = { ...objects[srcParentId]!, shapes: [...list, newRoot] } as ShapeNode
            }
          }
          roots.push(newRoot)
          sourceToCloneIds[sid] = newRoot
        }
        operationResults.push({ op: op.op, sourceToCloneIds: { ...sourceToCloneIds }, clonedRootIds: roots })
      } else if (op.op === 'reparent') {
        const target = requireShape(op.newParentId, `${tag} newParent`)
        if (op.newParentId !== ROOT_FRAME_ID && !isContainer(target)) {
          throw new Error(`penpot_mutate_hierarchy: ${tag}: newParent ${op.newParentId} is type ${target['type']}, need frame/group`)
        }
        for (const sid of op.shapeIds) {
          if (sid === ROOT_FRAME_ID || sid === pageId) {
            throw new Error(`penpot_mutate_hierarchy: ${tag}: refusing to reparent the protected page root`)
          }
          requireShape(sid, tag)
          if (op.newParentId === sid || descendants(objects, sid).has(op.newParentId)) {
            throw new Error(`penpot_mutate_hierarchy: ${tag}: circular reparent of ${sid} into ${op.newParentId} rejected`)
          }
        }
        const targetFrame = op.newParentId === ROOT_FRAME_ID ? ROOT_FRAME_ID : ((target['type'] === 'frame' ? op.newParentId : frameIdOf(target)) ?? ROOT_FRAME_ID)
        for (const sid of op.shapeIds) {
          const shape = objects[sid]!
          const oldParentId = parentIdOf(shape)
          detachFromParent(sid)
          if (oldParentId && objects[oldParentId] && oldParentId !== op.newParentId) {
            // The server does not prune moved children from the old parent's
            // shapes array — without this the old parent keeps a ghost reference.
            const pruned = shapesOf(objects[oldParentId]!).filter((c) => c !== sid)
            objects[oldParentId] = { ...objects[oldParentId]!, shapes: pruned } as ShapeNode
            changes.push(parentShapesChange(pageId, objects[oldParentId]!, pruned))
          }
          const list = shapesOf(objects[op.newParentId]!)
          const at = op.index === undefined ? list.length : Math.max(0, Math.min(op.index, list.length))
          list.splice(at, 0, sid)
          objects[op.newParentId] = { ...objects[op.newParentId]!, shapes: list } as ShapeNode
          changes.push(reparentChange(pageId, shape, op.newParentId, targetFrame))
          changes.push(parentShapesChange(pageId, objects[op.newParentId]!, list))
          modifiedShapeIds.push(sid)
        }
        operationResults.push({ op: op.op, shapeIds: [...op.shapeIds], newParentId: op.newParentId })
      } else if (op.op === 'group') {
        for (const sid of op.shapeIds) requireShape(sid, tag)
        const first = objects[op.shapeIds[0]!]!
        const sharedParent = parentIdOf(first)
        if (!sharedParent || !objects[sharedParent]) {
          throw new Error(`penpot_mutate_hierarchy: ${tag}: parent of ${op.shapeIds[0]} not found`)
        }
        for (const sid of op.shapeIds.slice(1)) {
          if (parentIdOf(objects[sid]!) !== sharedParent) {
            throw new Error(`penpot_mutate_hierarchy: ${tag}: all grouped shapes must share one parent`)
          }
        }
        const boxes = op.shapeIds.map(boxOfShape)
        const gx1 = Math.min(...boxes.map((b) => b.x1))
        const gy1 = Math.min(...boxes.map((b) => b.y1))
        const gx2 = Math.max(...boxes.map((b) => b.x2))
        const gy2 = Math.max(...boxes.map((b) => b.y2))
        const groupId = op.groupId ?? randomUUID()
        if (objects[groupId]) throw new Error(`penpot_mutate_hierarchy: ${tag}: groupId ${groupId} already exists`)
        const parentShapes = shapesOf(objects[sharedParent]!)
        const ordered = parentShapes.filter((id) => op.shapeIds.includes(id))
        const frameOf = frameIdOf(first) ?? ROOT_FRAME_ID
        const g = groupBuilder({
          id: groupId,
          name: op.name,
          x: gx1,
          y: gy1,
          width: Math.max(gx2 - gx1, 1),
          height: Math.max(gy2 - gy1, 1),
          parentId: sharedParent,
          frameId: frameOf,
          shapes: ordered,
        })
        const firstIdx = Math.min(...op.shapeIds.map((id) => parentShapes.indexOf(id)).filter((i) => i !== -1))
        const newParentShapes = parentShapes.filter((id) => !op.shapeIds.includes(id))
        newParentShapes.splice(Math.max(firstIdx, 0), 0, groupId)
        changes.push(addObj(pageId, g as Record<string, unknown>))
        for (const cid of ordered) {
          changes.push(reparentChange(pageId, objects[cid]!, groupId, frameOf))
          objects[cid] = { ...objects[cid]!, 'parent-id': groupId, 'frame-id': frameOf } as ShapeNode
        }
        objects[sharedParent] = { ...objects[sharedParent]!, shapes: newParentShapes } as ShapeNode
        objects[groupId] = { ...(g as unknown as ShapeNode), shapes: ordered }
        changes.push(parentShapesChange(pageId, objects[sharedParent]!, newParentShapes))
        createdShapeIds.push(groupId)
        for (const cid of ordered) modifiedShapeIds.push(cid)
        operationResults.push({ op: op.op, groupId, childIds: ordered })
      } else if (op.op === 'ungroup') {
        const gshape = requireShape(op.groupId, tag)
        if (gshape['type'] !== 'group') {
          throw new Error(`penpot_mutate_hierarchy: ${tag}: shape ${op.groupId} is type ${gshape['type']}, not group`)
        }
        const newParentId = parentIdOf(gshape)
        if (!newParentId || !objects[newParentId]) {
          throw new Error(`penpot_mutate_hierarchy: ${tag}: parent of group ${op.groupId} not found`)
        }
        const newFrameId = frameIdOf(gshape) ?? ROOT_FRAME_ID
        const childIds = shapesOf(gshape)
        const parentShapes = shapesOf(objects[newParentId]!)
        const gi = parentShapes.indexOf(op.groupId)
        const newParentShapes = [...parentShapes.slice(0, gi), ...childIds, ...parentShapes.slice(gi + 1)]
        for (const cid of childIds) {
          const child = objects[cid]
          if (!child) throw new Error(`penpot_mutate_hierarchy: ${tag}: child ${cid} not found`)
          changes.push(reparentChange(pageId, child, newParentId, newFrameId))
          objects[cid] = { ...child, 'parent-id': newParentId, 'frame-id': newFrameId } as ShapeNode
          modifiedShapeIds.push(cid)
        }
        objects[newParentId] = { ...objects[newParentId]!, shapes: newParentShapes } as ShapeNode
        changes.push(parentShapesChange(pageId, objects[newParentId]!, newParentShapes))
        // del-obj deletes the group AND whatever its shapes array lists at delete
        // time — so the group must be emptied first, otherwise the just-released
        // children are deleted along with it.
        changes.push(parentShapesChange(pageId, { ...gshape, shapes: [] } as ShapeNode, []))
        changes.push(delObj(pageId, op.groupId))
        delete objects[op.groupId]
        deletedShapeIds.push(op.groupId)
        operationResults.push({ op: op.op, groupId: op.groupId, releasedChildIds: childIds })
      } else if (op.op === 'reorder' || op.op === 'bringToFront' || op.op === 'sendToBack') {
        const shapeId: string = op.shapeId
        let action: ReorderAction
        if (op.op === 'reorder') {
          const a = op.action
          if (a === 'before' || a === 'after') action = { type: a, targetId: op.targetId as string }
          else if (a === 'front') action = { type: 'front' }
          else if (a === 'back') action = { type: 'back' }
          else if (a === 'forward') action = { type: 'forward' }
          else action = { type: 'backward' }
        } else {
          action = op.op === 'bringToFront' ? { type: 'front' } : { type: 'back' }
        }
        if ((action.type === 'before' || action.type === 'after') && !action.targetId) {
          throw new Error(`penpot_mutate_hierarchy: ${tag}: action "${action.type}" requires targetId`)
        }
        const shape = requireShape(shapeId, tag)
        const pid = parentIdOf(shape)
        if (!pid || !objects[pid]) throw new Error(`penpot_mutate_hierarchy: ${tag}: parent of ${shapeId} not found`)
        const order = reorderChildren(shapesOf(objects[pid]!), shapeId, action)
        objects[pid] = { ...objects[pid]!, shapes: order } as ShapeNode
        changes.push(parentShapesChange(pageId, objects[pid]!, order))
        modifiedShapeIds.push(shapeId)
        operationResults.push({ op: op.op, shapeId, order })
      }
    })

    function boxOfShape(sid: string): { x1: number; y1: number; x2: number; y2: number } {
      const s = objects[sid]!
      const sel = s['selrect'] as { x1?: number; y1?: number; x2?: number; y2?: number } | undefined
      if (sel?.x1 !== undefined && sel?.y1 !== undefined && sel?.x2 !== undefined && sel?.y2 !== undefined) {
        return { x1: sel.x1, y1: sel.y1, x2: sel.x2, y2: sel.y2 }
      }
      const x = (s['x'] as number) ?? 0
      const y = (s['y'] as number) ?? 0
      return { x1: x, y1: y, x2: x + ((s['width'] as number) ?? 0), y2: y + ((s['height'] as number) ?? 0) }
    }

    if (dryRun) {
      return {
        status: 'dry-run',
        revisionBefore: file.revn,
        revisionAfter: file.revn,
        plannedChangeCount: changes.length,
        operationResults,
        createdShapeIds,
        modifiedShapeIds: [...new Set(modifiedShapeIds)],
        deletedShapeIds,
        sourceToCloneIds,
        readbackVerified: false,
        warnings: [...warnings, 'dryRun: no changes were sent'],
      }
    }

    let result: { revn: number }
    try {
      result = await client.updateFile(fileId, file.revn, file.vern, changes)
    } catch (err) {
      if (!(err instanceof PenpotStaleWriteError)) throw err
      // Write applied on top of a lagged change: report, do not retry.
      // All ids below were chosen client-side, so the caller can read back.
      return {
        status: 'write_applied_with_lagged_changes',
        writeApplied: true,
        fileId,
        pageId,
        revisionBefore: file.revn,
        revisionAfter: err.result.revn,
        laggedChangeCount: err.laggedCount,
        operationResults,
        createdShapeIds,
        modifiedShapeIds: [...new Set(modifiedShapeIds)],
        deletedShapeIds,
        sourceToCloneIds,
        readbackVerified: false,
        nextAction: 'Read back the affected ids before any retry. The mutation has already been applied.',
        warnings,
      }
    }

    // Mandatory readback: re-fetch and verify every operation outcome.
    const verify: string[] = []
    const fresh = (await client.getFile(fileId)) as FileSummary
    const freshPage = fresh.data.pagesIndex[pageId] as unknown as { objects: Objects } | undefined
    if (!freshPage) throw new Error('penpot_mutate_hierarchy: page vanished after write (unexpected)')
    const freshObjects = freshPage.objects
    for (const r of operationResults) {
      if (r['deletedShapeIds']) {
        for (const sid of r['deletedShapeIds'] as string[]) {
          if (freshObjects[sid]) verify.push(`delete unverified: ${sid} still present`)
        }
      }
      if (r['clonedRootIds']) {
        for (const sid of r['clonedRootIds'] as string[]) {
          if (!freshObjects[sid]) verify.push(`clone unverified: ${sid} missing after write`)
        }
      }
      if (r['newParentId'] && r['shapeIds']) {
        for (const sid of r['shapeIds'] as string[]) {
          const s = freshObjects[sid]
          const pid = s ? (parentIdOf(s as ShapeNode) ?? (s as ShapeNode).parentId) : undefined
          if (!s || pid !== r['newParentId']) verify.push(`reparent unverified: ${sid} parent is ${pid}`)
        }
      }
      if (r['groupId'] && r['childIds']) {
        const g = freshObjects[r['groupId'] as string]
        if (!g || g['type'] !== 'group') verify.push(`group unverified: ${r['groupId']} missing/not a group`)
        for (const cid of r['childIds'] as string[]) {
          const c = freshObjects[cid]
          const pid = c ? (parentIdOf(c as ShapeNode) ?? (c as ShapeNode).parentId) : undefined
          if (!c || pid !== r['groupId']) verify.push(`group unverified: child ${cid} parent is ${pid}`)
        }
      }
      if (r['releasedChildIds']) {
        for (const cid of r['releasedChildIds'] as string[]) {
          if (!freshObjects[cid]) verify.push(`ungroup unverified: child ${cid} missing`)
        }
      }
      if (r['order']) {
        const s = freshObjects[r['shapeId'] as string]
        const pid = (s ? (parentIdOf(s as ShapeNode) ?? (s as unknown as { parentId?: string }).parentId) : undefined) as string | undefined
        const order = pid && freshObjects[pid] ? shapesOf(freshObjects[pid] as ShapeNode) : []
        if (JSON.stringify(order) !== JSON.stringify(r['order'])) {
          verify.push(`reorder unverified for ${r['shapeId']}: order differs`)
        }
      }
    }
    const readbackVerified = verify.length === 0
    if (!readbackVerified) warnings.push(...verify)

    return {
      status: readbackVerified ? 'ok' : 'applied-with-mismatch',
      revisionBefore: file.revn,
      revisionAfter: result.revn,
      operationResults,
      createdShapeIds,
      modifiedShapeIds: [...new Set(modifiedShapeIds)],
      deletedShapeIds,
      sourceToCloneIds,
      readbackVerified,
      warnings,
    }
  },
}
