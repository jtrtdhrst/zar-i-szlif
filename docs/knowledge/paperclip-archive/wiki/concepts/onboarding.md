---
title: Żar i Szlif — onboarding: start, zwierzak, doświadczenie, drużyna i zaproszenia
type: concept
tags: [onboarding, rejestracja, rr, doswiadczenie, avatary, zaproszenia, newsletter]
created: 2026-09-09
updated: 2026-10-23
---

# Onboarding — kanoniczny kontrakt TARGET (2026-10-18)

**Status: kierunek koncepcyjny TARGET, nie CURRENT, nie dowód wdrożenia.** Decyzja właściciela z 2026-10-18 rozszerza i zastępuje **kolejność** wcześniejszego setupu z 2026-09-09. Zachowujemy oddzielne procesy: setup konta, pierwszy mail powitalny, opcjonalne zaproszenia współprowadzących oraz pierwsze misje w aplikacji.

## 1. Ekran powitalny przed logowaniem

Scena: początek budowy pustego obozu, przewodnicy Iskra (lis, pomysł) i Szlif (kruk, plan). Widać dwa wyraźne CTA:
- **„Rozpocznij budowę obozowiska”** — dla nowej osoby.
- **„Mam już konto — Zaloguj się”** — dla powracającej.

Oba mogą korzystać z **jednego Google OAuth**; system rozróżnia nowe konto (onboarding), niedokończony setup (wznów właściwy krok) i istniejące konto (prosto do obozu, bez powtórki). Brak dwóch niezależnych mechanizmów kont i zbędnych ekranów na starcie.

## 2. Kolejność pierwszego onboardingu

1. **Google OAuth** — jedno konto użytkownika.
2. **Wstępny wybór zwierzaka na początku** z kilku dostępnych gatunków. Lis i kruk wyłącznie dla Iskry i Szlifa. Przykładowe gatunki: borsuk, bóbr, sarna, wiewiórka, jeż, sowa; dokładna lista i liczba na start nadal do decyzji, katalog musi być rozszerzalny.
3. **Dwa oddzielne pytania o doświadczenie**: (a) jak długo jesteś w Royal Rangers? (b) jak długo **samodzielnie** planujesz i prowadzisz zbiórki? Nie zakładać, że wieloletni pomocnik ma umiejętność samodzielnego planowania.
4. **Imię i nazwisko** (prefill z Google, edytowalne), **wybór szczepu**, następnie **utworzenie drużyny i wpisanie jej nazwy albo dołączenie do już istniejącej / zaproszonej**. Jedna aktywna drużyna na osobę; unikać duplikatów.
5. **Potwierdzenie dostępności postaci** w docelowej drużynie. Tylko jeden aktywny awatar danego gatunku na drużynę. Jeśli gatunek wybrany wcześniej jest zajęty, użytkownik wybiera inny wolny; nie tworzyć duplikatu. Przy zmianie drużyny obowiązuje nowy wybór postaci (zgodnie z kanonem świata).
6. **Opcjonalne zaproszenie współprowadzących** po utworzeniu/nazwaniu drużyny: pole na **kilka adresów e-mail**, wyraźne CTA **„Wyślij zaproszenia”** i **„Zrobię to później”**. Użytkownik może pominąć ten krok i dodać osoby później z Ogniska.
7. **Wejście do obozowiska** z sześcioma punktami oraz domyślnie rozwiniętą kartką przygotowań najbliższej zbiórki (lub prawidłowym pustym stanem, jeśli brak planu).

**Bez blokowania wejścia:** nie wymagać wysłania zaproszeń, dodania osób, planu rocznego, pierwszej zbiórki ani newslettera przed otwarciem obozu. Po powrocie nie powtarzać setupu.

## 3. Pytania o doświadczenie — dwa niezależne wymiary

| Pytanie | Przykładowe odpowiedzi (copy/UX do dopracowania) | Cel |
|---|---|---|
| Jak długo jesteś w Royal Rangers? | do 6 miesięcy; 6–12 mies.; 1–3 lata; 3–5 lat; ponad 5 lat | Dopasowanie wyjaśnień dotyczących RR |
| Jak długo samodzielnie planujesz i prowadzisz zbiórki? | Jeszcze nie — tylko pomagam; dopiero zaczynam; 6–12 mies.; 1–3 lata; ponad 3 lata | Dopasowanie poziomu przykładów, szablonów i pomocy w planowaniu |

**Prywatność i brak etykietowania:**
- Odpowiedzi i ich ewentualny pochodny **tag poziomu wsparcia są prywatne**, służą personalizacji **edukacji i wskazówek w interfejsie**; nie są publiczną etykietą kompetencji.
- **Zakaz publicznego tagu „niedoświadczony instruktor”**, wyświetlania stażu innym członkom drużyny jako rankingu czy oceniania kwalifikacji na podstawie deklaracji.
- Staż nie blokuje żadnych modułów, nie wpływa na formalne uprawnienia; użytkownik może później poprawić odpowiedzi i zmienić / wyłączyć poziom podpowiedzi.
- Przykład: długi staż w RR i brak samodzielnego prowadzenia → więcej pomocy przy zbiórkach, nie tłumaczenie od podstaw całej organizacji. Początkujący → więcej gotowych przykładów, zaawansowany → krótsze instrukcje.
- Minimalizacja zbieranych danych, prawidłowe uprawnienia/RLS i ochrona prywatnych preferencji.
- **Otwarte**: finalne zakresy odpowiedzi oraz możliwość pominięcia pytania; nie zatwierdzać szczegółów UI przez domysł.

## 4. Zaproszenia do drużyny

- Dotyczą **współprowadzących / uprawnionych użytkowników**, nie automatycznego zakładania kont wszystkim uczestnikom, zwłaszcza dzieciom.
- Po podaniu nazwy drużyny można dodać kilka e-maili i uruchomić jawne wysłanie zaproszeń; sam wpis adresu nic nie wysyła.
- Zaproszona osoba loguje się przez Google, przechodzi własny pierwszy setup i **dołącza do wskazanej istniejącej drużyny**, zamiast zakładać kolejną.
- Samo wysłanie maila **nie nadaje członkostwa**. Potrzebna jest weryfikacja konta, ważne zaproszenie, akceptacja, sprawdzenie uprawnień i zasady jednej drużyny.
- Przy wdrażaniu doprecyzować: kto może zapraszać, walidację i duplikaty, antyspam, czas wygaśnięcia, ponowienie, konflikt aktywnej drużyny, statusy (oczekuje/zaakceptowano) i dostawcę poczty. Nie twierdzić, że provider już działa.

### Dołączenie kodem drużyny i obsługa próśb — TARGET 2026-10-20

- W ścieżce „Dołącz do drużyny” użytkownik po Google OAuth może wpisać **kod istniejącej drużyny**, zamiast zakładać nową. Wprowadzenie poprawnego kodu **nie powoduje automatycznego dołączenia**: wyświetla potwierdzenie drużyny i umożliwia wysłanie **prośby o dołączenie**.
- Prośba otrzymuje status **oczekuje**, widoczny dla wnioskującego i uprawnionych administratorów w **Ognisku**. Administrator może **zaakceptować lub odrzucić**; dopiero zatwierdzenie aktywuje członkostwo. Nie wolno udostępniać danych/obozu osobie oczekującej. Nieważny lub unieważniony kod kończy się bez członkostwa.
- Przed aktywacją serwer atomowo weryfikuje tożsamość, brak innej aktywnej drużyny oraz dostępność wybranego gatunku awatara; konflikt wymaga odpowiedniego działania (np. wybór innego gatunku), nie obejścia ograniczeń. Wznowienie setupu i ponowne wysłanie prośby nie mogą tworzyć duplikatów.
- Kodem zarządza uprawniony administrator w Ognisku: podgląd, kopiowanie, unieważnienie/rotacja. Lista członków, dodawanie/usuwanie osób, role systemowe i funkcje organizacyjne są dostępne w tej samej lokacji, z serwerowym RBAC/RLS i audytem. Szczegółowy kontrakt: [[wiki/concepts/zar-i-szlif-swiat-i-gamifikacja]] — „Ognisko — zarządzanie drużyną”.
- Zaproszenia e-mail pozostają osobną wygodną ścieżką wejścia. Nie utożsamiać wysłania zaproszenia, posiadania kodu ani zgłoszenia z aktywnym członkostwem; wymagane są odpowiednie zgody i weryfikacja uprawnień.

## 5. Pierwszy mail po rejestracji to osobny workflow

Mail powitalny ma przywitać i zawierać informację o dodaniu nadawcy do ważnych/kontaktów **lub odpowiedzeniu na wiadomość**, zgodnie z wcześniej przyjętą treścią. Nie jest zaproszeniem do drużyny ani zadaniem w aplikacji. Nie zakładać produkcyjnej wysyłki bez osobnej weryfikacji.

## 6. Pierwsze misje w obozowisku (nieblokujące)

**Po zakończeniu setupu** nowa osoba trafia do obozu i może rozpocząć **Arc 1 — „Nasz pierwszy namiot”** w Namiocie Zastępu: prolog powstania namiotu → profil i realia → samodzielność, umiejętności i współpraca → historia **grupowych** sprawności i wymagań stopni → ostrożne podsumowanie kontekstu. Specyfikacja: [[wiki/concepts/arc-01-nasz-pierwszy-namiot]] (**WORKING DRAFT** z 2026-10-19, nie finalny kontrakt implementacji).

**Nie segmentować** na poszczególnych uczestników, nie wymuszać nadrabiania przez nieobecnych ani formalnie przyznawać stopni/sprawności całemu zastępowi. Arc 2 przy Stole Wypraw obejmuje **temat roczny** oraz **jeden cel z DoD na bieżące 3 miesiące**; bez rozpisywania całego roku. Zob. [[wiki/concepts/arc-02-wyznaczamy-kierunek]].

Nadal dostępne są osobne, nieblokujące działania produktowe:
1. **Uzupełnij dane drużyny / zaproś współprowadzących** — Ognisko (szczególnie gdy zaproszenia pominięto).
2. **Dodaj plan roczny** — Stół Wypraw; **pierwszy krok Arc 2**, obowiązkowy temat roczny, potem bieżący horyzont 3 miesięcy i cel z DoD.
3. **Zaplanuj pierwszą zbiórkę** — Stół Wypraw, istotny rezultat pracy z aplikacją.

**Namiot Zastępu** to stały punkt dostępu do rzadko zmienianych danych podstawowych i kontekstu, z możliwością późniejszej aktualizacji przez UI lub uprawnione MCP aplikacji. Arc 1 nie blokuje wejścia do obozu, funkcji czy zapraszania członków; dołączający do istniejącej drużyny nie powinien resetować wspólnego profilu.

**Potwierdź zapis do newslettera** to osobne nieblokujące zadanie komunikacyjne. Nie zamieniać go w „odpisz na powitalnego maila”. Dane checklisty i kartki przygotowań odczytywane z kanonicznych modułów (Supabase/Postgres), nie dublowane.

## 7. Skrócona mapa

```text
START → [Rozpocznij budowę] lub [Mam już konto]
                    ↓ Google OAuth
        konto gotowe → od razu OBÓZ
        setup przerwany → WZNÓW ETAP
        nowe / zaproszone konto
                    ↓
            WYBÓR ZWIERZAKA (wstępny)
                    ↓
     2 PYTANIA: STAŻ RR i PROWADZENIE ZBIÓREK
                    ↓
          IMIĘ/NAZWISKO + SZCZEP
                    ↓
         UTWÓRZ / NAZWIJ / DOŁĄCZ DO DRUŻYNY
                    ↓
        POTWIERDŹ WOLNY GATUNEK
                    ↓
        [WYŚLIJ ZAPROSZENIA] / [PÓŹNIEJ]
                    ↓
              OBÓZ + PIERWSZE MISJE
```

## 8. Zakres decyzji i otwarte szczegóły

**Zatwierdzony kierunek TARGET:** dwa CTA, wspólny Google OAuth, wczesny wybór postaci, dwa osobne prywatne pytania, tworzenie/nazywanie drużyny albo dołączenie, unikalny gatunek, opcjonalne zaproszenia wielu współprowadzących, odrębne mail powitalny i newsletter, pierwsze misje oraz kontynuowanie niedokończonego setupu.

**Do zaprojektowania:** dokładny starter pack postaci, odpowiedzi na pytania i obowiązkowość/pomijanie, szczegółowa macierz uprawnień ról, parametry ważności kodów/zaproszeń, powiadomienia i obsługa nadużyć, fallback gdy zabraknie wolnych gatunków, copy/wygląd ekranów. Stan TARGET nie oznacza CURRENT.

## Supersession i powiązania

**2026-10-18 zastępuje dawną kolejność** `Google → imię/nazwisko → szczep → drużyna → panel`, zachowując wymóg tożsamości, szczepu i jednej drużyny. Pierwszy mail oraz pierwsze misje z decyzji 2026-09-09 nadal są odrębne.

[[wiki/concepts/zar-i-szlif-swiat-i-gamifikacja]], [[wiki/concepts/arc-01-nasz-pierwszy-namiot]], [[wiki/projects/kompas-zbiorek/decisions]], [[wiki/projects/kompas-zbiorek/index]], [[wiki/sources/prd-kompas]].


## Zgoda Google Calendar nie należy do logowania ani rejestracji — decyzja 2026-10-23 (TARGET)

**Google OAuth do uwierzytelnienia konta i zgoda na zarządzanie kalendarzem to dwa odrębne przepływy.** Podczas rejestracji, logowania, ponownego logowania i onboardingu **nie wolno wymagać ani wyświetlać prośby o zakresy Google Calendar lub utworzenie kalendarza**. Dopuszczalne są wyłącznie zakresy potrzebne do zalogowania użytkownika. Brak zgody kalendarzowej nie wpływa na wejście do obozowiska, ukończenie konfiguracji konta, planowanie i zarządzanie aktywnościami.

**Dopiero w sekcji Kalendarz** dostępna jest dobrowolna akcja „Połącz z Google Calendar”, która prosi o minimalne dodatkowe uprawnienia w osobnym, świadomie uruchomionym procesie i — po zgodzie — tworzy/odnajduje dedykowany kalendarz „Żar i Szlif”. Integrację można pominąć, później połączyć, rozłączyć i wznowić. Żadne ekrany startowe ani onboardingowe nie mają obowiązkowego „Zezwól na utworzenie kalendarza”. Szczegóły autoryzacji, mapowania event ID, synchronizacji dwukierunkowej i bezpiecznego opisu: [[wiki/concepts/google-calendar-integration]].

**Test akceptacyjny:** świeże konto przechodzi cały pierwszy login i rejestrację bez Calendar OAuth; opcja pojawia się dopiero po wejściu w Kalendarz; odmowa zgody nie blokuje aplikacji. **Status: TARGET / dokumentacja produktu, nie dowód wdrożenia.**
