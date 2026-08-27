---
title: Panel Google Sheets — trwały stan drużyny
type: entity
tags: [google-sheets, panel, oauth, integracja]
sources: [raw/WSPOLNY_KONTEKST.md, raw/DOKUMENTACJA-INTEGRACJI.md]
created: 2026-08-20
updated: 2026-08-27
---

# Panel Google Sheets

Google Sheets jest trwałym stanem i pamięcią drużyny. Po rejestracji użytkownik może podłączyć istniejący arkusz albo utworzyć kopię szablonu `SHEETS_TEMPLATE_FILE_ID`. Arkusz może być wspólnym kontekstem kilku liderów tej samej drużyny i pozostaje czytelny także poza panelem.

## Rola produktowa

W arkuszu zostają dane potrzebne do zachowania ciągłości pracy: kontekst drużyny, plany i karty aktywności, obserwacje, refleksje oraz potwierdzone wnioski lub reguły działania. Dzięki temu kolejna rozmowa lub planowanie nie musi zaczynać się od odtwarzania całej historii z pamięci instruktora.

Google Sheets jest także trwałym planem awaryjnym — dane pozostają dostępne w arkuszu nawet wtedy, gdy sam panel nie jest dostępny.

Nie obiecywać synchronizacji między urządzeniami poza mechanizmem opartym o Google Sheets.

## Zasada zapisu

Istotny zapis do trwałej pamięci wymaga podglądu i potwierdzenia użytkownika. Awaria zapisu nie może być przedstawiana jako sukces.

Technicznie zapis karty odbywa się przez `POST /panel/save` (`values.append`, mapowanie kolumn) dopiero po podglądzie i potwierdzeniu.

## Integracja

- OAuth scope: `drive.file`.
- Landing: istniejący arkusz albo kopia szablonu.
- Kod: `kompas-ui-plugin/cloudflare-worker/src/panel-handler.ts`, `oauth.ts`, `google-handler.ts`.
- Kontrakt struktury szablonu: `SZABLON GOOGLE DOCS.md` (nagłówki `[...]`).

Powiązane: [[wiki/sources/wspolny-kontekst]], [[wiki/concepts/karta-zbiorki]].