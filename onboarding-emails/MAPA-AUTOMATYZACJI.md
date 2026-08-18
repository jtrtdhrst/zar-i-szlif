# Mapa automatyzacji onboardingowej — Kompas Zbiórek

## Tabela tagów

| Tag | Nazwa w Sender.net | Opis | Kiedy nakładać | Kiedy zdjąć |
|---|---|---|---|---|
| `registered` | `registered` | Nowy użytkownik po rejestracji | Rejestracja (webhook/API) | Po zakończeniu sekwencji lub porzuceniu |
| `onb_seq_active` | `onb_seq_active` | Aktywny w sekwencji onboardingowej | Wejście do sekwencji (Email 0) | Zakończenie sekwencji / porzucenie / unsubscribe |
| `onb_email_0_sent` | `onb_email_0_sent` | Wysłano Email 0 | Po wysłaniu Email 0 | — |
| `onb_email_1_sent` | `onb_email_1_sent` | Wysłano Email 1 | Po wysłaniu Email 1 | — |
| `onb_email_2_sent` | `onb_email_2_sent` | Wysłano Email 2 | Po wysłaniu Email 2 | — |
| `onb_email_3_sent` | `onb_email_3_sent` | Wysłano Email 3 | Po wysłaniu Email 3 | — |
| `onb_email_4_sent` | `onb_email_4_sent` | Wysłano Email 4 (reaktywacja) | Po wysłaniu Email 4 | — |
| `onb_completed` | `onb_completed` | Użytkownik ukończył sekwencję | Po Email 3 lub Email 4 | — |
| `onb_inactive` | `onb_inactive` | Użytkownik bez aktywności >7 dni | Warunek: brak aktywności | Po powrocie aktywności |
| `onb_engaged` | `onb_engaged` | Użytkownik z interakcją (kliknął CTA) | Kliknięcie dowolnego CTA w sekwencji | — |
| `txn_welcome` | `txn_welcome` | Oznaczenie wiadomości transakcyjnej | Email 0 | — |

### Uwaga dot. Sender.net
Sender.net obsługuje tagi jako pola niestandardowe (custom fields) lub etykiety (labels). Przed wdrożeniem zweryfikuj, czy Sender.net pozwala na:
- Automatyczne nakładanie tagów przez webhook (rejestracja)
- Usuwanie/tagowanie na podstawie warunków w automatach
- Odróżnianie wiadomości transakcyjnych od marketingowych

Jeśli mechanizm warunkowy nie jest dostępny — oznacz jako **NEEDS CONFIG**.

---

## Sekwencja onboardingowa

### Email 0: Powitanie (natychmiast po rejestracji)

| Element | Wartość |
|---|---|
| **Trigger** | Rejestracja użytkownika (webhook z aplikacji → Sender.net) |
| **Tag na wejściu** | `registered`, `onb_seq_active`, `onb_email_0_sent`, `txn_welcome` |
| **Typ** | Transakcyjny (powitanie, nie marketing) |
| **Subject** | Witaj w Kompasie Zbiórek — zacznij od pierwszej zbiórki |
| **Preheader** | Kilka kliknięć i masz gotowy plan pierwszej zbiórki |
| **Cel** | Przywitanie, pokazanie wartości, nakierowanie na pierwsze uruchomienie |
| **CTA** | Otwórz Kompas i zaplanuj pierwszą zbiórkę |
| **Opóźnienie** | 0 (natychmiast) |
| **Warunek wyjścia** | Kliknięcie CTA → tag `onb_engaged`, kontynuacja sekwencji |
| **Następny krok** | Email 1 po +1 dzień |

### Email 1: 3 kroki do pierwszej zbiórki (+1 dzień)

| Element | Wartość |
|---|---|
| **Trigger** | Czas: +1 dzień od Email 0 |
| **Tag na wejściu** | `onb_email_1_sent` |
| **Typ** | Transakcyjny/onboardingowy |
| **Subject** | 3 kroki do gotowej zbiórki — to prostsze niż myślisz |
| **Preheader** | Opisz problem, a Kompas poprowadzi Cię przez analizę |
| **Cel** | Pokazanie schematu: Problem → Analiza → Planowanie zbiórki |
| **CTA** | Zacznij od opisania problemu |
| **Opóźnienie** | +1 dzień od Email 0 |
| **Warunek wyjścia** | Kliknięcie CTA → tag `onb_engaged` |
| **Następny krok** | Email 2 po +2 dni (łącznie +3 od rejestracji) |

### Email 2: Model SENS → DZIAŁANIE → REFLEKSJA (+3 dni)

| Element | Wartość |
|---|---|
| **Trigger** | Czas: +3 dni od rejestracji |
| **Tag na wejściu** | `onb_email_2_sent` |
| **Typ** | Marketingowy/edukacyjny |
| **Subject** | Nie planuj pustych zbiórek — użyj modelu SENS |
| **Preheader** | SENS → DZIAŁANIE → REFLEKSJA to prosty sposób na wartościowe zbiórki |
| **Cel** | Edukacja o cyklu doskonalenia (00→06), pokazanie że Kompas to nie tylko planer |
| **CTA** | Przeczytaj jak działa cykl doskonalenia |
| **Opóźnienie** | +3 dni od rejestracji |
| **Warunek wyjścia** | Kliknięcie CTA → tag `onb_engaged` |
| **Następny krok** | Email 3 po +4 dni (łącznie +7 od rejestracji) |

### Email 3: Przypomnienie + przykład użycia (+7 dni)

| Element | Wartość |
|---|---|
| **Trigger** | Czas: +7 dni od rejestracji |
| **Tag na wejściu** | `onb_email_3_sent` |
| **Typ** | Marketingowy/re-engagement |
| **Subject** | Gotowy na kolejną zbiórkę? Kompas czeka |
| **Preheader** | Przykład: jak lider wykorzystał Kompasa do planowania wyjazdu |
| **Cel** | Przypomnienie, przykład użycia z życia, CTA do powrotu |
| **CTA** | Zaplanuj kolejną zbiórkę |
| **Opóźnienie** | +7 dni od rejestracji |
| **Warunek wyjścia** | Kliknięcie CTA → tag `onb_engaged`, `onb_completed` |
| **Następny krok** | Zakończenie sekwencji / Email 4 (opcjonalnie) |

### Email 4: Reaktywacja — tylko dla nieaktywnych (+14 dni)

| Element | Wartość |
|---|---|
| **Trigger** | Czas: +14 dni od rejestracji + brak tagu `onb_engaged` |
| **Tag na wejściu** | `onb_email_4_sent`, `onb_inactive` |
| **Typ** | Marketingowy/re-activation |
| **Subject** | Czy Kompas Zbiórek jest Ci jeszcze potrzebny? |
| **Preheader** | Możesz wrócić w dowolnym momencie — wystarczy jedno kliknięcie |
| **Cel** | Ostateczna próba reaktywacji, szansa na rezygnację zamiast spamu |
| **CTA** | Wróć do Kompasu |
| **Opóźnienie** | +14 dni od rejestracji |
| **Warunek wejścia** | Brak tagu `onb_engaged` (użytkownik nie kliknął żadnego CTA) |
| **Warunek wyjścia** | Kliknięcie CTA → `onb_completed`; brak → zakończenie sekwencji |
| **Następny krok** | Koniec sekwencji |

---

## Drzewo decyzyjne sekwencji

```
Rejestracja
  │
  ├─→ Email 0 (0) ─→ Klik CTA? ─→ TAK: tag onb_engaged
  │                                  NIE: kontynuacja
  │
  ├─→ Email 1 (+1d) ─→ Klik CTA? ─→ TAK: tag onb_engaged
  │                                   NIE: kontynuacja
  │
  ├─→ Email 2 (+3d) ─→ Klik CTA? ─→ TAK: tag onb_engaged
  │                                   NIE: kontynuacja
  │
  ├─→ Email 3 (+7d) ─→ Klik CTA? ─→ TAK: onb_completed
  │                                   NIE: tag onb_inactive
  │
  └─→ Email 4 (+14d, tylko jeśli brak onb_engaged)
        │
        ├─→ Klik CTA? ─→ TAK: onb_completed
        └─→ NIE: koniec sekwencji, tag onb_inactive
```

---

## Warunki wyjścia z sekwencji

| Warunek | Efekt |
|---|---|
| Kliknięcie CTA w Email 0-3 | Tag `onb_engaged`, kontynuacja sekwencji |
| Kliknięcie CTA w Email 4 | Tag `onb_completed`, koniec sekwencji |
| Unsubscribe | Usunięcie z `onb_seq_active`, koniec sekwencji |
| Email bounce | Oznaczenie `onb_inactive`, koniec sekwencji |
| Brak aktywności do Email 3 | Tag `onb_inactive`,_Email 4 po +7 dni |
| Kliknięcie CTA w Email 3 | Tag `onb_completed`, pomijam Email 4 |

---

## Rozdzielność transakcyjne vs. marketingowe

| Email | Typ | Uwagi |
|---|---|---|
| Email 0 | Transakcyjny | Nie wymaga unsubscribe; powitanie po rejestracji to usługa |
| Email 1 | Transakcyjny/onboardingowy | Edukacja o produkcie; Senders.net może traktować jako transakcyjny |
| Email 2 | Marketingowy | Wymaga unsubscribe; treść edukacyjna o modelu |
| Email 3 | Marketingowy | Re-engagement, wymaga unsubscribe |
| Email 4 | Marketingowy | Re-activation, wymaga unsubscribe |

**Rekomendacja:** Email 0 i 1 oznacz jako transakcyjne (brak unsubscribe w stopce), Email 2-4 jako marketingowe (stopka z unsubscribe).

---

## Konfiguracja w Sender.net — kroki

1. **Utwórz listę mailingową** `onboarding-sekwencja`
2. **Utwórz custom fields** dla tagów: `onb_email_0_sent` do `onb_email_4_sent`, `onb_engaged`, `onb_completed`, `onb_inactive`, `txn_welcome`
3. **Skonfiguruj webhook rejestracji** (z aplikacji Kompas Zbiórek → Sender.net API)
4. **Utwórz automatyzację (automation):**
   - Trigger: dodanie do listy `onboarding-sekwencja` (via webhook)
   - Kroki: Email 0 → wait 1d → Email 1 → wait 2d → Email 2 → wait 4d → Email 3 → wait 7d (warunek: brak onb_engaged) → Email 4
5. **Załaduj szablony HTML** z folderu `html/`
6. **Przetestuj:** wyślij testowy cykl na 2-3 adresach
7. **Włącz automację**
