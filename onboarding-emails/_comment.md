## Rezultat: Sekwencja onboardingowa HTML + tagi — GOTOWE

### Utworzone artefakty

**Dokumentacja:**
- `onboarding-emails/MAPA-AUTOMATYZACJI.md` — mapa sekwencji, tagi, drzewo decyzyjne, warunki wyjscia, kroki wdrozenia w Sender.net

**Szablony HTML (mobile-first, inline CSS, 600px max, zero JS):**
- `onboarding-emails/html/email-0-powitanie.html` — natychmiast po rejestracji (transakcyjny)
- `onboarding-emails/html/email-1-trzy-kroki.html` — +1d, 3 kroki do zbiorki (transakcyjny)
- `onboarding-emails/html/email-2-model-sens.html` — +3d, model SENS->DZIALANIE->REFLEKSJA (marketingowy)
- `onboarding-emails/html/email-3-przypomnienie.html` — +7d, przyklad uzycia (marketingowy)
- `onboarding-emails/html/email-4-reaktywacja.html` — +14d, reaktywacja dla nieaktywnych (marketingowy)

**Plain-text fallback:**
- `onboarding-emails/plain-text/email-0-powitanie.txt`
- `onboarding-emails/plain-text/email-1-trzy-kroki.txt`
- `onboarding-emails/plain-text/email-2-model-sens.txt`
- `onboarding-emails/plain-text/email-3-przypomnienie.txt`
- `onboarding-emails/plain-text/email-4-reaktywacja.txt`

### Sekwencja (5 wiadomosci)

| # | Trigger | Subject | Typ |
|---|---------|---------|-----|
| 0 | Natychmiast | Witaj w Kompasie Zbiorakow | Transakcyjny |
| 1 | +1d | 3 kroki do gotowej zbiorki | Transakcyjny |
| 2 | +3d | Nie planuj pustych zbiorek - uzyj modelu SENS | Marketingowy |
| 3 | +7d | Gotowy na kolejna zbiroke? | Marketingowy |
| 4 | +14d (tylko nieaktywni) | Czy Kompas jest Ci jeszcze potrzebny? | Marketingowy |

### Tagi
`registered`, `onb_seq_active`, `onb_email_0_sent`...`onb_email_4_sent`, `onb_engaged`, `onb_completed`, `onb_inactive`, `txn_welcome`

### Blockery / NEEDS CONFIG
1. **Webhook rejestracji** — aplikacja Kompas Zbiorakow musi wysylac webhook do Sender.net po rejestracji (nakładanie tagow).
2. **Warunek braku aktywnosci** — jesli Sender.net nie obsluguje warunkow tagowych w automatach, Email 4 wymaga recznej segmentacji (NEEDS CONFIG).
3. **Sender.net MCP** — niedostepny z tego srodowiska; wdrozenie reczne lub po udostepnieniu MCP.

### Zmiana w dokumentacji
Zaktualizowano `documentation.md` — dodana sekcja "E-mail marketing (Sender.net)" ze statusem, tagami i plikami.

Deklaracja: nie zmieniono kodu aplikacji ani infrastruktury Kompasu.
