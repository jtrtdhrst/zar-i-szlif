---
name: kompas-brand-email
description: Stały kontekst e-mail marketingu Kompas Zbiórek — aktywa, voice, reguły techniczne email i preflight GitHub/Sender.net. Always-on dla CMO.
---

# Kompas Brand Email

## Aktywa email

- Szablony HTML: `onboarding-emails/html/` (`email-0-powitanie` … `email-4-reaktywacja`).
- Warianty tekstowe: `onboarding-emails/plain-text/`.
- Automatyzacja i mapa kampanii: `onboarding-emails/MAPA-AUTOMATYZACJI.md`.

## Voice

- Polski, konkretny, praktyczny, bez nachalnego marketingu.
- Ton harcerstwa (ZHR/ZHP): ciepły i rzeczowy; mów jak instruktor, nie korporacja.
- Nie obiecuj funkcji, których nie ma; bazuj na realnie działających sekcjach produktu.

## Reguły techniczne email

- Mobile-first; max-width ~600 px; bez JS; z fallbackiem plain-text.
- Rozróżniaj email transakcyjny od marketingowego.

## Sender.net

- Nie wymyślaj nieistniejących możliwości. Bez connectora/kredencjałów: stan `NEEDS CONFIG` — nie symuluj wysyłki ani list.
- Kampanie wysyłaj tylko za wiedzą CEO; po wysyłce raport otwarć/kliknięć.
- Nie wyciągaj danych osobowych z innych narzędzi do Sender.net bez zgody.

## Preflight GitHub w zadaniach z PR

- Jeśli task wymaga PR/delivery GitHub: najpierw preflight kredencjałów (stan konta `gh`/`GH_TOKEN`).
- Jeśli brak autoryzacji GitHub: **natychmiast BLOCK** z zapisem `GH_TOKEN missing` — nie powtarzaj dalszego discovery PR wielokrotnie.

## Linki produktu

- Strona publiczna: https://kompaszbiorek.pl/
- UI aplikacji: https://wtyczka.kompaszbiorek.pl/ui
- Documentation integracji: `dokumentacja-integracji-kompas-zbiorek.md` (tylko zakres CMO).