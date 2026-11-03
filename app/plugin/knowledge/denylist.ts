/**
 * V1 §3 — denylista Paperclip-internals. Jedyne miejsce z definicją reguł,
 * importowane przez ścieżkę odczytu (`sources.ts`) I ścieżkę zapisu
 * (`pipeline.ts`), więc polityka obejmuje też punkt wejścia do kolekcji,
 * a nie tylko czytanie plików.
 *
 * Reguły ścieżkowe dotyczą identyfikatora dokumentu (relPath w sources.ts,
 * documentId w pipeline). Reguły treściowe są celowo wąskie: realna treść
 * produktowa używa słów „token" i „sekret" (help page, polityka prywatności,
 * brand book), więc zakaz słów tych odrzuciłby wiedzę użytkownika. Do
 * indeksu nie może trafić natomiast internals Paperclipa i materiał
 * sekretowy.
 */

/** Identyfikatory/ścieżki, które NIGDY nie trafiają do indeksu. */
const DENIED_PATHS = [
  /(^|\/)\.paperclip-wiki\//, /(^|\/)ops\//, /(^|\/)\.env(\.|$)/, /(^|\/)AGENTS\.md$/,
  /(^|\/)skills\//, /(^|\/)registry\//, /(^|\/)scripts\//, /(^|\/)dev\//, /(^|\/)archive\//,
  /_comment\.md$/, /_test\./, /\.test\./, /wrangler\..*\.jsonc$/, /instructions|toolInvocation|system prompt/i,
  /paperclip|runbook|sekret|token|Authorization|TEMPLATE_FILE_ID/i,
];

/** Treść indeksowana: internals Paperclipa albo materiał sekretowy. */
export const DENIED_TEXT = [
  /\bpaperclip\b/i,
  /\brunbook/i,
  /toolInvocation/,
  /(sk-ant-|ghp_|xoxb-|AIza|BEGIN [A-Z ]*PRIVATE KEY)/,
];

/**
 * Fail-closed: `ref` (ścieżka relatywna lub documentId) i opcjonalna treść
 * muszą być czyste, inaczej zapis/odczyt jest odrzucany z czytelnym błędem.
 */
export function assertNotDenied(ref: string, text?: string): void {
  if (DENIED_PATHS.some((re) => re.test(ref))) throw new Error(`source denied (V1 §3 denylist): ${ref}`);
  if (text !== undefined && DENIED_TEXT.some((re) => re.test(text))) {
    throw new Error(`source denied (V1 §3 denylist): internal/secret content in ${ref}`);
  }
}
