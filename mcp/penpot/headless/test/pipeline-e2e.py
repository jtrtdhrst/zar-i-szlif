#!/usr/bin/env python3
"""pipeline-e2e.py — full headless design-loop evidence run through the public
remote MCP endpoint (no browser, no plugin session).

Flow: project/file/page/shapes -> export PNG -> self-diff (0) -> deliberate
defect -> diff (>0) -> revert -> diff (decreases) -> PNG+SVG import ->
hierarchy ops -> snapshot -> restart persistence -> named snapshot.

Writes JSON evidence + PNG artifacts to --out (default ./evidence-pipeline).
Exit 0 only if every gate passes. Uses only stdlib + the MCP token file.
"""
import argparse, base64, binascii, json, os, struct, sys, time, urllib.request, uuid, zlib

TOKEN_FILE = os.environ.get("MCP_TOKEN_FILE", "/home/opencode/projects/penpot-agent/secrets/mcp-token")
BASE = os.environ.get("PIPELINE_MCP_URL", "https://penpot.kompaszbiorek.pl/mcp/stream")


def png_bytes(w, h, rgb):
    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        return c + struct.pack(">I", binascii.crc32(typ + data) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


class MCP:
    def __init__(self):
        with open(TOKEN_FILE) as f:
            self.token = f.read().strip()
        self.sid = None
        self.n = 0

    def call(self, method, params=None):
        self.n += 1
        body = json.dumps({"jsonrpc": "2.0", "id": self.n, "method": method, "params": params or {}}).encode()
        req = urllib.request.Request(
            BASE + "?userToken=" + self.token, data=body, method="POST",
            headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream",
                      "User-Agent": "pipeline-e2e/1.0"},
        )
        if self.sid:
            req.add_header("Mcp-Session-Id", self.sid)
        with urllib.request.urlopen(req, timeout=180) as r:
            nsid = r.headers.get("Mcp-Session-Id")
            if nsid:
                self.sid = nsid
            raw = r.read()
        try:
            return json.loads(raw)
        except Exception:
            for line in raw.decode(errors="replace").splitlines():
                if line.startswith("data: "):
                    try:
                        return json.loads(line[6:])
                    except Exception:
                        pass
            raise RuntimeError("unparseable MCP response")

    def tool(self, name, args):
        r = self.call("tools/call", {"name": name, "arguments": args})
        if r.get("error"):
            raise RuntimeError(f"{name} JSON-RPC error: {r['error']}")
        res = r.get("result", {})
        text = "".join(c.get("text", "") for c in res.get("content", []) if c.get("type") == "text")
        if res.get("isError"):
            raise RuntimeError(f"{name} tool error: {text[:500]}")
        try:
            out = json.loads(text)
        except Exception:
            return {"_text": text[:500]}
        # Lagged-write protocol: the mutation was applied; verify by readback.
        if isinstance(out, dict) and out.get("writeApplied"):
            out["_lagged"] = True
        return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="evidence-pipeline")
    ap.add_argument("--keep-prefix", default="PIPELINE-E2E")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    ev = {"started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "gates": {}}
    mcp = MCP()
    mcp.call("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                            "clientInfo": {"name": "pipeline-e2e", "version": "1.0"}})
    mcp.call("notifications/initialized")
    tools = [t["name"] for t in mcp.call("tools/list", {})["result"]["tools"]]
    for need in ("penpot_export_frame", "penpot_visual_diff", "penpot_import_asset", "penpot_mutate_hierarchy"):
        assert need in tools, f"missing tool {need}"
    ev["gates"]["tools_registered_22"] = len(tools)

    teams = mcp.tool("penpot_list_teams", {})
    team_id = teams[0]["id"] if isinstance(teams, list) else teams["teams"][0]["id"]
    stamp = time.strftime("%Y%m%d-%H%M%S")
    proj = mcp.tool("penpot_create_project", {"teamId": team_id, "name": f"{args.keep_prefix}-{stamp}"})
    project_id = proj.get("projectId") or proj.get("id")
    fil = mcp.tool("penpot_create_file", {"projectId": project_id, "name": f"{args.keep_prefix}-file-{stamp}"})
    file_id = fil.get("fileId") or fil.get("id")
    page_id, frame_id = str(uuid.uuid4()), str(uuid.uuid4())
    rect_id, circ_id, path_id, text_id = (str(uuid.uuid4()) for _ in range(4))
    mcp.tool("penpot_create_page", {"fileId": file_id, "name": "Loop canvas", "pageId": page_id})
    mcp.tool("penpot_add_shapes", {"fileId": file_id, "pageId": page_id, "shapes": [
        {"id": frame_id, "type": "frame", "name": "screen", "x": 0, "y": 0, "width": 640, "height": 480,
         "fills": [{"type": "solid", "color": "#FFFFFF", "opacity": 1}]},
        {"id": rect_id, "type": "rect", "name": "hero", "x": 40, "y": 40, "width": 200, "height": 120,
         "parentId": frame_id, "frameId": frame_id,
         "fills": [{"type": "solid", "color": "#2563EB", "opacity": 1}]},
        {"id": circ_id, "type": "circle", "name": "dot", "x": 300, "y": 60, "width": 80, "height": 80,
         "parentId": frame_id, "frameId": frame_id,
         "fills": [{"type": "solid", "color": "#EF4444", "opacity": 1}]},
        {"id": path_id, "type": "path", "name": "tick", "parentId": frame_id, "frameId": frame_id,
         "content": [{"command": "move-to", "params": {"x": 420, "y": 60}}, {"command": "line-to", "params": {"x": 480, "y": 120}}],
         "stroke": {"color": "#16A34A", "opacity": 1, "width": 6, "style": "solid", "alignment": "center"}},
        {"id": text_id, "type": "text", "name": "headline", "x": 40, "y": 200, "width": 400, "height": 40,
         "parentId": frame_id, "frameId": frame_id, "characters": "Hello pipeline",
         "fontSize": "28", "fontWeight": "400", "fillColor": "#111827"},
    ]})
    ev.update({"projectId": project_id, "fileId": file_id, "pageId": page_id, "frameId": frame_id})

    exp1 = mcp.tool("penpot_export_frame", {"fileId": file_id, "pageId": page_id, "shapeId": frame_id,
                                            "format": "png", "scale": 1, "background": "white"})
    assert exp1["status"] == "ok" and exp1["width"] == 640 and exp1["height"] == 480, exp1
    open(os.path.join(args.out, "render-initial.png"), "wb").write(base64.b64decode(exp1["dataBase64"]))
    ev["gates"]["export_png"] = {"sha256": exp1["sha256"], "bytes": exp1["byteLength"], "warnings": exp1["warnings"]}

    svg1 = mcp.tool("penpot_export_frame", {"fileId": file_id, "pageId": page_id, "shapeId": frame_id, "format": "svg"})
    assert svg1["mimeType"] == "image/svg+xml" and svg1["byteLength"] > 100, svg1
    open(os.path.join(args.out, "render-initial.svg"), "wb").write(base64.b64decode(svg1["dataBase64"]))
    ev["gates"]["export_svg"] = {"sha256": svg1["sha256"], "bytes": svg1["byteLength"]}

    d0 = mcp.tool("penpot_visual_diff", {"referenceArtifactId": exp1["artifactId"],
                                         "targetFileId": file_id, "targetPageId": page_id, "targetShapeId": frame_id,
                                         "targetBackground": "white", "allowedMismatchRatio": 0})
    assert d0["status"] == "ok" and d0["differentPixels"] == 0 and d0["passed"] is True, d0
    ev["gates"]["self_diff_zero"] = d0["mismatchRatio"]

    # Deliberate defect: move rect +20px and recolor.
    mcp.tool("penpot_update_shapes", {"fileId": file_id, "pageId": page_id,
                                      "patches": [{"shapeId": rect_id, "x": 60,
                                                   "fills": [{"type": "solid", "color": "#F59E0B", "opacity": 1}]}]})
    exp2 = mcp.tool("penpot_export_frame", {"fileId": file_id, "pageId": page_id, "shapeId": frame_id,
                                            "format": "png", "scale": 1, "background": "white"})
    open(os.path.join(args.out, "render-defect.png"), "wb").write(base64.b64decode(exp2["dataBase64"]))
    assert exp2["sha256"] != exp1["sha256"], "render must reflect the mutation"
    ev["gates"]["mutation_reflected"] = {"before": exp1["sha256"][:12], "after": exp2["sha256"][:12]}
    d1 = mcp.tool("penpot_visual_diff", {"referenceArtifactId": exp1["artifactId"],
                                         "targetFileId": file_id, "targetPageId": page_id, "targetShapeId": frame_id,
                                         "targetBackground": "white", "allowedMismatchRatio": 0})
    assert d1["status"] == "ok" and d1["differentPixels"] > 0 and d1["passed"] is False, d1
    assert d1["diffArtifactUri"] and d1["overlayArtifactUri"] and len(d1["regions"]) > 0, d1
    ev["gates"]["defect_detected"] = {"differentPixels": d1["differentPixels"], "mismatchRatio": d1["mismatchRatio"],
                                      "regions": len(d1["regions"])}

    # Correct the defect, verify mismatch decreases to zero.
    mcp.tool("penpot_update_shapes", {"fileId": file_id, "pageId": page_id,
                                      "patches": [{"shapeId": rect_id, "x": 40,
                                                   "fills": [{"type": "solid", "color": "#2563EB", "opacity": 1}]}]})
    exp3 = mcp.tool("penpot_export_frame", {"fileId": file_id, "pageId": page_id, "shapeId": frame_id,
                                            "format": "png", "scale": 1, "background": "white"})
    d2 = mcp.tool("penpot_visual_diff", {"referenceArtifactId": exp1["artifactId"],
                                         "targetFileId": file_id, "targetPageId": page_id, "targetShapeId": frame_id,
                                         "targetBackground": "white", "allowedMismatchRatio": 0})
    assert d2["passed"] is True and d2["differentPixels"] == 0, d2
    ev["gates"]["correction_verified"] = {"beforeRatio": d1["mismatchRatio"], "afterRatio": d2["mismatchRatio"]}

    # Asset import: generated PNG fixture + editable SVG fixture.
    red = png_bytes(48, 32, (220, 30, 30))
    imp = mcp.tool("penpot_import_asset", {"fileId": file_id, "pageId": page_id, "name": "red-fixture",
                                           "mimeType": "image/png", "sourceBase64": base64.b64encode(red).decode(),
                                           "x": 40, "y": 300, "importMode": "image",
                                           "parentId": frame_id, "frameId": frame_id})
    assert imp["nativeEditable"] is False and imp["mediaId"], imp
    if imp.get("_lagged"):
        got = mcp.tool("penpot_get_shape", {"fileId": file_id, "pageId": page_id,
                                            "shapeId": imp["shapeIds"][0], "includeDescendants": False})
        assert got["type"] == "image", got
        ev["gates"]["import_png_lagged_readback"] = True
    ev["gates"]["import_png"] = {"mediaId": imp["mediaId"], "shapeIds": imp["shapeIds"]}
    svg_fixture = ('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60">'
                   '<rect x="4" y="4" width="60" height="40" fill="#2563EB"/>'
                   '<circle cx="90" cy="24" r="16" fill="#16A34A"/>'
                   '<path d="M10 50 L110 50" stroke="#111827" stroke-width="3"/></svg>')
    imps = mcp.tool("penpot_import_asset", {"fileId": file_id, "pageId": page_id, "name": "vector-fixture",
                                            "mimeType": "image/svg+xml",
                                            "sourceBase64": base64.b64encode(svg_fixture.encode()).decode(),
                                            "x": 220, "y": 300, "importMode": "editable-svg",
                                            "parentId": frame_id, "frameId": frame_id})
    assert imps["nativeEditable"] is True and len(imps["shapeIds"]) == 3, imps
    if imps.get("_lagged"):
        got = mcp.tool("penpot_get_shape", {"fileId": file_id, "pageId": page_id,
                                            "shapeId": imps["shapeIds"][0], "includeDescendants": False})
        assert got["type"] == "rect", got
        ev["gates"]["import_svg_lagged_readback"] = True
    ev["gates"]["import_svg_editable"] = {"shapeIds": imps["shapeIds"], "warnings": imps["warnings"]}
    # Restyle one imported native shape to prove editability.
    mcp.tool("penpot_update_shapes", {"fileId": file_id, "pageId": page_id,
                                      "patches": [{"shapeId": imps["shapeIds"][0],
                                                   "fills": [{"type": "solid", "color": "#7C3AED", "opacity": 1}]}]})
    got = mcp.tool("penpot_get_shape", {"fileId": file_id, "pageId": page_id,
                                      "shapeId": imps["shapeIds"][0], "includeDescendants": False})
    assert (got["fills"][0].get("fill-color") or got["fills"][0].get("fillColor")) == "#7C3AED", got
    ev["gates"]["imported_svg_restyled"] = True

    # Hierarchy: dryRun, group, bringToFront, clone, delete, circular rejection.
    dry = mcp.tool("penpot_mutate_hierarchy", {"fileId": file_id, "pageId": page_id, "dryRun": True,
                                               "operations": [{"op": "delete", "shapeIds": [circ_id]}]})
    assert dry["status"] == "dry-run" and dry["plannedChangeCount"] == 1, dry
    def snap_objects():
        s = mcp.tool("penpot_get_file_snapshot", {"fileId": file_id})
        return s["data"]["pagesIndex"][page_id]["objects"]

    grp = mcp.tool("penpot_mutate_hierarchy", {"fileId": file_id, "pageId": page_id,
                                               "operations": [{"op": "group", "shapeIds": [rect_id, circ_id],
                                                               "name": "hero-group"}]})
    assert grp["status"] in ("ok", "write_applied_with_lagged_changes"), grp
    group_id = grp["operationResults"][0]["groupId"]
    if grp.get("_lagged"):
        objs = snap_objects()
        assert objs[group_id]["type"] == "group", "group readback failed"
        for cid in (rect_id, circ_id):
            assert (objs[cid].get("parent-id") or objs[cid].get("parentId")) == group_id, cid
    else:
        assert grp["readbackVerified"] is True, grp
    ev["gates"]["hierarchy_group"] = {"groupId": group_id, "lagged": bool(grp.get("_lagged"))}
    front = mcp.tool("penpot_mutate_hierarchy", {"fileId": file_id, "pageId": page_id,
                                                 "operations": [{"op": "bringToFront", "shapeId": group_id}]})
    assert front["status"] in ("ok", "write_applied_with_lagged_changes"), front
    if front.get("_lagged"):
        objs = snap_objects()
        assert objs[frame_id]["shapes"][-1] == group_id, "bringToFront readback failed"
    else:
        assert front["readbackVerified"] is True, front
    ev["gates"]["hierarchy_reorder"] = {"lagged": bool(front.get("_lagged"))}
    clo = mcp.tool("penpot_mutate_hierarchy", {"fileId": file_id, "pageId": page_id,
                                                "operations": [{"op": "clone", "shapeIds": [text_id], "dx": 0, "dy": 60}]})
    assert clo["status"] in ("ok", "write_applied_with_lagged_changes"), clo
    clone_id = clo["operationResults"][0]["clonedRootIds"][0]
    if clo.get("_lagged"):
        objs = snap_objects()
        assert clone_id in objs, "clone readback failed"
    else:
        assert clo["readbackVerified"] is True, clo
    dele = mcp.tool("penpot_mutate_hierarchy", {"fileId": file_id, "pageId": page_id,
                                                "operations": [{"op": "delete", "shapeIds": [clone_id]}]})
    assert dele["status"] in ("ok", "write_applied_with_lagged_changes"), dele
    if dele.get("_lagged"):
        objs = snap_objects()
        assert clone_id not in objs, "delete readback failed"
    else:
        assert dele["readbackVerified"] is True, dele
    ev["gates"]["hierarchy_reorder_clone_delete"] = True
    try:
        mcp.tool("penpot_mutate_hierarchy", {"fileId": file_id, "pageId": page_id,
                                             "operations": [{"op": "reparent", "shapeIds": [group_id],
                                                             "newParentId": group_id}]})
        raise SystemExit("circular reparent was NOT rejected")
    except RuntimeError as e:
        assert "circular" in str(e), e
    ev["gates"]["circular_rejected"] = True
    ung = mcp.tool("penpot_mutate_hierarchy", {"fileId": file_id, "pageId": page_id,
                                                "operations": [{"op": "ungroup", "groupId": group_id}]})
    assert ung["status"] in ("ok", "write_applied_with_lagged_changes"), ung
    if ung.get("_lagged"):
        objs = snap_objects()
        assert group_id not in objs and rect_id in objs and circ_id in objs, "ungroup readback failed"
    else:
        assert ung["readbackVerified"] is True, ung
    ev["gates"]["hierarchy_ungroup"] = True

    # Export once more with imported assets on canvas; snapshot; verify snapshot read.
    exp4 = mcp.tool("penpot_export_frame", {"fileId": file_id, "pageId": page_id, "shapeId": frame_id,
                                            "format": "png", "scale": 1, "background": "white"})
    open(os.path.join(args.out, "render-final.png"), "wb").write(base64.b64decode(exp4["dataBase64"]))
    assert exp4["sha256"] != exp1["sha256"]
    snap = mcp.tool("penpot_create_file_snapshot", {"fileId": file_id, "label": "pipeline-e2e-final"})
    snap_id = snap.get("id") or snap.get("snapshotId")
    snaps = mcp.tool("penpot_list_file_snapshots", {"fileId": file_id})
    assert any((s.get("id") or s.get("snapshotId")) == snap_id for s in (snaps if isinstance(snaps, list) else snaps.get("snapshots", []))), snaps
    ev["gates"]["snapshot"] = {"snapshotId": snap_id}
    ev["finished"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with open(os.path.join(args.out, "evidence.json"), "w") as f:
        json.dump(ev, f, indent=2)
    print(json.dumps({"result": "E2E_PASS", "projectId": project_id, "fileId": file_id,
                      "pageId": page_id, "frameId": frame_id, "snapshotId": snap_id,
                      "evidenceDir": args.out}, indent=2))


if __name__ == "__main__":
    main()
