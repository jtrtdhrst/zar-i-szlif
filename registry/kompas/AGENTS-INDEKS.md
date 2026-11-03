# Indeks komponentów Kompasu dla agentów AI

Źródło prawdy: produkcyjny wygląd `https://kompaszbiorek.pl` (kaskada v48).
Sekcje WWW (01–04) i brand book zostały wyciągnięte ze źródła strony
(`kompas-ui-design/strona-glowna-cloudflare/index.html`) i zunifikowane w jeden
wspólny język wizualny (`registry/kompas/ui/kompas-site.css` + `kompas-site.js`).
Szablony maili zostały usunięte ze Storybooka (nie są częścią interfejsu WWW).

## Jak agent wybiera komponent

1. Wczytaj ten indeks, by poznać dostępne elementy i ich przeznaczenie.
2. Dopasuj zadanie do grupy poniżej.
3. `kompas-brand-tokens` i `kompas-site` ładuj zawsze jako fundament.
4. Sprawdź `registryDependencies` danego elementu i załaduj najpierw zależności.
5. Odczytaj plik źródłowy (kolumna `plik`) i jego `*.stories.js` przed generowaniem kodu.

## Segmentacja funkcjonalna

### A. Fundament marki (zawsze najpierw)
| Nazwa | Typ | Plik | Kiedy użyć |
|-------|-----|------|------------|
| kompas-brand-tokens | registry:ui | `ui/kompas-brand-tokens.js` (+ `.css`) | Baza tokenów kolor/type/space/radius/motion/breakpoint. |
| kompas-typography | registry:ui | `ui/kompas-typography.js` | Hierarchia tekstu: eyebrow, H1–H2 Display, lead, copy, caption. |
| kompas-site | registry:lib | `ui/kompas-site.js` (+ `kompas-site.css`) | **Wspólny język sekcji WWW**: helpery `renderKompasSiteButton`, `renderKompasRail`, `renderKompasKicker`, `renderKompasCard`, `renderKompasAccent`, `renderKompasMountains`, `renderKompasTopo` i klasy `.kompas-*`. Ładuj dla każdej sekcji. |

### B. Sekcje WWW (wyciągnięte ze strony, zunifikowane)
| Nazwa | Typ | Plik | Zależności | Kiedy użyć |
|-------|-----|------|------------|------------|
| site-header | registry:component | `blocks/site-header.js` | kompas-site | Sticky nagłówek z nav + CTAs (01). |
| hero-section | registry:block | `blocks/hero-section.js` | kompas-site | Sekcja 01: H1 + lead + akcje + podgląd produktu. |
| situations-section | registry:block | `blocks/situations-section.js` | kompas-site | Sekcja 02: 3 karty wyzwań + pasek CTA. |
| cycle-section | registry:block | `blocks/cycle-section.js` | kompas-site | Sekcja 03: 4 kroki cyklu doskonalenia. |
| memory-section | registry:block | `blocks/memory-section.js` | kompas-site | Sekcja 04: karty pamięci + podgląd dokumentu. |

### C. Brand Book — osobny system
| Nazwa | Typ | Plik | Zależności | Kiedy użyć |
|-------|-----|------|------------|------------|
| brand-book | registry:block | `blocks/brand-book.js` | kompas-site, kompas-brand-tokens | Kanoniczna referencja marki: kolory, typografia, logo, ton. Osobny system w Storybooku (`Kompas/Brand Book`). |

## Zasady dla agenta
- Storybook zawiera wyłącznie elementy strony marketingowej oraz jej fundament marki. Produktowe UI, powłoka aplikacji i szablony maili są poza zakresem.
- Każda sekcja WWW używa **tylko** klas `.kompas-*` z `kompas-site.css` — nie duplikuj stylów.
- Akcent „L" (prawy+dolny, złoty) to sygnatura marki: `renderKompasAccent()` / klasa `.kompas-accent`.
- Topografia (`.kompas-topo`) i góry (`.kompas-mountains`) to dekoracja sekcji — nie nadużywaj.
- Przyciski i karty dla strony renderuj przez `kompas-site`, nie przez usunięte komponenty produktowe.
- Breakpointy (z `kompas-site.css`): 1199 / 1099 / 959 / 599 px. Sprawdź widok mobilny (375 px) przed publikacją sekcji.
