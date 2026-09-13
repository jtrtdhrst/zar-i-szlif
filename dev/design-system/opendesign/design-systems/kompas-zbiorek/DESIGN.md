# Kompas Zbiórek Design System

> Category: Productivity & SaaS

Kompas Zbiórek is an operational planning product for Royal Rangers instructors. Its visual language combines cartographic orientation with a calm, practical working tool. The core metaphor is **direction → route → waypoint → destination**. The system must feel structured, grounded and distinctive without becoming an outdoor lifestyle site, vintage scout poster, military HUD or generic blue SaaS dashboard.

## Visual theme and hierarchy

Design for **rich context with economical components**. Variation comes from meaning rather than decoration: current vs future, plan vs execution, active vs inactive, data vs prose, activity aspect, and dominant vs supporting information.

Use warm paper as the default canvas, deep forest for structural dark surfaces, red for direction/action, and gold for destination/highlight. Use asymmetry and Bento composition only when they improve hierarchy. Every screen should have one clearly dominant element rather than a grid of equal cards.

The application is quieter than the marketing site. Marketing may use a single strong display moment and more visible brand graphics; the panel is an operational tool first and branded second.

Never reinterpret the system as glassmorphism, a generic modern SaaS UI, an AI-generated landing-page aesthetic, or an illustration-heavy mountain brand.

## Color roles

The compiled OpenDesign tokens in `tokens.css` are canonical.

- Paper canvas: `--bg` = `#f5f0df`.
- Raised/working paper: `--surface` = `#ece5d1`.
- Warm tertiary paper: `--surface-warm` = `#eee4c8`.
- Primary ink: `--fg` = `#20301e`.
- Secondary ink: `--fg-2` = `#3f4b3e`.
- Muted copy: `--muted` = `#485347`.
- Direction/action red: `--accent` = `#be302a`.
- Destination gold: canonical hue `#d6ad2f`; in the shared OpenDesign token contract it is exposed through `--warn`. On dark surfaces use the lighter gold `#e4c557` for text-like emphasis.
- Deep forest surfaces use `#1d2d19`, with `#162313` for deeper structure and `#3a4d34` for secondary forest structure. The `[data-theme="dark"]` override in `tokens.css` binds these values.
- Rare black dominant surface: `#070907`, maximum one black dominant figure per screen. This is a deliberate exceptional brand figure, not the normal dark theme.

Red means **direction and action**. It is appropriate for the primary CTA, active navigation, and current/active emphasis. Do not turn every link or card into red.

Gold means **destination, waypoint and selected edge**. It is used for the characteristic L accent, destination emphasis, selected edge and limited dark-surface highlights. Gold is not a large generic background and raw `#d6ad2f` should not be used as small body text on paper.

The four activity aspects are a controlled exception when the underlying product data actually contains the aspect. Use them primarily as a 5 px semantic stripe plus label, never as a whole-card fill:

- fizyczny: `#be302a`
- społeczny: `#d6ad2f`
- duchowy: `#3a4d34`
- intelektualny: `#3f7d8c`

The blue-green intellectual color is hydrology-inspired and must never become the generic product accent. No gradients.

## Typography

Use **Noto Sans Display** for display/headings and **Noto Sans** for body/UI. Do not substitute Inter, Roboto or a generic SaaS font stack. The CSS token stacks include fallbacks only for resilience.

Canonical hierarchy:

- Marketing H0: 76/72, weight 900, tracking about -0.040em. Exactly one display moment per marketing view; never use H0 in the application.
- Marketing H1: 52/56, weight 900, tracking about -0.034em.
- Application H1: about 42/46, weight 900.
- H2: 38/44, weight 900, tracking about -0.024em.
- H3: 24/28, weight 850, tracking about -0.016em.
- Lead: 20/30, weight 500.
- Body: 16/24, weight 400.
- Navigation: 16/20, weight 700.
- CTA: 14/16, uppercase when appropriate, tracking about 0.028em.
- Kicker: 12/16, uppercase, tracking about 0.105em.
- Label: 12/16, uppercase, tracking about 0.14em.
- Micro text: 11/16, mainly badges.

Normal headings and paragraphs use sentence case. Uppercase is reserved for kickers, labels, CTA labels and the wordmark. Do not write whole paragraphs in uppercase. Keep reading measures restrained: display/headings roughly 520–720 px depending on role, body about 520–640 px. Do not center long informational copy.

## Spacing, geometry and layout

Use a strict **4 px rhythm**. Legal spacing values in the source system are 4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 64, 80, 96, 104 and 112 px. The OpenDesign shared scale in `tokens.css` carries the common slots; when composing layouts, continue the same rhythm rather than inventing 6, 11, 13, 14, 17, 23, 26 or 37 px repairs. Never use negative margins to repair a broken grid.

Main container max width is 1280 px. Typical gutters are 32 px desktop, 20/16 px compact/tablet and 12 px phone. Breakpoints from the source system are approximately 1199 compact, 1099 hero stack, 959 tablet/navigation collapse and 599 mobile.

Cards, fields and modals use restrained 8 px corners. Pills are reserved for buttons, chips and badges. Do not introduce 20–32 px SaaS card radii. Primary interactive controls should provide at least a 44 px tap target. Compact secondary controls may go to 40 px. Badges are not controls.

When Bento is semantically useful, use a 12-column desktop grid with approximately 16 px gaps. A normal composition has one dominant region and supporting regions; eight equal cards are not Bento. Useful spans: full 12, dominant 8, half 6, supporting/third 4, compact/metric 3. Do not nest Bento grids inside Bento grids.

## Components and interaction states

Reuse a small stable component vocabulary rather than creating one-off visual primitives.

**Buttons.** Primary action is a red pill using the action accent, optionally with the characteristic gold circular cap from the source system. One strong primary CTA maximum per visible viewport. Secondary/guide action is a paper/light pill with restrained gold/structural border. Hover may move up by 1 px. No scaling, bounce or glow. Never use `transition: all`.

**Cards and work sections.** Cards generally sit on paper or warm paper and rely on contrast and spacing more than shadow. Working/active cards may use a 5 px semantic stripe. Not every card gets a stripe. Avoid card-inside-card proliferation.

**Tabs.** Canonical process stages are `01 PLANOWANIE`, `02 REALIZACJA`, `03 REFLEKSJA`, `04 DOSKONALENIE`. Exactly one tab is active. The active tab uses deep forest, white text, a gold stage number and a hard gold offset around 6 px rather than a soft floating shadow. Inactive tabs use paper and a structural border. Switching a tab must change the content below it.

**Forms.** Fields live on working paper surfaces. Inputs use 8 px radius, strong structural border and at least 44 px height. Do not place ordinary form fields on dark surfaces. Do not invent user values in placeholders. Use visible choice groups for 2–6 options and a select for 7+ options. Selection is shown through border/background and, when semantically appropriate, a 5 px stripe.

**Status and filters.** Status badges are not clickable. Filters are chips. Done belongs to the forest family, progress to the gold family, todo/problem to the red family.

**Dialogs.** Use modals for one meaningful decision. Use a dark olive overlay around `rgba(16,24,15,.68)` and no backdrop blur.

## Brand signature and cartographic language

The brand identity is structural, not wallpaper.

**Gold L accent.** The key signature is a gold L attached to the right and bottom edge of a dominant element. Both arms have the same stroke thickness and normally the same absolute arm length. Typical source values are approximately 88 px arm / 4 px stroke on desktop, 64/3 on tablet and 48/2 on phone. A product-preview variant may use a longer 120 px arm. Use maximum **one L accent per visible frame**. Never put an L on every card and never replace it with a full gold border or generic box shadow.

**Terrain language.** Use cartographic graphics only where they reinforce meaning or hierarchy. Preferred controlled motifs are local contour/topographic fragments, terrain frame, terrain profile, summit mark, map ticks, azimuth and waypoint. Decorative brand graphics are not functional UI icons. Budget: normally 1–2 branded terrain elements per section and one terrain layer maximum per section.

Topographic contours may appear in dead space or as a subtle section background. Keep them low-opacity and asymmetric. Never put dense contours directly behind body copy. Terrain/summit metadata such as bearing, elevation, scale or distance must be **real data**. Never fabricate values such as 124°, 642 m or 2.4 km merely to make the composition look cartographic.

Do not default to random mountain silhouettes, coordinate grids, altitude labels, connected route lines or decorative geographic numbers. These were overused in older iterations and are not the default current language. Navigation/topbars stay on a clean solid forest surface with no terrain texture.

## Iconography

Use **Phosphor Icons**, Regular style, for functional UI icons. The approved semantic subset from the source system includes: compassRose, compass, mapTrifold, mapPin, path, signpost, target, flag, personSimpleHike, tent, tree, campfire, binoculars, backpack, calendar, users, check, arrowRight and warning.

Functional icons support controls, navigation, status and actions. Branded terrain graphics remain a separate system and must not be replaced by library icons. Do not use Lucide, Heroicons or emoji. Do not place a decorative icon before every heading. Simple text signs are acceptable where clearer: `→`, `↓`, `+`, `✓`.

## Content and product semantics

Actual product copy is in **Polish**. Address the user as `ty` in lower case. Tone is warm, practical and direct, instructor-to-instructor rather than corporate.

Use product terminology precisely: aktywność, element aktywności, cel główny aktywności, plan roczny, cel średnioterminowy, sprawność, wymaganie sprawności, aspekt fizyczny, aspekt społeczny, aspekt duchowy, aspekt intelektualny, materiały, zadania przygotowawcze, eksperyment, podsumowanie, refleksja, Kontekst, Archiwum, Baza Aktywności RR, asystent w ChatGPT.

Do not expose technical terms such as MCP, skills, tools or pipelines to normal end users. Empty state rule: write **„Brak danych”** and then a concrete instruction telling the user what can be added. Never use „Wkrótce”, lorem ipsum or invented user data.

Critical semantic rule: **plan ≠ wykonanie**. Never imply that something merely planned has already been completed.

## Motion, depth and accessibility

The system is almost shadowless. Use `--elev-flat` by default and `--elev-raised` only where separation is genuinely needed. Do not use material-style stacked shadows, glow, neumorphism or glassmorphism.

Motion is minimal and functional. Common transitions are about 160–180 ms with an ease curve. Animate only the property that changes, usually transform, background or border-color. Respect `prefers-reduced-motion`. No section entrance choreography, parallax, bouncing or decorative loading motion.

Normal text should meet 4.5:1 contrast and large text 3:1 against the actual paired background. Keep a visible keyboard focus ring. Gold body text on paper requires a darker gold than the decorative destination gold; do not use decorative gold for small text without checking contrast. Preserve native semantics, labels and keyboard behavior. Do not communicate state only by color.

## Responsive behavior

Do not simply scale the desktop design down. Recompose hierarchy intentionally. On mobile collapse Bento layouts in meaningful reading order, keep minimum tap targets, simplify terrain decoration, shorten the L accent, allow content to determine card height, prefer a single-column working flow where appropriate and make primary actions full width when the narrow layout benefits from it.

Approximate mobile type: marketing H0 44/46, H1 40/42, H2 36/40 and lead 18/27. The application remains quieter and should not introduce marketing-scale display type merely because space is available.

## Refinement mode

For requests such as “improve the design”, “make it look better”, “modernize it”, “polish the UI” or “make it premium”, default to **refine, not redesign**.

Preserve information architecture, screen purpose, user workflow, key content, brand identity and component semantics. Improve hierarchy, spacing, alignment, density, responsive behavior, accessibility and consistency. Replace a pattern only when the current implementation genuinely prevents a good experience: broken hierarchy, serious accessibility failure, unusable responsive behavior or a component that cannot support the product need. The result should feel like the same product, only more mature and coherent.

## Anti-patterns and validation

Do not add gradients, glassmorphism, giant rounded cards, excessive/floating shadows, glowing borders, generic blue as the global accent, Inter, Roboto, Lucide, Heroicons, emoji, a Bento grid for every section, an active stripe on every card, terrain graphics on every surface, fabricated coordinates/elevations/distances/user data, repeated mountain silhouettes, generic rows of three identical feature cards, decorative blobs, random abstract geometry or `transition: all`. Never treat planned work as completed work.

Before presenting a screen verify: Noto Sans Display/Noto Sans; warm paper/forest/red/gold roles; one clear dominant element; 4 px rhythm; restrained 8 px cards; limited strong red action; maximum one L signature per visible frame; restrained terrain language; no fabricated data; plan vs execution semantics; Phosphor functional icons; intentional responsive recomposition.
