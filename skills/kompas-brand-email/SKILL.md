---
name: kompas-brand-email
description: Stały kontekst e-mail marketingu Żar i Szlif — aktywa, voice, reguły techniczne email i preflight GitHub/Sender.net. Always-on dla CMO.
---

# Żar i Szlif — Brand Email

Publiczna nazwa: **Żar i Szlif**. Nazwa skilla, URL i ścieżki mogą pozostać technicznym legacy. Nie emituj starej nazwy produktu jako aktualnej marki. Historyczne szablony onboardingu w `content/onboarding-emails/` mogą zawierać stary branding i nie są zatwierdzone do wysyłki; przed jakąkolwiek aktywacją wymagają osobnego audytu treści, zgód, linków i zatwierdzenia. Logo/slogan niezatwierdzone; zobacz `branding/BRAND.md`.

## Aktywa email

- Szablony HTML: `content/onboarding-emails/html/` (`email-0-powitanie` … `email-4-reaktywacja`).
- Warianty tekstowe: `content/onboarding-emails/plain-text/`.
- Automatyzacja i mapa kampanii: `content/onboarding-emails/MAPA-AUTOMATYZACJI.md`.
- Materiały marketingowe: `content/marketing/`.

`content/` zawiera treści, nie runtime aplikacji. Zmiana tekstu/emaila nie powinna trafiać do `app/`, chyba że task jawnie dotyczy renderowania lub integracji tych treści w produkcie.

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
- Aktualny UI/routing produkcyjny potwierdzaj z bieżącej konfiguracji przed publikacją linku; nie hardcoduj historycznego endpointu jako jedynego kanonu.
- Dokumentacja runtime/integracji aplikacji: `app/documentation.md` w zakresie dotyczącym CMO.
