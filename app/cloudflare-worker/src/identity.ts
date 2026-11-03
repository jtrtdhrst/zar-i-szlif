// Kanoniczna tożsamość użytkownika dla RAG na Cloudflare Worker.
//
// Worker jest AS-em OAuth 2.1 dla klienta MCP i OAuth Clientem wobec Google.
// Grant (`ctx.props`) niesie zweryfikowany profil Google; TEN MODUŁ zamienia go
// na scope retrieval. To jedyne miejsce, w którym powstaje `userId`, więc
// izolacja nie ma dwóch ścieżek.
//
// Zasady (V1 §4 + wymóg tożsamościowy):
// - Identyfikatorem jest STABILNY SUBJEKT Google (`sub`), nigdy email.
//   `email` służy wyłącznie do rozpoznania profilu w UI, nigdy do autoryzacji.
// - `email_verified === false` nie obniża autoryzacji, ale `email` i tak nigdy
//   nie jest kluczem scope — zweryfikowany sub jest warunkiem wejścia.
// - Brak sub = fail-closed (brak query do Qdrant, zamiast pusty/wspólny scope).
// - `workspaceIds` pochodzą wyłącznie z grantu serwerowego. Nigdy z argumentów
//   narzędzia (tę ochronę egzekwuje `assertNoClientScope` w knowledge/mcp-tools).
// - Brak drugiego systemu kont: Supabase/Postgres pozostaje SSOT aplikacji.
//   Dopóki `supabase/` nie ma migracji tabeli auth, kanoniczną tożsamością jest
//   provider-subject — dokładnie tak, jak Supabase Auth wiąże konto Google.
//
// ponytail: subject z providera to jedyny klucz; mapowanie na wiersz
// `auth.users` dochodzi dopiero, gdy kanoniczna tabela auth istnieje.

/** Prefiks providera — dokumentuje domenę klucza scope, nie jest częścią `userId`.
 *  UWAGA: `userId` zwracane niżej to GOŁY subject, bo dokładnie tak indexed
 *  `payload.user_id` w kolekcji (`knowledge/smoke.ts`, `pipeline.syncDocument`)
 *  i dokładnie tego wymaga `resolveAuth`/`buildAuthFilter`. Prefiks
 *  `google:` w filtrze Qdrant dawałby zero trafień dla chunków widocznych
 *  wyłącznie dla usera. */
export const PROVIDER = "google";

/** Grant po OAuth: struktura propsów Workera (patrz `src/google-handler.ts`). */
export interface VerifiedGrant {
  googleSub?: unknown;
  email?: unknown;
  emailVerified?: unknown;
  workspaceIds?: unknown;
}

/**
 * Fail-closed: zweryfikowany subject Google, bez `sub` = rzucamy. Zwraca
 * GOŁY `sub`, bo tak indexed `payload.user_id` w Qdrant i tak go porównuje
 * `resolveAuth`/`buildAuthFilter`.
 */
export function canonicalUserId(grant: VerifiedGrant | null | undefined): string {
  const sub = typeof grant?.googleSub === "string" ? grant.googleSub.trim() : "";
  if (!sub) {
    throw new Error("Brak autoryzacji: grant OAuth bez zweryfikowanego subjectu Google (fail-closed).");
  }
  return sub;
}

/**
 * Workspace/team z grantu serwerowego: tylko niepuste stringi, bez duplikatów.
 * `workspaceIds` trafiają do `buildAuthFilter` jako WARTOŚCI
 * (`{ key: "workspace_id", match: { value: … } }`), nigdy jako klucze obiektu,
 * więc `__proto__`/`constructor` w tej pozycji są niegroźne i nie są odfiltrowywane.
 * Chroni je allowlista źródeł bez prototypu w `knowledge/pipeline.ts`.
 */
export function canonicalWorkspaceIds(grant: VerifiedGrant | null | undefined): string[] {
  const raw = Array.isArray(grant?.workspaceIds) ? grant.workspaceIds : [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value === "string" && value.trim()) seen.add(value.trim());
  }
  return [...seen];
}

/** Kanoniczny scope przekazywany do `knowledge/mcp-tools`. */
export interface CanonicalScope {
  googleSub: string;
  workspaceIds: string[];
}

export function resolveCanonicalScope(grant: VerifiedGrant | null | undefined): CanonicalScope {
  return { googleSub: canonicalUserId(grant), workspaceIds: canonicalWorkspaceIds(grant) };
}
