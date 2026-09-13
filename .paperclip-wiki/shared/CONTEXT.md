# Shared context contract

Ten plik jest krótkim kanonem statusu wiedzy dla external agent bundles. Nie zawiera REPO MAP ani szczegółów implementacji — te należą do aktualnych skilli i bieżącego kodu.

## Status wiedzy

- **TARGET / MUST-HAVE** — zatwierdzony stan docelowy. Nie oznacza, że funkcja działa dziś.
- **CURRENT / AS-IS** — stan potwierdzony aktualnym kodem, runtime, testem albo świeżą dokumentacją wykonania.
- **DELTA** — różnica pomiędzy TARGET i CURRENT.
- **UNAPPROVED / DO NOT ASSUME** — pomysł lub flow bez zatwierdzenia; nie jest wymaganiem ani CURRENT.

Najważniejsza reguła: dokument opisujący wizję nie może samodzielnie awansować funkcji do CURRENT.

## Rozstrzyganie konfliktów

Dla konkretnego taska kolejność jest następująca:

1. bieżący issue / wake payload / `currentExecutionWorkspace`;
2. aktualny kod, runtime i testy dla CURRENT;
3. root `AGENTS.md` oraz właściwy skill dla kontraktów wykonawczych i technicznych;
4. live Paperclip Wiki dla trwałych decyzji;
5. lokalny mirror `.paperclip-wiki/`;
6. raw/archive/history jako materiał historyczny.

Jeśli mirror Wiki i aktualny skill/repo różnią się ścieżkami technicznymi, nie odtwarzaj starego layoutu. Zweryfikuj live Wiki, a stan implementacji rozstrzygnij na podstawie bieżącego repo/runtime.

## Workspace jest częścią kontekstu

External instructions i knowledge bundle nie są workspace'em wykonawczym. Agent przed write ma stosować `currentExecutionWorkspace` i upewnić się, że rzeczywiście znajduje się w oczekiwanym checkoutcie/branchu. Niezgodność oznacza fail-closed i routing workspace, a nie ręczny workaround.

## Anti-churn

Nie twórz nowego issue tylko dlatego, że Paperclip obserwuje Paperclip. Najpierw użyj istniejącego issue, komentarza, statusu albo handoffu. Nowy issue powinien reprezentować niezależnie wartościowy deliverable.

Szczegółowy bieżący router techniczny i lekcje z incydentów są w root `CONTEXT.md`; product TARGET w `PRODUCT.md`, CURRENT w `STATE.md`, governance w `GOVERNANCE.md`, delivery w `DELIVERY.md`.
