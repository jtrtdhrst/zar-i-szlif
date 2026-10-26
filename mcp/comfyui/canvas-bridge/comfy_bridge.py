"""Canvas bridge broker (fills the ``mcp_service.comfy_bridge`` hook).

The pack's browser bridge (``web/mcp/bridge.js``) snapshots the open canvas and
POSTs to ``/arkennemasis/mcp/browser/*`` — but no server routes existed, so every
call failed and the badge stayed ``not shared`` / ``Connection: unavailable``.
This module implements exactly the protocol the shipped JS speaks (register,
heartbeat with queued commands, ack, disconnect, connection-status), plus a tiny
agent side (enqueue a ``read``, fetch its snapshot).

Trust posture mirrors the open ComfyUI UI itself: no auth tokens here.
Session secrets bind commands/results to the sharing tab; agent endpoints are
owner-operated. shortcut: add a shared token on agent endpoints if this ever
faces untrusted callers.
"""

from __future__ import annotations

import secrets
import time
import uuid

SESSION_TTL_S = 60
REQUEST_TTL_S = 120
MAX_SESSIONS = 32
MAX_PENDING_PER_SESSION = 64

_sessions: dict = {}


def _now() -> float:
    return time.time()


def _purge_locked() -> None:
    now = _now()
    dead = [sid for sid, s in _sessions.items() if now - s["last_seen"] > SESSION_TTL_S]
    for sid in dead:
        _sessions.pop(sid, None)
    for s in _sessions.values():
        pending = s["pending"]
        for rid in [r for r, q in pending.items() if now > q["expires_at"]]:
            if rid not in s["results"]:
                s["results"][rid] = {"status": "expired", "error": {"code": "request_expired", "message": "The canvas request expired. Read the canvas before retrying."}}
            pending.pop(rid, None)


def _live_sessions() -> list:
    _purge_locked()
    return sorted(_sessions.values(), key=lambda s: s["last_seen"], reverse=True)


def _check_browser_session(data: dict):
    sid = (data.get("session_id") or "")
    secret = (data.get("session_secret") or "")
    s = _sessions.get(sid)
    if not s or s["secret"] != secret:
        return None, {"code": "unknown_session", "message": "Unknown canvas session. Share the canvas again."}
    s["last_seen"] = _now()
    return s, None


def register_routes():
    try:
        from server import PromptServer
    except Exception as exc:
        raise RuntimeError("PromptServer import failed: %s" % exc)
    routes = PromptServer.instance.routes

    @routes.post("/arkennemasis/mcp/browser/register")
    async def _register(request):
        body = await request.json()
        if len(_sessions) >= MAX_SESSIONS:
            return _err(429, "too_many_sessions", "Too many sharing tabs. Stop sharing one first.")
        sid, secret = secrets.token_hex(8), secrets.token_hex(32)
        _sessions[sid] = {
            "secret": secret,
            "client_id": str(body.get("client_id") or ""),
            "title": str(body.get("title") or ""),
            "created": _now(),
            "last_seen": _now(),
            "pending": {},
            "results": {},
        }
        _purge_locked()
        from aiohttp import web
        return web.json_response({"session_id": sid, "session_secret": secret})

    @routes.post("/arkennemasis/mcp/browser/heartbeat")
    async def _heartbeat(request):
        from aiohttp import web
        body = await request.json()
        s, err = _check_browser_session(body)
        if err:
            return _err(404, err["code"], err["message"])
        if body.get("client_id"):
            s["client_id"] = str(body["client_id"])
        if "title" in body:
            s["title"] = str(body["title"] or "")
        out = []
        for rid, q in list(s["pending"].items()):
            if _now() > q["expires_at"]:
                continue
            out.append({"command": q["command"], "request_id": rid, "expires_at": q["expires_at"], "session_id": q["session_id"]})
        return web.json_response({"commands": out})

    @routes.post("/arkennemasis/mcp/browser/disconnect")
    async def _disconnect(request):
        from aiohttp import web
        try:
            body = await request.json()
        except Exception:
            body = {}
        sid = str(body.get("session_id") or "")
        sec = str(body.get("session_secret") or "")
        s = _sessions.get(sid)
        if s and (not sec or s["secret"] == sec):
            _sessions.pop(sid, None)
        return web.json_response({"ok": True})

    @routes.post("/arkennemasis/mcp/browser/ack")
    async def _ack(request):
        from aiohttp import web
        body = await request.json()
        s, err = _check_browser_session(body)
        if err:
            return _err(404, err["code"], err["message"])
        rid = str(body.get("request_id") or "")
        if rid in s["pending"]:
            s["results"][rid] = {"status": "done", "result": body.get("result")}
            del s["pending"][rid]
            return web.json_response({"ok": True})
        return _err(410, "request_expired", "The canvas request expired. Read the canvas before retrying.")

    @routes.post("/arkennemasis/mcp/browser/connection-status")
    async def _connection_status(request):
        from aiohttp import web
        try:
            await request.json()
        except Exception:
            pass
        live = _live_sessions()
        if live:
            return web.json_response({"state": "online", "message": "%d tab(s) sharing the canvas." % len(live)})
        return web.json_response({"state": "waiting", "message": "Broker alive, no tabs sharing yet. Click Share canvas in an open ComfyUI tab."})

    @routes.post("/arkennemasis/mcp/agent/read")
    async def _agent_read(request):
        from aiohttp import web
        try:
            body = await request.json()
        except Exception:
            body = {}
        live = _live_sessions()
        if not live:
            return _err(409, "no_live_session", "No tab is sharing the canvas right now.")
        target = None
        wanted = str(body.get("session_id") or "")
        if wanted:
            target = _sessions.get(wanted)
            if target is None:
                return _err(404, "unknown_session", "Unknown canvas session.")
        else:
            target = live[0]
        sid = next(k for k, v in _sessions.items() if v is target)
        if len(target["pending"]) >= MAX_PENDING_PER_SESSION:
            return _err(429, "too_many_requests", "Too many pending canvas requests. Wait and retry.")
        rid = uuid.uuid4().hex
        target["pending"][rid] = {"command": "read", "request_id": rid, "session_id": sid, "expires_at": _now() + REQUEST_TTL_S}
        return web.json_response({"request_id": rid, "session_id": sid, "expires_at": target["pending"][rid]["expires_at"]})

    @routes.get("/arkennemasis/mcp/agent/result")
    async def _agent_result(request):
        from aiohttp import web
        rid = str(request.query.get("request_id") or "")
        for s in list(_sessions.values()):
            if rid in s["results"]:
                return web.json_response(s["results"].pop(rid))
            if rid in s["pending"]:
                return web.json_response({"status": "pending"})
        return _err(404, "unknown_request", "Unknown request id. It may have expired; enqueue a fresh read.")

    @routes.get("/arkennemasis/mcp/agent/sessions")
    async def _agent_sessions(request):
        from aiohttp import web
        live = _live_sessions()
        return web.json_response({"sessions": [{"session_id": sid, "client_id": s["client_id"], "title": s["title"], "last_seen": s["last_seen"], "pending": len(s["pending"])} for sid, s in ((k, v) for k, v in _sessions.items() if v in live)]})
    return {"broker": "arkennemasis-canvas", "routes": 8}


def _err(status: int, code: str, message: str):
    from aiohttp import web
    return web.json_response({"error": {"code": code, "message": message}}, status=status)
