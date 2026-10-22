"""Pure helpers over Langfuse observation lists. No I/O, no imports outside stdlib."""
from __future__ import annotations

from collections.abc import Callable
from datetime import datetime

#: Metric keys reported as deltas by :func:`compare_traces`.
DELTA_METRICS = (
    "observationCount",
    "durationMs",
    "totalLatencyMs",
    "errorCount",
    "tokens.total",
    "cost.total",
)


def _node(obs: dict) -> dict:
    """Project an observation onto the canonical node shape."""
    node = {
        "id": obs.get("id"),
        "traceId": obs.get("traceId"),
        "name": obs.get("name"),
        "type": obs.get("type"),
        "level": obs.get("level"),
        "startTime": obs.get("startTime"),
        "endTime": obs.get("endTime"),
        "latency": obs.get("latency"),
        "parentObservationId": obs.get("parentObservationId"),
        "statusMessage": obs.get("statusMessage"),
        "providedModelName": obs.get("providedModelName"),
        "isRootObservation": obs.get("isRootObservation"),
        "children": [],
    }
    # Kontekst wykonania - obecny tylko wtedy, gdy API go zwrocilo.
    for key in ("environment", "version", "release", "userId", "sessionId",
                "timeToFirstToken", "completionStartTime", "internalModelId",
                "usageDetails", "costDetails", "totalCost",
                "promptId", "promptName", "promptVersion",
                "usagePricingTierId", "usagePricingTierName", "url",
                # tresc: tylko gdy jawnie zamowiona (drogie i wrazliwe pola API)
                "input", "output", "metadata", "modelParameters"):
        if key in obs:
            node[key] = obs.get(key)
    return node


def _sort_key(node: dict) -> tuple[str, str]:
    """Deterministic ordering key: start time first, id as tiebreaker."""
    return (str(node.get("startTime") or ""), str(node.get("id") or ""))


def _num(value) -> float:
    """Return value as float, 0.0 for missing or non-numeric input."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0.0
    return float(value)


def _parse_time(value) -> datetime | None:
    """Parse an ISO-8601 timestamp, None when missing or unparseable."""
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _on_cycle(oid: str, nodes: dict[str, dict]) -> bool:
    """True when following parents from oid loops back to oid."""
    seen: set[str] = set()
    cur = oid
    while True:
        if cur in seen:
            return cur == oid
        seen.add(cur)
        parent = nodes[cur].get("parentObservationId")
        if not isinstance(parent, str) or parent not in nodes:
            return False
        cur = parent


def build_tree(observations: list[dict]) -> list[dict]:
    """Group observations into root nodes with nested children."""
    by_id: dict[str, dict] = {}
    for obs in observations:
        oid = obs.get("id")
        if not isinstance(oid, str) or not oid:
            continue
        by_id.setdefault(oid, obs)

    nodes = {oid: _node(obs) for oid, obs in by_id.items()}
    children_of: dict[str, list[dict]] = {oid: [] for oid in nodes}
    roots: list[dict] = []
    for oid, node in nodes.items():
        parent = node.get("parentObservationId")
        if (not isinstance(parent, str) or not parent or parent not in nodes
                or _on_cycle(oid, nodes)):
            roots.append(node)
        else:
            children_of[parent].append(node)

    for oid, node in nodes.items():
        node["children"] = sorted(children_of[oid], key=_sort_key)
    roots.sort(key=_sort_key)
    return roots


def summarize(observations: list[dict]) -> dict:
    """Aggregate counts, timings, tokens and cost over observations."""
    by_type: dict[str, int] = {}
    by_level: dict[str, int] = {}
    by_model: dict[str, int] = {}
    tokens = {"input": 0, "output": 0, "total": 0, "observationsWithUsage": 0}
    cost_total = 0.0
    observations_with_cost = 0
    error_count = 0
    warning_count = 0
    total_latency = 0.0
    starts: list[str] = []
    ends: list[str] = []

    for obs in observations:
        otype = obs.get("type")
        tkey = otype if isinstance(otype, str) and otype else "(unknown)"
        by_type[tkey] = by_type.get(tkey, 0) + 1
        level = obs.get("level")
        lkey = level if isinstance(level, str) and level else "(unknown)"
        by_level[lkey] = by_level.get(lkey, 0) + 1
        model = obs.get("providedModelName")
        mkey = model if isinstance(model, str) and model else "(unknown)"
        by_model[mkey] = by_model.get(mkey, 0) + 1

        if level == "ERROR":
            error_count += 1
        elif level == "WARNING":
            warning_count += 1

        start = obs.get("startTime")
        if isinstance(start, str) and start:
            starts.append(start)
        end = obs.get("endTime")
        if isinstance(end, str) and end:
            ends.append(end)

        total_latency += _num(obs.get("latency")) * 1000.0

        usage = obs.get("usageDetails")
        if isinstance(usage, dict) and usage:
            tokens["observationsWithUsage"] += 1
            for key in ("input", "output", "total"):
                tokens[key] += int(_num(usage.get(key)))

        unit_cost = obs.get("totalCost")
        if not isinstance(unit_cost, bool) and isinstance(unit_cost, (int, float)):
            cost_total += float(unit_cost)
            observations_with_cost += 1

    first_start = min(starts) if starts else None
    last_end = max(ends) if ends else None
    duration_ms = 0.0
    start_dt = _parse_time(first_start)
    end_dt = _parse_time(last_end)
    if start_dt is not None and end_dt is not None:
        try:
            duration_ms = round((end_dt - start_dt).total_seconds() * 1000.0, 3)
        except TypeError:
            duration_ms = 0.0

    return {
        "observationCount": len(observations),
        "rootCount": len(build_tree(observations)),
        "errorCount": error_count,
        "warningCount": warning_count,
        "firstStartTime": first_start,
        "lastEndTime": last_end,
        "durationMs": duration_ms,
        "totalLatencyMs": round(total_latency, 3),
        "byType": by_type,
        "byLevel": by_level,
        "byModel": by_model,
        "tokens": tokens,
        "cost": {"total": round(cost_total, 10), "observationsWithCost": observations_with_cost},
    }


def _self_latency(node: dict) -> float:
    """Latency of a node minus the latency covered by its direct children."""
    child_sum = sum(_num(child.get("latency")) for child in node.get("children", []))
    return max(0.0, _num(node.get("latency")) - child_sum)


def _best_chain(node: dict) -> tuple[list[dict], float]:
    """Chain from node to a leaf plus the summed self latency along it."""
    best_child: list[dict] = []
    best_score = 0.0
    for child in node.get("children", []):
        chain, score = _best_chain(child)
        if (not best_child or score > best_score
                or (score == best_score and _sort_key(chain[0]) < _sort_key(best_child[0]))):
            best_child, best_score = chain, score
    return [node] + best_child, _self_latency(node) + best_score


def critical_path(observations: list[dict]) -> list[dict]:
    """Return the root->leaf chain maximizing summed self latency."""
    best: list[dict] = []
    best_score: float | None = None
    for root in build_tree(observations):
        chain, score = _best_chain(root)
        if (best_score is None or score > best_score
                or (score == best_score and _sort_key(chain[0]) < _sort_key(best[0]))):
            best, best_score = chain, score
    return [{k: v for k, v in node.items() if k != "children"} for node in best]


def find_errors(observations: list[dict]) -> list[dict]:
    """Collect observations flagged as ERROR/WARNING or carrying a status message."""
    found = []
    for obs in observations:
        level = obs.get("level")
        message = obs.get("statusMessage")
        if level not in ("ERROR", "WARNING") and not (isinstance(message, str) and message):
            continue
        found.append({
            "id": obs.get("id"),
            "traceId": obs.get("traceId"),
            "name": obs.get("name"),
            "type": obs.get("type"),
            "level": level,
            "statusMessage": message,
            "startTime": obs.get("startTime"),
        })
    found.sort(key=lambda item: (str(item.get("startTime") or ""), str(item.get("id") or "")))
    return found


def _metric_value(summary: dict, metric: str):
    """Read a possibly nested summary metric."""
    if "." in metric:
        outer, inner = metric.split(".", 1)
        return summary.get(outer, {}).get(inner)
    return summary.get(metric)


def compare_traces(trace_ids: list[str], fetch: Callable[[str], list[dict]]) -> dict:
    """Compare fetched traces and report per-metric deltas between first and last."""
    traces = []
    errors: dict[str, str] = {}
    for tid in trace_ids:
        try:
            observations = fetch(tid)
        except Exception as exc:  # a failing trace must not break the comparison
            observations = []
            errors[tid] = str(exc) or type(exc).__name__
        summary = summarize(observations)
        traces.append({
            "traceId": tid,
            "summary": summary,
            "errorCount": summary["errorCount"],
            "rootCount": summary["rootCount"],
            "durationMs": summary["durationMs"],
        })

    deltas = []
    if trace_ids:
        first_id, last_id = trace_ids[0], trace_ids[-1]
        for metric in DELTA_METRICS:
            values = {t["traceId"]: _metric_value(t["summary"], metric) for t in traces}
            first_value = values.get(first_id)
            last_value = values.get(last_id)
            delta = last_value - first_value
            ratio = None if not first_value else round(delta / first_value * 100, 2)
            deltas.append({
                "metric": metric,
                "values": values,
                "change": {
                    "first": first_id,
                    "last": last_id,
                    "delta": delta,
                    "ratioPct": ratio,
                },
            })

    return {"traces": traces, "deltas": deltas, "errors": errors}
