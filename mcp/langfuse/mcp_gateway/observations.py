"""Read projections over native Langfuse observations (Observations API v2).

`getTraceTree` i `getSessionTimeline` to cienkie widoki istniejacych rekordow
Langfuse - nie nowy system trace'ow. Zrodlo danych:

  * `listObservations` (natywne MCP Langfuse -> Observations API v2) dla drzewa
    trace'a: filtr traceId, selektywne pola, paginacja cursor,
  * `GET /api/public/v2/observations?sessionId=...` dla osi czasu sesji
    (natywny endpoint REST v2, filtr sessionId),
  * `listScores` (natywne MCP Langfuse) dla score'ow powiazanych z obserwacjami.

Uzupelnienie brakujacych score'ow, kosztu albo tresci jest zawsze oznaczone
jako niedostepne - nigdy nie wymyslamy wartosci.
"""
from __future__ import annotations

import os

from . import traces
from .normalize import failure, success

TOOL_TREE = "getTraceTree"
TOOL_SESSION = "getSessionTimeline"

#: Pola zawsze obecne w projekcji (natywny zestaw domyslny + kontekst wykonania).
BASE_FIELDS = [
    "id", "traceId", "startTime", "endTime", "parentObservationId", "type", "name",
    "level", "statusMessage", "isRootObservation", "providedModelName", "latency",
    "environment", "version", "release", "timeToFirstToken", "completionStartTime",
    "userId", "sessionId", "internalModelId", "usageDetails", "costDetails", "totalCost",
    "promptId", "promptName", "promptVersion", "usagePricingTierId", "usagePricingTierName",
]

#: Pola kosztowne/wrazliwe - tylko na wyraźne żądanie.
CONTENT_FIELDS = ["input", "output", "metadata", "modelParameters"]

PUBLIC_URL_ENV = "LANGFUSE_MCP_PUBLIC_URL"
DEFAULT_PUBLIC_URL = "https://langfuse.kompaszbiorek.pl"


def public_base_url():
    return (os.environ.get(PUBLIC_URL_ENV) or DEFAULT_PUBLIC_URL).rstrip("/")


def observation_url(project_id, trace_id, observation_id):
    """Natywny link Langfuse do obserwacji."""
    return "%s/project/%s/traces/%s?observation=%s" % (
        public_base_url(), project_id, trace_id, observation_id)


def trace_url(project_id, trace_id):
    return "%s/project/%s/traces/%s" % (public_base_url(), project_id, trace_id)


def project_from_url(url):
    """Id projektu z natywnego URL-a obserwacji (`/project/<id>/traces/...`)."""
    if not url or "/project/" not in url:
        return None
    return url.split("/project/", 1)[1].split("/", 1)[0]


def trace_url_from_observation_url(url):
    """Link do trace'a wyprowadzony z natywnego URL-a obserwacji."""
    if not url:
        return None
    return url.split("?", 1)[0]


def _scores_by_observation(ctx, trace_id, limit=100):
    """Score'y trace'a z natywnego `listScores`, zgrupowane po obserwacji."""
    items, pagination = ctx["upstream"].paginate(
        "listScores", {"traceId": [trace_id], "limit": limit}, max_pages=10)
    by_observation = {}
    for score in (items or []):
        subject = score.get("subject") or {}
        observation_id = subject.get("id")
        if not observation_id:
            continue
        metadata = score.get("metadata") or {}
        by_observation.setdefault(observation_id, []).append({
            "id": score.get("id"),
            "name": score.get("name"),
            "value": score.get("value"),
            "stringValue": score.get("stringValue"),
            "dataType": score.get("dataType"),
            "source": score.get("source"),
            "comment": score.get("comment"),
            "configId": score.get("configId"),
            "queueId": score.get("queueId"),
            "url": score.get("url"),
            "evaluatorId": metadata.get("evaluator_id"),
            "evaluatorVersionId": metadata.get("evaluator_version_id"),
            "evaluationRuleId": metadata.get("evaluation_rule_id"),
        })
    return by_observation, pagination


def _attach(nodes, scores, include_content):
    """Dopisuje score'y i (opcjonalnie) tresc do wezlow drzewa."""
    for node in nodes:
        node["scores"] = scores.get(node.get("id"), [])
        if include_content:
            node.setdefault("input", None)
            node.setdefault("output", None)
        _attach(node.get("children") or [], scores, include_content)
    return nodes


def trace_tree(args, ctx):
    """Calkowite drzewo wykonania jednego trace'a (Observations API v2 + score'y)."""
    trace_id = args.get("traceId")
    if not trace_id:
        return failure("INVALID_ARGUMENT", "traceId is required", tool=TOOL_TREE)
    include_content = bool(args.get("includeContent"))
    fields = list(BASE_FIELDS)
    if include_content:
        fields += CONTENT_FIELDS
    requested = args.get("fields")
    if requested:
        fields = [name for name in fields if name in requested] or list(requested)

    limit = int(args.get("limit") or 100)
    items, pagination = ctx["upstream"].paginate(
        "listObservations", {"traceId": trace_id, "fields": fields, "limit": limit},
        max_pages=int(args.get("maxPages") or 25))
    if items is None:
        error = (pagination or {}).get("error") or {}
        return failure(error.get("code", "UPSTREAM_ERROR"),
                       error.get("message", "listObservations failed"),
                       tool=TOOL_TREE, details={"traceId": trace_id})

    observations = [item for item in items if isinstance(item, dict) and item.get("id")]
    project_id = next((item.get("projectId") for item in observations if item.get("projectId")), None)
    if not project_id:
        # API nie probuje wrażliwego pola projectId - bierzemy je z natywnego URL-a.
        project_id = next((project_from_url(item.get("url")) for item in observations
                           if project_from_url(item.get("url"))), None)
    scores, score_pagination = _scores_by_observation(ctx, trace_id)

    roots = traces.build_tree(observations)
    _attach(roots, scores, include_content)
    summary = traces.summarize(observations)
    summary["rootCount"] = len(roots)
    summary["scoreCount"] = sum(len(entries) for entries in scores.values())

    trace_link = next((trace_url_from_observation_url(item.get("url")) for item in observations
                       if trace_url_from_observation_url(item.get("url"))), None)
    if not trace_link and project_id:
        trace_link = trace_url(project_id, trace_id)

    return success({
        "traceId": trace_id,
        "projectId": project_id,
        "found": bool(observations),
        "note": None if observations else
                "brak obserwacji dla tego trace'a w natywnym API (trace nieznany albo "
                "jeszcze nie zmaterializowany)",
        "tree": roots,
        "summary": summary,
        "observationCount": len(observations),
        "scores": scores,
        "url": trace_link,
        "fields": fields,
        "includeContent": include_content,
        "pagination": {
            "observations": pagination,
            "scores": score_pagination,
            "complete": bool(pagination.get("complete")) and bool(score_pagination.get("complete")),
        },
        "interface": "PUBLIC_API",
    }, tool=TOOL_TREE,
        meta={"pagination": {"mode": "cursor", "fetched": len(observations),
                             "complete": bool(pagination.get("complete"))}})


def session_timeline(args, ctx):
    """Osa czasu sesji: obserwacje w grupowaniu po trace (Observations API v2)."""
    session_id = args.get("sessionId")
    if not session_id:
        return failure("INVALID_ARGUMENT", "sessionId is required", tool=TOOL_SESSION)
    limit = int(args.get("limit") or 100)
    params = {"sessionId": session_id, "limit": limit}
    if args.get("fromStartTime"):
        params["fromStartTime"] = args["fromStartTime"]
    if args.get("toStartTime"):
        params["toStartTime"] = args["toStartTime"]

    observations = []
    cursor = None
    pages = 0
    complete = False
    max_pages = int(args.get("maxPages") or 25)
    while pages < max_pages:
        page_params = dict(params)
        if cursor:
            page_params["cursor"] = cursor
        try:
            payload = ctx["upstream"].rest_get("/api/public/v2/observations", params=page_params)
        except Exception as exc:  # noqa: BLE001 - upstream error semantics
            code = getattr(exc, "code", "UPSTREAM_ERROR")
            return failure(code, str(exc), tool=TOOL_SESSION, details={"sessionId": session_id})
        pages += 1
        data = payload.get("data") if isinstance(payload, dict) else None
        if isinstance(data, list):
            observations.extend(data)
        meta = (payload.get("meta") or {}) if isinstance(payload, dict) else {}
        cursor = meta.get("cursor")
        if not cursor:
            complete = True
            break

    project_id = next((item.get("projectId") for item in observations if item.get("projectId")), None)
    traces_by_id = {}
    for observation in observations:
        trace_id = observation.get("traceId")
        if not trace_id:
            continue
        entry = traces_by_id.setdefault(trace_id, {
            "traceId": trace_id,
            "url": trace_url(project_id, trace_id) if project_id else None,
            "observations": [],
            "startTime": observation.get("startTime"),
            "endTime": observation.get("endTime"),
        })
        entry["observations"].append({
            "id": observation.get("id"),
            "parentObservationId": observation.get("parentObservationId"),
            "name": observation.get("name"),
            "type": observation.get("type"),
            "level": observation.get("level"),
            "statusMessage": observation.get("statusMessage"),
            "startTime": observation.get("startTime"),
            "endTime": observation.get("endTime"),
            "latency": observation.get("latency"),
            "timeToFirstToken": observation.get("timeToFirstToken"),
            "userId": observation.get("userId"),
            "environment": observation.get("environment"),
            "providedModelName": observation.get("providedModelName"),
            "isRootObservation": observation.get("isRootObservation"),
            "url": observation_url(project_id, trace_id, observation.get("id")),
        })
        if observation.get("startTime") and (not entry["startTime"]
                                             or observation["startTime"] < entry["startTime"]):
            entry["startTime"] = observation["startTime"]
        if observation.get("endTime") and (not entry["endTime"]
                                           or observation["endTime"] > entry["endTime"]):
            entry["endTime"] = observation["endTime"]

    for entry in traces_by_id.values():
        entry["observations"].sort(key=lambda item: (str(item.get("startTime") or ""),
                                                     str(item.get("id") or "")))
    timeline = sorted(traces_by_id.values(),
                      key=lambda entry: (str(entry.get("startTime") or ""), str(entry.get("traceId"))))

    return success({
        "sessionId": session_id,
        "projectId": project_id,
        "found": bool(observations),
        "note": None if observations else
                "brak obserwacji dla tej sesji w natywnym API (sesja nieznana albo "
                "jeszcze nie zmaterializowana)",
        "traceCount": len(timeline),
        "observationCount": len(observations),
        "timeline": timeline,
        "pagination": {"mode": "cursor", "pages": pages, "fetched": len(observations),
                       "complete": complete, "cursor": cursor},
        "interface": "PUBLIC_API",
    }, tool=TOOL_SESSION,
        meta={"pagination": {"mode": "cursor", "fetched": len(observations), "complete": complete}})
