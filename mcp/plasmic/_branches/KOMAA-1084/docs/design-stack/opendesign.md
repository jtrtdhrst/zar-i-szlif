# OpenDesign w warstwie

- `open-design` (oficjalny lokalny MCP, stdio): pełny odczyt projektów/plików
  (`list_projects`, `get_project`, `get_file`, `list_files`, `search_files`,
  `get_artifact`) + generowanie (`start_run`, `get_run`, `cancel_run`, skills, brief).
  Faktyczny inwentarz: 22 narzędzia (wykryte, nie zakładane).
- UWAGA: MCP nie czyta design-systems (`list_projects` → puste). Dlatego:
- `services/opendesign-bridge-mcp` (`open-design-remote`, 9 narzędzi `design_*`):
  czyta design-systems przez daemon REST (`/api/design-systems/*`,
  Bearer `OD_API_TOKEN`). `design_get_context` zwraca `DesignContext`
  (project, tokens, components, constraints, sourceRefs) z limitem ~48 KB.
- Polityka write: READ-ONLY. Write-back tylko ścieżką
  zdalny klient → proposal → Paperclip/OpenCode → walidacja → OpenDesign (niezaimplementowane w v1).
