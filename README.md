# Multica–Hermes isolated E2E 2026-11-09

Disposable test-only branch. No workflows and no production code. Local Docker builds on VPS; GitHub Actions are intentionally absent.

## Service

Stdlib-only Python HTTP microservice (`app.py`) listening on `0.0.0.0:8080`.

Environment:

- `SOURCE_SHA` — reported by `/health` and `/version` (default `unknown`)
- `HOST`, `PORT` — optional overrides

## Run locally

```sh
python3 app.py
```

## Smoke checks

```sh
curl -s http://127.0.0.1:8080/health
curl -s http://127.0.0.1:8080/version
curl -s "http://127.0.0.1:8080/sum?x=2&y=3"
curl -si "http://127.0.0.1:8080/sum?x=2" | head -1
```

Expected:

- `/health` → `{"status": "ok", "service": "multica-hermes-e2e", "source_sha": "..."}`
- `/version` → `{"revision": "v2", "source_sha": "..."}`
- `/sum?x=2&y=3` → `{"sum": 5}`
- invalid/missing parameters → HTTP 400 JSON error

## Tests

```sh
python3 -m unittest -v
```

## Docker

```sh
docker build -t multica-hermes-e2e .
docker run --rm -p 8080:8080 -e SOURCE_SHA=local multica-hermes-e2e
```

The image runs `python -m unittest -v` at build time and defines a `/health` HEALTHCHECK.
