# Żar i Szlif — MCP Connect: native Plasmic page payload

Source artifact for the **independent** self-hosted Plasmic Studio project
`Żar i Szlif — MCP Connect` (public host `https://mcp.zariszlif.pl/`).

This is **not** a page inside the legacy smoke project `ew9Zg1DsRBmoU5D99kLXHZ`.
It is the import payload for a project that must be created first.

## What these files are

`landing-zar-i-szlif-mcp-connect.html` is a full HTML document that the Plasmic MCP
compiles into a **native, editable** Studio page (native components, not a flattened
screenshot). Public copy is Polish; the file carries no tracking, no script and no
private data. This `.md` file is its handoff doc for the Studio session that owns
the new project.

Content is intentionally in parity with the credential-free fallback site in
`app/mcp-worker/src/landing.ts` (PR #64), extended with the OAuth, privacy/scope
and FAQ sections required for the MCP Connect scope.

## Import command (run in the session that owns the new project)

```
plasmic_create_project(name="Żar i Szlif — MCP Connect", workspaceId=<authorized workspace>)
plasmic_import_html(
  projectId=<new project id>,
  name="MCP Connect",
  path="/",
  html=<contents of landing-zar-i-szlif-mcp-connect.html>,
  splitComponents="sections"
)
plasmic_get_project(projectId=<new project id>)      # read project id + exact revision
plasmic_read_page(pageId=<saved page id>)            # read saved page id + exact revision
```

`plasmic_create_project` is not in the currently deployed `plasmic-mcp` image
(18 tools, no project creation). It exists in the service source and is delivered
by deploying that build to the Studio host; until then the project can only be
created through the WAB admin API `POST /api/v1/projects` with the authorized
Studio session, which yields the same project record.

After the page is saved, make one controlled edit and re-read it
(`plasmic_update` on an existing element id, then `plasmic_read_page`) so the
native editability is proven in the same authorized session.

## Verified behaviour of the live importer (dry run, no write)

`plasmic_import_html` with `dryRun=true` against the legacy project returned
`ok:true`, `valid:true`, `revision:106` (unchanged → nothing was written) and
compiled the payload into 113 native template tags, 3 native components and
51 CSS rules (Paperclip run `f45a7350-8c79-4b5a-9e0d-af697b76bddb`).
Two importer limits were observed and are already handled in this payload:

| Importer behaviour | Handling in this file |
| --- | --- |
| `@media` rules are dropped | Layout is fluid on its own: `clamp()` type/padding/gap values plus `flex-wrap` stacks the hero, cards and header at 390 px without any media query. The single `@media` block is an enhancement for the standalone HTML only. |
| pseudo-class selectors are dropped | No `outline: none` is ever set, so the user-agent focus ring stays visible; interactive elements keep a non-colour affordance (buttons have a filled background, text links are underlined by default). |
| unknown tags are flattened | Only standard tags are used (`dl`/`dt`/`dd` were replaced by `div` + `h3` + `p`). |

## Accessibility

- `lang="pl"`, one `h1`, sequential `h2`/`h3` outline, `header`/`nav`/`main`/`footer` landmarks.
- Skip link to `#tresc-glowna`; every `section` has `aria-labelledby`.
- Interactive targets are ≥ 48 px high; text links are underlined (not colour-only).
- Decorative glyph `✦` is `aria-hidden`; the endpoint block is a labelled `role="group"`.
- No script, no `currentColor`, no CSS grid (Plasmic does not support grid).

## Design tokens

The palette is expressed as CSS custom properties on `.mcp-connect`
(`--mc-bg`, `--mc-ink`, `--mc-brand`, `--mc-line`, …) and matches the palette of
the PR #64 fallback. The same values are the intended Studio token set
(`brand-bg`, `brand-ink`, `brand-green`, `brand-line`, …) for whoever creates the
project tokens in Studio; the page does not depend on tokens existing.

## Handoff

- Integration issue **KOMAA-1178** needs: new project id, saved page id, exact
  revision, editor URL and preview URL returned by Studio (never invented).
- Independent UI QA must verify **native editability** (component tree is
  editable in Studio, not an image) plus 390 px / 1440 px rendering and keyboard
  navigation.
- The dedicated MCP routing contract is unchanged by this artifact: the Worker
  keeps full ownership of `/mcp`, `/authorize`, `/callback`, `/token`, `/register`,
  `/.well-known/*` and `/health`; only public `GET /` and `GET /docs` may serve
  this page. No reverse-proxy catch-all.
