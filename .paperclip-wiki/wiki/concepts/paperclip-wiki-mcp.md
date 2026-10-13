---
title: Paperclip MCP Wiki — read path i bezpieczna edycja
type: concept
tags: [paperclip, mcp, wiki, concurrency, optimistic-locking]
sources: [raw/WSPOLNY_KONTEKST.md, raw/documentation.md]
created: 2026-08-26
updated: 2026-08-26
---

# Paperclip MCP Wiki

## Zakres

Paperclip MCP udostępnia bezpieczne strony Wiki z katalogu `wiki/`. Read path
obejmuje listowanie, wyszukiwanie, metadata i pełny Markdown strony. Write path
jest dwuetapowy: propozycja z diffem, a następnie zastosowanie zaakceptowanej
propozycji z kontrolą optimistic locking.

Narzędzia:

- `paperclipWikiList` — lista bezpiecznych stron i ich capabilities.
- `paperclipWikiSearch` — kompaktowe wyszukiwanie metadata.
- `paperclipWikiGetPage` — pełna treść oraz aktualny hash.
- `paperclipWikiGetMetadata` — metadata strony oraz aktualny hash.
- `paperclipWikiProposeChange` — niezmieniająca Wiki propozycja i diff.
- `paperclipWikiApplyChange` — jednorazowe zastosowanie propozycji.

## Procedura odczytu i edycji

1. Wyszukaj lub wylistuj strony.
2. Pobierz docelową stronę przez `paperclipWikiGetPage`.
3. Zachowaj hash z tego bezpośredniego odczytu.
4. Przygotuj pełną treść i wywołaj `paperclipWikiProposeChange` z tym hashem.
5. Przejrzyj zwrócony `diff`, `resultingHash` i `warnings`.
6. Po akceptacji wywołaj `paperclipWikiApplyChange` z `proposalId` oraz tym
   samym `expectedHash`.

`hash` i `updatedAt` z `paperclipWikiList` nie są autorytatywnymi revision
metadata. Listing może zwrócić `hash: null` lub `updatedAt: null`, mimo że
bezpośredni odczyt strony zwraca poprawną wartość. Do propozycji i zastosowania
zawsze używaj hash z `GetPage` lub `GetMetadata` wykonanych bezpośrednio przed
operacją.

## Bezpieczeństwo i konflikty

Publiczny path ogranicza się do stron Markdown pod `wiki/`. Odrzucane są
`raw/`, `AGENTS.md`, templates, runtime configuration, skill files, sekrety,
`.git/` oraz ścieżki traversal. Naruszenie granicy zwraca
`WIKI_PATH_FORBIDDEN`.

Jeśli strona zmieniła się po odczycie lub propozycji, narzędzie zwraca
`WIKI_HASH_CONFLICT` i nie nadpisuje równoległej zmiany. Nie ponawiaj zapisu z
wymuszonym hashem: pobierz stronę ponownie, zbuduj nową propozycję i poddaj ją
ponownej ocenie.

## Stan weryfikacji

Potwierdzony jest live read path: autoryzacja i company context, 35 bezpiecznych
stron, wyszukiwanie, metadata, pełna treść, SHA-256 oraz blokada ścieżek
chronionych. Skille `wiki-query`, `wiki-propose-change` i `wiki-apply-change`
są zarejestrowane. Pełny write-path E2E z zapisem i przywróceniem oryginału nie
jest częścią tej weryfikacji.

## Plugin-tools execute: zweryfikowana korekta KOMAA-782 (2026-10-13)

Dla narzędzia `paperclipai.plugin-llm-wiki:wiki_list_pages` wywoływanego przez `POST /api/plugins/tools/execute` **nie wystarcza** `runContext.companyId`: procesor Wiki czyta `companyId` także z `parameters`. Własny, autoryzowany run/agent używa:

```json
{
  "tool": "paperclipai.plugin-llm-wiki:wiki_list_pages",
  "parameters": {"companyId": "<companyId z własnego runContext>", "wikiId": "default"},
  "runContext": {"agentId": "<własny agentId>", "runId": "<własny runId>", "companyId": "<ten sam companyId>", "projectId": "<własny projectId>"}
}
```

Żądanie musi mieć własną autoryzację i nagłówek `X-Paperclip-Run-Id`; powyższe placeholdery nie są dosłownymi danymi do wysłania. Równoważność `parameters.companyId === runContext.companyId` jest obowiązkowa. `parameters={}` daje deterministyczny błąd `companyId is required` mimo poprawnego `runContext` (KOMAA-782). Nie próbuj ponownie tej samej błędnej postaci. Naprawa kształtu wywołania **nie oznacza** uaktualnienia treści. Po dostępie wykonaj pełny odczyt i edycję z `expectedHash`, następnie read-back każdej zmienionej strony i niezależny review. Jeśli uprawnienia odmówią (`403`), zatrzymaj zapis i eskaluj prawdziwą granicę uprawnień; nigdy nie obchodź ACL. Odrębnie raportuj: naprawiony kontrakt narzędzia, udane zapisy Wiki, faktyczne wdrożenie UI.
