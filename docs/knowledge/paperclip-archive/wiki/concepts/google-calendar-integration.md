---
title: Żar i Szlif — Google Calendar integration (TARGET)
type: concept
tags: [google-calendar, activities, integration, oauth, synchronization]
created: 2026-10-21
updated: 2026-10-23
status: TARGET_NOT_IMPLEMENTED
owner: CTO
implementers: [Engineer, MCP Engineer]
---

# Google Calendar — dedicated editable application calendar

## User outcome
An authenticated instructor can **optionally**, only from the application's Calendar section, connect Google Calendar and add a **separate secondary calendar named "Żar i Szlif"** to that Google account. **Signing in or registering must never request Calendar permissions or require calendar creation.** The app remains fully usable if Calendar consent is not granted. After connection the instructor can see/manage authorized meetings, camps, trips, and events in Google Calendar. Creating, rescheduling, editing, or cancelling an event must be reflected on the same canonical activity card in Żar i Szlif. Disconnection must not delete canonical app records or silently destroy the user's Google calendar.

This is a TARGET feature, not a claim of deployed Google integration. It is not a read-only ICS subscription or a second copy of the activity database. The existing knowledge MCP and 17-tool activity lifecycle proposal are separate.

## Non-negotiable data model
- Supabase/Postgres remains the **single canonical source** for actual team activity / meeting records and authorized mutations; Google Calendar is an external projection plus a narrowly scoped input for editable event fields. The Activity Library is suggestions, never a calendar record.
- Each connected Google identity gets exactly one **app-created secondary calendar** by default; store a stable connection identity, calendar ID, authorized actor ID, event mapping (activity ID + Google event ID + revision/ETag + sync cursor), sync status, created-by-app marker and audit trail. Reconnecting should discover/reuse the previously linked app calendar when authorized rather than creating duplicates.
- Only actual activities for the user's current authorized team become events. Google event descriptions MAY contain **only** an exact deep link to the corresponding activity card, an event/plan realization status and the current connected user's **own assigned tasks with their completion states**, after per-user authorization and content redaction. Do not publish child identity, other people's tasks, personal participation details, material inventories, individual RR progress, experiments, secrets or sensitive notes. Allowed fields include safe title/location, start/end/timezone, harmless activity type and these narrowly scoped description fields. Never export a child's name indirectly through a task title; sanitize every field.
- One Google calendar event must map to one canonical activity, including changes from either direction. Event types (meeting, camp, trip, etc.) use existing domain model. Do not create parallel `calendar_events` as a competing activity SSOT; any event-link table is a synchronization ledger.

## Product cycle
1. **Calendar section only:** expose an optional "Połącz z Google Calendar" action (possibly linking to integration settings), clearly explain requested access, start user-consented incremental Google Calendar OAuth only after that explicit action, and display Connected / Syncing / Action needed / Disconnected with an unlink action. **No Calendar consent dialog, calendar creation or blocking step at login, registration or onboarding.**
2. On first connect, create a secondary calendar `Żar i Szlif` in the actual user's Google account, making the user the calendar data owner; save its Google calendar ID, confirm it appears in that account, and backfill permitted upcoming events. Never attempt calendar creation with a service account. Google Calendar API `calendars.insert` and least-privilege `https://www.googleapis.com/auth/calendar.app.created` are the preferred baseline; verify actual endpoint/scope interoperability and Google consent/verification requirements on staging.
3. A real activity created/updated/cancelled through panel or approved product MCP `manage_activity` emits an idempotent outbox mutation to create/update/remove **only its app-owned Google event**. Persist and use the **canonical activity ID + Google calendar ID + Google event ID** mapping in both directions; event ID does not change on updates/reschedules. Date/time changes move the same Google event, including DST-aware IANA timezone handling. Refresh only allowed description fields when the underlying activity status or the connected user's assigned tasks/statuses change.
4. A user may edit event title, time and approved location directly inside this dedicated Google calendar. Use Google Calendar push notifications plus `events.list` incremental synchronization / periodic reconciliation to read changes **by the persisted Google event ID**, never by matching titles/dates. Validate the mapped actor's current authorization and update the **same canonical activity ID** with optimistic version checks, or surface a resolvable conflict without overwriting another user's newer edit. The event description is a generated projection: edits to task checkboxes, statuses or links inside Google's free-text description do not count as authoritative task completion.
5. On deletion from Google, handle as an explicit event cancellation/unlink intent according to reviewed product policy. Do NOT implicitly erase historical activity cards/reports or delete unrelated calendar events. If team authorization is revoked or active team changes, stop synchronizing old team data and safely remove only app-created event projections for which ownership/mapping is verified.
6. On token expiry/revocation, lost access, Google API quota/backoff or sync channel expiry: show a clear degraded status, retry transient failures safely, renew watch channels, and reconcile after reauthorization; never loop or silently lose canonical changes.
7. Disconnect revokes stored credentials and stops notifications/sync. Preserve app activities; provide a distinct, explicit optional removal of app-created Google events/calendar after confirmation (never delete a user's primary calendar or manually created unrelated events).

## Credentials and permissions
- Google sign-in for panel.zariszlif.pl and the OAuth **incremental Calendar consent** must not be conflated: Calendar scopes are neither required nor requested as part of login/registration, and refusal does not block the product. Use dedicated panel OAuth client/redirect allowlists per `wiki/concepts/product-oauth-client-credential-mapping.md`; never repurpose the mcp.zariszlif.pl OAuth client/credentials or leak refresh tokens to client JS, tool responses, logs or prompts.
- Implement encrypted server-side token storage and safe refresh/revocation; bind Google principal to the authenticated Supabase user and active team with RLS/membership checks on every synchronization and import. Avoid broad `calendar` and `calendar.events` scopes if `calendar.app.created` suffices.
- Product MCP is not a Google OAuth client and must never receive Google credentials. It updates canonical activity data with existing `manage_activity` permissions; the backend integration handles Google propagation. `list_activities` and `get_activity` may expose a safe `calendar_sync_status` or provider link, never OAuth secrets; add separate MCP calendar tools only if verified functionality cannot fit those existing contracts and approved separately.

## Implementation edges and sequencing
- Engineer: verify actual Supabase activity schema, event schema, existing panel OAuth callback, integration backend and runtime; map conflicts before DDL. Create only additive secure tables/outbox, no duplicate records.
- Engineer: Google OAuth + calendar provisioning; outbound event mapping and inbound sync worker with bounded retries, tombstones, ETags, syncToken, webhook verification and expiry renewal.
- Engineer / Designer: user-facing connect/manage/disconnect UI, settings state and authorized calendar deep links. No login/onboarding requirement; integration is optional.
- MCP Engineer: validate that `manage_activity` / `list_activities` / `get_activity` map date/time edits to the same activity and do not create a second, unreviewed MCP tool surface. Changes to product MCP must follow independent review and live scope checks.
- CTO: independently review privacy/security, conflict resolution and E2E results before production release. Harness resolves platform/workspace failures without bypassing real domain approvals.

## Definition of Done — real evidence only
- OAuth connect creates one dedicated user-owned `Żar i Szlif` Google calendar, visible and writable in the real test user's Google Calendar. Reconnect and retry create **zero duplicate calendars**.
- Create, change time, rename, relocate and cancel an app activity: one mapped Google event is created/updated/removed appropriately, with no duplicates and with the same canonical activity ID.
- Google-origin edits import only allowlisted fields and update the same activity; Google deletion does not silently erase past reports. Collision handling, offline recovery, notification replay, expired sync tokens, 401/403, 404/410, 429/5xx, backoff, DST, team switch and revoked membership have explicit tests.
- Negative tests prove calendar-private data isn't queried, child identity/PII and other users' tasks aren't exported, no cross-team updates are accepted, and MCP returns no OAuth credentials. Tests also verify that safe assigned tasks and their statuses render only in the proper connected adult's own event description, with a correct authorized activity deep link and current realization status. User-created unrelated Google events stay untouched.
- Disconnect stops sync and protects canonical records; documented optional deletion is separately confirmed and scoped.
- Deployment is independently accepted by CTO after staging integration tests and real Google Calendar test-account round trip, then verified by readback from live authorized accounts. Update docs only when exact release proof exists.

## Decyzja produktowa 2026-10-23 — dostęp z kalendarza, opis wydarzenia i ścisłe ID

1. **Rejestracja/logowanie:** wyłącznie uwierzytelnienie potrzebne dla konta; brak prośby o uprawnienie do tworzenia kalendarzy. **Opcjonalna integracja:** użytkownik wywołuje ją świadomie z sekcji Kalendarz, również długo po rejestracji. Brak połączenia nie blokuje tworzenia ani prowadzenia aktywności.
2. **Synchronizacja 2-kierunkowa:** jedynym kluczem odwzorowania jest trwałe mapowanie `activity_id ↔ (google_calendar_id, google_event_id)` przypisane do właściwego użytkownika/konta; dane o rewizji/ETag służą rozwiązywaniu kolizji. Aktualizacja z aplikacji zmienia istniejący event o jego ID; edycje dozwolonych pól z Google wracają do **tego samego** rekordu aktywności. Retry, aktualizacja opisu, ponowne połączenie i zmiana nazwy nie mogą tworzyć duplikatów.
3. **Generowany opis wydarzenia Google:** zawiera (a) **dokładny, działający deep link do konkretnej Karty Aktywności**, kierujący przez autoryzację aplikacji, (b) **stan realizacji wydarzenia/aktywności** — np. zaplanowano, do podsumowania, zrealizowano po potwierdzeniu lub odwołano — oraz (c) **zadania z tą aktywnością powiązane i przypisane konkretnie do osoby, której Google Calendar jest podłączony**, z aktualnym stanem wykonania każdego zadania. Nie wstawiać zadań innej osoby, danych dzieci ani wrażliwych treści. Jeśli brak przypisanych zadań, widoczne neutralne „Brak Twoich zadań” lub sekcja pominięta.
4. **Źródło prawdy:** karta, przypisania zadań i ich statusy pochodzą z Supabase/Postgres; opis Google jest tylko bezpieczną projekcją aktualizowaną 1-kierunkowo z aplikacji. 2-kierunkowo synchronizowane są **zatwierdzone edytowalne pola wydarzenia** (np. termin, tytuł i dozwolona lokalizacja), nie dowolny tekst opisu, dane zadań ani poświadczenia wykonania.
5. **Dostęp i zmiana uprawnień:** używaj realnego routingu aplikacji, bez konstruowania niezweryfikowanego URL; otwarcie linku wymaga logowania i uprawnienia do drużyny/aktywności. Przy odebraniu dostępu zaktualizuj/wycofaj widok kalendarza odpowiednio do zasad prywatności. Każdy użytkownik widzi we własnym kalendarzu wyłącznie uprawnione dane, niezależnie od pozostałych współprowadzących.

### Testy akceptacyjne tej decyzji

- Nowe konto: rejestracja i pierwsze logowanie bez żadnych uprawnień Calendar; odmowa lub brak integracji nie blokuje modułów.
- Z sekcji Kalendarz: dobrowolny OAuth, dokładnie jeden dedykowany kalendarz i prawidłowe połączenie, powrót z odwołania zgody bez utraty danych aplikacji.
- Zmiana tytułu/terminu w obu kierunkach: po każdej zmianie odczyt **tego samego** `google_event_id` i `activity_id`, bez podwojenia wpisów i z kontrolą konfliktów.
- Opis: link prowadzi do właściwej karty po autoryzacji; status po potwierdzonym podsumowaniu zmienia się; status każdego przypisanego zadania aktualizuje się po wykonaniu. Konto innego współprowadzącego nie widzi zadań cudzych.
- Edycja ręczna generowanego opisu Google **nie zalicza zadań** w aplikacji; wrażliwe dane i personalia nie wyciekają, 403/odłączone konto działa fail-closed.

Powiązania: [[wiki/concepts/onboarding]], [[wiki/concepts/karta-zbiorki]], [[wiki/sources/baza-aktywnosci]]. Status: **TARGET / do wdrożenia**; ta decyzja nie oznacza, że synchronizacja działa już produkcyjnie.
