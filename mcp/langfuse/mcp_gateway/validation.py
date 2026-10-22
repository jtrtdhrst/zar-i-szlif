"""Walidacja argumentow narzedzi MCP (podzbior JSON Schema draft-07).

Sprawdzamy argumenty ZANIM polecimy do API, zeby klient dostal jeden
spojny kontrakt bledow zamiast surowego 400 z upstreamu. Wspierane:
type, required, enum, minimum/maximum/exclusiveMinimum, format date-time,
items, properties, additionalProperties=false.
"""
import datetime

_PY_TYPES = {"object": dict, "array": list, "string": str, "boolean": bool,
             "number": (int, float), "integer": int}


def _type_ok(value, expected):
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    py = _PY_TYPES.get(expected)
    return isinstance(value, py) if py else True


def _is_datetime(value):
    if not isinstance(value, str):
        return False
    try:
        datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def _check(spec, value, path, issues):
    expected = spec.get("type")
    if expected and not _type_ok(value, expected):
        issues.append({"field": path, "code": "INVALID_TYPE",
                       "message": f"'{path}' must be of type {expected}"})
        return
    if "enum" in spec and value not in spec["enum"]:
        issues.append({"field": path, "code": "INVALID_ENUM",
                       "message": f"'{path}' must be one of {spec['enum']}"})
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in spec and value < spec["minimum"]:
            issues.append({"field": path, "code": "OUT_OF_RANGE",
                           "message": f"'{path}' must be >= {spec['minimum']}"})
        if "maximum" in spec and value > spec["maximum"]:
            issues.append({"field": path, "code": "OUT_OF_RANGE",
                           "message": f"'{path}' must be <= {spec['maximum']}"})
        if "exclusiveMinimum" in spec and value <= spec["exclusiveMinimum"]:
            issues.append({"field": path, "code": "OUT_OF_RANGE",
                           "message": f"'{path}' must be > {spec['exclusiveMinimum']}"})
    if spec.get("format") == "date-time" and not _is_datetime(value):
        issues.append({"field": path, "code": "INVALID_DATETIME",
                       "message": f"'{path}' must be an ISO-8601 date-time"})
    if expected == "array" and isinstance(value, list):
        item_spec = spec.get("items")
        if isinstance(item_spec, dict):
            for i, item in enumerate(value):
                _check(item_spec, item, f"{path}[{i}]", issues)
    if expected == "object" and isinstance(value, dict):
        props = spec.get("properties") or {}
        for name in spec.get("required") or []:
            if name not in value or value[name] is None:
                issues.append({"field": f"{path}.{name}".lstrip("."), "code": "MISSING_ARGUMENT",
                               "message": f"'{name}' is required"})
        for name, item in value.items():
            if name in props:
                _check(props[name], item, f"{path}.{name}".lstrip("."), issues)


def validate(schema, args, extra_allowed=()):
    """Zwraca liste problemow: [{field, code, message}]. Pusta lista = argumenty poprawne."""
    issues = []
    if not isinstance(args, dict):
        return [{"field": "", "code": "INVALID_ARGUMENT", "message": "arguments must be a JSON object"}]
    props = schema.get("properties") or {}
    for name in schema.get("required") or []:
        if name not in args or args[name] is None:
            issues.append({"field": name, "code": "MISSING_ARGUMENT",
                           "message": f"'{name}' is required"})
    if schema.get("additionalProperties") is False:
        allowed = sorted(set(props) | set(extra_allowed))
        for key in args:
            if key not in props and key not in extra_allowed:
                issues.append({"field": key, "code": "UNKNOWN_ARGUMENT",
                               "message": f"unknown argument '{key}'; allowed: {allowed}"})
    for key, value in args.items():
        spec = props.get(key)
        if isinstance(spec, dict):
            _check(spec, value, key, issues)
    return issues


def apply_defaults(schema, args):
    """Uzupelnia argumenty domyslnymi wartosciami zadeklarowanymi w schemacie."""
    out = dict(args)
    for name, spec in (schema.get("properties") or {}).items():
        if name not in out and isinstance(spec, dict) and "default" in spec:
            out[name] = spec["default"]
    return out


def apply_limits(schema, args):
    """Przytnie `limit` do maksimum zadeklarowanego przez API. Zwraca (args, warnings)."""
    warnings = []
    spec = (schema.get("properties") or {}).get("limit") or {}
    maximum = spec.get("maximum")
    if isinstance(maximum, int) and isinstance(args.get("limit"), int) and args["limit"] > maximum:
        warnings.append(f"limit clamped from {args['limit']} to {maximum}")
        args = dict(args)
        args["limit"] = maximum
    return args, warnings
