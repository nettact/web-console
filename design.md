# Design — NetTact Liquid Glass

A locked design system for the NetTact web console. Every page redesign reads
this file first. Extend the system here when a new interaction is needed; do
not invent page-local themes.

## Product context

- Audience: home and small-business operators with basic network knowledge.
- Primary job: understand network health, isolate a fault, then act.
- Tone: calm, technical, native and spatial.
- Copy: factual and operational. Do not invent metrics or marketing claims.

## Genre

Custom application system. It starts from modern-minimal discipline, then uses
translucent material only where depth communicates ownership: the application
shell, primary work surfaces and overlays.

## Macrostructure family

- Operational pages: **Workbench**. A compact identity row leads into one main
  data workspace. Data and controls are the content.
- Index and administration pages: **Index-First**. Search, filters, rows and
  groups replace decorative card grids.
- Entry and configuration flows: **Narrative Workflow**. Steps, sections and
  progressive disclosure make the current task obvious.
- Login: **Split Studio**. Brand context and sign-in form share the viewport
  without a centred full-screen hero.

## Theme

Theme route: **custom**.

Vibe: **calm translucent, precise, spatial, native**.

- Dark paper: `oklch(16% 0.014 252)`
- Light paper: `oklch(97.5% 0.008 252)`
- Dark accent: `oklch(72% 0.15 250)`
- Light accent: `oklch(60% 0.18 250)`
- Secondary chart series: `oklch(72% 0.16 335)` dark /
  `oklch(58% 0.18 335)` light.
- Axes: dark + light / geometric-sans / cool.
- Accent stays below 5% of the viewport. It marks active navigation, focus,
  links and primary actions.
- Glass is purposeful. Use it for the side navigation, top utility bar,
  primary panels and overlays. Do not put bordered glass cards inside glass
  cards.
- Blur is always paired with a translucent fallback colour and a visible rule.

## Typography

- Display: Manrope Variable, weight 700, normal style.
- Body/UI: Inter Variable, weight 400/500.
- Mono/readouts: JetBrains Mono Variable, weight 500.
- Chinese fallback: PingFang SC, Microsoft YaHei, sans-serif.
- Display tracking: `-0.028em`.
- Numeric workspaces use tabular figures.
- Headings remain roman; italic headings are forbidden.

## Spacing

`tokens.css` is the source of truth. It uses a named 4-point scale. Production
CSS consumes `var(--space-*)`; raw spacing is limited to browser fixes.

## Motion

- Easings: `--ease-out`, `--ease-in`, `--ease-in-out`.
- Durations: `--dur-micro`, `--dur-short`, `--dur-long`.
- Allowed primitives: material fade, button press and drawer translate.
- Animate only transform and opacity.
- Reduced motion collapses spatial movement to a maximum 150 ms fade.

## Microinteraction stance

- Silent success when the changed value is visible.
- Errors name what failed and the next action.
- Hover affordances have focus and tap equivalents.
- Focus rings appear instantly.
- Inputs reserve stable space for validation and loading feedback.
- Touch targets are at least 44 × 44 CSS pixels.

## Application shell

- Desktop: persistent translucent side navigation, compact glass utility bar
  and one scrollable workspace.
- Tablet: compact navigation rail.
- Mobile: the rail becomes a modal navigation sheet with a backdrop.
- The shell owns navigation, language, theme, notifications, identity and
  logout. Pages never redraw this chrome.
- Navigation archetype: N3 persistent side rail, adapted to an operational
  application rather than a decorative editorial rail.
- Application pages do not render a marketing footer.

## CTA voice

- Primary: solid signal blue, 12 px radius, action-specific label.
- Secondary: translucent paper surface with a visible rule.
- Tertiary: text action with a rule or ink shift on hover/focus.
- Buttons and inputs share a 44 px minimum height.

## Per-page allowances

- App pages do not add decorative enrichment.
- Charts use semantic series colours through tokens.
- Dashboards may vary spans because users control layout, but keep one
  containment level.
- Onboarding may number real sequential steps.
- Login may use a split composition.
- The standalone public status page may use the shared **Liquid Glass** variant:
  translucent surfaces, restrained specular highlights, spatial depth and
  fluid 150–300 ms state transitions. It supports both themes and reduced
  transparency, keeps text on contrast-safe surfaces, and reserves continuous
  animation for loading feedback only.

## What pages MUST share

- NetTact pulse-line mark and wordmark.
- Material depth: shell → primary surface → unbordered internal group.
- Blue signal placement and semantic status palette.
- Display, body and mono roles.
- Control geometry and focus treatment.
- Page heading rhythm: identity left, relevant controls right, context below.
- Loading, empty, error and success treatment.

## What pages MAY differ on

- Density. Dashboard and processes are denser than onboarding.
- Main workspace form: chart, list, form or detail stack.
- One page-specific breakout when required by the data model.

## Exports

### tokens.css

`tokens.css` at the project root is the executable source of truth.

### Tailwind v4 `@theme`

```css
@theme {
  --color-paper: oklch(16% 0.014 252);
  --color-paper-2: oklch(20% 0.016 252);
  --color-paper-3: oklch(24% 0.018 252);
  --color-ink: oklch(96% 0.008 252);
  --color-ink-2: oklch(78% 0.014 252);
  --color-accent: oklch(72% 0.15 250);
  --color-chart-secondary: oklch(72% 0.16 335);
  --color-focus: oklch(78% 0.18 250);
  --font-display: "Manrope Variable", sans-serif;
  --font-body: "Inter Variable", sans-serif;
  --font-outlier: "JetBrains Mono Variable", monospace;
  --spacing-xs: 0.75rem;
  --spacing-sm: 1rem;
  --spacing-md: 1.5rem;
  --spacing-lg: 2rem;
  --text-md: 1.125rem;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

### shadcn/ui CSS variables

```css
:root {
  --background: 16% 0.014 252;
  --foreground: 96% 0.008 252;
  --card: 20% 0.016 252;
  --card-foreground: 96% 0.008 252;
  --popover: 20% 0.016 252;
  --popover-foreground: 96% 0.008 252;
  --primary: 72% 0.15 250;
  --primary-foreground: 17% 0.016 252;
  --secondary: 24% 0.018 252;
  --secondary-foreground: 78% 0.014 252;
  --muted: 96% 0.008 252 / 0.12;
  --muted-foreground: 66% 0.014 252;
  --border: 96% 0.008 252 / 0.12;
  --input: 96% 0.008 252 / 0.2;
  --ring: 78% 0.18 250;
  --radius: 1.25rem;
}
```
