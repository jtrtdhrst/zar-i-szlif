# PostHog integration — Żar i Szlif

Status: **prepared on `main`, not yet embedded in a deployed application**.
PostHog organization: Żar i Szlif. EU project ID: `265172`.
Ingest host: `https://eu.i.posthog.com`.

## Source map

| Surface | Adapter | NPM dependency | Activation |
|---|---|---|---|
| Marketing | `www/landing/posthog.client.mjs` | `posthog-js` | Import into generated landing client |
| MCP documentation | `www/mcp/posthog.client.mjs` | `posthog-js` | Import into generated website client |
| Application | `product/posthog.client.mjs` | `posthog-js` | Import into generated product client |
| Product MCP | `mcp/posthog.server.mjs` | `posthog-node` | Import into a future Node.js MCP service |

These directories are **currently empty Plasmic targets** (no package manifests or entrypoints).
Adapters are ready to import, but must not be described as installed or deployed until
Plasmic-generated applications and the product MCP are connected and built.

## Deployment variables

Use `.env.posthog.example` for naming conventions. Provide the **public Project Token**
from PostHog Project Settings in each app's deployment environment, not via source code.
For Next.js use `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST`.
For Vite use `VITE_POSTHOG_PROJECT_TOKEN` and `VITE_POSTHOG_HOST`.
For Node.js MCP use `POSTHOG_PROJECT_TOKEN`, `POSTHOG_HOST`, and
`POSTHOG_SERVER_ENABLED` (default `false`).

The existing Coolify `zar-i-szlif-web` production application still uses the recovery
ref `release/panel-stable-20261027`; do not move it to `main` or redeploy it merely
to enable PostHog. Its deployment variables are not a substitute for a future main
deployment or for site-specific build-time variables.

## Connect when a generated app exists

1. In each generated browser app directory: `npm install posthog-js`.
2. Import the corresponding adapter, then call its `initialize*PostHog({ projectToken, host })`
   from the browser/client entrypoint. Pass framework-specific environment variables.
3. Connect your consent interface to `set*AnalyticsConsent(true|false)`. Consent
   is **OFF by default**. No events are sent before opt-in.
4. Call `capture*Event()` only with the enumerated safe event names and optional
   `area` (a short controlled category, not free text). Product events must not
   contain meeting cards, plans, notes, email, child names or team IDs.
5. In product only, call `identifyConsentingUser(supabaseAuthUser.id)` after the
   user is authenticated and analytics consent is granted; call
   `resetAnalyticsOnLogout()` at logout. Reset also clears analytics consent.
6. For MCP Node.js: `npm install posthog-node`; call `createMcpAnalytics()` with
   `enabled: process.env.POSTHOG_SERVER_ENABLED === 'true'`. Call `shutdown()`
   at process shutdown. Capture only permitted outcome events with pseudonymous
   `distinctId`, category and duration, never request/response contents.
7. Build each application independently, deploy staging, opt in with a test user,
   and confirm events appear in PostHog Activity. Verify opt-out means zero
   network captures. Only then deploy to production.

## Privacy and testing

EU ingestion does not alone guarantee GDPR compliance. Configure retention, discard
IP addresses in PostHog project privacy settings if appropriate, and validate the
lawful basis/consent flow and retention before turning on production tracking.
Autocapture, automatic pageviews and session replay are disabled; explicit
consent-controlled pageviews and curated events are the only browser events.

Use a separate PostHog project for staging where possible. Do not emit artificial
production events merely to confirm the API token. The HTTPS root path returning 404
does not indicate failed ingestion; validate an actual event once a client is wired.

## References

- https://posthog.com/docs/libraries/js
- https://posthog.com/docs/libraries/node
- https://posthog.com/docs/libraries/next-js
