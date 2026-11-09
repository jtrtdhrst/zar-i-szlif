---
title: Baza aktywności RR — produkt i trwałe reguły integracji
type: source
tags: [baza-aktywnosci, api, prd]
sources: [raw/PRD-BAZA-AKTYWNOSCI-RR.md, raw/API-SPRAWNOSCI.md]
created: 2026-08-20
updated: 2026-10-23
---

# Baza Aktywności RR i sprawności

## Baza Aktywności RR

Baza Aktywności RR jest wspólną, ręcznie moderowaną bazą gotowych aktywności. Użytkownicy mogą proponować wpisy z opisem i kategoriami; publikacja do wspólnej bazy wymaga właściwego kontraktu moderacji.

Zaakceptowana aktywność może być użyta w panelu/asystencie i wpięta do planu konkretnej aktywności bez przepisywania od zera.

## Sprawności RR

- Wymagania sprawności muszą pochodzić z oficjalnego źródła RR; nie wolno ich wymyślać.
- Zaplanowane wymaganie ≠ wykonane wymaganie.
- Faktyczne wykonanie potwierdza się po aktywności.
- Jedno wymaganie może być realizowane przez kilka aktywności.
- Po ukończeniu wszystkich wymagań TARGET przewiduje domknięcie sprawności i zadanie wręczenia naszywki.
- Brak danych = jawny `Brak danych`, nie wygenerowana treść udająca źródłową.

## Granica CURRENT

Ta strona **nie przechowuje bieżących nazw endpointów, tool names, wersji, retry policy ani statusu dostępności integracji**. Przed implementacją lub stwierdzeniem „działa” sprawdź aktualny kod/runtime/test/tool health.

Trwałe reguły integracji: [[wiki/entities/integracje-api]]. Architektura danych/MCP: [[wiki/sources/integracje-mcp]]. Stan braku danych: [[wiki/concepts/stan-braku-danych]].

## Decyzja produktowa 2026-10-23 — po zakończeniu aktywności: zgłoszenie do Bazy Aktywności (TARGET)

**Na etapie zakładki Podsumowanie** przeprowadzonej aktywności użytkownik widzi opcjonalną akcję **„Zaproponuj do Bazy Aktywności”**. Akcja nie publikuje nic automatycznie i nie jest konieczna, aby ukończyć podsumowanie. Dotyczy faktycznie wykonanej aktywności lub wybranego jej elementu; zakończenie zbiórki samo w sobie **nigdy** nie uruchamia publikacji.

1. Po kliknięciu użytkownik **sam wybiera**, jaki element/scenariusz chce udostępnić. System może wstępnie wypełnić edytowalny formularz na podstawie istniejącej karty, **ale nie może go automatycznie wysłać**.
2. Przed wysłaniem istnieje **pełna ręczna edycja tytułu i opisu z perspektywy późniejszego użytkownika bazy**, podgląd wpisu, ewentualna poprawa instrukcji realizacji, czasu, niezbędnych materiałów i kategorii, jeśli te pola istnieją w docelowym kontrakcie. Nie wymuszaj publikowania retrospekcji, prywatnych notatek, danych dzieci, ocen osób, list uczestników ani szczegółów wewnętrznych zespołu; wymagaj usunięcia informacji wrażliwych.
3. Użytkownik może **zapisać szkic, edytować go, anulować albo wysłać do moderacji**. Wysłanie ma status **oczekuje na zatwierdzenie**, a nie „opublikowano”. Propozycja i karta źródłowa są oddzielnymi obiektami; edycja propozycji nie przepisuje historycznego przebiegu w karcie.
4. **Tylko po ręcznym zatwierdzeniu przez właściciela produktu (Ciebie)** wpis staje się widoczny w katalogu i możliwy do wybrania jako gotowa aktywność. Wymagane: identyfikowalna decyzja, autor propozycji, czas, wersja treści i stan: `draft → pending_review → approved/published` albo `changes_requested/rejected`. Odrzucenie lub poprawki odsyłają do edycji; nie ma automatycznej akceptacji ani publikacji. Prawo do ostatecznej publikacji należy domyślnie wyłącznie do właściciela produktu; ewentualne delegowanie innej osobie wymaga jego osobnej, jawnej decyzji, nigdy automatycznej akceptacji przez model, system lub dowolnego instruktora.
5. **Perspektywa odbiorcy:** przed zatwierdzeniem pokazuj podgląd finalnej karty tak, jak zobaczy ją inny instruktor. Po zatwierdzeniu wpis jest wybieralny i edytowalny jako **własna kopia/instancja w planie** przyszłej aktywności, bez modyfikowania wzorca i cudzej historii. Wersjonuj opublikowaną propozycję; istotne zmiany w publicznej treści ponownie podlegają zatwierdzeniu.

**Kryteria akceptacji:** zakończenie podsumowania bez zgłoszenia niczego nie publikuje; kliknięcie otwiera edytowalny formularz tytułu/opisu; oczekujący wpis nie pojawia się w publicznym katalogu; publikacja następuje dopiero po realnej decyzji właściciela produktu; użytkownik może wybrać zatwierdzony wpis i zaadaptować go bez zmiany źródła. Ochrona przed duplikatem ponowionego kliknięcia/wysyłki.

## Decyzja produktowa 2026-10-23 — zaliczanie wymagań i przekazanie naszywki (TARGET)

- **Po aktywności**, w Podsumowaniu, uprawniony instruktor oznacza **konkretne, faktycznie wykonane wymagania** sprawności na właściwym kanonicznym rekordzie; nie zaliczaj wymagań za sam plan, udział lub nadejście daty. Niezrealizowane wymagania zostają otwarte. Oficjalna lista wymagań musi pochodzić z wiarygodnego źródła RR.
- Gdy **wszystkie wymagania danej sprawności dla właściwego beneficjenta są zweryfikowane i instruktor potwierdzi przyznanie**, sprawność otrzymuje stan **„do wręczenia”**. Nie utożsamiaj postępu grupowego z automatycznym przyznaniem sprawności poszczególnym uczestnikom: jeśli system przechowuje wyłącznie grupowy stan, **nie twórz przypisania dla konkretnego dziecka** bez uprawnionego, jawnego potwierdzenia.
- Po takim potwierdzeniu automatycznie stwórz w kanonicznym systemie zadań **dwa powiązane zadania organizacyjne**: (1) **„Zabierz naszywkę [sprawność] na najbliższą aktywność”**, (2) **„Wręcz naszywkę [sprawność] podczas najbliższej aktywności”**. Powiąż je z tą samą sprawnością/zdarzeniem przyznania i **najbliższą przyszłą aktywnością uprawnionej drużyny**, przypisz wskazanemu instruktorowi lub pozostaw nieprzypisane do wyznaczenia; nie przypisuj automatycznie dzieciom.
- Jeżeli kolejna aktywność nie istnieje, trzymaj zadania jako **oczekujące na termin** i podłącz je po jej zaplanowaniu. Przeniesienie/odwołanie następnej zbiórki aktualizuje docelowe powiązanie, bez tworzenia ponownych zadań; zadania mają niezależne stany wykonania.
- Idempotencja po ID zdarzenia przyznania i typie zadania uniemożliwia duplikowanie naszywek i zadań przy zapisie, ponowieniu i synchronizacji. Samo **zabranie** naszywki nie oznacza jej **wręczenia**. Dopiero jawne potwierdzenie wręczenia zamyka proces i zostawia ślad audytowy. Zadania pojawiają się przy kolejnej zbiórce i w podglądzie przygotowań, a w opisie Google Calendar **tylko wtedy, gdy są przypisane właścicielowi połączonego kalendarza i pozbawione danych wrażliwych**.

**Kryteria akceptacji:** częściowo zaliczone wymagania nie generują wręczenia; potwierdzona kompletna sprawność tworzy dokładnie jeden zestaw dwóch zadań; brak przyszłej aktywności nie gubi zadań; po dodaniu kolejnego terminu widać oba zadania; wykonanie pierwszego nie zalicza drugiego; odwołanie terminu umożliwia przeniesienie; ponowione webhooki/zapis nie tworzą duplikatów.

Kontekst: [[wiki/concepts/karta-zbiorki]], [[wiki/concepts/arc-04-co-zabieramy-dalej]], [[wiki/concepts/google-calendar-integration]]. **TARGET, nie wdrożono/nie zweryfikowano produkcyjnie.**
