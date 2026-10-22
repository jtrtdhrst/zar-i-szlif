#!/usr/bin/env python3
"""Langfuse MCP public shim v4 (2026-10-20).

v3 dodalo profil read-only; v4 dodaje **warstwe kontraktow** (MCP Contract
Gateway) miedzy klientem MCP a upstreamem Langfuse.

Co robi v4
----------
* **Walidacja argumentow przed wywolaniem API** - schematy pochodza z
  katalogu upstream (`evidence/langfuse-mcp-catalog.json`), bledy maja jeden
  kod, komunikat i flage `retryable`.
* **Jednolity format wynikow** - kazde narzedzie zwraca `ok`, `tool` i
  `warnings`; narzedzia upstream zachowuja swojego ksztaltu (`data`/`meta`),
  a gateway dokleja sekcje `gateway` (paginacja, ostrzezenia, redakcje,
  czasy). Narzedzia gateway zwracaja pelny envelope
  `{ok, tool, data, meta, warnings}`.
* **Limity odpowiedzi** - obciecie dlugich napisow i twardy limit bajtow
  z czytelnym bledem zamiast przerwanej odpowiedzi.
* **Redakcja danych wrazliwych** - sekrety (klucze API, JWT, tokeny, klucze
  prywatne) sa maskowane domyslnie; wylaczenie przez `gateway.redact=false`.
* **Uprawnienia read/write/delete** - profil decyduje co widoczne, a sekcja
  `gateway.effect` opisuje efekt kazdego narzedzia.
* **Operacje wysokiego poziomu** - 14 narzedzi gateway: drzewo trace'a,
  sciezka krytyczna, porownania metryk, anomalie, opisy metryk, diagnostyka.
* **Ochrona zapisow** - `gateway.dryRun`, `gateway.idempotencyKey` (odtwarzanie
  poprzedniej odpowiedzi) i readback po zapisie.

Behaviour niezmieniony w stosunku do v3
---------------------------------------
* Brak kredencji wejsciowej: klucz projektu jest wstrzykiwany po stronie
  serwera, `Bearer X` jest przepisywany na `Basic X`.
* Naglowek `Host` jest przekazywany (LANGFUSE_MCP_ALLOWED_HOSTS).
* Allowlist sciezek: `/health` + `/api/public/mcp*`.
* Profil `X-Langfuse-MCP-Profile`: `read-only` (fail-closed), `operator-write`,
  `full`. Narzedzia gateway sa widoczne w kazdym profilu (sa tylko odczytowe).
"""
import http.client
import gzip
import json
import os
import sys
import time
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlsplit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:  # uklad w obrazie: /app/shim.py + /app/mcp_gateway/
    from mcp_gateway import catalog, normalize, profiles, registry, validation
    from mcp_gateway.diagnostics import Diagnostics, IdempotencyStore
    from mcp_gateway.upstream import Upstream
except ImportError:  # uruchomienie z repozytorium
    from opslib.mcp_gateway import catalog, normalize, profiles, registry, validation
    from opslib.mcp_gateway.diagnostics import Diagnostics, IdempotencyStore
    from opslib.mcp_gateway.upstream import Upstream

UPSTREAM_HOST = os.environ.get("LANGFUSE_MCP_UPSTREAM_HOST", "langfuse")
UPSTREAM_PORT = int(os.environ.get("LANGFUSE_MCP_UPSTREAM_PORT", "3000"))
INJECT_BASIC = os.environ.get("LANGFUSE_MCP_BASIC", "").strip()
PROFILE_HEADER = "X-Langfuse-MCP-Profile"
REDACT_HEADER = "X-Langfuse-MCP-Redact"
READONLY_PROFILE = profiles.READONLY_PROFILE
CONTRACT_VERSION = registry.CONTRACT_VERSION
HOP = {"connection", "transfer-encoding", "upgrade", "keep-alive", "proxy-connection"}

REDACT_DEFAULT = os.environ.get("LANGFUSE_MCP_REDACT", "1").lower() not in ("0", "false", "no")
MAX_STRING_CHARS = int(os.environ.get("LANGFUSE_MCP_MAX_STRING_CHARS", "8000"))
MAX_BYTES = int(os.environ.get("LANGFUSE_MCP_MAX_BYTES", "2000000"))
DEBUG = os.environ.get("LANGFUSE_MCP_DEBUG", "").lower() in ("1", "true", "on")


def _debug(*parts):
    if DEBUG:
        print("[debug]", *parts, flush=True)

PROFILE_TOOLS = profiles.PROFILE_TOOLS
READONLY_TOOLS = profiles.READONLY_TOOLS
OPERATOR_WRITE_TOOLS = profiles.OPERATOR_WRITE_TOOLS

PROFILE_NOTES = {
    "read-only": (" This MCP endpoint is mounted in a least-privilege READ-ONLY profile: "
                  "only non-mutating tools are exposed. Every mutating tool is rejected "
                  "with -32601 before it reaches Langfuse."),
    "operator-write": (" This MCP endpoint is mounted in a least-privilege OPERATOR-WRITE "
                       "profile: read tools plus non-destructive configuration writes "
                       "(create/update evaluators, rules, score configs, models, prompts, "
                       "datasets, dashboards). Destructive tools and tools that inject data "
                       "into the production stream are rejected with -32601."),
}

GATEWAY_NOTE = (
    " Contract gateway v%s active: arguments are validated before the API call, every "
    "response carries ok/tool/warnings plus a gateway section (pagination, warnings, "
    "redactions, timings), secrets are redacted by default, and 19 higher-level tools are "
    "available (getTraceTree, getTraceSummary, getTraceCriticalPath, getTraceErrors, "
    "compareTraces, compareMetrics, getUsageBreakdown, detectAnomalies, queryMetricsPreset, "
    "describeMetric, describeTool, listToolDomains, getMcpHealth, getMcpDiagnostics, "
    "runPromptExperiment, getExperimentStatus, compareExperiments, getRegressionResults, "
    "listEvaluatorVersions). runPromptExperiment executes the official Langfuse Experiment "
    "Runner SDK and writes to the project, so it is exposed in the 'full' profile only. "
    "Writes accept gateway.dryRun and gateway.idempotencyKey." % CONTRACT_VERSION)

DIAGNOSTICS = Diagnostics()
IDEMPOTENCY = IdempotencyStore()
UPSTREAM = Upstream(UPSTREAM_HOST, UPSTREAM_PORT, INJECT_BASIC)

# zapis -> (narzedzie odczytujace, nazwa argumentu identyfikatora)
READBACK = {
    "createEvaluator": ("getEvaluator", "evaluatorId"),
    "updateEvaluator": ("getEvaluator", "evaluatorId"),
    "createEvaluationRule": ("getEvaluationRule", "evaluationRuleId"),
    "updateEvaluationRule": ("getEvaluationRule", "evaluationRuleId"),
    "createScoreConfig": ("getScoreConfig", "configId"),
    "updateScoreConfig": ("getScoreConfig", "configId"),
    "createModel": ("getModel", "modelId"),
    "updateModel": ("getModel", "modelId"),
    "createTextPrompt": ("getPrompt", "name"),
    "createChatPrompt": ("getPrompt", "name"),
    "upsertDataset": ("getDataset", "datasetId"),
    "upsertDatasetItem": ("getDatasetItem", "datasetItemId"),
    "createDashboard": ("getDashboard", "dashboardId"),
    "updateDashboard": ("getDashboard", "dashboardId"),
    "createDashboardWidget": ("getDashboardWidget", "widgetId"),
    "updateDashboardWidget": ("getDashboardWidget", "widgetId"),
}
ID_FIELDS = ("id", "evaluatorId", "dashboardId", "configId", "modelId", "datasetId",
             "datasetItemId", "evaluationRuleId", "widgetId", "name")


def allowed(path):
    if path == "/health":
        return True
    p = urlsplit(path).path
    return p == "/api/public/mcp" or p.startswith("/api/public/mcp/")


def _sse_payloads(body: bytes):
    """Yield JSON objects from a raw response body (plain JSON or SSE frames)."""
    text = body.decode("utf-8", "replace")
    stripped = text.lstrip()
    if stripped.startswith("{") or stripped.startswith("["):
        try:
            yield json.loads(text)
            return
        except ValueError:
            return
    for line in text.splitlines():
        if line.startswith("data:"):
            chunk = line[5:].strip()
            if not chunk:
                continue
            try:
                yield json.loads(chunk)
            except ValueError:
                continue


def filter_readonly_response(body: bytes, content_type: str, allowed_tools, profile: str) -> bytes:
    """Filter a JSON-RPC response for the read-only profile. Unknown shapes pass through."""
    try:
        payload = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        # SSE framing: filter every data frame in place.
        if "text/event-stream" not in (content_type or ""):
            return body
        out_lines = []
        for line in body.decode("utf-8", "replace").splitlines(keepends=True):
            if line.startswith("data:"):
                chunk = line[5:].strip()
                try:
                    obj = json.loads(chunk)
                except ValueError:
                    out_lines.append(line)
                    continue
                obj = _filter_obj(obj, allowed_tools, profile)
                out_lines.append("data: " + json.dumps(obj) + "\n\n")
            else:
                out_lines.append(line)
        return "".join(out_lines).encode("utf-8")
    filtered = _filter_obj(payload, allowed_tools, profile)
    return json.dumps(filtered).encode("utf-8")


def _filter_obj(obj, allowed_tools, profile: str):
    if not isinstance(obj, dict):
        return obj
    result = obj.get("result")
    if isinstance(result, dict):
        if isinstance(result.get("tools"), list):
            result["tools"] = [t for t in result["tools"]
                               if isinstance(t, dict) and t.get("name") in allowed_tools]
        if isinstance(result.get("instructions"), str):
            note = PROFILE_NOTES.get(profile)
            if note:
                result["instructions"] = result["instructions"] + note
    return obj


def _mcp_result(rpc_id, envelope, is_error=False):
    """Envelope JSON jako tresc MCP tools/call."""
    body = json.dumps(envelope, ensure_ascii=False)
    return json.dumps({
        "jsonrpc": "2.0",
        "id": rpc_id,
        "result": {"content": [{"type": "text", "text": body}], "isError": is_error},
    }).encode("utf-8")


def _gateway_context(profile):
    return {"upstream": UPSTREAM, "diagnostics": DIAGNOSTICS, "idempotency": IDEMPOTENCY,
            "profile": profile, "effect_of": profiles.effect_of,
            "profiles_for": profiles.profiles_for}


def _payload_of(result):
    """JSON z content[0].text (albo sam result, gdy tresc nie jest JSON)."""
    content = result.get("content") if isinstance(result, dict) else None
    if isinstance(content, list) and content and isinstance(content[0], dict):
        text = content[0].get("text")
        if isinstance(text, str):
            try:
                return json.loads(text)
            except ValueError:
                return text
    return result


def _summarize_metrics_schema(payload):
    """Krotkie podsumowanie getMetricsSchema (pelne pozostaje w payloadzie)."""
    if not isinstance(payload, dict):
        return None
    views = payload.get("views") or {}
    return {
        "supportedViews": payload.get("supportedViews"),
        "granularities": payload.get("granularities"),
        "config": payload.get("config"),
        "measures": {view: sorted((body.get("measures") or {}).keys()) for view, body in views.items()},
        "dimensions": {view: sorted((body.get("dimensions") or {}).keys()) for view, body in views.items()},
    }


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "langfuse-mcp-shim/4"

    # --- pomocnicze ---------------------------------------------------------
    def _profile(self):
        """Fail closed: an absent or unknown profile degrades to read-only."""
        raw = (self.headers.get(PROFILE_HEADER) or "").strip().lower()
        return raw if raw in PROFILE_TOOLS else READONLY_PROFILE

    def _allowed_tools(self):
        tools = PROFILE_TOOLS[self._profile()]
        return None if tools is None else tools

    def _send(self, status, body, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except BrokenPipeError:
            pass

    def _deny(self, tool, rpc_id, profile):
        body = json.dumps({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "error": {
                "code": -32601,
                "message": (f"MCP error -32601: tool '{tool}' is not available in the "
                            f"'{profile}' Langfuse MCP profile"),
            },
        }).encode("utf-8")
        self._send(200, body)

    # Naglowki przenoszone do upstreamu. Lista jest zamknieta: przenoszenie
    # naglowkow klienta (Host, Origin, cf-*, X-Forwarded-*) powodowalo, ze
    # Langfuse odrzucal zadanie ("Access forbidden"). Do upstreamu idzie tylko
    # to, co MCP wymaga.
    UPSTREAM_HEADERS = ("content-type", "accept", "mcp-session-id", "last-event-id",
                        "x-langfuse-mcp-profile")

    def _upstream_headers(self):
        out = {}
        for k, v in self.headers.items():
            kl = k.lower()
            if kl not in self.UPSTREAM_HEADERS:
                continue
            out[k] = v
        # Kredencja upstreamu jest wstrzykiwana po stronie serwera (INJECT_BASIC)
        # i ma pierwszenstwo: token klienta (Bearer MCP) NIE jest kredencjalem
        # Langfuse - przekazanie go jako Basic dalo "Authentication failed".
        if INJECT_BASIC:
            out["Authorization"] = "Basic " + INJECT_BASIC
        else:
            auth = self.headers.get("Authorization")
            if not auth:
                return None
            if auth[:7].lower() == "bearer ":
                auth = "Basic " + auth[7:]
            out["Authorization"] = auth
        out.setdefault("Content-Type", "application/json")
        out.setdefault("Accept", "application/json, text/event-stream")
        return out

    def _call_upstream(self, path, body):
        """Proxy do upstreamu. Zwraca (status, headers, raw) albo (None, None, None).

        Odpowiedz jest dekompresowana (upstream moze odpowiedziec gzip/deflate,
        gdy klient przepusci Accept-Encoding) - naglowek Content-Encoding jest
        wtedy usuwany, bo ciało juz jest rozwiniete.
        """
        headers = self._upstream_headers()
        if headers is None:
            return None, None, None
        conn = http.client.HTTPConnection(UPSTREAM_HOST, UPSTREAM_PORT, timeout=120)
        try:
            conn.request(self.command, path, body=body, headers=headers)
            res = conn.getresponse()
            raw = res.read()
            out_headers = []
            for key, value in res.getheaders():
                if key.lower() == "content-encoding":
                    encoding = (value or "").lower().strip()
                    try:
                        if encoding == "gzip":
                            raw = gzip.decompress(raw)
                        elif encoding == "deflate":
                            try:
                                raw = zlib.decompress(raw)
                            except zlib.error:
                                raw = zlib.decompress(raw, -zlib.MAX_WBITS)
                        else:
                            out_headers.append((key, value))  # nieznane kodowanie - zostawiamy
                            continue
                    except (OSError, zlib.error):
                        out_headers.append((key, value))  # nie umielismy rozpakowac - zostawiamy
                        continue
                    continue
                out_headers.append((key, value))
            return res.status, out_headers, raw
        except Exception:  # ponytail: prosty 502 zamiast strony bledu
            return None, None, None
        finally:
            conn.close()

    # --- routing ------------------------------------------------------------
    def _proxy(self):
        split = urlsplit(self.path)
        path = split.path
        query = parse_qs(split.query)

        if path == "/health":
            snapshot = DIAGNOSTICS.snapshot(top=0)
            body = json.dumps({
                "ok": True, "service": "langfuse-mcp-shim", "version": 4,
                "contractVersion": CONTRACT_VERSION,
                "upstream": {"host": UPSTREAM_HOST, "port": UPSTREAM_PORT,
                             "catalogTools": len(catalog.tool_names()),
                             "gatewayTools": len(registry.TOOL_SPECS)},
                "calls": snapshot["calls"], "errors": snapshot["errors"],
                "profiles": snapshot["profiles"],
            }).encode("utf-8")
            self._send(200, body)
            return
        if not allowed(path):
            self._send(404, b'{"error":"not found"}')
            return

        length = int(self.headers.get("Content-Length") or 0)
        data = self.rfile.read(length) if length else None
        profile = self._profile()
        allowed_tools = self._allowed_tools()
        req = None
        if data:
            try:
                req = json.loads(data.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                req = None
                self._send(200, json.dumps({
                    "jsonrpc": "2.0", "id": None,
                    "error": {"code": -32700, "message": "MCP error -32700: request body is not valid JSON"},
                }).encode("utf-8"))
                return
        method = req.get("method") if isinstance(req, dict) else None
        _debug("request", "path=", self.path, "method=", method, "body_bytes=", len(data or b""),
               "content_length=", self.headers.get("Content-Length"),
               "transfer_encoding=", self.headers.get("Transfer-Encoding"))

        if method == "tools/call" and isinstance(req, dict):
            self._handle_tool_call(req, profile, allowed_tools)
            return
        if method == "tools/list" and isinstance(req, dict):
            self._handle_tools_list(req, profile, allowed_tools, query)
            return

        # pozostale metody (initialize, resources, ping) - czysty proxy
        status, headers, raw = self._call_upstream(self.path, data)
        if raw is None:
            self._send(502, b'{"error":"bad gateway"}')
            return
        if method == "initialize" and raw:
            raw = self._append_instructions(raw)
        self._relay(status, headers, raw)

    def _relay(self, status, headers, raw):
        self.send_response(status)
        for k, v in headers or []:
            if k.lower() in HOP | {"content-length"}:
                continue
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        try:
            self.wfile.write(raw)
        except BrokenPipeError:
            pass

    def _append_instructions(self, raw):
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return raw
        result = payload.get("result") if isinstance(payload, dict) else None
        if isinstance(result, dict) and isinstance(result.get("instructions"), str):
            result["instructions"] = result["instructions"] + GATEWAY_NOTE
        return json.dumps(payload).encode("utf-8")

    # --- tools/list ---------------------------------------------------------
    def _handle_tools_list(self, req, profile, allowed_tools, query):
        domain = (query.get("domain") or [None])[0]
        upstream_path = urlsplit(self.path).path
        rest = {k: v for k, v in query.items() if k != "domain"}
        if rest:
            upstream_path += "?" + urlencode(rest, doseq=True)
        status, headers, raw = self._call_upstream(upstream_path, json.dumps(req).encode("utf-8"))
        _debug("tools/list", "path=", upstream_path, "status=", status, "bytes=", len(raw or b""),
               "profile=", profile, "domain=", domain, "head=", (raw or b"")[:220])
        if raw is None:
            self._send(502, b'{"error":"bad gateway"}')
            return
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            _debug("tools/list -> parse fail, relay surowego")
            self._relay(status, headers, raw)
            return
        result = payload.get("result") if isinstance(payload, dict) else None
        if not isinstance(result, dict) or not isinstance(result.get("tools"), list):
            self._relay(status, headers, raw)
            return
        tools = [t for t in result["tools"]
                 if allowed_tools is None or (isinstance(t, dict) and t.get("name") in allowed_tools)]
        if domain:
            wanted = catalog.DOMAIN_ALIASES.get(domain, {domain})
            tools = [t for t in tools if isinstance(t, dict) and catalog.domain_of(t["name"]) in wanted]
        gateway_domains = {spec["name"]: spec.get("domain") for spec in registry.TOOL_SPECS}
        for spec in registry.tool_definitions(profile):
            if domain and gateway_domains.get(spec["name"]) != domain:
                continue
            tools.append(spec)
        result["tools"] = tools
        _debug("tools/list -> wysylam", len(tools), "narzedzi; parse_ok=1")
        note = PROFILE_NOTES.get(profile)
        if isinstance(result.get("instructions"), str):
            result["instructions"] = result["instructions"] + (note or "") + GATEWAY_NOTE
        self._send(200, json.dumps(payload).encode("utf-8"))

    # --- tools/call ---------------------------------------------------------
    def _handle_tool_call(self, req, profile, allowed_tools):
        rpc_id = req.get("id")
        params = req.get("params") or {}
        name = params.get("name") or ""
        arguments = params.get("arguments") or {}
        if not isinstance(arguments, dict):
            arguments = {}
        started = time.time()

        if allowed_tools is not None and name not in allowed_tools and name not in registry.TOOLS_BY_NAME:
            self._deny(name, rpc_id, profile)
            return

        # --- narzedzia gateway (lokalne) ---
        if name in registry.TOOLS_BY_NAME:
            if not profiles.gateway_visible(name, profile):
                self._deny(name, rpc_id, profile)
                return
            envelope = registry.handle(name, arguments, _gateway_context(profile))
            elapsed = (time.time() - started) * 1000
            DIAGNOSTICS.record(name, envelope.get("ok", False), elapsed,
                               code=None if envelope.get("ok") else envelope["error"]["code"],
                               profile=profile)
            self._send(200, _mcp_result(rpc_id, envelope, is_error=not envelope.get("ok", True)))
            return

        # --- narzedzia upstream ---
        schema = catalog.schema_of(name)
        gateway_args = arguments.get("gateway") if isinstance(arguments.get("gateway"), dict) else {}
        args = {k: v for k, v in arguments.items() if k != "gateway"}

        warnings = []
        args = validation.apply_defaults(schema, args)
        issues = validation.validate(schema, args) if schema else []
        effect = profiles.effect_of(name)

        if gateway_args.get("dryRun") and effect != "read":
            # dryRun: nic nie leci do upstream, a problemy z argumentami raportujemy jako ostrzezenia
            for issue in issues:
                warnings.append(f"argument '{issue['field'] or '<root>'}': {issue['message']}")
            envelope = normalize.success({"dryRun": True, "tool": name, "effect": effect,
                                           "arguments": args},
                                          tool=name,
                                          warnings=["dryRun: upstream nie zostalo wywolane"] + warnings)
            DIAGNOSTICS.record(name, True, (time.time() - started) * 1000, profile=profile)
            self._send(200, _mcp_result(rpc_id, envelope))
            return

        if issues:
            envelope = normalize.failure("INVALID_ARGUMENT",
                                          "argument validation failed: " +
                                          "; ".join(f"{i['field'] or '<root>'}: {i['message']}"
                                                    for i in issues),
                                          tool=name, details={"issues": issues})
            DIAGNOSTICS.record(name, False, (time.time() - started) * 1000, code="INVALID_ARGUMENT",
                               profile=profile)
            self._send(200, _mcp_result(rpc_id, envelope, is_error=True))
            return
        args, limit_warnings = validation.apply_limits(schema, args)
        warnings.extend(limit_warnings)

        idem_key = gateway_args.get("idempotencyKey")
        if idem_key:
            cached = IDEMPOTENCY.get(str(idem_key))
            if cached:
                envelope = cached["payload"]
                if isinstance(envelope, dict):
                    envelope.setdefault("meta", {})["idempotentReplay"] = True
                DIAGNOSTICS.record(name, True, (time.time() - started) * 1000, profile=profile)
                self._send(200, _mcp_result(rpc_id, envelope))
                return

        redact = gateway_args.get("redact")
        if redact is None:
            header = (self.headers.get(REDACT_HEADER) or "").lower()
            redact = REDACT_DEFAULT and header not in ("0", "off", "false")
        max_chars = MAX_STRING_CHARS if gateway_args.get("maxStringChars") is None \
            else int(gateway_args["maxStringChars"])

        status, headers, raw = self._call_upstream(self.path, json.dumps(
            {"jsonrpc": "2.0", "id": rpc_id, "method": "tools/call",
             "params": {"name": name, "arguments": args}}).encode("utf-8"))
        if raw is None:
            self._send(502, b'{"error":"bad gateway"}')
            return
        elapsed = (time.time() - started) * 1000

        envelope_json = next(iter(_sse_payloads(raw)), None)
        result = (envelope_json or {}).get("result") if isinstance(envelope_json, dict) else None
        if not isinstance(result, dict):
            code, message, retryable = normalize.classify_http(status or 502, raw[:400])
            failure = normalize.failure(code, message or "upstream returned no result", tool=name,
                                        retryable=retryable, details={"httpStatus": status})
            DIAGNOSTICS.record(name, False, elapsed, code=code, profile=profile)
            self._send(200, _mcp_result(rpc_id, failure, is_error=True))
            return

        if result.get("isError"):
            payload = _payload_of(result)
            message = payload if isinstance(payload, str) else json.dumps(payload)[:300]
            failure = normalize.failure("UPSTREAM_ERROR", message, tool=name, retryable=True,
                                        details={"httpStatus": status})
            DIAGNOSTICS.record(name, False, elapsed, code="UPSTREAM_ERROR", profile=profile)
            self._send(200, _mcp_result(rpc_id, failure, is_error=True))
            return

        payload = _payload_of(result)
        redactions = 0
        if isinstance(payload, dict):
            payload, redactions = normalize.redact(payload, max_chars=max_chars, enabled=bool(redact))
            if redactions:
                warnings.append(f"{redactions} secret(s) masked")
        if len(raw) > MAX_BYTES:
            failure = normalize.failure("TOO_LARGE",
                                        f"response of {len(raw)} bytes exceeds the gateway limit "
                                        f"({MAX_BYTES}); narrow the query (limit/filters/fields)",
                                        tool=name, details={"bytes": len(raw), "limit": MAX_BYTES})
            DIAGNOSTICS.record(name, False, elapsed, code="TOO_LARGE", profile=profile)
            self._send(200, _mcp_result(rpc_id, failure, is_error=True))
            return

        if isinstance(payload, dict):
            payload["gateway"] = {
                "contractVersion": CONTRACT_VERSION,
                "tool": name,
                "profile": profile,
                "effect": effect,
                "elapsedMs": round(elapsed, 2),
                "redactions": redactions,
                "warnings": warnings,
                "upstreamStatus": status,
                "pagination": normalize.pagination_info(payload.get("meta")),
            }
            if name == "getMetricsSchema":
                summary = _summarize_metrics_schema(payload)
                if summary:
                    payload["summary"] = summary
            if name == "getHealth":
                payload["components"] = self._health_components()
            payload["ok"] = True
            payload["tool"] = name
            payload["warnings"] = warnings

        if idem_key:
            IDEMPOTENCY.put(str(idem_key), payload if isinstance(payload, dict)
                             else {"ok": True, "tool": name, "data": payload})
        if name in READBACK and isinstance(payload, dict):
            readback = self._readback(name, payload)
            if readback:
                payload.setdefault("gateway", {})["readback"] = readback
        DIAGNOSTICS.record(name, True, elapsed, profile=profile)
        self._send(200, _mcp_result(rpc_id, payload if isinstance(payload, dict)
                                    else {"ok": True, "tool": name, "data": payload,
                                          "meta": {}, "warnings": warnings}))

    def _health_components(self):
        snapshot = DIAGNOSTICS.snapshot(top=0)
        return {"gateway": {"status": "OK", "calls": snapshot["calls"],
                            "errorRate": snapshot["errorRate"],
                            "p95Ms": snapshot["latencyMs"]["p95"]},
                "catalog": {"status": "OK" if catalog.TOOLS else "DEGRADED",
                            "tools": len(catalog.tool_names())}}

    def _readback(self, name, payload):
        """Po zapisie odczytujemy obiekt, zeby klient widzial stan po operacji."""
        getter, id_param = READBACK[name]
        data = payload.get("data") if isinstance(payload, dict) else None
        identifier = None
        for source in (data, payload):
            if isinstance(source, dict):
                for field in ID_FIELDS:
                    if source.get(field):
                        identifier = source[field]
                        break
            if identifier:
                break
        if not identifier:
            return None
        ok, readback = UPSTREAM.mcp_call(getter, {id_param: identifier})
        if not ok:
            return {"tool": getter, "status": "failed"}
        return {"tool": getter, "status": "ok", "data": readback}

    do_GET = _proxy
    do_POST = _proxy
    do_DELETE = _proxy
    do_OPTIONS = _proxy
    do_PUT = _proxy
    do_PATCH = _proxy

    def log_message(self, format, *args):  # noqa: A002 - sygnatura stdlib
        pass


if __name__ == "__main__":
    port = int(os.environ.get("LANGFUSE_MCP_PORT", "8080"))
    ThreadingHTTPServer(("0.0.0.0", port), H).serve_forever()
