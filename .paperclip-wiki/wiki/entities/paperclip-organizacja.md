---
title: Paperclip — organizacja, agenci, rutyny
type: entity
tags: [paperclip, agents, governance]
sources: [raw/WSPOLNY_KONTEKST.md, raw/SNAPSHOT-ORGANIZACJI-PAPERCLIP.md]
created: 2026-08-20
updated: 2026-08-20
---

# Paperclip — organizacja

Workspace: `isolated_workspace` + `git_worktree` (`baseRef=main`, parent `.paperclip-worktrees`), managed checkout nie jest targetem zapisu. Dostarczanie: Engineer→QA→Done, max 2 deliverable.

Agenci: CEO (`kompas-governance`), COO (`issue-triage`, `kompas-team-map`), CTO/Engineer (`kompas-technical-context`, `github-pr-workflow`), Designer (`kompas-design-context`, `agent-browser`), UI QA (`kompas-qa-context`, `qa-acceptance`), CMO (`kompas-brand-email`). Skille lekkie kontrakty `local/<hash>/<slug>`.

Profile modeli: `cheap` (heartbeat, triage, docs) vs `primary` (kod, decyzja); eskalacja do Deepseek Pro tylko gdy cheap/primary nie rozwiązały.