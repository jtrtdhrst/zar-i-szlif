# KOMAA-789 — Żar i Szlif welcome, canonical creative package (Email Creative)

Status: READY_FOR_IMPORT / NOT_DONE. live_sending_authorized=false. Production OFF until CMO KOMAA-776 + CTO KOMAA-788.
KOMAA-773 `creative-package` (INFLUENCY demo) stays untouched as history — never send it to real users.

## Canonical artifact
- File: `content/onboarding-emails/mautic/welcome-zar-i-szlif.html` (exact final HTML, immutable in this commit)
- SHA256: `48267ab14d7f7373f8f270e6c01ce3ad1b4b134e1bba44b00738acd947f89bac`, 2,902 bytes
- Subject (PROPOSED, needs CMO sign-off): `Twoje konto Żar i Szlif jest aktywne`
- Preheader (PROPOSED, needs CMO sign-off): `Otwórz panel i zaplanuj pierwszą aktywność.`
- Plain text: `Cześć, {contactfield=firstname|Instruktorze}! Twoje konto Żar i Szlif jest aktywne. Żar i Szlif pomaga zaplanować aktywność drużyny bez pustej kartki: cel, plan z elementami i czasem, materiały oraz krótka refleksja po realizacji. Zacznij od panelu: https://panel.kompaszbiorek.pl/ — Dostałeś tego maila, bo założyłeś konto w Żar i Szlif. Wypisz się: {unsubscribe_url}`
- Links: 1) `https://panel.kompaszbiorek.pl/` CTA (approved root); 2) `{unsubscribe_url}` footer (official Mautic token, resolves at send).
- Tokens preserved exactly: `{contactfield=firstname|Instruktorze}` (role fallback, no demo names), `{unsubscribe_url}`.
- Removed vs KOMAA-773: INFLUENCY brand, demo names, fake dates/countdown, static plans/materials/tasks, imaginary address, placeholder anchor hrefs. No logo/slogan/address invented (UNAPPROVED per `branding/BRAND.md` on PR branch `fix/zar-i-szlif-canonical-brand-20261013`, OPEN — rules read as TARGET, not deployed state).

## Emailens evidence (REAL tool runs, this heartbeat)
- Baseline (unmodified KOMAA-773 input, sha-verified `2628e019…`): overallCompatibility 79, ZERO compat errors / 21 clients; spam 62–77 (missing-unsubscribe, missing-address); 2 broken-anchor placeholders; dark-hero forced-repaint contrast errors. Verdict: structure email-safe, content/brand NOT production-usable → rebuilt.
- Final (EXACT bytes above): `emailens_audit_email` overallCompatibility 79, ZERO compat errors / 21 clients (Gmail 97, Outlook web/iOS/Android/macOS 100, Apple Mail 100, Yahoo 97, Samsung 100, Thunderbird 97, HEY 100, ProtonMail/AOL 94, Fastmail/Superhuman 100; Outlook Windows/Classic 79 warnings-only: border-radius fallback, @media enhancement, hidden-preheader pattern, td padding). `emailens_preview_email` overallScore 79, identical scores, zero errors. Links 2, zero issues. Spam 92 low (only missing-physical-address warning — no address invented). A11y 88 (2 low-contrast warnings from approved palette, no structural errors). Inbox: subject 36 / preheader 43 chars, no bad truncation. Size 2.8 KB. Expected pre-send notes: `{unsubscribe_url}` flagged unresolved (resolves in Mautic), raw token 38-char nowrap warning (resolves to short name at send). Dark-mode forced-repaint warnings on brand green (documented limitation, same class as KOMAA-773).
- Acceptance: PASS conditional. Screenshots NOT_RUN (no screenshot tool in runtime).

## Mautic / send blockers (owners named — send stays BLOCKED, import may proceed inert)
1. Sender + reply-to — owner Lifecycle Ops / MCP Engineer KOMAA-786.
2. Physical footer address + settings URL — owner KOMAA-786 (spam stays yellow till supplied).
3. Subject/preheader sign-off — owner CMO KOMAA-776. 4. Production activation — owner CTO KOMAA-788.
