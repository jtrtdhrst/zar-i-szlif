"""Adaptery eksperymentow Langfuse: SDK runner + read / comparison / regression.

Kazdy adapter jest cienka warstwa nad NATYWNYM interfejsem Langfuse:

  run_prompt_experiment -> Langfuse Python SDK (Experiment Runner, `run_experiment`)
  experiment_status     -> Public API /api/public/experiments + /api/public/experiment-items
  compare_experiments   -> te same API + scores (read-only agregacja liczbowa)
  regression_results    -> te same API + scores (read-only analiza regresji)
  evaluator_versions    -> Public API /api/public/v2/evaluators/{id}/versions

Nie duplikujemy silnika eksperymentow, ewaluatorow, scorow ani dataset-run
lifecycle - to wszystko zostaje w Langfuse. Adapter jedynie:
  * rozwiazuje encje (dataset, prompt, provider),
  * wywoluje model przez allowlistowany adapter,
  * czyta natywne rekordy i wykonuje lekka agregacje.

Dozwolone interfejsy (klasyfikacja z addendum):
  PUBLIC_API   - /api/public/experiments, /api/public/experiment-items, /api/public/v2/*
  OFFICIAL_SDK - langfuse (Python) 5.x: Langfuse.get_dataset/get_prompt/run_experiment
  UI_ONLY      - natywne "Prompt Experiment" w panelu Langfuse (brak stabilnego POST)
"""
import base64
import contextlib
import datetime
import json
import logging
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from .normalize import failure, success

TOOL_RUN = "runPromptExperiment"
TOOL_STATUS = "getExperimentStatus"
TOOL_COMPARE = "compareExperiments"
TOOL_REGRESSION = "getRegressionResults"
TOOL_EVALUATOR_VERSIONS = "listEvaluatorVersions"

# Najstarsza data, ktora jeszcze akceptuje filtr fromStartTime w API eksperymentow.
EPOCH = "1970-01-01T00:00:00Z"

# Etykiety traktowane jako "blad" przy score'ach kategorycznych.
DEFAULT_FAILURE_LABELS = ("FAIL", "FAILED", "FAILURE", "ERROR", "REJECTED", "UNSUCCESSFUL")

# Klasyfikacja interfejsow - jedno zrodlo prawdy dla opisu narzedzi.
INTERFACE = {
    TOOL_RUN: "OFFICIAL_SDK",
    TOOL_STATUS: "PUBLIC_API",
    TOOL_COMPARE: "PUBLIC_API",
    TOOL_REGRESSION: "PUBLIC_API",
    TOOL_EVALUATOR_VERSIONS: "PUBLIC_API",
}


# --- konfiguracja providerow modeli -----------------------------------------
# Allowlista operatora: LANGFUSE_MCP_MODEL_PROVIDERS (JSON):
#   {"<provider>": {"baseUrl": "...", "apiKey": "...", "sessionHeader": "...",
#                   "userAgent": "...", "prices": {"<model>": {"input": 0.0, "output": 0.0}}}}
# Nie ma zadnych sekretow w kodzie ani w odpowiedziach MCP.
PROVIDERS_ENV = "LANGFUSE_MCP_MODEL_PROVIDERS"
LANGFUSE_HOST_ENV = "LANGFUSE_MCP_HOST"
LANGFUSE_PUBLIC_URL_ENV = "LANGFUSE_MCP_PUBLIC_URL"
DEFAULT_LANGFUSE_HOST = "http://langfuse:3000"
# Serwer materializuje eksperyment z trace'a asynchronicznie (kolejka ingestii),
# wiec po powrocie z SDK rekord moze byc jeszcze niewidoczny.
READBACK_SECONDS_ENV = "LANGFUSE_MCP_EXPERIMENT_READBACK_SECONDS"
DEFAULT_READBACK_SECONDS = 120

_CLIENT = None
_CLIENT_LOCK = threading.Lock()


def providers():
    """Allowlista providerow modeli (konfiguracja operatora)."""
    raw = os.environ.get(PROVIDERS_ENV, "").strip()
    if not raw:
        return {}
    try:
        cfg = json.loads(raw)
    except ValueError:
        return {}
    if not isinstance(cfg, dict):
        return {}
    return {name: cfg[name] for name in cfg
            if isinstance(cfg.get(name), dict) and cfg[name].get("baseUrl")}


def sdk_client():
    """Klient oficjalnego SDK Langfuse (Python). None gdy brak konfiguracji."""
    global _CLIENT
    with _CLIENT_LOCK:
        if _CLIENT is not None:
            return _CLIENT
        basic = os.environ.get("LANGFUSE_MCP_BASIC", "").strip()
        try:
            public_key, secret_key = base64.b64decode(basic).decode("utf-8").split(":", 1)
        except Exception:  # noqa: BLE001 - brak konfiguracji, nie blad krytyczny
            return None
        try:
            from langfuse import Langfuse
        except ImportError:  # pragma: no cover - obraz bez SDK
            return None
        kwargs = {"public_key": public_key, "secret_key": secret_key,
                  "host": os.environ.get(LANGFUSE_HOST_ENV, DEFAULT_LANGFUSE_HOST)}
        # base_url sluzy tylko do linkow w UI - API idzie do hosta wewnetrznego.
        public_url = os.environ.get(LANGFUSE_PUBLIC_URL_ENV, "").strip()
        if public_url:
            kwargs["base_url"] = public_url
        _CLIENT = Langfuse(**kwargs)
        return _CLIENT


# --- pomocnicze --------------------------------------------------------------

def _iso(value):
    if value is None:
        return None
    if isinstance(value, datetime.datetime):
        moment = value if value.tzinfo else value.replace(tzinfo=datetime.timezone.utc)
        return moment.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return str(value)


def _parse_datetime(value):
    if not value:
        return None
    try:
        return datetime.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _classify_error(exc):
    """Zamienia wyjatek SDK na kod kontraktu."""
    text = "%s: %s" % (type(exc).__name__, exc)
    low = text.lower()
    if "not found" in low or "404" in low:
        return "NOT_FOUND"
    if "unauthorized" in low or "401" in low:
        return "UNAUTHORIZED"
    if "forbidden" in low or "403" in low:
        return "FORBIDDEN"
    if "timeout" in low or "timed out" in low:
        return "TIMEOUT"
    return "UPSTREAM_ERROR"


def _split_public_url(url):
    """Z publicznego URL-a Langfuse wyciega host i projectId."""
    if not url:
        return None, None
    base, _, rest = str(url).partition("/project/")
    project_id = rest.split("/")[0] if rest else None
    return (base or None), project_id


def _upstream_error(payload, tool):
    err = (payload or {}).get("error") or {}
    code = err.get("code") or "UPSTREAM_ERROR"
    message = err.get("message") or "upstream call failed"
    return failure(code, message, tool=tool, details={"upstream": err})


# --- model -------------------------------------------------------------------

def _chat(provider, model, messages, temperature=None, max_tokens=None, timeout=None):
    """Jedno wywolanie modelu przez allowlistowany adapter (OpenAI-compatible)."""
    body = {"model": model, "messages": messages}
    if temperature is not None:
        body["temperature"] = temperature
    if max_tokens is not None:
        body["max_tokens"] = max_tokens
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + str(provider.get("apiKey") or ""),
        "User-Agent": provider.get("userAgent") or "curl/8.14.1",
    }
    session_header = provider.get("sessionHeader")
    if session_header:
        headers[session_header] = "langfuse-mcp-" + uuid.uuid4().hex
    request = urllib.request.Request(
        provider["baseUrl"].rstrip("/") + "/chat/completions",
        data=json.dumps(body).encode("utf-8"), headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=int(provider.get("timeout") or 180)) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:200]
        raise RuntimeError("provider HTTP %s: %s" % (exc.code, detail)) from exc
    except Exception as exc:  # noqa: BLE001 - komunikat trafia do resultatu
        raise RuntimeError("provider call failed: %s" % exc) from exc
    choices = payload.get("choices") or []
    message = (choices[0].get("message") or {}) if choices else {}
    text = message.get("content")
    if text is None:
        text = message.get("reasoning_content") or ""
    usage = payload.get("usage") or {}
    return {
        "text": text,
        "usage": {"input": int(usage.get("prompt_tokens") or 0),
                  "output": int(usage.get("completion_tokens") or 0),
                  "total": int(usage.get("total_tokens") or 0)},
        "providerRequestId": payload.get("id"),
        "finishReason": choices[0].get("finish_reason") if choices else None,
    }


def _generation_scope(client, model, messages, model_params, prompt):
    """Kontekst obserwacji 'generation' w Langfuse (natywny zapis modelu i kosztu)."""
    try:
        return client.start_as_current_observation(
            name="prompt-experiment-model-call", as_type="generation",
            model=model, input=messages,
            model_parameters=model_params or None, prompt=prompt)
    except Exception:  # noqa: BLE001 - obserwacja jest wzbogaceniem, nie warunkiem itemu
        return contextlib.nullcontext(None)


def _price(ctx, provider, model):
    """Cena tokena: najpierw natywny rejestr modeli Langfuse, potem konfiguracja providera."""
    page = 1
    while page <= 20:
        ok, payload = ctx["upstream"].mcp_call("listModels", {"page": page, "limit": 100})
        if not ok:
            break
        for entry in (payload.get("data") or []):
            name = (entry.get("modelName") or "").lower()
            if name == model.lower() and (entry.get("unit") or "TOKENS") == "TOKENS":
                return {"input": entry.get("inputPrice"), "output": entry.get("outputPrice"),
                        "unit": "TOKENS", "source": "langfuse-model-definition",
                        "modelId": entry.get("id")}
        meta = payload.get("meta") or {}
        total = int(meta.get("totalItems") or 0)
        limit = int(meta.get("limit") or 100)
        if not total or page * limit >= total:
            break
        page += 1
    prices = (provider.get("prices") or {}).get(model)
    if isinstance(prices, dict) and prices.get("input") is not None:
        return {"input": prices.get("input"), "output": prices.get("output") or 0.0,
                "unit": "TOKENS", "source": "provider-config"}
    return None


# --- odczyt eksperymentow ----------------------------------------------------

def _fetch_upstream(ctx, tool, args, max_pages=25):
    """Pagiuje narzedzie upstream po cursor. Zwraca (items, pagination) albo (None, error)."""
    items, pagination = ctx["upstream"].paginate(tool, args, max_pages=max_pages)
    if items is None:
        return None, {"error": (pagination or {}).get("error") or {}}
    return items, pagination


def _resolve_experiment(ctx, experiment_id=None, experiment_name=None):
    """Znajduje eksperyment po id, a gdy nie ma - po nazwie (Public API /api/public/experiments).

    Zapytanie o eksperyment uzywa wylacznie grup core/metadata - API eksperymentow
    przyjmuje inne grupy niz API itemow eksperymentu, wiec nie mieszamy ich.
    """
    if not experiment_id and not experiment_name:
        return None, failure("INVALID_ARGUMENT", "experimentId or experimentName is required",
                             tool=TOOL_STATUS)
    for key, value in (("id", experiment_id), ("name", experiment_name)):
        if not value:
            continue
        args = {"fields": ["core", "metadata"], "limit": 100,
                "fromStartTime": EPOCH, key: [value]}
        items, error = _fetch_upstream(ctx, "listExperiments", args, max_pages=10)
        if items is None:
            return None, _upstream_error(error, TOOL_STATUS)
        for entry in items:
            if entry.get(key) == value:
                return entry, None
    if experiment_id:
        return None, failure("NOT_FOUND", "experiment '%s' not found" % experiment_id,
                             tool=TOOL_STATUS)
    return None, failure("NOT_FOUND", "experiment named '%s' not found" % experiment_name,
                         tool=TOOL_STATUS)


def _experiment_items(ctx, experiment_id, fields, limit=100, max_pages=25):
    args = {"experimentId": [experiment_id], "fields": fields, "limit": limit,
            "fromStartTime": EPOCH}
    items, error = _fetch_upstream(ctx, "listExperimentItems", args, max_pages=max_pages)
    if items is None:
        return None, error
    return items, None


def _score_entries(item):
    """Normalizuje score'y z payloadu experiment item."""
    entries = []
    for score in item.get("scores") or []:
        if not isinstance(score, dict):
            continue
        value = score.get("value")
        string_value = score.get("stringValue")
        if value is None and string_value is None:
            continue
        entries.append({
            "id": score.get("id"),
            "name": score.get("name"),
            "value": value,
            "stringValue": string_value,
            "dataType": score.get("dataType"),
            "source": score.get("source"),
            "comment": score.get("comment"),
            "url": score.get("url"),
            "configId": score.get("configId"),
            "queueId": score.get("queueId"),
            "metadata": score.get("metadata") or {},
            "observationId": score.get("observationId") or item.get("id"),
            "traceId": score.get("traceId") or item.get("traceId"),
        })
    return entries


def _numeric(value):
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip().lower()
        if text in ("true", "yes", "1"):
            return 1.0
        if text in ("false", "no", "0"):
            return 0.0
    return None


def _is_failure(label, failure_labels):
    return str(label or "").strip().upper() in failure_labels


# --- 1) runPromptExperiment ---------------------------------------------------

def run_prompt_experiment(args, ctx):
    """Oficjalny Langfuse Experiment Runner (Python SDK) + minimalny adapter modelu."""
    provider_name = args.get("provider") or ""
    allowlist = providers()
    provider = allowlist.get(provider_name)
    if not provider:
        return failure("INVALID_ARGUMENT",
                       "provider '%s' is not allowlisted" % provider_name,
                       tool=TOOL_RUN,
                       details={"allowlisted": sorted(allowlist),
                                "note": "allowlista jest konfigurowana przez operatora "
                                        "(%s)" % PROVIDERS_ENV})
    model = args.get("model") or ""
    if not model:
        return failure("INVALID_ARGUMENT", "model is required", tool=TOOL_RUN)

    client = sdk_client()
    if client is None:
        return failure("UNSUPPORTED",
                       "Langfuse SDK client is unavailable (LANGFUSE_MCP_BASIC not configured)",
                       tool=TOOL_RUN)

    dataset_name = args.get("datasetName") or ""
    prompt_name = args.get("promptName") or ""
    prompt_version = args.get("promptVersion")
    experiment_name = args.get("experimentName") or ""
    run_name = args.get("runName") or experiment_name
    dataset_version = _parse_datetime(args.get("datasetVersion"))
    if args.get("datasetVersion") and dataset_version is None:
        return failure("INVALID_ARGUMENT", "datasetVersion must be an ISO-8601 date-time",
                       tool=TOOL_RUN)

    # 1) dataset
    try:
        dataset = client.get_dataset(dataset_name, version=dataset_version)
    except Exception as exc:  # noqa: BLE001
        return failure(_classify_error(exc), "dataset '%s': %s" % (dataset_name, exc),
                       tool=TOOL_RUN)
    items = list(getattr(dataset, "items", []) or [])
    if not items:
        return failure("NOT_FOUND", "dataset '%s' has no items" % dataset_name, tool=TOOL_RUN)

    # 2) prompt (niezmienialna wersja)
    try:
        prompt = client.get_prompt(prompt_name, version=prompt_version)
    except Exception as exc:  # noqa: BLE001
        return failure(_classify_error(exc), "prompt '%s' v%s: %s"
                       % (prompt_name, prompt_version, exc), tool=TOOL_RUN)
    variables = list(getattr(prompt, "variables", []) or [])

    # 3) walidacja zmiennych promptu wobec pol datasetu
    input_keys = set()
    for item in items:
        data = getattr(item, "input", None)
        if isinstance(data, dict):
            input_keys |= set(data.keys())
    missing = [name for name in variables if name not in input_keys]
    if missing:
        return failure("INVALID_ARGUMENT",
                       "prompt variables missing from dataset inputs: %s" % ", ".join(missing),
                       tool=TOOL_RUN,
                       details={"missingVariables": missing,
                                "datasetInputKeys": sorted(input_keys)})

    # 4) cena modelu (natywny rejestr modeli Langfuse)
    price = _price(ctx, provider, model)
    max_cost = args.get("maxCostUsd")
    if max_cost is not None and not price:
        return failure("UNSUPPORTED",
                       "maxCostUsd cannot be enforced: no token price registered for model '%s' "
                       "(register a Langfuse model definition or configure provider prices)" % model,
                       tool=TOOL_RUN, details={"model": model})

    max_items = args.get("maxItems")
    selected = items[:max_items] if max_items else items
    concurrency = int(args.get("maxConcurrency") or 1)
    if max_cost is not None:
        concurrency = 1  # cap kosztowy musi byc liczony dokladnie, item po item
    temperature = args.get("temperature")
    max_tokens = args.get("maxTokens")

    plan = {
        "dataset": {"name": getattr(dataset, "name", dataset_name),
                    "id": getattr(dataset, "id", None),
                    "version": _iso(getattr(dataset, "version", None)),
                    "itemsAvailable": len(items),
                    "itemsSelected": len(selected)},
        "prompt": {"name": getattr(prompt, "name", prompt_name),
                   "version": getattr(prompt, "version", prompt_version),
                   "variables": variables},
        "model": {"provider": provider_name, "model": model,
                  "temperature": temperature, "maxTokens": max_tokens},
        "experimentName": experiment_name, "runName": run_name,
        "price": {"source": (price or {}).get("source"),
                  "inputPerToken": (price or {}).get("input"),
                  "outputPerToken": (price or {}).get("output")},
        "maxCostUsd": max_cost, "maxConcurrency": concurrency,
    }
    if args.get("dryRun"):
        return success({"dryRun": True, "plan": plan}, tool=TOOL_RUN,
                       warnings=["dryRun: model nie zostalo wywolane"])

    # 5) duplikat: istniejacy eksperyment o tym samym runName
    existing, _ = _resolve_experiment(ctx, None, run_name)
    if existing and int(existing.get("itemCount") or 0) > 0 and not args.get("allowExistingExperiment"):
        return failure("CONFLICT",
                       "experiment '%s' already exists with %s items; use another runName or "
                       "allowExistingExperiment=true to re-run into the same experiment"
                       % (run_name, existing.get("itemCount")),
                       tool=TOOL_RUN,
                       details={"experimentId": existing.get("id"),
                                "itemCount": existing.get("itemCount"),
                                "url": existing.get("url")})

    # 6) task callback - jedyna czesc, ktora musi zywe w naszym procesie
    state = {"cost": 0.0, "tokens": 0, "calls": 0, "budgetStopped": False}
    lock = threading.Lock()

    def task(*, item, **kwargs):  # noqa: ARG001 - kontrakt SDK
        data = getattr(item, "input", None)
        if not isinstance(data, dict):
            data = {"input": data}
        values = {name: data.get(name) for name in variables}
        compiled = prompt.compile(**values)
        messages = ([{"role": "user", "content": compiled}] if isinstance(compiled, str)
                    else list(compiled))
        with lock:
            if max_cost is not None and state["cost"] >= max_cost:
                state["budgetStopped"] = True
                raise RuntimeError("budget exhausted: %.6f USD spent, maxCostUsd=%s"
                                   % (state["cost"], max_cost))
        model_params = {}
        if temperature is not None:
            model_params["temperature"] = temperature
        if max_tokens is not None:
            model_params["max_tokens"] = max_tokens
        with _generation_scope(client, model, messages, model_params, prompt) as generation:
            result = _chat(provider, model, messages, temperature, max_tokens)
            usage = result["usage"]
            if generation is not None:
                update = {"output": result["text"], "usage_details": usage}
                if price:
                    cost_in = round(usage["input"] * (price["input"] or 0.0), 10)
                    cost_out = round(usage["output"] * (price["output"] or 0.0), 10)
                    update["cost_details"] = {"input": cost_in, "output": cost_out,
                                              "total": round(cost_in + cost_out, 10)}
                generation.update(**update)
        with lock:
            state["calls"] += 1
            state["tokens"] += usage["total"]
            if price:
                state["cost"] += round(usage["input"] * (price["input"] or 0.0), 10) \
                    + round(usage["output"] * (price["output"] or 0.0), 10)
        return result["text"]

    # 7) oficjalny runner SDK - wszystko else robi Langfuse
    # Wersja datasetu trafia do metadanych eksperymentu, zeby pozniejsze
    # porownania mogly sprawdzic, czy oba runy mialy ten sam stan danych.
    run_metadata = {"provider": provider_name, "model": model,
                    "promptName": prompt_name, "promptVersion": prompt_version,
                    "mcpTool": TOOL_RUN}
    dataset_version_resolved = _iso(getattr(dataset, "version", None)) or args.get("datasetVersion")
    if dataset_version_resolved:
        run_metadata["datasetVersion"] = dataset_version_resolved
    collector = _ErrorCollector()
    sdk_logger = logging.getLogger("langfuse")
    sdk_logger.addHandler(collector)
    previous_level = sdk_logger.level
    sdk_logger.setLevel(logging.ERROR)
    try:
        experiment = client.run_experiment(
            name=experiment_name,
            run_name=run_name,
            description=args.get("description") or "",
            data=selected,
            task=task,
            max_concurrency=concurrency,
            metadata=run_metadata,
            _dataset_version=getattr(dataset, "version", None),
        )
    except Exception as exc:  # noqa: BLE001
        return failure(_classify_error(exc), "experiment run failed: %s" % exc, tool=TOOL_RUN)
    finally:
        sdk_logger.removeHandler(collector)
        sdk_logger.setLevel(previous_level)

    item_results = list(getattr(experiment, "item_results", []) or [])
    executed = len(item_results)
    failed = len(selected) - executed
    experiment_id = getattr(experiment, "experiment_id", None)
    experiment_url = getattr(experiment, "experiment_url", None)

    # 8) readback przez istniejace narzedzia MCP (potwierdzenie trwalosci)
    readback = _readback_experiment(ctx, experiment_id, run_name, expected_items=executed)

    errors = [{"source": "sdk", "message": message} for message in collector.messages]
    for item in (readback or {}).get("failedItems") or []:
        errors.append({"source": "experiment-item",
                       "datasetItemId": item.get("datasetItemId"),
                       "observationId": item.get("observationId"),
                       "message": item.get("error")})
    if state["budgetStopped"]:
        errors.append({"source": "budget",
                       "message": "budget exhausted - remaining items were not executed"})

    return success({
        "experimentId": experiment_id,
        "experimentName": getattr(experiment, "name", experiment_name),
        "runName": getattr(experiment, "run_name", run_name),
        "dataset": plan["dataset"],
        "prompt": plan["prompt"],
        "model": plan["model"],
        "executedItems": executed,
        "failedItems": failed,
        "modelCalls": state["calls"],
        "tokens": state["tokens"],
        "cost": {"accumulatedUsd": round(state["cost"], 8) if price else None,
                 "maxCostUsd": max_cost,
                 "budgetExhausted": state["budgetStopped"],
                 "observation": "measured" if price else "pricing_unknown",
                 "priceSource": (price or {}).get("source")},
        "experimentUrl": (readback or {}).get("url") or experiment_url,
        "readback": readback,
        "errors": errors,
        "interface": INTERFACE[TOOL_RUN],
    }, tool=TOOL_RUN, meta={"contractNote": "wyniki pochodza z oficjalnego SDK Langfuse"})


def _readback_experiment(ctx, experiment_id, run_name, expected_items=None, attempts=None, delay=6.0):
    """Potwierdzenie trwalosci: eksperyment i itemy przez istniejace narzedzia MCP.

    Serwer materializuje eksperyment i jego itemy z trace'a asynchronicznie
    (kolejka ingestii), wiec po powrocie z SDK rekordy moga nie byc jeszcze
    widoczne - czekamy az eksperyment i wszystkie itemy sie pojawią.
    """
    if attempts is None:
        budget = int(os.environ.get(READBACK_SECONDS_ENV, DEFAULT_READBACK_SECONDS))
        attempts = max(1, int(budget / delay))
    found = None
    items = []
    for attempt in range(attempts):
        experiment, _ = _resolve_experiment(ctx, experiment_id, run_name)
        if experiment:
            found = experiment
            items, error = _experiment_items(ctx, experiment.get("id"),
                                             ["core", "dataset", "io"], limit=100)
            if not expected_items or len(items or []) >= expected_items:
                break
        if attempt + 1 < attempts:
            time_sleep(delay)
    if not found:
        return {"status": "pending_ingestion", "experimentId": experiment_id,
                "note": "eksperyment nie byl jeszcze widoczny w /api/public/experiments "
                        "(materializacja z trace'a jest asynchroniczna). Potwierdz przez "
                        "getExperimentStatus z experimentId=%s." % experiment_id}
    failed = [{"observationId": item.get("id"), "datasetItemId": item.get("experimentItemId"),
               "traceId": item.get("traceId"),
               "error": str(item.get("output") or item.get("statusMessage") or "")[:400]}
              for item in (items or []) if (item.get("level") or "").upper() == "ERROR"]
    observed = len(items) if items else 0
    readback = {
        "status": "ok",
        "experimentId": found.get("id"),
        "declaredItemCount": found.get("itemCount"),
        "observedItemCount": observed,
        "failedItems": failed,
        "datasetId": found.get("datasetId"),
        "url": found.get("url"),
        "error": None if items is not None else (error or {}).get("error"),
    }
    if expected_items and observed < expected_items:
        readback["note"] = ("obserwowano %s z %s itemow - pozostale sa jeszcze w kolejce "
                            "ingestii" % (observed, expected_items))
    return readback


class _ErrorCollector(logging.Handler):
    """Zbiera bledy logowane przez SDK (itemy, ktore wywalily sie w trakcie runu)."""

    def __init__(self):
        super().__init__(level=logging.ERROR)
        self.messages = []

    def emit(self, record):
        try:
            self.messages.append(record.getMessage()[:400])
        except Exception:  # noqa: BLE001 - logowanie nie moze wywarczyc runu
            pass


def time_sleep(seconds):
    time.sleep(seconds)


# --- 2) getExperimentStatus ---------------------------------------------------

def experiment_status(args, ctx):
    """Cienki adapter odczytu: /api/public/experiments + /api/public/experiment-items."""
    experiment, error = _resolve_experiment(ctx, args.get("experimentId"),
                                           args.get("experimentName"))
    if error:
        error["tool"] = TOOL_STATUS
        return error
    item_fields = args.get("fields") or ["core", "dataset", "io"]
    limit = int(args.get("limit") or 100)
    items, error = _experiment_items(ctx, experiment.get("id"), item_fields, limit=limit)
    if items is None:
        failure_envelope = _upstream_error(error, TOOL_STATUS)
        failure_envelope["data"] = {"experiment": experiment}
        return failure_envelope
    failed_items = [item for item in items if (item.get("level") or "").upper() == "ERROR"]
    successful = [item for item in items if (item.get("level") or "").upper() != "ERROR"]
    return success({
        "experimentId": experiment.get("id"),
        "name": experiment.get("name"),
        "description": experiment.get("description"),
        "datasetId": experiment.get("datasetId"),
        "startTime": experiment.get("startTime"),
        "endTime": experiment.get("endTime"),
        "declaredItemCount": experiment.get("itemCount"),
        "observedItemCount": len(items),
        "successfulItems": len(successful),
        "failedItems": len(failed_items),
        "status": None,
        "statusNote": "Public API nie wystawia pola stanu wykonania (RUNNING/COMPLETED/FAILED). "
                      "Obserwowalne sa wylacznie czasy, deklarowana liczba itemow i liczba "
                      "odczytanych itemow.",
        "url": experiment.get("url"),
        "items": items,
        "interface": INTERFACE[TOOL_STATUS],
    }, tool=TOOL_STATUS,
        meta={"pagination": {"mode": "cursor", "fetched": len(items), "limit": limit}})


# --- 3) compareExperiments ----------------------------------------------------

def _pair_items(baseline_items, candidate_items):
    """Paruje itemy po id itemu datasetu (experimentItemId)."""
    base_by_item = {}
    for item in baseline_items:
        key = item.get("experimentItemId") or item.get("id")
        base_by_item[key] = item
    cand_by_item = {}
    for item in candidate_items:
        key = item.get("experimentItemId") or item.get("id")
        cand_by_item[key] = item
    shared = sorted(set(base_by_item) & set(cand_by_item))
    return base_by_item, cand_by_item, shared


def _score_map(item):
    out = {}
    for entry in _score_entries(item):
        if entry.get("name"):
            out[entry["name"]] = entry
    return out


def _item_evidence(item):
    """Dowody jednego itemu eksperymentu: input, output, trace, obserwacja, score'y.

    Wszystko pochodzi z natywnego payloadu `listExperimentItems` - nic nie
    jest odtwarzane ani dopytywane poza Langfuse.
    """
    if not item:
        return None
    scores = []
    for entry in _score_entries(item):
        metadata = entry.get("metadata") or {}
        scores.append({
            "id": entry.get("id"),
            "name": entry.get("name"),
            "value": entry.get("value"),
            "stringValue": entry.get("stringValue"),
            "dataType": entry.get("dataType"),
            "source": entry.get("source"),
            "comment": entry.get("comment"),
            "url": entry.get("url"),
            "evaluatorId": metadata.get("evaluator_id"),
            "evaluatorVersionId": metadata.get("evaluator_version_id"),
            "evaluationRuleId": metadata.get("evaluation_rule_id"),
        })
    return {
        "observationId": item.get("id"),
        "traceId": item.get("traceId"),
        "datasetItemId": item.get("experimentItemId"),
        "datasetItemVersion": item.get("experimentItemVersion"),
        "level": item.get("level"),
        "startTime": item.get("startTime"),
        "endTime": item.get("endTime"),
        "input": item.get("input"),
        "expectedOutput": item.get("expectedOutput"),
        "output": item.get("output"),
        "itemMetadata": item.get("experimentItemMetadata"),
        "url": item.get("url"),
        "scores": scores,
    }


def _experiment_metadata(experiment):
    return (experiment or {}).get("metadata") or {}


def _dataset_version(experiment):
    """Wersja datasetu zapisana w metadanych eksperymentu (albo None)."""
    version = _experiment_metadata(experiment).get("datasetVersion")
    return str(version) if version else None


def _version_equivalence(base_version, cand_version):
    """Czy oba eksperymenty mialy ten sam dataset: 'yes' | 'no' | 'unknown'."""
    if not base_version or not cand_version:
        return "unknown"
    return "yes" if base_version == cand_version else "no"


def _evaluation_criteria(base_item, cand_item):
    """Nazwy score'ow porownywanych + identyfikatory ewaluatorow (natywne metadane)."""
    names = set()
    evaluators = set()
    versions = set()
    for item in (base_item, cand_item):
        for entry in _score_entries(item or {}):
            if entry.get("name"):
                names.add(entry["name"])
            metadata = entry.get("metadata") or {}
            if metadata.get("evaluator_id"):
                evaluators.add(metadata["evaluator_id"])
            if metadata.get("evaluator_version_id"):
                versions.add(metadata["evaluator_version_id"])
    return {"scoreNames": sorted(names),
            "evaluatorIds": sorted(evaluators),
            "evaluatorVersionIds": sorted(versions)}


def _compare_scores(base_scores, cand_scores, failure_labels, lower_is_better):
    """Porownuje score'y jednego itemu. Zwraca liste findings."""
    findings = []
    for name in sorted(set(base_scores) | set(cand_scores)):
        base = base_scores.get(name)
        cand = cand_scores.get(name)
        base_value = base.get("value") if base else None
        cand_value = cand.get("value") if cand else None
        base_text = (base or {}).get("stringValue")
        cand_text = (cand or {}).get("stringValue")
        data_type = ((cand or base or {}).get("dataType") or "").upper()
        finding = {
            "scoreName": name,
            "dataType": data_type,
            "baselineValue": base_value if base_value is not None else base_text,
            "candidateValue": cand_value if cand_value is not None else cand_text,
            "baselineScoreId": (base or {}).get("id"),
            "candidateScoreId": (cand or {}).get("id"),
        }
        if base is None or cand is None:
            finding["kind"] = "MISSING_SCORE"
            finding["difference"] = None
            findings.append(finding)
            continue
        base_num = _numeric(base_value)
        cand_num = _numeric(cand_value)
        if base_num is not None and cand_num is not None:
            difference = round(cand_num - base_num, 10)
            finding["difference"] = difference
            if difference == 0:
                finding["kind"] = "UNCHANGED"
            elif (difference < 0) == bool(lower_is_better):
                finding["kind"] = "IMPROVEMENT"
            else:
                finding["kind"] = "REGRESSION"
        elif base_text is not None and cand_text is not None:
            finding["difference"] = None
            if base_text == cand_text:
                finding["kind"] = "UNCHANGED"
            elif _is_failure(base_text, failure_labels) and not _is_failure(cand_text, failure_labels):
                finding["kind"] = "RESOLVED_FAILURE"
            elif _is_failure(cand_text, failure_labels) and not _is_failure(base_text, failure_labels):
                finding["kind"] = "NEW_FAILURE"
            else:
                finding["kind"] = "CATEGORY_CHANGED"
        else:
            finding["kind"] = "TEXT_CHANGED" if base_text != cand_text else "UNCHANGED"
            finding["difference"] = None
        findings.append(finding)
    return findings


def compare_experiments(args, ctx):
    """Porownanie dwoch eksperymentow na natywnych rekordach Langfuse."""
    baseline, error = _resolve_experiment(ctx, args.get("baselineExperimentId"),
                                          args.get("baselineExperimentName"))
    if error:
        error["tool"] = TOOL_COMPARE
        return error
    candidate, error = _resolve_experiment(ctx, args.get("candidateExperimentId"),
                                           args.get("candidateExperimentName"))
    if error:
        error["tool"] = TOOL_COMPARE
        return error

    base_dataset = baseline.get("datasetId")
    cand_dataset = candidate.get("datasetId")
    if base_dataset and cand_dataset and base_dataset != cand_dataset:
        return failure("INVALID_ARGUMENT",
                       "experiments are not comparable: datasetId baseline=%s candidate=%s"
                       % (base_dataset, cand_dataset),
                       tool=TOOL_COMPARE,
                       details={"baseline": {"id": baseline.get("id"), "datasetId": base_dataset},
                                "candidate": {"id": candidate.get("id"), "datasetId": cand_dataset}})
    # Brak datasetId (eksperyment jeszcze nie zmaterializowany) to "unknown",
    # nie powod do odrzucenia porownania.
    dataset_compatible = ("yes" if base_dataset and base_dataset == cand_dataset
                          else ("no" if base_dataset and cand_dataset else "unknown"))

    fields = args.get("fields") or ["core", "dataset", "io", "scores"]
    limit = int(args.get("limit") or 100)
    base_items, error = _experiment_items(ctx, baseline.get("id"), fields, limit=limit)
    if base_items is None:
        return _upstream_error(error, TOOL_COMPARE)
    cand_items, error = _experiment_items(ctx, candidate.get("id"), fields, limit=limit)
    if cand_items is None:
        return _upstream_error(error, TOOL_COMPARE)

    base_by_item, cand_by_item, shared = _pair_items(base_items, cand_items)
    failure_labels = {str(label).upper() for label in
                      (args.get("failureLabels") or list(DEFAULT_FAILURE_LABELS))}
    lower_is_better = bool(args.get("treatLowerIsBetter"))
    score_names = set(args.get("scoreNames") or [])

    findings = []
    for key in shared:
        base_item = base_by_item[key]
        cand_item = cand_by_item[key]
        base_scores = _score_map(base_item)
        cand_scores = _score_map(cand_item)
        if score_names:
            base_scores = {k: v for k, v in base_scores.items() if k in score_names}
            cand_scores = {k: v for k, v in cand_scores.items() if k in score_names}
        evidence = {"baseline": _item_evidence(base_item),
                    "candidate": _item_evidence(cand_item),
                    "evaluationCriteria": _evaluation_criteria(base_item, cand_item)}
        for finding in _compare_scores(base_scores, cand_scores, failure_labels, lower_is_better):
            finding.update({
                "datasetItemId": key,
                "baselineExperimentId": baseline.get("id"),
                "candidateExperimentId": candidate.get("id"),
                "baselineObservationId": base_item.get("id"),
                "candidateObservationId": cand_item.get("id"),
                "baselineTraceId": base_item.get("traceId"),
                "candidateTraceId": cand_item.get("traceId"),
                "evidence": evidence,
            })
            findings.append(finding)

    summary = {"improvements": 0, "regressions": 0, "newFailures": 0,
               "resolvedFailures": 0, "unchanged": 0, "missingScores": 0, "other": 0}
    for finding in findings:
        kind = finding["kind"]
        if kind == "IMPROVEMENT":
            summary["improvements"] += 1
        elif kind == "REGRESSION":
            summary["regressions"] += 1
        elif kind == "NEW_FAILURE":
            summary["newFailures"] += 1
        elif kind == "RESOLVED_FAILURE":
            summary["resolvedFailures"] += 1
        elif kind == "UNCHANGED":
            summary["unchanged"] += 1
        elif kind == "MISSING_SCORE":
            summary["missingScores"] += 1
        else:
            summary["other"] += 1

    base_url, project_id = _split_public_url(baseline.get("url"))
    comparison_url = None
    if base_url and base_dataset:
        comparison_url = ("%s/project/%s/datasets/%s/compare?runs=%s&runs=%s"
                          % (base_url, project_id, base_dataset,
                             urllib.parse.quote(str(baseline.get("id")), safe=""),
                             urllib.parse.quote(str(candidate.get("id")), safe="")))

    verdict = "COMPARABLE"
    warnings = []
    base_version = _dataset_version(baseline)
    cand_version = _dataset_version(candidate)
    version_equivalence = _version_equivalence(base_version, cand_version)
    if dataset_compatible == "unknown":
        warnings.append("datasetId jednego z eksperymentow nie jest (jeszcze) dostepny - "
                        "zgodnosci datasetow nie da sie potwierdzic")
    if version_equivalence == "no":
        warnings.append("eksperymenty uzyly roznych wersji datasetu (%s vs %s) - porownanie "
                        "dotyczy innego stanu danych testowych"
                        % (base_version, cand_version))
    elif version_equivalence == "unknown":
        warnings.append("wersja datasetu nie jest zapisana w metadanych eksperymentow - "
                        "rownowaznosc danych testowych nie jest potwierdzona")
    if not shared:
        verdict = "INSUFFICIENT_EVIDENCE"
        warnings.append("brak wspolnych itemow datasetu - nie mozna sparowac wynikow")
    elif not findings:
        verdict = "INSUFFICIENT_EVIDENCE"
        warnings.append("brak score'ow na itemach eksperymentow - porownanie bez dowodow")

    return success({
        "verdict": verdict,
        "baseline": {"experimentId": baseline.get("id"), "name": baseline.get("name"),
                     "datasetId": base_dataset, "itemCount": baseline.get("itemCount"),
                     "datasetVersion": base_version,
                     "metadata": _experiment_metadata(baseline),
                     "url": baseline.get("url")},
        "candidate": {"experimentId": candidate.get("id"), "name": candidate.get("name"),
                      "datasetId": cand_dataset, "itemCount": candidate.get("itemCount"),
                      "datasetVersion": cand_version,
                      "metadata": _experiment_metadata(candidate),
                      "url": candidate.get("url")},
        "datasetCompatible": dataset_compatible,
        "datasetVersionEquivalent": version_equivalence,
        "pairedItems": len(shared),
        "baselineOnlyItems": sorted(set(base_by_item) - set(cand_by_item)),
        "candidateOnlyItems": sorted(set(cand_by_item) - set(base_by_item)),
        "summary": summary,
        "findings": findings,
        "comparisonUrl": comparison_url,
        "interface": INTERFACE[TOOL_COMPARE],
    }, tool=TOOL_COMPARE, warnings=warnings)


# --- 4) getRegressionResults ---------------------------------------------------

def regression_results(args, ctx):
    """Analiza regresji na natywnych score'ach obu eksperymentow."""
    baseline, error = _resolve_experiment(ctx, args.get("baselineExperimentId"),
                                          args.get("baselineExperimentName"))
    if error:
        error["tool"] = TOOL_REGRESSION
        return error
    candidate, error = _resolve_experiment(ctx, args.get("candidateExperimentId"),
                                           args.get("candidateExperimentName"))
    if error:
        error["tool"] = TOOL_REGRESSION
        return error
    base_dataset = baseline.get("datasetId")
    cand_dataset = candidate.get("datasetId")
    if base_dataset and cand_dataset and base_dataset != cand_dataset:
        return failure("INVALID_ARGUMENT",
                       "experiments use different datasets: %s vs %s" % (base_dataset, cand_dataset),
                       tool=TOOL_REGRESSION)

    fields = args.get("fields") or ["core", "dataset", "io", "scores"]
    limit = int(args.get("limit") or 100)
    base_items, error = _experiment_items(ctx, baseline.get("id"), fields, limit=limit)
    if base_items is None:
        return _upstream_error(error, TOOL_REGRESSION)
    cand_items, error = _experiment_items(ctx, candidate.get("id"), fields, limit=limit)
    if cand_items is None:
        return _upstream_error(error, TOOL_REGRESSION)

    base_by_item, cand_by_item, shared = _pair_items(base_items, cand_items)
    failure_labels = {str(label).upper() for label in
                      (args.get("failureLabels") or list(DEFAULT_FAILURE_LABELS))}
    lower_is_better = bool(args.get("treatLowerIsBetter"))
    score_names = set(args.get("scoreNames") or [])

    findings = []
    for key in sorted(set(base_by_item) | set(cand_by_item)):
        base_item = base_by_item.get(key)
        cand_item = cand_by_item.get(key)
        evidence = {"baseline": _item_evidence(base_item),
                    "candidate": _item_evidence(cand_item),
                    "evaluationCriteria": _evaluation_criteria(base_item, cand_item)}
        if base_item is None:
            findings.append({"kind": "MISSING_RESULT", "datasetItemId": key,
                             "detail": "brak wyniku w eksperymencie bazowym",
                             "baselineExperimentId": baseline.get("id"),
                             "candidateExperimentId": candidate.get("id"),
                             "candidateObservationId": (cand_item or {}).get("id"),
                             "candidateTraceId": (cand_item or {}).get("traceId"),
                             "evidence": evidence})
            continue
        if cand_item is None:
            findings.append({"kind": "MISSING_RESULT", "datasetItemId": key,
                             "detail": "brak wyniku w eksperymencie kandydackim",
                             "baselineExperimentId": baseline.get("id"),
                             "candidateExperimentId": candidate.get("id"),
                             "baselineObservationId": base_item.get("id"),
                             "baselineTraceId": base_item.get("traceId"),
                             "evidence": evidence})
            continue
        base_scores = _score_map(base_item)
        cand_scores = _score_map(cand_item)
        if score_names:
            base_scores = {k: v for k, v in base_scores.items() if k in score_names}
            cand_scores = {k: v for k, v in cand_scores.items() if k in score_names}
        base_failed = (base_item.get("level") or "").upper() == "ERROR"
        cand_failed = (cand_item.get("level") or "").upper() == "ERROR"
        if base_failed and not cand_failed:
            findings.append({"kind": "RESOLVED_FAILURE", "datasetItemId": key,
                             "detail": "item bazowy zakonczyl sie bledem, kandydat przeszedl",
                             "baselineExperimentId": baseline.get("id"),
                             "candidateExperimentId": candidate.get("id"),
                             "baselineObservationId": base_item.get("id"),
                             "candidateObservationId": cand_item.get("id"),
                             "evidence": evidence})
            continue
        if cand_failed and not base_failed:
            findings.append({"kind": "NEW_FAILURE", "datasetItemId": key,
                             "detail": "kandydat zakonczyl sie bledem, baza przeszla",
                             "baselineExperimentId": baseline.get("id"),
                             "candidateExperimentId": candidate.get("id"),
                             "baselineObservationId": base_item.get("id"),
                             "candidateObservationId": cand_item.get("id"),
                             "evidence": evidence})
            continue
        for finding in _compare_scores(base_scores, cand_scores, failure_labels, lower_is_better):
            if finding["kind"] not in ("REGRESSION", "IMPROVEMENT", "NEW_FAILURE",
                                       "RESOLVED_FAILURE"):
                continue
            finding.update({
                "datasetItemId": key,
                "baselineExperimentId": baseline.get("id"),
                "candidateExperimentId": candidate.get("id"),
                "baselineObservationId": base_item.get("id"),
                "candidateObservationId": cand_item.get("id"),
                "baselineTraceId": base_item.get("traceId"),
                "candidateTraceId": cand_item.get("traceId"),
                "evidence": evidence,
            })
            findings.append(finding)

    summary = {"regressions": 0, "improvements": 0, "newFailures": 0,
               "resolvedFailures": 0, "missingResults": 0}
    for finding in findings:
        kind = finding.get("kind")
        key = {"REGRESSION": "regressions", "IMPROVEMENT": "improvements",
               "NEW_FAILURE": "newFailures", "RESOLVED_FAILURE": "resolvedFailures",
               "MISSING_RESULT": "missingResults"}.get(kind)
        if key:
            summary[key] += 1

    base_url, project_id = _split_public_url(baseline.get("url"))
    comparison_url = None
    if base_url and base_dataset:
        comparison_url = ("%s/project/%s/datasets/%s/compare?runs=%s&runs=%s"
                          % (base_url, project_id, base_dataset,
                             urllib.parse.quote(str(baseline.get("id")), safe=""),
                             urllib.parse.quote(str(candidate.get("id")), safe="")))

    verdict = "REGRESSION_ANALYSIS_COMPLETE"
    warnings = []
    base_version = _dataset_version(baseline)
    cand_version = _dataset_version(candidate)
    version_equivalence = _version_equivalence(base_version, cand_version)
    if version_equivalence == "no":
        warnings.append("eksperymenty uzyly roznych wersji datasetu (%s vs %s) - regresja moze "
                        "wynikac ze zmiany danych testowych, nie zmiany promptu/modelu"
                        % (base_version, cand_version))
    elif version_equivalence == "unknown":
        warnings.append("wersja datasetu nie jest zapisana w metadanych eksperymentow - "
                        "rownowaznosc danych testowych nie jest potwierdzona")
    if not shared:
        verdict = "INSUFFICIENT_EVIDENCE"
        warnings.append("brak wspolnych itemow datasetu")

    return success({
        "verdict": verdict,
        "baseline": {"experimentId": baseline.get("id"), "name": baseline.get("name"),
                     "datasetId": base_dataset, "datasetVersion": base_version,
                     "metadata": _experiment_metadata(baseline), "url": baseline.get("url")},
        "candidate": {"experimentId": candidate.get("id"), "name": candidate.get("name"),
                      "datasetId": cand_dataset, "datasetVersion": cand_version,
                      "metadata": _experiment_metadata(candidate), "url": candidate.get("url")},
        "datasetVersionEquivalent": version_equivalence,
        "pairedItems": len(shared),
        "summary": summary,
        "findings": findings,
        "comparisonUrl": comparison_url,
        "interface": INTERFACE[TOOL_REGRESSION],
    }, tool=TOOL_REGRESSION, warnings=warnings)


# --- 5) listEvaluatorVersions --------------------------------------------------

def evaluator_versions(args, ctx):
    """Wersje ewaluatora z natywnego API v2 (brak odpowiednika w katalogu MCP)."""
    evaluator_id = args.get("evaluatorId")
    if not evaluator_id:
        return failure("INVALID_ARGUMENT", "evaluatorId is required", tool=TOOL_EVALUATOR_VERSIONS)
    try:
        payload = ctx["upstream"].rest_get(
            "/api/public/v2/evaluators/%s/versions" % urllib.parse.quote(str(evaluator_id)))
    except Exception as exc:  # noqa: BLE001
        code = getattr(exc, "code", "UPSTREAM_ERROR")
        return failure(code, str(exc), tool=TOOL_EVALUATOR_VERSIONS)
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        data = payload if isinstance(payload, list) else []
    versions = []
    for entry in data:
        if not isinstance(entry, dict):
            continue
        versions.append({
            "version": entry.get("version"),
            "id": entry.get("id"),
            "createdAt": entry.get("createdAt"),
            "runtime": entry.get("runtime"),
            "sourceCodeLanguage": entry.get("sourceCodeLanguage"),
            "hasSourceCode": bool(entry.get("sourceCode")),
            "sourceCode": entry.get("sourceCode"),
            "prompt": entry.get("prompt"),
            "model": entry.get("model"),
            "provider": entry.get("provider"),
            "outputDefinition": entry.get("outputDefinition"),
        })
    return success({
        "evaluatorId": evaluator_id,
        "versionCount": len(versions),
        "versions": versions,
        "interface": INTERFACE[TOOL_EVALUATOR_VERSIONS],
    }, tool=TOOL_EVALUATOR_VERSIONS)
