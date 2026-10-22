# Self-hosted Plasmic action

The bundled action shipped by Studio installs its own `@plasmicapp/cli` in a
throwaway directory, so it always talks to `https://codegen.plasmic.app` and
fails with `Project with ID ... not found` against our self-hosted Studio.

`selfhost.cjs` replaces it (`action.yml` → `main: selfhost.cjs`):

1. `init` — no-op when the target directory already has `package.json`
   (Studio's generated workflow passes `directory`/`branch`).
2. `sync` — installs deps with pnpm 9 (`--ignore-workspace` because the repo
   root is an npm workspace without pnpm `packages`), patches the CLI host
   comparison, runs `plasmic sync --skip-upgrade-check` and commits/pushes.
3. `build` — `npm run build`.

Studio regenerates `.github/workflows/plasmic.yml` on publish but leaves this
directory alone, so the fix survives. The old 17 MB bundles were removed.
