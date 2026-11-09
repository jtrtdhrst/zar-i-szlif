---
title: Product release state must be proved from runtime
status: accepted
date: 2026-11-09
---
# ADR 002: Deployment is not inferred from code or a PR

## Context
Repowise indexes Git history, and Paperclip Wiki includes historical release claims. Neither a successful index nor merged PR proves what is currently serving traffic.

## Decision
For claims of a live Product release, require exact Git SHA, deployed artifact/config identification and actual endpoint readback. When evidence is absent, label the claim UNVERIFIED.

## Consequences
At the verified 2026-11-09 snapshot, `https://panel.zariszlif.pl/healthz` returned HTTP 200 `ok` and `__release.json` returned commit `98cd058155dbf4c268777246fc510324f98f7dc5`. This is time-scoped: do not apply it as a perpetual statement.

## Evidence and scope
- `docs/architecture/CURRENT-RUNTIME-2026-11-09.md`.
- Scope: `ops/`, `app/`, `tests/`.
