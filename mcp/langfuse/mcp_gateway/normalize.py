"""Jednolity kontrakt wynikow i bledow, redakcja danych wrazliwych, metadane paginacji.

Envelope (uzywany przez narzedzia gateway i przez wrappery narzedzi upstream):

    {"ok": true,  "tool": "...", "data": ..., "meta": {...}, "warnings": [...]}
    {"ok": false, "tool": "...", "error": {"code", "message", "retryable", "details"},
     "meta": {}, "warnings": [...]}
"""
import json
import re

RETRYABLE = {
    "INVALID_ARGUMENT": False, "MISSING_ARGUMENT": False, "UNKNOWN_ARGUMENT": False,
    "INVALID_TYPE": False, "INVALID_ENUM": False, "OUT_OF_RANGE": False,
    "INVALID_DATETIME": False, "UNAUTHORIZED": False, "FORBIDDEN": False,
    "NOT_FOUND": False, "CONFLICT": False, "UNSUPPORTED": False, "TOO_LARGE": False,
    "RATE_LIMITED": True, "UPSTREAM_ERROR": True, "TIMEOUT": True, "INTERNAL": True,
}

_SECRET_PATTERNS = [
    (re.compile(r"sk-[A-Za-z0-9_\-]{10,}"), "sk-***"),
    (re.compile(r"pk-lf-[A-Za-z0-9_\-]{10,}"), "pk-lf-***"),
    (re.compile(r"gh[pousr]_[A-Za-z0-9]{16,}"), "gh*_***"),
    (re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._\-]{12,}"), "Bearer ***"),
    (re.compile(r"eyJ[A-Za-z0-9_\-]{5,}\.[A-Za-z0-9_\-]{3,}\.[A-Za-z0-9_\-]{3,}"), "***JWT***"),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
     "***PRIVATE KEY***"),
    (re.compile(r"(?i)((?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)"
                r"[\"']?\s*[:=]\s*[\"']?)([^\s\"',;]{6,})"), r"\1***"),
]

# klucze, ktorych wartosc jest z definicji poufna (niezaleznie od formatu)
SENSITIVE_KEYS = frozenset({
    "password", "passwd", "secret", "apikey", "api_key", "api-key", "token", "accesstoken",
    "access_token", "refreshtoken", "refresh_token", "authorization", "privatekey", "private_key",
    "clientsecret", "client_secret", "session_token", "cookie",
})


def success(data, tool=None, meta=None, warnings=None):
    return {"ok": True, "tool": tool, "data": data, "meta": meta or {}, "warnings": list(warnings or [])}


def failure(code, message, tool=None, retryable=None, details=None):
    return {"ok": False, "tool": tool,
            "error": {"code": code, "message": message,
                      "retryable": RETRYABLE.get(code, False) if retryable is None else retryable,
                      "details": details or {}},
            "meta": {}, "warnings": []}


def _upstream_message(body):
    if not body:
        return ""
    try:
        payload = body if isinstance(body, dict) else json.loads(body)
    except (ValueError, TypeError):
        return str(body)[:300]
    if isinstance(payload, dict):
        for key in ("message", "error", "detail"):
            value = payload.get(key)
            if isinstance(value, str) and value:
                return value[:300]
    return ""


def classify_http(status, body=None):
    """HTTP status upstream -> (code, message, retryable)."""
    message = _upstream_message(body)
    if status == 400 or status == 422:
        return "INVALID_ARGUMENT", message or "upstream rejected the arguments", False
    if status == 401:
        return "UNAUTHORIZED", message or "upstream rejected the credentials", False
    if status == 403:
        return "FORBIDDEN", message or "forbidden by upstream", False
    if status == 404:
        return "NOT_FOUND", message or "resource not found", False
    if status == 409:
        return "CONFLICT", message or "conflict", False
    if status == 429:
        return "RATE_LIMITED", message or "rate limited by upstream", True
    if status >= 500:
        return "UPSTREAM_ERROR", message or f"upstream error {status}", True
    return "UPSTREAM_ERROR", message or f"unexpected upstream status {status}", False


def redact_text(text, max_chars=2000):
    """Masksuje sekrety i skraca dlugie napisy. Zwraca (tekst, liczba zamaskowanych)."""
    count = 0
    for pattern, replacement in _SECRET_PATTERNS:
        text, hits = pattern.subn(replacement, text)
        count += hits
    if max_chars and len(text) > max_chars:
        text = text[:max_chars] + f"...[truncated {len(text) - max_chars} chars]"
    return text, count


def redact(obj, max_chars=2000, enabled=True):
    """Rekurencyjna redakcja. Zwraca (obj, liczba zamaskowanych sekretow)."""
    if not enabled:
        return obj, 0
    count = 0
    if isinstance(obj, dict):
        out = {}
        for key, value in obj.items():
            if isinstance(key, str) and key.lower().replace("-", "_") in SENSITIVE_KEYS \
                    and isinstance(value, (str, int, float)) and str(value):
                out[key] = "***"
                count += 1
                continue
            new, hits = redact(value, max_chars, enabled)
            out[key] = new
            count += hits
        return out, count
    if isinstance(obj, list):
        out = []
        for value in obj:
            new, hits = redact(value, max_chars, enabled)
            out.append(new)
            count += hits
        return out, count
    if isinstance(obj, str):
        new, hits = redact_text(obj, max_chars)
        return new, hits
    return obj, 0


def pagination_info(meta):
    """Normalizuje metadane paginacji upstream do jednego ksztaltu."""
    if not isinstance(meta, dict):
        return {"mode": "none"}
    if "cursor" in meta:
        cursor = meta.get("cursor")
        return {"mode": "cursor", "cursor": cursor, "hasMore": bool(cursor)}
    if "page" in meta or "totalItems" in meta:
        page = int(meta.get("page") or 1)
        limit = int(meta.get("limit") or 0)
        total = int(meta.get("totalItems") or 0)
        return {"mode": "page", "page": page, "limit": limit, "totalItems": total,
                "totalPages": meta.get("totalPages"), "hasMore": bool(limit and page * limit < total)}
    return {"mode": "none"}


def truncate_text(text, max_bytes):
    """Przecina odpowiedz do limitu bajtow. Zwraca (tekst, przekroczono?)."""
    if not max_bytes or len(text) <= max_bytes:
        return text, False
    head = text[:max_bytes].encode("utf-8")[:max_bytes].decode("utf-8", "ignore")
    return head + f'...["truncated":true,"bytes":{len(text)}]', True
