"""Katalog narzedzi upstream Langfuse MCP: nazwy, schematy JSON Schema, domeny.

Zrodlo: snapshot `tools/list` z evidence/langfuse-mcp-catalog.json (85 narzedzi).
Jesli plik nie jest dostepny, katalog jest pusty - gateway nadal dziala, ale
bez walidacji opartej na schematach.
"""
import json
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
_CANDIDATES = [
    os.environ.get("LANGFUSE_MCP_CATALOG", ""),
    "/app/langfuse-mcp-catalog.json",
    "/langfuse-mcp-catalog.json",
    os.path.join(_HERE, "..", "..", "evidence", "langfuse-mcp-catalog.json"),
]


def _load():
    for path in _CANDIDATES:
        if path and os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    payload = json.load(fh)
            except (OSError, ValueError):
                continue
            tools = (payload.get("result") or {}).get("tools") or []
            return {t["name"]: t for t in tools if isinstance(t, dict) and t.get("name")}
    return {}


TOOLS = _load()

# domena -> narzędzia (stan na 2026-10-20, Langfuse v4.33.0)
_DOMAINS = {
    "observations": ["listObservations", "getObservation", "getObservationFieldSchema",
                     "getObservationFilterSchema", "getObservationFilterValues"],
    "scores": ["listScores", "getScore", "createScore", "listScoreConfigs", "getScoreConfig",
               "createScoreConfig", "updateScoreConfig", "deleteScoreConfig"],
    "evaluators": ["listManagedEvaluatorTemplates", "listEvaluators", "getEvaluator", "testEvaluator",
                   "createEvaluator", "updateEvaluator", "deleteEvaluator", "listEvaluationRules",
                   "getEvaluationRule", "createEvaluationRule", "updateEvaluationRule",
                   "attachEvaluatorToEvaluationRule", "detachEvaluatorFromEvaluationRule",
                   "deleteEvaluationRule"],
    "datasets": ["upsertDataset", "listDatasets", "getDataset", "upsertDatasetItem",
                 "listDatasetItems", "getDatasetItem", "deleteDatasetItem", "createDatasetRunItem",
                 "listDatasetRunItems", "listDatasetRuns", "getDatasetRun", "deleteDatasetRun"],
    "experiments": ["listExperiments", "listExperimentItems"],
    "prompts": ["listPrompts", "getPrompt", "getPromptUnresolved", "createTextPrompt",
                "createChatPrompt", "updatePromptLabels"],
    "models": ["listModels", "createModel", "getModel", "deleteModel"],
    "dashboards": ["listDashboards", "getDashboard", "createDashboard", "updateDashboard",
                   "deleteDashboard", "listDashboardWidgets", "getDashboardWidget",
                   "createDashboardWidget", "updateDashboardWidget", "deleteDashboardWidget",
                   "addDashboardPlacement", "updateDashboardPlacement", "deleteDashboardPlacement"],
    "alerts": ["listAlerts", "getAlert"],
    "annotations": ["listAnnotationQueues", "createAnnotationQueue", "getAnnotationQueue",
                    "listAnnotationQueueItems", "getAnnotationQueueItem", "createAnnotationQueueItem",
                    "updateAnnotationQueueItem", "deleteAnnotationQueueItem",
                    "createAnnotationQueueAssignment", "deleteAnnotationQueueAssignment",
                    "listComments", "createComment", "getComment"],
    "metrics": ["queryMetrics", "getMetricsSchema"],
    "platform": ["getHealth", "getV4MigrationData", "getMedia", "submitFeedback"],
}

DOMAIN_OF = {name: domain for domain, names in _DOMAINS.items() for name in names}
DOMAINS = {domain: list(names) for domain, names in _DOMAINS.items()}

# domena gateway -> domeny upstream (trace'y upstream nazywaja sie observations)
DOMAIN_ALIASES = {"traces": {"observations"}, "metrics": {"metrics", "observations"},
                  "platform": {"platform", "observations"}}


def tool_names():
    """Nazwy wszystkich narzedzi upstream (katalog + ewentualne nowe w upstream)."""
    return sorted(set(TOOLS) | set(DOMAIN_OF))


def schema_of(name):
    """JSON Schema argumentow narzedzia (pusty dict gdy brak katalogu)."""
    return (TOOLS.get(name) or {}).get("inputSchema") or {}


def description_of(name):
    return (TOOLS.get(name) or {}).get("description") or ""


def domain_of(name):
    return DOMAIN_OF.get(name, "other")
