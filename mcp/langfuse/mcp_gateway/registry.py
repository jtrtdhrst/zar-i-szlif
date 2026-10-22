"""Narzedia syntetyczne gateway: analityka wysokiego poziomu, trace, diagnostyka.

Dodawane do `tools/list` obok 85 narzedzi upstream. Wszystkie zwracaja
jednolity envelope (ok/data/meta/warnings albo ok/error).
"""
import datetime

from . import analytics, catalog, experiments, llm_connections, observations, profiles, traces
from .normalize import failure, success

CONTRACT_VERSION = "1.0.0"

QUERY_PROPERTIES = {
    "view": {"type": "string", "enum": ["observations", "scores-numeric", "scores-categorical", "scores-boolean"]},
    "dimensions": {"type": "array", "items": {"type": "object"}},
    "metrics": {"type": "array", "items": {"type": "object"}},
    "filters": {"type": "array", "items": {"type": "object"}},
    "timeDimension": {"type": "object"},
    "fromTimestamp": {"type": "string"},
    "toTimestamp": {"type": "string"},
    "config": {"type": "object"},
}

QUERY_SCHEMA = {"type": "object", "properties": QUERY_PROPERTIES, "required": ["view", "metrics"],
                "additionalProperties": False}

PRESETS = {
    "cost_by_model": {"dimensions": [{"field": "providedModelName"}],
                      "metrics": [{"measure": "totalCost", "aggregation": "sum"}],
                      "timeDimension": {"granularity": "day"}},
    "tokens_by_model": {"dimensions": [{"field": "providedModelName"}],
                        "metrics": [{"measure": "totalTokens", "aggregation": "sum"}],
                        "timeDimension": {"granularity": "day"}},
    "latency_by_type": {"dimensions": [{"field": "type"}],
                        "metrics": [{"measure": "latency", "aggregation": "avg"}],
                        "timeDimension": {"granularity": "day"}},
    "errors_by_type": {"dimensions": [{"field": "type"}],
                       "metrics": [{"measure": "count", "aggregation": "count"}],
                       "filters": [{"column": "level", "operator": "=", "value": "ERROR", "type": "string"}],
                       "timeDimension": {"granularity": "day"}},
    "volume_by_hour": {"dimensions": [],
                       "metrics": [{"measure": "count", "aggregation": "count"}],
                       "timeDimension": {"granularity": "hour"}},
    "score_by_name": {"dimensions": [{"field": "name"}],
                      "metrics": [{"measure": "value", "aggregation": "avg"}],
                      "timeDimension": {"granularity": "day"}},
}
PRESET_VIEWS = {"score_by_name": "scores-numeric"}


def _iso(moment):
    return moment.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _query_schema_with(extra=None, required=None):
    props = dict(QUERY_PROPERTIES)
    props.update(extra or {})
    return {"type": "object", "properties": props, "required": required or [], "additionalProperties": False}


def _fetch_factory(ctx):
    upstream = ctx["upstream"]

    def fetch(trace_id):
        return upstream.list_observations(trace_id=trace_id)
    return fetch


# --- handlery ---------------------------------------------------------------

def _trace_tree(args, ctx):
    return observations.trace_tree(args, ctx)


def _session_timeline(args, ctx):
    return observations.session_timeline(args, ctx)


def _get_llm_connections(args, ctx):
    return llm_connections.get_llm_connections(args, ctx)


def _upsert_llm_connection(args, ctx):
    return llm_connections.upsert_llm_connection(args, ctx)


def _trace_summary(args, ctx):
    trace_id = args.get("traceId")
    observations = ctx["upstream"].list_observations(trace_id=trace_id)
    return success({"traceId": trace_id, "summary": traces.summarize(observations)},
                   tool="getTraceSummary")


def _trace_critical_path(args, ctx):
    trace_id = args.get("traceId")
    observations = ctx["upstream"].list_observations(trace_id=trace_id)
    return success({"traceId": trace_id, "criticalPath": traces.critical_path(observations),
                    "summary": traces.summarize(observations)},
                   tool="getTraceCriticalPath")


def _trace_errors(args, ctx):
    trace_id = args.get("traceId")
    observations = ctx["upstream"].list_observations(trace_id=trace_id)
    return success({"traceId": trace_id, "errors": traces.find_errors(observations),
                    "errorCount": len(traces.find_errors(observations))},
                   tool="getTraceErrors")


def _compare_traces(args, ctx):
    trace_ids = args.get("traceIds") or []
    result = traces.compare_traces(trace_ids, _fetch_factory(ctx))
    return success(result, tool="compareTraces")


def _compare_metrics(args, ctx):
    run = ctx["upstream"].query_metrics
    labels = tuple(args.get("labels") or ("a", "b"))
    result = analytics.compare_metrics(run, args.get("a") or {}, args.get("b") or {}, labels=labels)
    return success(result, tool="compareMetrics")


def _usage_breakdown(args, ctx):
    run = ctx["upstream"].query_metrics
    result = analytics.usage_breakdown(run, args.get("query") or {}, args.get("dimension") or "type",
                                        limit=int(args.get("limit") or 20))
    return success(result, tool="getUsageBreakdown")


def _detect_anomalies(args, ctx):
    run = ctx["upstream"].query_metrics
    result = analytics.detect_anomalies(run, args.get("query") or {},
                                         sensitivity=float(args.get("sensitivity") or 2.0),
                                         min_points=int(args.get("minPoints") or 5))
    return success(result, tool="detectAnomalies")


def _query_metrics_preset(args, ctx):
    preset = args.get("preset")
    if preset not in PRESETS:
        return failure("INVALID_ARGUMENT", f"unknown preset '{preset}'; available: {sorted(PRESETS)}",
                       tool="queryMetricsPreset", details={"presets": sorted(PRESETS)})
    hours = int(args.get("hours") or 24)
    now = datetime.datetime.now(datetime.timezone.utc)
    query = dict(PRESETS[preset])
    query["view"] = PRESET_VIEWS.get(preset, "observations")
    query["filters"] = query.get("filters") or []
    query["fromTimestamp"] = _iso(now - datetime.timedelta(hours=hours))
    query["toTimestamp"] = _iso(now)
    if args.get("granularity"):
        query["timeDimension"] = {"granularity": args["granularity"]}
    payload = ctx["upstream"].query_metrics(query)
    return success({"preset": preset, "query": query, "result": payload},
                   tool="queryMetricsPreset")


def _describe_metric(args, ctx):
    view = args.get("view") or "observations"
    measure = args.get("measure")
    schema = ctx["upstream"].metrics_schema(view)
    views = schema.get("views") or {}
    measures = (views.get(view) or {}).get("measures") or {}
    if measure not in measures:
        return failure("NOT_FOUND", f"measure '{measure}' not available in view '{view}'",
                       tool="describeMetric", details={"available": sorted(measures)[:50]})
    entry = measures[measure]
    return success({"view": view, "measure": measure, "definition": entry,
                    "availableMeasures": sorted(measures)[:200]},
                   tool="describeMetric")


def _describe_tool(args, ctx):
    name = args.get("name")
    if name not in catalog.tool_names():
        return failure("NOT_FOUND", f"unknown tool '{name}'", tool="describeTool")
    return success({"name": name, "domain": catalog.domain_of(name),
                    "effect": ctx["effect_of"](name), "description": catalog.description_of(name),
                    "inputSchema": catalog.schema_of(name),
                    "profiles": ctx["profiles_for"](name)},
                   tool="describeTool")


def _list_tool_domains(args, ctx):
    domains = {domain: sorted(names) for domain, names in sorted(catalog.DOMAINS.items())}
    gateway_tools = sorted(spec["name"] for spec in TOOL_SPECS)
    return success({"domains": domains, "domainCount": len(domains),
                    "upstreamToolCount": len(catalog.tool_names()),
                    "gatewayTools": gateway_tools},
                   tool="listToolDomains")


def _get_mcp_health(args, ctx):
    components = {}
    upstream_ok, upstream_payload = True, {}
    try:
        upstream_payload = ctx["upstream"].health()
    except Exception as exc:  # noqa: BLE001 - raportujemy stan, nie wywalamy calego health
        upstream_ok, upstream_payload = False, {"error": str(exc)}
    components["upstream"] = {"status": "OK" if upstream_ok else "DOWN",
                              "version": upstream_payload.get("version"),
                              "detail": upstream_payload.get("error")}
    db_ok, db_payload = True, {}
    try:
        db_ok, db_payload = ctx["upstream"].mcp_call(
            "getHealth", {"failIfDatabaseUnavailable": True, "failIfNoRecentEvents": False})
    except Exception as exc:  # noqa: BLE001
        db_ok, db_payload = False, {"error": str(exc)}
    components["database"] = {"status": "OK" if db_ok else "DOWN",
                              "detail": (db_payload.get("error") or {}).get("message") if not db_ok else None}
    snapshot = ctx["diagnostics"].snapshot()
    components["gateway"] = {"status": "OK", "calls": snapshot["calls"],
                             "errorRate": snapshot["errorRate"], "p95Ms": snapshot["latencyMs"]["p95"],
                             "uptimeSec": snapshot["uptimeSec"]}
    components["catalog"] = {"status": "OK" if catalog.TOOLS else "DEGRADED",
                             "tools": len(catalog.tool_names())}
    components["idempotency"] = {"status": "OK", "entries": ctx["idempotency"].size()}
    statuses = [c.get("status") for c in components.values()]
    status = "OK" if all(s == "OK" for s in statuses) else ("DEGRADED" if "DOWN" not in statuses else "DOWN")
    return success({"status": status, "components": components}, tool="getMcpHealth",
                   meta={"contractVersion": CONTRACT_VERSION})


def _get_mcp_diagnostics(args, ctx):
    snapshot = ctx["diagnostics"].snapshot()
    upstream_version = None
    try:
        upstream_version = (ctx["upstream"].health() or {}).get("version")
    except Exception:  # noqa: BLE001
        upstream_version = None
    snapshot.update({
        "contractVersion": CONTRACT_VERSION,
        "upstreamVersion": upstream_version,
        "catalogTools": len(catalog.tool_names()),
        "idempotencyEntries": ctx["idempotency"].size(),
        "generatedAt": _iso(datetime.datetime.now(datetime.timezone.utc)),
    })
    return success(snapshot, tool="getMcpDiagnostics")


# --- eksperymenty (OFFICIAL_SDK + PUBLIC_API) --------------------------------

def _run_prompt_experiment(args, ctx):
    return experiments.run_prompt_experiment(args, ctx)


def _experiment_status(args, ctx):
    return experiments.experiment_status(args, ctx)


def _compare_experiments(args, ctx):
    return experiments.compare_experiments(args, ctx)


def _regression_results(args, ctx):
    return experiments.regression_results(args, ctx)


def _evaluator_versions(args, ctx):
    return experiments.evaluator_versions(args, ctx)


EXPERIMENT_FIELDS = {"type": "array",
                     "items": {"type": "string",
                               "enum": ["core", "metadata", "scores", "dataset", "io",
                                        "itemMetadata", "experimentMetadata"]}}

# --- katalog narzedzi gateway ----------------------------------------------

TOOL_SPECS = [
    {"name": "getTraceTree", "domain": "traces",
     "description": "PUBLIC_API: pelne drzewo wykonania trace'a z natywnego Observations API v2 "
                    "(kroki agenta, wywolania narzedzi, input/output na zadanie, relacje "
                    "rodzic-dziecko, bledy, czasy, tokeny, koszt, prompt i wersja promptu, "
                    "score'y, natywne linki). Zglasza, czy paginacja zostala zakonczona.",
     "inputSchema": {"type": "object", "properties": {
         "traceId": {"type": "string"},
         "includeContent": {"type": "boolean"},
         "fields": {"type": "array", "items": {"type": "string"}},
         "limit": {"type": "integer", "minimum": 1, "maximum": 100},
         "maxPages": {"type": "integer", "minimum": 1, "maximum": 100},
     }, "required": ["traceId"], "additionalProperties": False},
     "handler": _trace_tree},
    {"name": "getSessionTimeline", "domain": "traces",
     "description": "PUBLIC_API: os czasu sesji agenta z natywnego Observations API v2 "
                    "(filtr sessionId), obserwacje pogrupowane po trace z identyfikatorami "
                    "i linkami do oryginalnych rekordow Langfuse.",
     "inputSchema": {"type": "object", "properties": {
         "sessionId": {"type": "string"},
         "fromStartTime": {"type": "string", "format": "date-time"},
         "toStartTime": {"type": "string", "format": "date-time"},
         "limit": {"type": "integer", "minimum": 1, "maximum": 100},
         "maxPages": {"type": "integer", "minimum": 1, "maximum": 100},
     }, "required": ["sessionId"], "additionalProperties": False},
     "handler": _session_timeline},
    {"name": "getTraceSummary", "domain": "traces",
     "description": "Agregaty trace'a: czas, tokeny, koszt, bledy, rozklad typow.",
     "inputSchema": {"type": "object", "properties": {"traceId": {"type": "string"}},
                     "required": ["traceId"], "additionalProperties": False},
     "handler": _trace_summary},
    {"name": "getTraceCriticalPath", "domain": "traces",
     "description": "Najwolniejsza sciezka krytyczna trace'a (root -> liscie).",
     "inputSchema": {"type": "object", "properties": {"traceId": {"type": "string"}},
                     "required": ["traceId"], "additionalProperties": False},
     "handler": _trace_critical_path},
    {"name": "getTraceErrors", "domain": "traces",
     "description": "Obserwacje z poziomu ERROR/WARNING oraz niepuste statusMessage.",
     "inputSchema": {"type": "object", "properties": {"traceId": {"type": "string"}},
                     "required": ["traceId"], "additionalProperties": False},
     "handler": _trace_errors},
    {"name": "compareTraces", "domain": "traces",
     "description": "Porownanie wielu trace'ow: podsumowania i delty miedzy pierwszym a ostatnim.",
     "inputSchema": {"type": "object", "properties": {"traceIds": {"type": "array", "items": {"type": "string"}}},
                     "required": ["traceIds"], "additionalProperties": False},
     "handler": _compare_traces},
    {"name": "compareMetrics", "domain": "metrics",
     "description": "Porownanie dwoch zapytan queryMetrics po wymiarach i czasie (delta, delta %%).",
     "inputSchema": _query_schema_with({"a": QUERY_SCHEMA, "b": QUERY_SCHEMA,
                                         "labels": {"type": "array", "items": {"type": "string"}}},
                                        required=["a", "b"]),
     "handler": _compare_metrics},
    {"name": "getUsageBreakdown", "domain": "metrics",
     "description": "Rozklad metryki po jednym wymiarze (model, typ, srodowisko).",
     "inputSchema": _query_schema_with({"query": QUERY_SCHEMA, "dimension": {"type": "string"},
                                         "limit": {"type": "integer", "minimum": 1, "maximum": 200}},
                                        required=["query", "dimension"]),
     "handler": _usage_breakdown},
    {"name": "detectAnomalies", "domain": "metrics",
     "description": "Wykrywanie anomalii w szeregu czasowym metryki (mediana + MAD).",
     "inputSchema": _query_schema_with({"query": QUERY_SCHEMA, "sensitivity": {"type": "number", "minimum": 0.5},
                                         "minPoints": {"type": "integer", "minimum": 3, "maximum": 100}},
                                        required=["query"]),
     "handler": _detect_anomalies},
    {"name": "queryMetricsPreset", "domain": "metrics",
     "description": "Gotowe zapytania analityczne: " + ", ".join(sorted(PRESETS)),
     "inputSchema": {"type": "object",
                     "properties": {"preset": {"type": "string", "enum": sorted(PRESETS)},
                                    "hours": {"type": "integer", "minimum": 1, "maximum": 24 * 90},
                                    "granularity": {"type": "string",
                                                    "enum": ["minute", "hour", "day", "week", "month"]}},
                     "required": ["preset"], "additionalProperties": False},
     "handler": _query_metrics_preset},
    {"name": "describeMetric", "domain": "metrics",
     "description": "Pelny opis jednej miary z getMetricsSchema (wymiary, ograniczenia).",
     "inputSchema": {"type": "object", "properties": {"view": {"type": "string"}, "measure": {"type": "string"}},
                     "required": ["measure"], "additionalProperties": False},
     "handler": _describe_metric},
    {"name": "describeTool", "domain": "platform",
     "description": "Schemat i uprawnienia dowolnego narzedzia (odkrywanie na demand).",
     "inputSchema": {"type": "object", "properties": {"name": {"type": "string"}},
                     "required": ["name"], "additionalProperties": False},
     "handler": _describe_tool},
    {"name": "listToolDomains", "domain": "platform",
     "description": "Katalog narzedzi pogrupowany po domenach (leniwe odkrywanie).",
     "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
     "handler": _list_tool_domains},
    {"name": "getMcpHealth", "domain": "platform",
     "description": "Stan komponentow gateway: upstream, baza, katalog, cache idempotencji.",
     "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
     "handler": _get_mcp_health},
    {"name": "getMcpDiagnostics", "domain": "platform",
     "description": "Statystyki gateway: wolumen, latencje, bledy, zgodność kontraktu.",
     "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
     "handler": _get_mcp_diagnostics},
    {"name": "runPromptExperiment", "domain": "experiments", "readOnly": False,
     "description": "OFFICIAL_SDK: uruchamia natywny eksperyment Langfuse (Langfuse Python SDK, "
                    "Experiment Runner) na istniejacym datasetcie i niezmienialnej wersji promptu. "
                    "Model jest wolany przez allowlistowany adapter providera (nie przez kod "
                    "przekazany w argumencie); trace'y, itemy i eksperyment tworzy sam SDK. "
                    "To NIE jest natywny przycisk 'Prompt Experiment' w panelu Langfuse - ten "
                    "workflow (UI_ONLY) nie ma stabilnego publicznego endpointu POST.",
     "inputSchema": {"type": "object", "properties": {
         "datasetName": {"type": "string"},
         "datasetVersion": {"type": "string", "format": "date-time"},
         "promptName": {"type": "string"},
         "promptVersion": {"type": "integer"},
         "experimentName": {"type": "string"},
         "runName": {"type": "string"},
         "description": {"type": "string"},
         "provider": {"type": "string"},
         "model": {"type": "string"},
         "temperature": {"type": "number", "minimum": 0, "maximum": 2},
         "maxTokens": {"type": "integer", "minimum": 1, "maximum": 100000},
         "maxConcurrency": {"type": "integer", "minimum": 1, "maximum": 50},
         "maxItems": {"type": "integer", "minimum": 1, "maximum": 1000},
         "maxCostUsd": {"type": "number", "minimum": 0},
         "allowExistingExperiment": {"type": "boolean"},
         "dryRun": {"type": "boolean"},
     }, "required": ["datasetName", "promptName", "promptVersion", "experimentName",
                     "provider", "model"],
         "additionalProperties": False},
     "handler": _run_prompt_experiment},
    {"name": "getExperimentStatus", "domain": "experiments",
     "description": "PUBLIC_API: odczyt metadanych eksperymentu i jego itemow "
                    "(/api/public/experiments + /api/public/experiment-items). "
                    "Nie wymysla pola stanu wykonania - raportuje tylko to, co API "
                    "faktycznie udostepnia (czasy, liczby itemow, poziomy itemow).",
     "inputSchema": {"type": "object", "properties": {
         "experimentId": {"type": "string"},
         "experimentName": {"type": "string"},
         "fields": EXPERIMENT_FIELDS,
         "limit": {"type": "integer", "minimum": 1, "maximum": 100},
     }, "additionalProperties": False},
     "handler": _experiment_status},
    {"name": "compareExperiments", "domain": "experiments",
     "description": "PUBLIC_API: porownuje dwa eksperymenty na natywnych itemach i score'ach "
                    "(lekka agregacja liczbowa, bez wlasnej logiki ewaluatorow). "
                    "Zwraca link do natywnego widoku porownania w Langfuse. "
                    "Przy braku danych zwraca werdykt INSUFFICIENT_EVIDENCE.",
     "inputSchema": {"type": "object", "properties": {
         "baselineExperimentId": {"type": "string"},
         "baselineExperimentName": {"type": "string"},
         "candidateExperimentId": {"type": "string"},
         "candidateExperimentName": {"type": "string"},
         "scoreNames": {"type": "array", "items": {"type": "string"}},
         "failureLabels": {"type": "array", "items": {"type": "string"}},
         "treatLowerIsBetter": {"type": "boolean"},
         "fields": EXPERIMENT_FIELDS,
         "limit": {"type": "integer", "minimum": 1, "maximum": 100},
     }, "additionalProperties": False},
     "handler": _compare_experiments},
    {"name": "getRegressionResults", "domain": "experiments",
     "description": "PUBLIC_API: wykrywa regresje na natywnych score'ach i itemach obu "
                    "eksperymentow (baseline vs candidate). Zwraca id eksperymentow, id itemow "
                    "i score'ow dla kazdego znaleziska.",
     "inputSchema": {"type": "object", "properties": {
         "baselineExperimentId": {"type": "string"},
         "baselineExperimentName": {"type": "string"},
         "candidateExperimentId": {"type": "string"},
         "candidateExperimentName": {"type": "string"},
         "scoreNames": {"type": "array", "items": {"type": "string"}},
         "failureLabels": {"type": "array", "items": {"type": "string"}},
         "treatLowerIsBetter": {"type": "boolean"},
         "fields": EXPERIMENT_FIELDS,
         "limit": {"type": "integer", "minimum": 1, "maximum": 100},
     }, "additionalProperties": False},
     "handler": _regression_results},
    {"name": "listEvaluatorVersions", "domain": "evaluators",
     "description": "PUBLIC_API: wersje ewaluatora z natywnego API v2 "
                    "(/api/public/v2/evaluators/{evaluatorId}/versions) - brak odpowiednika "
                    "w katalogu 85 narzedzi MCP.",
     "inputSchema": {"type": "object", "properties": {"evaluatorId": {"type": "string"}},
                     "required": ["evaluatorId"], "additionalProperties": False},
     "handler": _evaluator_versions},
    {"name": "getLlmConnections", "domain": "platform",
     "description": "PUBLIC_API: lista natywnych polaczen LLM Langfuse "
                    "(/api/public/llm-connections). Zwraca tylko pola bez sekretow.",
     "inputSchema": {"type": "object", "properties": {
         "page": {"type": "integer", "minimum": 1, "maximum": 1000},
         "limit": {"type": "integer", "minimum": 1, "maximum": 100},
     }, "additionalProperties": False},
     "handler": _get_llm_connections},
    {"name": "upsertLlmConnection", "domain": "platform", "readOnly": False,
     "description": "PUBLIC_API: tworzy lub aktualizuje natywne polaczenie LLM w Langfuse "
                    "(PUT /api/public/llm-connections). Wymagane: provider, adapter, secretKey. "
                    "Sekret nigdy nie jest zwracany w odpowiedzi. Nadpisanie istniejacego "
                    "polaczenia wymaga allowOverwrite=true.",
     "inputSchema": {"type": "object", "properties": {
         "id": {"type": "string"},
         "provider": {"type": "string"},
         "adapter": {"type": "string",
                     "enum": ["anthropic", "openai", "azure", "bedrock",
                              "google-vertex-ai", "google-ai-studio"]},
         "secretKey": {"type": "string"},
         "name": {"type": "string"},
         "baseURL": {"type": "string"},
         "model": {"type": "string"},
         "customModels": {"type": "array"},
         "withDefaultModels": {"type": "boolean"},
         "extraHeaderKeys": {"type": "array", "items": {"type": "string"}},
         "config": {"type": "object"},
         "allowOverwrite": {"type": "boolean"},
     }, "required": ["provider", "adapter", "secretKey"], "additionalProperties": False},
     "handler": _upsert_llm_connection},
]

TOOLS_BY_NAME = {spec["name"]: spec for spec in TOOL_SPECS}


def tool_definitions(profile=None):
    """Definicje MCP tools dla narzedzi syntetycznych.

    `profile` ogranicza widocznosc do narzedzi dostepnych w danym profilu
    (narzedzia zapisujace, np. runPromptExperiment, tylko w profilu full).
    """
    return [{"name": spec["name"], "description": spec["description"],
             "inputSchema": spec["inputSchema"],
             "annotations": {"readOnlyHint": spec.get("readOnly", True),
                             "title": spec["name"]}}
            for spec in TOOL_SPECS
            if profile is None or profiles.gateway_visible(spec["name"], profile)]


def handle(name, args, ctx):
    """Wykonuje narzedzie gateway. Zwraca envelope (success/failure)."""
    spec = TOOLS_BY_NAME.get(name)
    if not spec:
        return failure("NOT_FOUND", f"unknown gateway tool '{name}'", tool=name)
    try:
        return spec["handler"](args or {}, ctx)
    except Exception as exc:  # noqa: BLE001 - envelope zamiast wyjatku na wire
        return failure("INTERNAL", f"{type(exc).__name__}: {exc}", tool=name)
