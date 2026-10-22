"""Klient upstream Langfuse (MCP + REST) używany przez gateway.

Gateway gada z upstreamem po stronie serwera (klucz projektu wstrzykiwany
przez shim), wiec klient MCP nie musi nic wiedziec o kluczu.
"""
import gzip
import http.client
import json
import zlib
from urllib.parse import urlencode

from .normalize import classify_http
from urllib.parse import urlencode

from .normalize import classify_http


class UpstreamError(Exception):
    def __init__(self, code, message, details=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


def _first_json(raw, content_type):
    """Parsuje odpowiedz MCP: zwykly JSON albo ramki SSE."""
    text = raw.decode("utf-8", "replace")
    stripped = text.lstrip()
    if stripped.startswith("{") or stripped.startswith("["):
        try:
            return json.loads(text)
        except ValueError:
            pass
    for line in text.splitlines():
        if line.startswith("data:"):
            chunk = line[5:].strip()
            if chunk:
                try:
                    return json.loads(chunk)
                except ValueError:
                    continue
    return None


class Upstream:
    def __init__(self, host="langfuse", port=3000, basic="", timeout=120):
        self.host = host
        self.port = port
        self.basic = basic
        self.timeout = timeout

    def _request(self, method, path, body=None, headers=None, timeout=None):
        conn = http.client.HTTPConnection(self.host, self.port, timeout=timeout or self.timeout)
        try:
            conn.request(method, path, body=body, headers=headers or {})
            res = conn.getresponse()
            raw = res.read()
            encoding = (res.getheader("Content-Encoding") or "").lower().strip()
            if encoding == "gzip":
                raw = gzip.decompress(raw)
            elif encoding == "deflate":
                try:
                    raw = zlib.decompress(raw)
                except zlib.error:
                    raw = zlib.decompress(raw, -zlib.MAX_WBITS)
            return res.status, res.getheader("Content-Type") or "", raw
        finally:
            conn.close()

    def mcp_call(self, tool, arguments, timeout=None):
        """Wywoluje narzedzie upstream MCP. Zwraca (ok, payload).

        payload to slowany JSON z content[0].text (np. {"data": [...], "meta": {...}}).
        Przy bledzie zwraca (False, {"error": {"code", "message"}}).
        """
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                           "params": {"name": tool, "arguments": arguments}}).encode("utf-8")
        headers = {"Content-Type": "application/json",
                   "Accept": "application/json, text/event-stream",
                   "Authorization": "Basic " + self.basic}
        try:
            status, ctype, raw = self._request("POST", "/api/public/mcp", body, headers, timeout)
        except TimeoutError:
            return False, {"error": {"code": "TIMEOUT", "message": f"upstream timeout for {tool}"}}
        except OSError as exc:
            return False, {"error": {"code": "UPSTREAM_ERROR", "message": str(exc)}}
        envelope = _first_json(raw, ctype)
        if not isinstance(envelope, dict):
            return False, {"error": {"code": "UPSTREAM_ERROR",
                                     "message": f"unreadable upstream response ({status})"}}
        if envelope.get("error"):
            err = envelope["error"]
            return False, {"error": {"code": "UPSTREAM_ERROR",
                                     "message": err.get("message") or "upstream JSON-RPC error"}}
        result = envelope.get("result") or {}
        if result.get("isError"):
            return False, {"error": {"code": "UPSTREAM_ERROR",
                                     "message": _text_of(result) or "upstream tool error"}}
        parsed = _text_of(result)
        return True, parsed if isinstance(parsed, dict) else {"data": parsed}

    def paginate(self, tool, arguments, max_pages=25):
        """Pagiuje narzedzie upstream po cursor.

        Zwraca (items, pagination). `pagination.complete` mowi wprost, czy
        wszystkie rekordy zostaly pobrane - nie udajemy kompletnosci.
        """
        items = []
        cursor = None
        meta = {}
        pages = 0
        for _ in range(max_pages):
            args = dict(arguments)
            if cursor:
                args["cursor"] = cursor
            ok, payload = self.mcp_call(tool, args)
            if not ok:
                return None, {"error": payload.get("error", {}), "pages": pages,
                              "fetched": len(items), "complete": False}
            pages += 1
            data = payload.get("data")
            if isinstance(data, list):
                items.extend(data)
            meta = payload.get("meta") or {}
            cursor = meta.get("cursor")
            if not cursor:
                break
        return items, {"mode": "cursor", "pages": pages, "fetched": len(items),
                       "limit": meta.get("limit"), "cursor": cursor,
                       "complete": not cursor,
                       "note": None if not cursor else
                               "paginacja nie zakonczona - kolejne strony nie mieszcza sie "
                               "w limicie %d stron" % max_pages}

    def list_observations(self, trace_id=None, limit=100, max_pages=25, fields=None):
        """Zwraca obserwacje (trace opcjonalnie) z paginacja cursor, bez duplikatow."""
        args = {"limit": limit}
        if trace_id:
            args["traceId"] = trace_id
        if fields:
            args["fields"] = fields
        items, pagination = self.paginate("listObservations", args, max_pages=max_pages)
        if items is None:
            error = (pagination or {}).get("error") or {}
            raise UpstreamError(error.get("code", "UPSTREAM_ERROR"),
                                error.get("message", "listObservations failed"))
        seen = set()
        observations = []
        for item in items:
            if isinstance(item, dict) and item.get("id") and item["id"] not in seen:
                seen.add(item["id"])
                observations.append(item)
        return observations

    def query_metrics(self, query, timeout=None):
        ok, payload = self.mcp_call("queryMetrics", query, timeout=timeout)
        if not ok:
            raise UpstreamError(payload.get("error", {}).get("code", "UPSTREAM_ERROR"),
                                payload.get("error", {}).get("message", "queryMetrics failed"))
        return payload

    def metrics_schema(self, view=None):
        args = {"view": view} if view else {}
        ok, payload = self.mcp_call("getMetricsSchema", args)
        if not ok:
            raise UpstreamError(payload.get("error", {}).get("code", "UPSTREAM_ERROR"),
                                payload.get("error", {}).get("message", "getMetricsSchema failed"))
        return payload

    def health(self):
        ok, payload = self.mcp_call("getHealth", {"failIfDatabaseUnavailable": False,
                                                   "failIfNoRecentEvents": False})
        if not ok:
            raise UpstreamError(payload.get("error", {}).get("code", "UPSTREAM_ERROR"),
                                payload.get("error", {}).get("message", "getHealth failed"))
        return payload

    def rest_request(self, method, path, body=None, params=None, timeout=None):
        """Zadanie REST na publicznym API Langfuse (te same kredensje co MCP).

        Uzywane dla endpointow, ktorych nie ma w katalogu narzedzi MCP
        (np. /api/public/v2/evaluators/{id}/versions, /api/public/llm-connections).
        Zwraca zparsowany JSON; bledy HTTP wyrzucaja UpstreamError.
        """
        url = path
        if params:
            url += "?" + urlencode(params, doseq=True)
        headers = {"Accept": "application/json"}
        if self.basic:
            headers["Authorization"] = "Basic " + self.basic
        payload = None
        if body is not None:
            payload = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        try:
            status, _, raw = self._request(method, url, payload, headers, timeout)
        except TimeoutError:
            raise UpstreamError("TIMEOUT", "upstream timeout for %s %s" % (method, path))
        except OSError as exc:
            raise UpstreamError("UPSTREAM_ERROR", str(exc))
        if status >= 400:
            code, message, _ = classify_http(status, raw[:400])
            raise UpstreamError(code, message or "%s %s failed with %s" % (method, path, status),
                                {"httpStatus": status,
                                 "body": raw[:600].decode("utf-8", "replace")})
        try:
            return json.loads(raw.decode("utf-8"))
        except ValueError:
            raise UpstreamError("UPSTREAM_ERROR", "unreadable response for %s %s" % (method, path))

    def rest_get(self, path, params=None, timeout=None):
        """GET na publicznym REST API Langfuse (te same kredensje co MCP).

        Uzywane tylko dla endpointow, ktorych nie ma w katalogu narzedzi MCP,
        np. /api/public/v2/evaluators/{id}/versions.
        """
        return self.rest_request("GET", path, params=params, timeout=timeout)


def _text_of(result):
    """Wyciaga JSON z content[0].text (upstream zwraca tam string z JSON-em)."""
    content = result.get("content") if isinstance(result, dict) else None
    if isinstance(content, list) and content:
        text = content[0].get("text") if isinstance(content[0], dict) else None
        if isinstance(text, str):
            try:
                return json.loads(text)
            except ValueError:
                return text
        return text
    return result
