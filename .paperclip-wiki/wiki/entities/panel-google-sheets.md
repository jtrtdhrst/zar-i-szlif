---
title: Panel Google Sheets — trwały stan drużyny
type: entity
tags: [google-sheets, panel, oauth, integracja]
sources: [raw/WSPOLNY_KONTEKST.md, raw/DOKUMENTACJA-INTEGRACJI.md]
created: 2026-08-20
updated: 2026-08-20
---

# Panel Google Sheets

Szablon arkusza Google Sheets jako trwały stan drużyny. Landing 2 opcje: istniejący arkusz / kopia szablonu `SHEETS_TEMPLATE_FILE_ID`. OAuth scope `drive.file`. Zapis karty przez `POST /panel/save` (`values.append`, mapowanie kolumn) dopiero po podglądzie i potwierdzeniu; awaria ≠ sukces. Kod: `kompas-ui-plugin/cloudflare-worker/src/panel-handler.ts`, `oauth.ts`, `google-handler.ts`. Kontrakt struktury szablonu: `SZABLON GOOGLE DOCS.md` (nagłówki `[...]`).

