# Product host MCP — Żar i Szlif

Host-deployed, read-only MCP server for the Żar i Szlif `sprawnosci` catalog. It runs as
a plain Node 24 + TypeScript container (Streamable HTTP, stateless) and authenticates
callers with **the same Supabase Auth session the application already uses** — the JWT
Supabase issues to the browser/mobile client. No new identity provider, no separate MCP
token exchange, no service-role credentials.

```
MCP client ──Authorization: Bearer <Supabase access token>──▶ mcp/product-host
                                                                 │ verifies HS256 locally
                                                                 │ (SUPABASE_JWT_SECRET)
                                                                 ▼
                                                    Supabase PostgREST /rest/v1/sprawnosci
                                                    as the calling user (RLS applies)
```

Two read-only tools, one table, a fixed column projection. There is no write tool, no SQL
executor, no arbitrary URL fetch and no admin surface.

## Tools

Both tools run every PostgREST request with the caller's own bearer token, so row level
security behaves exactly as it does for the application.

### `list_sprawnosci`

| arg      | type                                            | notes                                   |
| -------- | ----------------------------------------------- | --------------------------------------- |
| `query`  | string                                          | case-insensitive match on `tytul`/`opis` |
| `poziom` | `odkrywcy` \| `zwiadowcy` \| `wedrownicy`        | exact match                             |
| `aspekt` | `fizyczny` \| `intelektualny` \| `duchowy` \| `spoleczny` | exact match                    |
| `grupa`  | string                                          | exact match                             |
| `limit`  | integer 1–100, default 25                       | page size                               |
| `offset` | integer ≥ 0, default 0                          | rows to skip                            |

Returns `{ items, count, limit, offset }`. `count` is the number of items in **this page**,
not the total matching row count. Each item is exactly:

`id, poziom, aspekt, grupa, grupa_label, tytul, wymagania, opis, tagi, zaktualizowano`

### `get_sprawnosc`

Arg `id` (non-empty string). Returns one item, or a tool error (`isError: true`) when no
row matches — absence is reported to the model, not as a protocol failure.

## HTTP contract

| route                                       | method      | behaviour                                                        |
| ------------------------------------------- | ----------- | ---------------------------------------------------------------- |
| `/health`                                   | GET         | `200 {ok:true,name,version}` — public                            |
| `/`                                         | GET         | short service info — public                                      |
| `/.well-known/oauth-protected-resource`     | GET         | RFC 9728 metadata (see below)                                    |
| `/mcp`                                      | POST        | Streamable HTTP MCP, stateless, requires a Supabase bearer token |
| `/mcp`                                      | GET/DELETE  | `405` with `Allow: POST` (no SSE stream, no sessions)            |
| anything else                               | any         | `404`                                                            |

Missing, malformed, expired, forged, `alg:none`, non-HS256 or wrong-`aud` token on
`POST /mcp` ⇒ `401` with

```
WWW-Authenticate: Bearer resource_metadata="<MCP_PUBLIC_ORIGIN>/.well-known/oauth-protected-resource"
```

Metadata document:

```json
{
  "resource": "<MCP_PUBLIC_ORIGIN>/mcp",
  "authorization_servers": ["<SUPABASE_PUBLIC_URL>/auth/v1"],
  "bearer_methods_supported": ["header"],
  "scopes_supported": ["openid", "email", "profile"]
}
```

`authorization_servers` is the **client-visible** Supabase origin (`SUPABASE_PUBLIC_URL`,
or `API_EXTERNAL_URL`), not the internal URL used server-side for PostgREST: a self-hosted
stack's `http://api-gw-…:8000` alias is not resolvable by any MCP client.

## Configuration

| variable              | required | default                     | meaning                                                     |
| --------------------- | -------- | --------------------------- | ----------------------------------------------------------- |
| `PORT`                | no       | `8080`                      | HTTP port                                                   |
| `MCP_PUBLIC_ORIGIN`   | yes (prod) | `http://127.0.0.1:$PORT`  | public origin used in the metadata document and the 401 challenge |
| `SUPABASE_URL`        | yes      | —                           | Supabase URL used **server-side** for PostgREST (may be an internal alias in self-hosted stacks) |
| `SUPABASE_PUBLIC_URL` | yes (prod) | falls back to `SUPABASE_URL` outside production | client-visible Supabase origin advertised as the auth server |
| `API_EXTERNAL_URL`    | no       | —                           | accepted alternative name for `SUPABASE_PUBLIC_URL` (standard in self-hosted Supabase) |
| `SUPABASE_ANON_KEY`   | yes      | —                           | anon/publishable key (never the service-role key)           |
| `SUPABASE_JWT_SECRET` | yes      | —                           | HS256 secret Supabase signs access tokens with              |
| `SUPABASE_JWT_ISSUER` | no       | unset                       | when set, `iss` is pinned to this value                     |
| `LOG_LEVEL`           | no       | `info`                      | `debug` \| `info` \| `warn` \| `error`                      |

The process refuses to start without `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_JWT_SECRET`, and — when `NODE_ENV=production` — without a client-visible
`SUPABASE_PUBLIC_URL` (or `API_EXTERNAL_URL`). Advertising an internal Docker alias as the
auth server is a client-visible lie, so that case fails startup instead of serving bad
metadata. Logs are redacted: bearer tokens and JWT-shaped strings never reach the log
stream, and the token is never included in an error message.

## Local run

```bash
cd mcp/product-host
npm ci
cp .env.example .env      # fill in placeholders, then export or use your own env loader
set -a && . ./.env && set +a
npm run build && npm start
curl -s localhost:8080/health
```

Checks:

```bash
npm run typecheck   # tsc over src + test
npm run build       # tsc src -> dist
npm test            # node:test, no live Supabase, generates its own HS256 tokens
```

Tests mock `fetch`, so they need no network, no database and no real secrets. One optional
live-PostgREST test is skipped unless you opt in — it is the regression that a staging E2E
caught (quoted equality filters matching nothing):

```bash
PRODUCT_HOST_LIVE_TEST=1 \
LIVE_SUPABASE_URL=https://<project>.supabase.co \
LIVE_SUPABASE_ANON_KEY=<anon key> \
LIVE_ACCESS_TOKEN=<access token of a signed-in test user> \
npm test
```

## Database migration (controller-applied)

`migrations/20261112_sprawnosci_catalog_fields.sql` adds three **additive** columns to
`public.sprawnosci` (`opis`, `tagi`, `zaktualizowano`), backfills existing rows, adds two
indexes and a `before update` trigger that keeps `zaktualizowano` current.

Agents do not apply SQL. The operator applies it to the target Supabase database **before**
the MCP service is switched over.

Apply:

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
  -f mcp/product-host/migrations/20261112_sprawnosci_catalog_fields.sql
```

Verify:

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'sprawnosci'
  and column_name in ('opis','tagi','zaktualizowano');

select count(*) as missing_opis from public.sprawnosci where opis is null;
select count(*) as empty_tagi from public.sprawnosci where cardinality(tagi) = 0;

select indexname from pg_indexes
where schemaname = 'public' and tablename = 'sprawnosci'
  and indexname in ('sprawnosci_tagi_gin','sprawnosci_zaktualizowano_idx');

select tgname from pg_trigger
where tgrelid = 'public.sprawnosci'::regclass and tgname = 'sprawnosci_touch';
```

Rollback (drops only what the forward migration created):

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
  -f mcp/product-host/migrations/20261112_sprawnosci_catalog_fields_rollback.sql
```

## Deployment contract

- Source: `miloszspyrka-code/zar-i-szlif`, branch `main` after reviewed merge.
- Coolify application built **from GitHub**, base/build context `mcp/product-host`,
  Dockerfile `mcp/product-host/Dockerfile`, exposed port `8080`.
- Public domain `https://mcp.zariszlif.pl` ⇒ `MCP_PUBLIC_ORIGIN=https://mcp.zariszlif.pl`.
- Container healthcheck: the Dockerfile probes `/health`.
- Runtime secrets (`SUPABASE_URL`, `SUPABASE_PUBLIC_URL` — or `API_EXTERNAL_URL` —
  `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`, optionally `SUPABASE_JWT_ISSUER`) are
  injected by Coolify. None of them are baked into the image. Staging example:
  `SUPABASE_URL=http://api-gw-…:8000` (internal) plus
  `SUPABASE_PUBLIC_URL=https://supabase-staging.51.89.174.58.sslip.io` (what clients must
  use). With `NODE_ENV=production` the container exits at startup if no client-visible
  origin is configured.
- Database migration is applied by the controller first (see above), then the app is
  deployed, then the smoke below is run.

### Smoke after deploy

```bash
BASE=https://mcp.zariszlif.pl

curl -s "$BASE/health"
curl -s "$BASE/.well-known/oauth-protected-resource"

# unauthenticated POST must be 401 with a resource_metadata challenge
curl -s -o /dev/null -D - -X POST "$BASE/mcp" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

Authenticated canary (uses a real application login; never commit the token):

```bash
TOKEN="$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" -H 'content-type: application/json' \
  -d '{"email":"...","password":"..."}' | jq -r .access_token)"

curl -s -X POST "$BASE/mcp" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_sprawnosci","arguments":{"limit":3}}}'
```

Rollback: redeploy the previous immutable image digest in Coolify. Rolling the database
back is only needed if the code is rolled back past this feature; the forward migration is
additive, so an older image keeps working with the new columns in place.

## Security notes

- Only `SUPABASE_ANON_KEY` + the caller's token reach PostgREST. The service-role key is
  never read by this service, so a compromised deployment cannot bypass RLS.
- Free-text `query` values are stripped of characters that terminate a PostgREST filter
  expression (`,`, `(`, `)`, `"`, `*`, `%`, `\`) before being interpolated into
  `or=(tytul.ilike.*…*,opis.ilike.*…*)`.
- Equality filters (`poziom`, `aspekt`, `grupa`, `id`) are emitted **unquoted**
  (`eq.<url-encoded value>`). PostgREST compares the literal string for `eq."value"` on a
  text column, so quoting silently returns zero rows; a value containing `,`, `(`, `)` or
  `"` is rejected as an invalid argument instead of being emitted, so a filter can never
  silently change meaning.
- No PII is projected beyond the catalog columns; the caller's `sub` is used only for
  logging correlation and never injected into a query.
