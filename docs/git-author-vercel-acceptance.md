# Autor commita a akceptacja Vercel — kryterium odróżnienia

Weryfikacja z **KOMAA-490** (P0, node akceptacji CTO). Dokument jest
niefunkcjonalny: istnieje po to, żeby zweryfikowana akceptacja autora była
trwałym artefaktem repo, a nie komentarzem w wątku issue.

## Objaw, który zamyka ten node

Vercel odrzuca wdrożenie, gdy nie potrafi powiązać commita z kontem
podłączonym przez integrację Vercel ↔ GitHub. Na `main` widać dwa kompletnie
różne komunikaty, oba z tej samej przyczyny:

| komunikat statusu Vercel | przyczyna |
| --- | --- |
| `Deployment was blocked` | autor nie jest powiązany z żadnym kontem |
| `GitHub couldn't verify an account for the commit.` | to samo, innymi słowami |

Nie wolno tego mylić z `Deployment has failed — run this Vercel CLI command`.
Ten ostatni oznacza **udany build z błędem** i pojawia się wyłącznie przy
attributable autorze.

## Kryterium odróżnienia

Jedyną zmienną decyzyjną jest `author.login` w API GitHuba, czyli czy
GitHub potrafi przypisać commita do konta:

- `author.login == null` → wdrożenie **zablokowane** przez Vercel;
- `author.login == miloszspyrka-code` → wdrożenie dociera do buildu.

Ścieżka plików nie ma znaczenia. `35fd12852e` zmienił wyłącznie
`docs/production-release.md` i został wdrożony, a `07587e2e1a` został
zablokowany. Ten sam commit z tą samą ścieżką, inny wniosek — bo różnił się
wyłącznie autor.

## Historyczny rozkład na `main`

Dokładnie tak, jak przewiduje kryterium, bez wyjątków:

| autor commita | `author.login` | wynik Vercel |
| --- | --- | --- |
| `gate <gate@example.invalid>` | `null` | **zablokowane** |
| `CTO (Paperclip) <cto@paperclip.local>` | `null` | **zablokowane** |
| `Paperclip CTO <cto@kompaszbiorek.pl>` | `null` | **zatrzymane** |
| `miloszspyrka-code <milos.spyrka@gmail.com>` | `miloszspyrka-code` | wdrożone |
| `miloszspyrka-code <233741877+miloszspyrka-code@users.noreply.github.com>` | `miloszspyrka-code` | wdrożone |

Wiersze `milos.spyrka@gmail.com` w tabeli to **historia**, nie gwarancja. Patrz
następna sekcja — ten adres przestał być skuteczny.

## `milos.spyrka@gmail.com` nie jest już powiązany z kontem

Wiersze historii wyglądają na to, że oba adresy są równorzędne. **Nie są.**
Różnica jest widoczna dopiero przy nowym commicie.

Kandydat `a98e258` (2026-10-02T12:40:29Z) — autor
`miloszspyrka-code <milos.spyrka@gmail.com>`, poprawna nazwa, poprawny
format, guard `assert-git-identity` zaakceptował, gate przeszedł:

```
gh api repos/miloszspyrka-code/kompas-zbiorek/commits/a98e258/statuses
  Vercel  failure  Deployment was blocked
```

Ten sam commit w API GitHuba:

```
author=miloszspyrka-code <milos.spyrka@gmail.com>
gh_author_login=NULL
```

Commity z tym samym adresem sprzed wielu dni mają `author.login=miloszspyrka-code`.
Różnica nie leży w commicie, tylko w tym, że adres **nie jest już zweryfikowany**
na koncie: `GET /users/miloszspyrka-code` → `email: null`, a `GET /user/emails`
odpowiada 403 (token bez zakresu `user:email`). GitHub potrafi powiązać adres
tylko z kontem, na którym jest zweryfikowany, więc dla nowych commitów
`gmail.com` jest martwy — a historia tego nie pokazuje.

Forma `233741877+miloszspyrka-code@users.noreply.github.com` jest tu bezpieczna
od z definicji: wyprowadza ją samo GitHub z `id` i `login` konta, więc nie
zależy od żadnej zweryfikowanej skrzynki. GitHub rozwiązuje ją deterministycznie,
także dla commitów tylko gałęziowych (`KOMAA-46`, `KOMAA-47`, `KOMAA-104`,
`KOMAA-106` — wszystkie `diverged`, wszystkie `login=miloszspyrka-code`).

Wniosek operacyjny: **tożsamość kanoniczna musi być formą noreply.** Adres
czytelny dla człowieka (`milos.spyrka@gmail.com`) wygląda bezpiecznie w `git log`
i cicho przestaje działać w chwili, gdy przestanie być zweryfikowany na koncie.

Pułapka przy diagnostyce: `author.login == NULL` w commicie **gałęziowym** nie
dowodzi, że blokada nastąpi. Commit `a98e258` został zablokowany, ale starsze
commity norepy z gałęzi rozwiązywały się poprawnie. Ostatecznym arbiterem jest
status Vercel na danym SHA, nie pole `author.login`.

## Dwie warstwy egzekucji

1. **`scripts/assert-git-identity.mjs`** — odrzuca syntetycznych autorów
   lokalnie: `.githooks/pre-commit --check-config`,
   `.githooks/pre-push` na obiektach commitów, oraz `.github/workflows/ci.yml`
   po stronie serwera. Reguła serwerowa jest tu istotna: `--no-verify`
   wyłącznie omija hooki lokalne, a CI nadal to wychwytuje. Warstwa
   kontrolna to `assert-git-identity`, warstwa korrecyjna to bootstrap
   tożsamości Harnessa (KOMAA-491) — guard nigdy nie przypisuje tożsamości
   sam, tylko ją weryfikuje.

2. **Integracja Vercel ↔ GitHub** — pozostaje ostatecznym arbitrem i dlatego
   jedynym, którego nie da się zastąpić testem lokalnym. Dlatego kryterium
   akceptacji wymaga realnego pusha na `main` i odczytu statusu na tym SHA,
   a nie samego zielonego gate'u.

Sprawdzenie po pushu, odczyt statusu na dokładnym SHA:

```bash
gh api repos/miloszspyrka-code/kompas-zbiorek/commits/<sha>/status \
  --jq '.statuses[]|select(.context=="Vercel")|"\(.state) \(.description)"'
```