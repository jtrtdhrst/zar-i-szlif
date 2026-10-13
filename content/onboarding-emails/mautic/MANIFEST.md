# Żar i Szlif — welcome email (Mautic; safe staging)

STATUS: READY_FOR_IMPORT / NOT_IMPORTED / PRODUCTION_OFF. No live sends, no campaign enrollment or segment-wide import.

## SINGLE canonical source — current
- Paperclip issue: `KOMAA-789`; document: `creative-package`.
- Path: `content/onboarding-emails/mautic/welcome-zar-i-szlif.html`.
- Validated candidate commit: `9cf1a6c68ac46b437c2187301d31f8e99f706e96` (PR #44).
- SHA256: `48267ab14d7f7373f8f270e6c01ce3ad1b4b134e1bba44b00738acd947f89bac` (2,902 bytes).
- Subject, PENDING CMO: `Twoje konto Żar i Szlif jest aktywne`.
- Preheader, PENDING CMO: `Otwórz panel i zaplanuj pierwszą aktywność.`.
- Tokens: `{contactfield=firstname|Instruktorze}`, `{unsubscribe_url}`; resolve in authenticated Mautic TEST rendering before any send.
- Exact final Emailens audit/preview: 79, zero compatibility errors across 21 clients (source `KOMAA-789-PACKAGE.md`). Screenshots NOT_RUN; no provider-side readback.

## LEGACY — never use for new import
- `KOMAA-773/creative-package` (`INFLUENCY`, SHA256 `2628e01982b3d94c15ca969f2aa70de896fdf1a6c28546435ac1a152b492b0fc`) is historical and not an approved current source.
- `welcome-mautic-test.html` (17,311 bytes, contains old INFLUENCY, demo names/static dates and notification placeholder mapping) is an archival technical fixture ONLY; forbidden for real contacts or current TEST campaign. Do not treat the old fixture as the present Żar i Szlif candidate.

## Mandatory provider + safety gates
1. KOMAA-791/KOMAA-786: authorized Mautic API credential, discover real sender/reply-to/physical footer address, TEST-only IDs. Import exact current SHA into a NEW INACTIVE email. API readback of saved email ID/type/status/subject/HTML hash; confirm token rendering and unsubscribe/suppression. No guesses, no environment secrets in source.
2. KOMAA-790/KOMAA-793/KOMAA-796: D1 account source, schema, authoritative pre-cutover backfill, atomic uniqueness, durable enrollment outbox and Mautic transport proof. Existing Google login does not equal first account registration. Current branch's `segmentEligible:false` means zero enrollment; do not "enable" blindly.
3. KOMAA-774: isolated one-contact test evidence for new account exactly once; existing account, repeat OAuth login, retry/replay, concurrent events, suppression/opt-out, wrong-segment and missing consent = 0 unintended sends. Verify positive sends only in permitted TEST-only scope.
4. KOMAA-776: independent CMO review, subject/preheader approval, HTML/render/consent/provider tests PASS.
5. KOMAA-788: CTO controlled canary, no historical import, rollback/kill switch, staged activation only after ALL prior evidence.

No send or activation has happened. Any failure of the above is BLOCKED; do not mark complete or wake agents repeatedly on unchanged failure fingerprints.
