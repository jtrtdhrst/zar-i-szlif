#!/usr/bin/env python3
"""Acceptance scenario: native onboarding screen 'Zar i Szlif' (1280x800)
plus a narrow 390x844 responsive fixture. Real Penpot objects only, then
PNG exports as evidence. Uses the remote MCP endpoint (no browser)."""
import base64, json, os, sys, urllib.request, uuid

TOKEN_FILE = os.environ.get("MCP_TOKEN_FILE", "/home/opencode/projects/penpot-agent/secrets/mcp-token")
BASE = os.environ.get("PIPELINE_MCP_URL", "https://penpot.kompaszbiorek.pl/mcp/stream")
OUT = "/root/penpot-pipeline-evidence-20261019/acceptance-zar-i-szlif"


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
                      "User-Agent": "Mozilla/5.0 Chrome/126"})
        if self.sid:
            req.add_header("Mcp-Session-Id", self.sid)
        with urllib.request.urlopen(req, timeout=180) as r:
            if r.headers.get("Mcp-Session-Id"):
                self.sid = r.headers.get("Mcp-Session-Id")
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
            raise RuntimeError(f"{name} tool error: {text[:800]}")
        try:
            out = json.loads(text)
        except Exception:
            return {"_text": text[:500]}
        if isinstance(out, dict) and out.get("writeApplied"):
            out["_lagged"] = True
        return out


def solid(color, opacity=1):
    return {"type": "solid", "color": color, "opacity": opacity}


def main():
    os.makedirs(OUT, exist_ok=True)
    mcp = MCP()
    mcp.call("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                            "clientInfo": {"name": "acceptance-zis", "version": "1.0"}})
    mcp.call("notifications/initialized")
    teams = mcp.tool("penpot_list_teams", {})
    team_id = teams[0]["id"] if isinstance(teams, list) else teams["teams"][0]["id"]
    proj = mcp.tool("penpot_create_project", {"teamId": team_id, "name": "ZIS-ACCEPTANCE-20261019"})
    project_id = proj.get("projectId") or proj.get("id")
    fil = mcp.tool("penpot_create_file", {"projectId": project_id, "name": "zar-i-szlif-onboarding"})
    file_id = fil.get("fileId") or fil.get("id")
    page_id = str(uuid.uuid4())
    mcp.tool("penpot_create_page", {"fileId": file_id, "name": "Onboarding", "pageId": page_id})

    desktop, narrow = str(uuid.uuid4()), str(uuid.uuid4())
    S = lambda n: f"{n}-{uuid.uuid4().hex[:8]}"
    ids = {}
    shapes = []

    def rect(name, x, y, w, h, fill, parent, r=0, opacity=1):
        sid = str(uuid.uuid4())
        ids[name] = sid
        s = {"id": sid, "type": "rect", "name": name, "x": x, "y": y, "width": w, "height": h,
             "parentId": parent, "frameId": parent, "fills": [solid(fill, opacity)]}
        if r:
            s.update({"r1": r, "r2": r, "r3": r, "r4": r})
        shapes.append(s)
        return sid

    def txt(name, x, y, w, h, characters, size, color, parent, align="left", weight="400"):
        sid = str(uuid.uuid4())
        ids[name] = sid
        shapes.append({"id": sid, "type": "text", "name": name, "x": x, "y": y, "width": w, "height": h,
                       "parentId": parent, "frameId": parent, "characters": characters,
                       "fontSize": str(size), "fontWeight": weight, "fillColor": color,
                       "paragraphs": [{"textAlign": align, "ranges": [{"text": characters,
                                                                      "fontSize": str(size), "fontWeight": weight,
                                                                      "fills": [{"type": "solid", "color": color, "opacity": 1}]}]}]})
        return sid

    # Desktop 1280x800.
    shapes.append({"id": desktop, "type": "frame", "name": "desktop-1280x800", "x": 0, "y": 0,
                   "width": 1280, "height": 800, "fills": [solid("#F8FAFC")]})
    rect("header-bar", 0, 0, 1280, 72, "#111827", desktop)
    txt("app-name", 48, 22, 300, 32, "Żar i Szlif", 24, "#FFFFFF", desktop, weight="700")
    txt("nav-links", 950, 26, 280, 24, "Pracownia  Cennik  Kontakt", 16, "#D1D5DB", desktop)
    txt("hero-heading", 96, 150, 700, 70, "Rozpal swoją pracownię", 52, "#111827", desktop, weight="700")
    txt("hero-intro", 96, 240, 560, 90,
        "Kowalstwo artystyczne i szkliwienie ceramiki w jednym miejscu. Wybierz ścieżkę i zacznij tworzyć już dziś.",
        20, "#374151", desktop)
    for i, (title, desc, accent) in enumerate([
            ("Kowalstwo", "Kucie, spawanie i wykończenie metalu pod okiem mistrzów.", "#F59E0B"),
            ("Szkliwienie", "Formowanie naczyń i szkliwa w pracowni ceramicznej.", "#2563EB")]):
        cx = 96 + i * 340
        rect(f"card-{i}", cx, 360, 300, 300, "#FFFFFF", desktop, r=16)
        rect(f"card-strip-{i}", cx, 360, 300, 12, accent, desktop, r=6)
        txt(f"card-title-{i}", cx + 32, 400, 236, 36, title, 28, "#111827", desktop, weight="700")
        txt(f"card-desc-{i}", cx + 32, 452, 236, 120, desc, 17, "#4B5563", desktop)
    rect("btn-primary", 96, 700, 220, 56, "#F59E0B", desktop, r=12)
    txt("btn-primary-label", 96, 714, 220, 28, "Rozpocznij", 20, "#111827", desktop, align="center", weight="700")
    txt("btn-secondary", 340, 716, 220, 28, "Dowiedz się więcej", 18, "#2563EB", desktop, align="center")
    shapes.append({"id": str(uuid.uuid4()), "type": "circle", "name": "deco-circle", "x": 1000, "y": 420,
                   "width": 180, "height": 180, "parentId": desktop, "frameId": desktop,
                   "fills": [{"type": "solid", "color": "#FDE68A", "opacity": 0.7}]})
    shapes.append({"id": str(uuid.uuid4()), "type": "path", "name": "deco-line", "parentId": desktop, "frameId": desktop,
                   "content": [{"command": "move-to", "params": {"x": 940, "y": 200}}, {"command": "curve-to", "params": {"x": 1180, "y": 320, "c1x": 1020, "c1y": 200, "c2x": 1100, "c2y": 320}}],
                   "stroke": {"color": "#F59E0B", "opacity": 1, "width": 5, "style": "solid", "alignment": "center"}})

    # Narrow 390x844 responsive fixture.
    shapes.append({"id": narrow, "type": "frame", "name": "mobile-390x844", "x": 1360, "y": 0,
                   "width": 390, "height": 844, "fills": [solid("#F8FAFC")]})
    rect("m-header", 0, 0, 390, 64, "#111827", narrow)
    txt("m-app", 24, 18, 200, 28, "Żar i Szlif", 20, "#FFFFFF", narrow, weight="700")
    txt("m-heading", 24, 110, 342, 90, "Rozpal swoją pracownię", 36, "#111827", narrow, weight="700")
    rect("m-card", 24, 250, 342, 280, "#FFFFFF", narrow, r=16)
    txt("m-card-title", 52, 282, 286, 36, "Kowalstwo", 26, "#111827", narrow, weight="700")
    rect("m-cta", 24, 580, 342, 56, "#F59E0B", narrow, r=12)
    txt("m-cta-label", 24, 594, 342, 28, "Rozpocznij", 20, "#111827", narrow, align="center", weight="700")

    # Emblem asset: editable SVG import placed on desktop.
    emblem = ('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">'
              '<circle cx="48" cy="48" r="44" fill="#111827"/>'
              '<path d="M48 20 C60 36 66 46 66 58 A18 18 0 0 1 30 58 C30 46 36 36 48 20 Z" fill="#F59E0B"/>'
              '</svg>')
    emb = mcp.tool("penpot_import_asset", {"fileId": file_id, "pageId": page_id, "name": "flame-emblem",
                                           "mimeType": "image/svg+xml",
                                           "sourceBase64": base64.b64encode(emblem.encode()).decode(),
                                           "x": 1060, "y": 120, "importMode": "editable-svg",
                                           "parentId": desktop, "frameId": desktop})
    assert emb["nativeEditable"] is True and len(emb["shapeIds"]) >= 2, emb

    mcp.tool("penpot_add_shapes", {"fileId": file_id, "pageId": page_id, "shapes": shapes})
    snap = mcp.tool("penpot_get_file_snapshot", {"fileId": file_id})
    objs = snap["data"]["pagesIndex"][page_id]["objects"]
    by_type = {}
    for o in objs.values():
        by_type[o.get("type")] = by_type.get(o.get("type"), 0) + 1
    assert by_type.get("frame", 0) >= 2 and by_type.get("text", 0) >= 8, by_type

    exp_d = mcp.tool("penpot_export_frame", {"fileId": file_id, "pageId": page_id, "shapeId": desktop,
                                             "format": "png", "scale": 1, "background": "white"})
    exp_m = mcp.tool("penpot_export_frame", {"fileId": file_id, "pageId": page_id, "shapeId": narrow,
                                             "format": "png", "scale": 1, "background": "white"})
    assert exp_d["width"] == 1280 and exp_d["height"] == 800, exp_d
    assert exp_m["width"] == 390 and exp_m["height"] == 844, exp_m
    open(f"{OUT}/zis-desktop.png", "wb").write(base64.b64decode(exp_d["dataBase64"]))
    open(f"{OUT}/zis-mobile.png", "wb").write(base64.b64decode(exp_m["dataBase64"]))
    snap_final = mcp.tool("penpot_create_file_snapshot", {"fileId": file_id, "label": "zis-acceptance-final"})
    with open(f"{OUT}/acceptance.json", "w") as f:
        json.dump({"projectId": project_id, "fileId": file_id, "pageId": page_id,
                   "objectCount": len(objs), "byType": by_type,
                   "desktop": {k: exp_d[k] for k in ("sha256", "byteLength", "width", "height", "revision")},
                   "mobile": {k: exp_m[k] for k in ("sha256", "byteLength", "width", "height", "revision")},
                   "emblemShapeIds": emb["shapeIds"], "snapshotId": snap_final.get("id")}, f, indent=2)
    print(json.dumps({"result": "ZIS_ACCEPTANCE_PASS", "fileId": file_id, "objects": len(objs), "byType": by_type,
                      "desktopSha": exp_d["sha256"][:12], "mobileSha": exp_m["sha256"][:12],
                      "snapshotId": snap_final.get("id")}, indent=2))


if __name__ == "__main__":
    main()
