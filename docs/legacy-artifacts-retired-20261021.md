# Legacy artifact retirement — 2026-10-21

Repo: `miloszspyrka-code/zar-i-szlif`. Archive entries are obsolete historical reference material, not runtime code or current product requirements. This cleanup removes tracked copies from the current working tree; **nothing is irreversibly erased**. Git history retains all blobs.

## Preservation

- Recovery commit: `7601547c81d15a58f7b00d5d82c2de3042f001b9` (branch `chore/current-context-docs-20261021` before this cleanup)
- Recovery tree SHA: `6eccddd4333ab6b30881ebfceaeed3a4009fbfa2`
- To restore a specific file locally: `git restore --source=7601547c81d15a58f7b00d5d82c2de3042f001b9 -- "PATH"`
- Historical content must not be treated as deployed behavior, active config or current brand voice.

## Files retired (11)

| Path | Original blob SHA | Bytes |
|---|---|---:|
| `archive/legacy/audyty-2026-08/AUDYT-UX-UI-2026-08-10-ARCHIWUM.md` | `7189a33755bd942708909b2a964317e07990ed9e` | 13668 |
| `archive/legacy/audyty-2026-08/AUDYT-ZGODNOSCI-PRD-2026-08-17-ARCHIWUM.md` | `5528f9e5e13e08473d44d6cccbdc896b9d92281f` | 8425 |
| `archive/legacy/custom-gpt/Prompt-systemowy-ARCHIWUM-2026-08-20.md` | `06ca5e543c926953b3ebd24b94d5a9e5b6d470f2` | 7785 |
| `archive/legacy/snapshoty-komaa/KOMAA-29-COO-TRIAGE.md` | `055a60e9f2b00a030ecc21f8718acda3a441f0fb` | 1965 |
| `archive/legacy/snapshoty-komaa/KOMAA-29-comments.json` | `a77301b2522f4873f01528c496bbe7fe396840d9` | 3300 |
| `archive/legacy/snapshoty-komaa/KOMAA-29-full.json` | `503e4ccf0ab4e5382c74a1ba0c6728e56fbe113d` | 11606 |
| `archive/legacy/snapshoty-komaa/KOMAA-29-issue.json` | `503e4ccf0ab4e5382c74a1ba0c6728e56fbe113d` | 11606 |
| `archive/legacy/snapshoty-komaa/KOMAA-29-status.json` | `61009d81e27c606481b522d235378df7aa0ac02c` | 12327 |
| `archive/legacy/snapshoty-komaa/KOMAA-33-issue.json` | `e95c7740f149c4be73ec6da499c56cf17a3ab09b` | 15216 |
| `archive/legacy/snapshoty-komaa/KOMAA-33-status.json` | `9860765af5173413c9eb83bd423b3fa1b6a7c9e6` | 15210 |
| `archive/ui-audits/AUDYT-SPRAWNOSCI-KOMAA-25.md` | `4147b2c8ca3863f477d372e0e8258d6164bf710c` | 13790 |

## Keep current

- Runtime: `app/`, `app/mcp-worker/`, `app/plugin/`, `app/cloudflare-worker/`.
- Current product requirements, active Paperclip Wiki, active integrations and onboarding/email source remain in place.
- No branch with unmerged feature code and no Paperclip execution worktree is removed by this change.
