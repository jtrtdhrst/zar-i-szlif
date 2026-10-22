"""Natywne LLM Connections Langfuse (odczyt + upsert).

Zrodlo: `/api/public/llm-connections` (GET/PUT/DELETE) - natywny API Langfuse 4.33.0.
Sprawdzone na serwerze 4.33.0: GET -> 200, PUT -> 201 (wymaga provider/adapter/
secretKey), DELETE -> 404 dla nieznajomego id. POST nie jest metoda upsertu
(405) - dlatego wczesniejszy wniosek o "braku API" byl bledny.

Sekretow nie ujawniamy: odpowiedzi zapisu czytamy bez `secretKey`, a w odczycie
zwracamy tylko pola, ktore serer udostepnia bez sekretow (`displaySecretKey` jest
ze strony serwera zamaskowane).
"""
from __future__ import annotations

from .normalize import failure, success

TOOL_GET = "getLlmConnections"
TOOL_UPSERT = "upsertLlmConnection"

PATH = "/api/public/llm-connections"

#: Adaptery akceptowane przez natywne API (enum z odpowiedzi walidacji serwera).
ADAPTERS = ("anthropic", "openai", "azure", "bedrock", "google-vertex-ai", "google-ai-studio")

#: Pola, ktorych nigdy nie zwracamy w odpowiedzi MCP.
SECRET_FIELDS = ("secretKey", "apiKey", "secret_key", "api_key")


def _connection(entry):
    """Pojedyncze polaczenie w ksztalcie bez sekretow."""
    if not isinstance(entry, dict):
        return {}
    return {
        "id": entry.get("id"),
        "provider": entry.get("provider"),
        "adapter": entry.get("adapter"),
        "baseURL": entry.get("baseURL"),
        "displaySecretKey": entry.get("displaySecretKey"),
        "customModels": entry.get("customModels"),
        "withDefaultModels": entry.get("withDefaultModels"),
        "extraHeaderKeys": entry.get("extraHeaderKeys"),
        "config": entry.get("config"),
        "createdAt": entry.get("createdAt"),
        "updatedAt": entry.get("updatedAt"),
    }


def get_llm_connections(args, ctx):
    """Lista natywnych polaczen LLM Langfuse (bez wartosci sekretow)."""
    params = {"page": int(args.get("page") or 1), "limit": int(args.get("limit") or 50)}
    try:
        payload = ctx["upstream"].rest_get(PATH, params=params)
    except Exception as exc:  # noqa: BLE001
        code = getattr(exc, "code", "UPSTREAM_ERROR")
        return failure(code, str(exc), tool=TOOL_GET)
    data = (payload or {}).get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        data = []
    meta = (payload or {}).get("meta") if isinstance(payload, dict) else {}
    return success({
        "connections": [_connection(entry) for entry in data],
        "count": len(data),
        "pagination": {"mode": "page", "page": meta.get("page", params["page"]),
                       "limit": meta.get("limit", params["limit"]),
                       "totalItems": meta.get("totalItems")},
        "secretsExposed": False,
        "interface": "PUBLIC_API",
    }, tool=TOOL_GET)


def upsert_llm_connection(args, ctx):
    """Tworzy lub aktualizuje natywne polaczenie LLM (PUT /api/public/llm-connections)."""
    adapter = args.get("adapter")
    if adapter and adapter not in ADAPTERS:
        return failure("INVALID_ARGUMENT",
                       "unsupported adapter '%s'; native API accepts: %s"
                       % (adapter, ", ".join(ADAPTERS)), tool=TOOL_UPSERT,
                       details={"adapters": list(ADAPTERS)})
    for required in ("provider", "adapter", "secretKey"):
        if not args.get(required):
            return failure("INVALID_ARGUMENT", "'%s' is required by the native API" % required,
                           tool=TOOL_UPSERT,
                           details={"required": ["provider", "adapter", "secretKey"]})

    # Ochrona polaczen produkcyjnych: nadpisujemy tylko na wyraźne żądanie.
    existing_ids = []
    if not args.get("id"):
        try:
            payload = ctx["upstream"].rest_get(PATH, params={"page": 1, "limit": 100})
        except Exception:  # noqa: BLE001 - brak odczytu nie blokuje tworzenia
            payload = {}
        for entry in ((payload or {}).get("data") or []):
            if isinstance(entry, dict) and entry.get("provider") == args.get("provider"):
                existing_ids.append(entry.get("id"))
        if existing_ids and not args.get("allowOverwrite"):
            return failure("CONFLICT",
                           "connection for provider '%s' already exists (%s); "
                           "pass allowOverwrite=true to replace it"
                           % (args.get("provider"), ", ".join(str(i) for i in existing_ids)),
                           tool=TOOL_UPSERT, details={"existingIds": existing_ids})

    body = {
        "provider": args.get("provider"),
        "adapter": args.get("adapter"),
        "secretKey": args.get("secretKey"),
    }
    for key in ("name", "baseURL", "baseUrl", "model", "customModels",
                "withDefaultModels", "extraHeaderKeys", "config"):
        if args.get(key) is not None:
            body[key] = args.get(key)
    if args.get("id"):
        body["id"] = args.get("id")

    try:
        created = ctx["upstream"].rest_request("PUT", PATH, body=body)
    except Exception as exc:  # noqa: BLE001
        code = getattr(exc, "code", "UPSTREAM_ERROR")
        details = getattr(exc, "details", None) or {}
        return failure(code, str(exc), tool=TOOL_UPSERT, details=details)
    return success({
        "connection": _connection(created),
        "secretsExposed": False,
        "interface": "PUBLIC_API",
    }, tool=TOOL_UPSERT)
