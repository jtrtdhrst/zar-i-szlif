"""Pure helpers over queryMetrics results. No I/O, stdlib only."""
from __future__ import annotations

import json
from statistics import median

TIME_COLUMN = "time_dimension"
MAD_SCALE = 0.6745


def measure_columns(query: dict) -> list[str]:
    """Column names produced by query['metrics'], in order, as "<aggregation>_<measure>"."""
    cols: list[str] = []
    for metric in query.get("metrics") or []:
        agg = metric.get("aggregation") or "count"
        measure = metric.get("measure") or "count"
        col = f"{agg}_{measure}"
        if col not in cols:
            cols.append(col)
    return cols


def _dimension_fields(query: dict) -> list[str]:
    """Field names of query['dimensions'], in order."""
    fields: list[str] = []
    for dim in query.get("dimensions") or []:
        field = dim.get("field") if isinstance(dim, dict) else dim
        if field and field not in fields:
            fields.append(field)
    return fields


def _rows(result) -> list[dict]:
    """Data rows of a queryMetrics result."""
    return [r for r in ((result or {}).get("data") or []) if isinstance(r, dict)]


def _num(value):
    """Numeric value of value, or None when missing or non-numeric."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value


def _dimensions_of(row: dict, fields: list[str]) -> dict:
    """Dimension values of a row, limited to the queried dimension fields."""
    return {f: row[f] for f in fields if f in row}


def _row_key(row: dict, fields: list[str]) -> tuple:
    """Hashable match key of a row: time bucket plus dimension values."""
    dims = _dimensions_of(row, fields)
    return (row.get(TIME_COLUMN), json.dumps(dims, sort_keys=True, default=str))


def compare_metrics(run, query_a, query_b, labels=("a", "b")) -> dict:
    """run(query) -> parsed queryMetrics result {"data":[rows], "meta":...}.
    Runs both queries, matches rows by (dimension values, time bucket) and reports the difference.
    Returns {"labels": [l1, l2],
             "rows": [{"key": {"dimensions": {"type": "TOOL"}, "time": "2026-10-13"},
                        "a": {"count_count": 874}, "b": {"count_count": 900},
                        "delta": {"count_count": 26}, "deltaPct": {"count_count": 2.97}}],
             "summary": {"a": {"count_count": 874}, "b": {"count_count": 900},
                         "delta": {"count_count": 26}, "deltaPct": {"count_count": 2.97}},
             "meta": {"rowsA": n, "rowsB": n, "matched": n, "onlyA": n, "onlyB": n}}
    Side keys stay "a"/"b"; "labels" names them (labels[0] is side "a").
    """
    rows_a = _rows(run(query_a))
    rows_b = _rows(run(query_b))
    fields_a, fields_b = _dimension_fields(query_a), _dimension_fields(query_b)
    fields = fields_a + [f for f in fields_b if f not in fields_a]
    cols_a, cols_b = measure_columns(query_a), measure_columns(query_b)
    cols = cols_a + [c for c in cols_b if c not in cols_a]

    idx_a = {_row_key(r, fields): r for r in rows_a}
    idx_b = {_row_key(r, fields): r for r in rows_b}
    keys = sorted(set(idx_a) | set(idx_b), key=lambda k: (str(k[0]), k[1]))

    out_rows = []
    for key in keys:
        row_a, row_b = idx_a.get(key), idx_b.get(key)
        source = row_a if row_a is not None else row_b
        measures_a = {c: _num(row_a[c]) for c in cols if row_a is not None and _num(row_a.get(c)) is not None}
        measures_b = {c: _num(row_b[c]) for c in cols if row_b is not None and _num(row_b.get(c)) is not None}
        delta, delta_pct = {}, {}
        for col in cols:
            val_a = _num(row_a.get(col)) if row_a is not None else None
            val_b = _num(row_b.get(col)) if row_b is not None else None
            if val_a is None and val_b is None:
                continue
            diff = (val_b or 0) - (val_a or 0)
            delta[col] = diff
            delta_pct[col] = round(diff / val_a * 100, 2) if val_a else None
        out_rows.append({
            "key": {"dimensions": _dimensions_of(source, fields), "time": source.get(TIME_COLUMN)},
            "a": measures_a,
            "b": measures_b,
            "delta": delta,
            "deltaPct": delta_pct,
        })

    totals_a = {c: 0 for c in cols}
    totals_b = {c: 0 for c in cols}
    for row in rows_a:
        for col in cols:
            value = _num(row.get(col))
            if value is not None:
                totals_a[col] += value
    for row in rows_b:
        for col in cols:
            value = _num(row.get(col))
            if value is not None:
                totals_b[col] += value
    summary = {
        "a": totals_a,
        "b": totals_b,
        "delta": {c: totals_b[c] - totals_a[c] for c in cols},
        "deltaPct": {c: (round((totals_b[c] - totals_a[c]) / totals_a[c] * 100, 2) if totals_a[c] else None)
                     for c in cols},
    }
    meta = {
        "rowsA": len(rows_a),
        "rowsB": len(rows_b),
        "matched": len(set(idx_a) & set(idx_b)),
        "onlyA": len(set(idx_a) - set(idx_b)),
        "onlyB": len(set(idx_b) - set(idx_a)),
    }
    return {"labels": list(labels), "rows": out_rows, "summary": summary, "meta": meta}


def usage_breakdown(run, query, dimension, limit=20) -> dict:
    """Groups metric rows by one dimension field.
    query["dimensions"] must contain the given dimension (a list of {"field": name}); if not, use it anyway.
    Returns {"dimension": dimension, "total": <sum of the first measure column>, "totalItems": n,
             "items": [{"value": "TOOL", "measures": {"count_count": 874}}, ...] sorted desc by the first measure column,
             "truncated": bool, "limit": limit}
    "totalItems" counts distinct dimension values before truncation.
    """
    rows = _rows(run(query))
    cols = measure_columns(query)
    first = cols[0] if cols else None
    groups: dict = {}
    for row in rows:
        value = row.get(dimension)
        measures = groups.setdefault(value, {})
        for col in cols:
            number = _num(row.get(col))
            if number is not None:
                measures[col] = measures.get(col, 0) + number
    items = [{"value": value, "measures": measures} for value, measures in groups.items()]
    items.sort(key=lambda item: _num(item["measures"].get(first)) or 0, reverse=True)
    total = sum(_num(row.get(first)) or 0 for row in rows) if first else 0
    truncated = len(items) > limit
    return {
        "dimension": dimension,
        "total": total,
        "totalItems": len(items),
        "items": items[:limit],
        "truncated": truncated,
        "limit": limit,
    }


def detect_anomalies(run, query, sensitivity=2.0, min_points=5) -> dict:
    """Time-series anomaly detection over query["timeDimension"] buckets.
    For every measure column: collect (time_dimension -> value) points sorted by time.
    Robust score: median + MAD (median absolute deviation); scaled z = 0.6745*(x-median)/MAD when MAD>0 else None.
    A point is an anomaly when scaled z is not None and abs(scaled z) >= sensitivity.
    Returns {"sensitivity": sensitivity, "minPoints": min_points, "method": "median+MAD",
             "measures": {"count_count": {"points": [{"time": t, "value": v, "score": z_or_null, "anomaly": bool}],
                                          "anomalies": [{"time": t, "value": v, "score": z}],
                                          "median": m, "mad": mad, "count": n}},
             "anomaliesTotal": n,
             "status": "ok" | "insufficient_data" (when a measure has fewer than min_points points)}
    Rows with a missing/non-numeric value are skipped. Missing measure column -> measure entry with empty points.
    """
    rows = _rows(run(query))
    measures = {}
    anomalies_total = 0
    insufficient = False
    for col in measure_columns(query):
        series: dict = {}
        for row in rows:
            value = _num(row.get(col))
            if value is None:
                continue
            series[row.get(TIME_COLUMN)] = value
        times = sorted(series, key=lambda t: (t is None, str(t)))
        values = [series[t] for t in times]
        if values:
            med = median(values)
            mad = median([abs(v - med) for v in values])
        else:
            med, mad = None, None
        points, anomalies = [], []
        for time in times:
            value = series[time]
            score = MAD_SCALE * (value - med) / mad if mad else None
            is_anomaly = score is not None and abs(score) >= sensitivity
            points.append({"time": time, "value": value, "score": score, "anomaly": is_anomaly})
            if is_anomaly:
                anomalies.append({"time": time, "value": value, "score": score})
        measures[col] = {"points": points, "anomalies": anomalies,
                          "median": med, "mad": mad, "count": len(values)}
        anomalies_total += len(anomalies)
        if len(values) < min_points:
            insufficient = True
    return {
        "sensitivity": sensitivity,
        "minPoints": min_points,
        "method": "median+MAD",
        "measures": measures,
        "anomaliesTotal": anomalies_total,
        "status": "insufficient_data" if insufficient else "ok",
    }
