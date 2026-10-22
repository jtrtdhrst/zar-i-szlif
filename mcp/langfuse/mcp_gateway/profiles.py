"""Profile uprawnien narzedzi MCP (read-only / operator-write / full) i efekt narzedzia.

Podzial read/write/delete jest jednym z wymogow kontraktu: agent widzi tylko
narzedzia, do ktorych ma uprawnienia, a gateway dodatkowo pilnuje, ze zapis
nie zmienia niczego w strumieniu produkcyjnym bez jawnego zadania.
"""

READONLY_PROFILE = "read-only"
OPERATOR_WRITE_PROFILE = "operator-write"
FULL_PROFILE = "full"

# Narzedzia tylko odczytujace stan projektu.
READONLY_TOOLS = frozenset({
    "getHealth", "getV4MigrationData", "getMetricsSchema",
    "getObservationFieldSchema", "getObservationFilterSchema",
    "getObservationFilterValues", "listManagedEvaluatorTemplates",
    "listObservations", "getObservation",
    "listScores", "getScore", "listScoreConfigs", "getScoreConfig",
    "listEvaluators", "getEvaluator", "listEvaluationRules", "getEvaluationRule",
    "listDatasets", "getDataset", "listDatasetItems", "getDatasetItem",
    "listExperiments", "listExperimentItems",
    "listPrompts", "getPrompt", "getPromptUnresolved", "listModels", "getModel",
    "listDashboards", "getDashboard", "listDashboardWidgets", "getDashboardWidget",
    "listAlerts", "getAlert", "listComments", "getComment",
    "listAnnotationQueues", "getAnnotationQueue",
    "listAnnotationQueueItems", "getAnnotationQueueItem",
    "queryMetrics", "getMedia",
})

# Zmiany konfiguracji bez niszczenia danych.
OPERATOR_WRITE_TOOLS = frozenset({
    "createEvaluator", "updateEvaluator",
    "createEvaluationRule", "updateEvaluationRule",
    "attachEvaluatorToEvaluationRule", "detachEvaluatorFromEvaluationRule",
    "createScoreConfig", "updateScoreConfig",
    "createModel", "updateModel",
    "createTextPrompt", "createChatPrompt", "updatePromptLabels",
    "upsertDataset", "upsertDatasetItem",
    "createDashboard", "updateDashboard",
    "createDashboardWidget", "updateDashboardWidget",
    "addDashboardPlacement", "updateDashboardPlacement",
    "testEvaluator",
})

PROFILE_TOOLS = {
    READONLY_PROFILE: READONLY_TOOLS,
    OPERATOR_WRITE_PROFILE: READONLY_TOOLS | OPERATOR_WRITE_TOOLS,
    FULL_PROFILE: None,  # None => brak filtrowania
}

# Narzedzia syntetyczne gateway, ktore zapisuja w Langfuse.
#
# GATEWAY_WRITE_TOOLS - zapis danych eksperymentow/trace'ow w projekcie
#   produkcyjnym: dozwolone wylacznie w profilu full (jak createDatasetRunItem).
# GATEWAY_CONFIG_WRITE_TOOLS - zapis konfiguracji (polaczenia LLM):
#   dozwolone w profilu operator-write i full, niedostepne w read-only.
GATEWAY_WRITE_TOOLS = frozenset({
    "runPromptExperiment",
})

GATEWAY_CONFIG_WRITE_TOOLS = frozenset({
    "upsertLlmConnection",
})


def gateway_visible(name, profile):
    """Czy syntezyczne narzedzie gateway jest widoczne w danym profilu."""
    if profile == FULL_PROFILE:
        return True
    if profile == OPERATOR_WRITE_PROFILE:
        return name not in GATEWAY_WRITE_TOOLS
    return name not in (GATEWAY_WRITE_TOOLS | GATEWAY_CONFIG_WRITE_TOOLS)


def effect_of(name):
    """'read' | 'write' | 'delete' dla narzedzia upstream."""
    if name in READONLY_TOOLS:
        return "read"
    if name in OPERATOR_WRITE_TOOLS:
        return "write"
    return "delete"


def profiles_for(name):
    """Listy profili, w ktorych narzedzie jest widoczne."""
    return [profile for profile, tools in PROFILE_TOOLS.items() if tools is None or name in tools]
