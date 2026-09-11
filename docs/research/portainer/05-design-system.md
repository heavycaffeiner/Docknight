# Portainer CE 2.45.0: Design System, Theming, and Dashboard IA

Source: `.ref/portainer` at commit 4a4a157. All paths below are relative to that root unless stated otherwise. Read-only investigation, no builds run.

## 0. TL;DR architecture

Portainer's visual system is a three-layer stack, not a clean single-source design system:

1. **Raw palette**: `app/assets/css/colors.json`, a flat JSON of named color ramps (1-11 steps, Untitled-UI/Tailwind-style scales: `gray`, `blue`, `error`, `warning`, `success`, `indigo`, `violet`, `moss`, etc, plus `black`/`white`). This is the single source of truth for hex values.
2. **Tailwind palette extension**: `tailwind.config.js` imports `colors.json` directly as `theme.colors`, so every ramp (`bg-blue-8`, `text-error-9`, `bg-success-2`, ...) is a Tailwind utility class. No `extend.colors` block is used for the main palette; `colors` is fully replaced (`preflight: false` too, meaning Tailwind's base reset is off, relying on Bootstrap 3's reset instead, since this app is a Bootstrap-to-Tailwind migration in progress).
3. **CSS custom properties, two families**:
   - `--ui-<name>[-<step>]`: generated at runtime from the same `colors.json` by `app/assets/css/colors.ts`, which builds a `<style>` tag with a `:root { --ui-blue-8: #0086c9; ... }` block and prepends it to `<head>` (`app/assets/css/colors.ts:5-17`). This is the bridge that lets legacy (non-Tailwind) CSS reference the new palette.
   - `--<semantic-name>-color` / `--bg-*` / `--text-*` / `--border-*`: a legacy "theme variable" layer defined statically in `app/assets/css/theme.css`, pre-dating the Tailwind migration. These are the vars actually consumed by old Bootstrap/AngularJS-era CSS (`bootstrap-override.css`, `rdash.css`, `vendor-override.css`, `button.css`, `icon.css`).

So there are effectively two parallel token systems live at once: the new one (Tailwind utility classes + `--ui-*` vars, used by all React/Tailwind code) and the old one (`--bg-widget-color` etc, used by legacy AngularJS views and Bootstrap overrides). New React components almost never touch `theme.css` variables directly; they use Tailwind classes with `th-dark:`/`th-highcontrast:` variants instead (see section 1).

## 1. Theme switching: end to end

### 1.1 Values
`ThemeColor = 'dark' | 'light' | 'highcontrast' | 'auto'` (`app/portainer/users/types.ts:20`).

UI picker: `app/react/portainer/account/AccountView/theme-options.tsx` (full file), 4 options with Lucide icons:
- `light` -> `Sun`
- `dark` -> `Moon`
- `highcontrast` -> `Eye`
- `auto` -> `RefreshCw`, labelled "System Theme"

Also duplicated in the header quick-switcher: `app/react/components/PageHeader/UserMenuThemeSelector.tsx:15-19` maps the same 3 concrete themes to icons (no icon needed for `auto` there because it's the "off" state).

### 1.2 Storage
Theme preference is **server-side, per-user**, not `localStorage`. It lives on the user record as `ThemeSettings.color` (Go API `User.ThemeSettings`). On theme change the React selector calls `updateMutation.mutate({ theme: { color } })` which is `useUpdateUserMutation` (`app/react/portainer/account/useUpdateUserMutation.tsx:17-19`), a `PUT` to the user endpoint. `LocalStorage` in this app is only used to remember the last-used *user id*, not the theme (`app/portainer/services/authentication.js:123`, `LocalStorage.storeUserId`).

### 1.3 Class/attribute toggling
The single mechanism that actually flips the theme, used by both the legacy AngularJS app and the new React app, is:

`app/react/portainer/services/applyTheme.ts` (full file, 31 lines):
```ts
export function applyTheme(color: ThemeColor) {
  removeAutoThemeListener?.();
  removeAutoThemeListener = null;

  if (color === 'auto' || !color) {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    function handleChange() { applyAutoTheme(mediaQuery); }
    handleChange();
    mediaQuery.addEventListener('change', handleChange);
    removeAutoThemeListener = () => mediaQuery.removeEventListener('change', handleChange);
  } else {
    document.documentElement.setAttribute('theme', color);
  }
}

function applyAutoTheme(mediaQuery) {
  if (mediaQuery.matches) {
    document.documentElement.setAttribute('theme', 'dark');
  } else {
    document.documentElement.removeAttribute('theme');
  }
}
```
Key facts:
- The mechanism is an **attribute on `<html>`**, `theme="dark"` or `theme="highcontrast"`, not a CSS class (`document.documentElement.setAttribute('theme', color)`, `applyTheme.ts:21`). Light theme = no attribute at all (removed, `applyTheme.ts:29`).
- "Auto" mode is implemented as a live `matchMedia('(prefers-color-scheme: dark)')` listener that only ever toggles between "dark" and "light" (no auto-highcontrast path exists at all -- system high-contrast-mode preference is not read).
- `html[theme='dark'], html[theme='highcontrast'] { color-scheme: dark; }` (`app/assets/css/app.css:23-27`) additionally flips native form control / scrollbar rendering.

### 1.4 CSS variable swap
`app/assets/css/theme.css` defines three blocks keyed on the same attribute selector:
- `:root { ... }` (lines 2-296): light/default values.
- `[theme='dark'] { ... }` (lines ~298-451): dark overrides, same variable names.
- `[theme='highcontrast'] { ... }` (lines ~453-604): high-contrast overrides (pure black backgrounds, white borders/text).

Example (`theme.css:119-121` default vs `theme.css` dark/highcontrast blocks):
```css
--bg-widget-color: var(--white-color);      /* light */
--bg-widget-color: var(--grey-1);            /* [theme='dark'] */
--bg-widget-color: var(--black-color);       /* [theme='highcontrast'] */
```
Because these are plain CSS custom property overrides scoped by attribute selector, no JS re-render is needed for legacy CSS consumers -- the browser recomputes cascaded values the instant the attribute changes.

### 1.5 Tailwind-side theme variants
`tailwind.config.js:32-36` (plugin `addVariant`) turns the same `theme` attribute into first-class Tailwind variants:
```js
addVariant('be', '&:is([data-edition="BE"] *)');
addVariant('th-highcontrast', '&:is([theme="highcontrast"] *)');
addVariant('th-dark', '&:is([theme="dark"] *)');
```
This is why virtually every React component hard-codes triplets like `bg-gray-2 th-dark:bg-gray-iron-10 th-highcontrast:bg-black` inline (e.g. `app/react/components/DashboardItem/DashboardItem.tsx:34-38`) instead of using semantic CSS variables. **There is no semantic Tailwind color layer** (no `bg-surface`, `bg-card`, etc as Tailwind tokens) -- every component manually repeats the light/dark/high-contrast triad. This is the single biggest maintenance/consistency risk in the system: a new component author must remember all 3 variants by hand every time, and greps confirm this pattern is repeated in hundreds of files (`Alert.tsx`, `Badge.tsx`, `BoxSelector*.module.css`, `CodeEditor.module.css`, `button.css`, etc).

There is a narrower semantic-CSS-variable approach only inside a few `.module.css` files that target CodeMirror/editor theming, e.g. `app/react/components/CodeEditor/CodeEditor.module.css:5-44`, which sets `--text-cm-*`/`--bg-codemirror-*` per `:global([theme='highcontrast'])` block -- this is the one place where the "variable swap" pattern from `theme.css` was carried into new React code.

### 1.6 Bootstrap (initial paint) path
On login, the legacy AngularJS `Authentication` service reads the theme from the freshly-fetched user object and applies it *before* first paint of the app shell:
`app/portainer/services/authentication.js:114-121`:
```js
// Initialize user theme base on UserTheme from database
const userTheme = userData.ThemeSettings ? userData.ThemeSettings.color : 'auto';
if (userTheme === 'auto' || !userTheme) {
  ThemeManager.autoTheme();
} else {
  ThemeManager.setTheme(userTheme);
}
```
`ThemeManager` (`app/portainer/services/themeManager.js`, explicitly commented `@deprecated use applyTheme instead`) is a thin AngularJS-service wrapper that just forwards to the same `applyTheme.ts`. `MainController` also unconditionally calls `ThemeManager.autoTheme()` on the shell route (`app/portainer/views/main/mainController.js:13`), which looks redundant with the login-time call and is a candidate for a real race: whichever runs last wins, and if `autoTheme()` fires after a concrete `dark`/`highcontrast` choice was applied, it will incorrectly reset to system preference. [INFERENCE, not runtime-verified since no build was run.]

### 1.7 Verdict for Docknight
- A single `data-theme`/`theme` attribute on `<html>` + CSS variables scoped by attribute selector is a proven, framework-agnostic pattern worth reusing directly.
- Do **not** copy Portainer's dual-token-system (Tailwind ramp classes + separate legacy CSS-var layer + per-component manual dark/high-contrast triplets). Pick one: CSS variables for every semantic surface/text/border color, and make Tailwind config reference `var(--token)` so a single override switches everything, rather than hand-maintaining `th-dark:`/`th-highcontrast:` variants per component.
- "Auto" theme should also react to `prefers-contrast: more`/`forced-colors` media features if a high-contrast mode is offered; Portainer does not do this.

## 2. Semantic color token list

### 2.1 Raw palette ramps (`app/assets/css/colors.json`, 380 lines; each ramp has steps 1-11 unless noted)
`black`, `white`, `graphite` (10-900), `mist` (50-900), `gray`, `blue`, `error`, `warning`, `success`, `gray-blue`, `gray-cool`, `gray-modern`, `gray-neutral`, `gray-iron`, `gray-true`, `gray-warm`, `moss`, `green-light`, `green`, `teal`, `cyan`, `blue-dark`, `indigo`, `violet`, `purple` (confirmed lines 1-300; file continues to line 380 with likely a few more ramps such as pink/rose/orange not fully enumerated here). Every ramp becomes `--ui-<ramp>-<step>` (via `colors.ts`) and a Tailwind color class `<ramp>-<step>` (via `tailwind.config.js`).

Tailwind additionally aliases `group-accent` to the `violet` ramp, and exposes 3 legacy passthroughs: `legacy-grey-3` (`var(--grey-3)`), `legacy-blue-2` (`var(--blue-2)`), `legacy-blue-9` (`var(--blue-9)`) -- an explicit escape hatch for old hardcoded hex-like grays that never got a place in the new ramp system (`tailwind.config.js:16-19`).

### 2.2 Legacy semantic variables (`app/assets/css/theme.css`, ~170 tokens defined 3x each: default/dark/highcontrast). Grouped by prefix:
- **Background**: `--bg-card-color`, `--bg-main-color`, `--bg-body-color`, `--bg-sidebar-color`, `--bg-sidebar-nav-color`, `--bg-widget-color`, `--bg-widget-header-color`, `--bg-widget-table-color`, `--bg-header-color`, `--bg-hover-table-color`, `--bg-table-color`, `--bg-table-selected-color`, `--bg-modal-content-color`, `--bg-dropdown-menu-color`, `--bg-log-viewer-color`, `--bg-tooltip-color`, `--bg-dashboard-item`, `--bg-searchbar`, `--bg-inputbox`, `--bg-dropdown-hover`, `--bg-code-color`, `--bg-app-datatable-thead/tbody`, `--bg-stepper-*`, `--bg-pagination-*`, `--bg-daterangepicker-*`, `--bg-motd-*`, plus ~15 more narrow ones.
- **Text**: `--text-main-color`, `--text-body-color`, `--text-widget-header-color`, `--text-form-control-color`, `--text-muted-color`, `--text-link-color` / `--text-link-hover-color`, `--text-danger-color`, `--text-code-color`, `--text-navtabs-color`, `--text-dropdown-menu-color`, `--text-log-viewer-color` (+ 5 `-json-*` sub-tokens for log syntax highlighting, all aliased to the same value), `--text-pagination-*`, `--text-stepper-active-color`, `--text-button-group-color`, ~15 more.
- **Border**: `--border-color`, `--border-widget-color`, `--border-sidebar-color`, `--border-form-control-color`, `--border-table-color` / `-top-color`, `--border-modal-header-color`, `--border-panel-color`, `--border-checkbox`, `--border-searchbar`, `--border-button-group`, ~10 more.
- **Shadow/misc**: `--shadow-box-color`, `--shadow-boxselector-color`, `--button-opacity` / `--button-opacity-hover`, `--BE-only` (a gray used to visually gray-out Business-Edition-only UI in CE, `theme.css:102`).

### 2.3 Status/semantic-intent tokens (the ones a Docknight team most needs)
These are not CSS variables but **Tailwind ramp + variant pairs** used consistently across `Alert`, `Badge`, buttons, and table state labels:
- `success` (green ramp) - positive/running/healthy
- `error` (red ramp, note: NOT named "danger" or "red" as a ramp; `error-*` is the actual Tailwind token) - negative/stopped/failed/unhealthy
- `warning` (amber ramp) - transitional/attention states
- `blue` - informational/primary brand accent, plus `blue-dark`, `indigo` for secondary accents
- `gray` - neutral/muted/disabled

Each of these has a light-mode pair (e.g. `bg-success-2 text-success-9`) and dark/high-contrast pairs (`th-dark:bg-success-10 th-dark:text-success-3`, `th-highcontrast:bg-success-10 th-highcontrast:text-success-3`) -- see `Badge.tsx:13-31` and `Alert.tsx:20-53` for the canonical variant tables.

### 2.4 Legacy Bootstrap-era status classes (still in active use, e.g. container state labels)
`app/assets/css/vendor-override.css:305-322` and `bootstrap-override.css:5-12`:
```css
.label-success { background-color: var(--ui-success-7); }
.label-danger  { background-color: var(--ui-error-6); }   /* bootstrap-override.css:6-12 */
.table .label .label-danger  { background-color: var(--ui-error-8); }
.table .label .label-warn    { background-color: var(--ui-warning-9); }
.table .label .label-success { background-color: var(--ui-success-7); }
```
Note the inconsistency: `label-danger` outside tables uses `--ui-error-6`, inside tables (`.table .label .label-danger`) resolves through a different step (`-8` vs `-6` outside), and there is no `label-info` for `ContainerStatus.Created` in this stylesheet -- the `info` class name used by `state.tsx` (see section 4) resolves through Bootstrap's own `.label-info` default blue, not a Portainer-controlled variable. This is a real inconsistency: one status path (created) is styled by upstream Bootstrap defaults while all siblings are styled by Portainer's own CSS vars.

## 3. Typography and spacing

### 3.1 Font stack
- Single font family everywhere: **Inter** (`tailwind.config.js:22-24`, `fontFamily.sans = ['Inter', ...defaultTheme.fontFamily.sans]`), self-hosted variable font (`app/assets/css/app.css:5-9`, `@font-face` with `Inter-VariableFont.ttf`, `font-weight: 100 900`). No monospace/code font override was found in `app.css` (CodeMirror likely uses its own default monospace stack; not investigated further as it is out of scope).

### 3.2 Size scale
There is **no custom Tailwind `fontSize` scale** in `tailwind.config.js` (only `fontFamily` and `animation` are extended) -- meaning all Tailwind typography utilities (`text-xs` through `text-9xl`) fall back to Tailwind's stock defaults. Meanwhile, the pre-Tailwind CSS layer hardcodes pixel sizes ad hoc, with no documented scale:
- `html { font-size: 16px; }` (`app.css:17-18`) -- the only rem-relative anchor in the whole app.
- Widget/table text: `.widget .widget-body table thead * { font-size: 14px; }`, `tbody * { font-size: 13px; }` (`rdash.css:111-116`).
- Buttons: `14px` default (`app.css:314-317`, Bootstrap `.btn` rule), `12px` for badges and small pills (`app.css:300-302`, `632-635`).
- Form section titles: `16px` (`app.css:104-106`).
- Misc one-offs: `18px` (`#network-legend span`, `app.css:92-93`), `10px` (visualizer task labels, `app.css:487-489`).

**Conclusion**: typography is not a systemized scale; it is a long tail of hardcoded pixel values inherited from the Bootstrap 3 / RDash admin-theme era, only partially rationalized. A from-scratch Docknight design system should define an explicit type scale (e.g. Tailwind's default `fontSize` tokens or a custom 6-8 step scale) rather than repeating this pattern.

### 3.3 Spacing
No custom Tailwind `spacing` scale either -- `theme.extend` in `tailwind.config.js` only touches `fontFamily` and `animation`. All spacing in new React code uses stock Tailwind spacing (`p-3`, `gap-2`, `space-y-6`, `mx-4`, etc, visible throughout `DashboardView.tsx` and `DashboardItem.tsx`). Legacy CSS uses hardcoded pixel paddings (widget body `padding: 20px` at `rdash.css:104-106`; widget header `padding: 20px 20px 10px 20px` at `rdash.css:98-99`). So: **new code = Tailwind default 4px-based spacing scale; old code = 20px/10px/5px pixel literals.** No single spacing token vocabulary spans both.

## 4. Icon system

- **Library**: `lucide-react` `^0.577.0` (`package.json:114`), used directly by name (`import { Power, Heart } from 'lucide-react'`) throughout new React code. This is the icon system going forward; there is no Feather/Font-Awesome dependency in `package.json` for new code.
- **Legacy bridge**: `app/react/components/Icon.tsx` (full file, 79 lines) is a compatibility shim so that AngularJS templates can still reference icons by kebab-case string name (`icon="database"` -> `Database` lucide component via `icon.split('-').map(capitalize).join('')` lookup, `Icon.tsx:66-72`), or by `svg-*` prefix for a small custom SVG sprite (`Icon.tsx:59-65`, delegates to `./Svg`), while new React call sites pass the component reference directly (`icon={BoxIcon}`). If a string name doesn't resolve to a real Lucide export, it silently `console.error`s and renders `null` (`Icon.tsx:73-77`) -- a soft-fail with no visual fallback (blank space) if a component name is renamed/typo'd.
- **Sizing convention**: `IconSize = 'xs'|'sm'|'md'|'lg'|'xl'` maps to a CSS custom property `--icon-size` (10/14/16/22/26 px respectively, `app/assets/css/icon.css:23-41`), consumed via a class `icon-${size}` (`Icon.tsx:37`). Actual pixel-to-property wiring (the base `.icon { width: var(--icon-size) }` rule) lives elsewhere in `icon.css` (not shown in the grep window but implied by the `--icon-size` custom property pattern). Icons default to no explicit size class, i.e. inherit `1em`/currentColor sizing from the SVG's own viewBox unless a size is passed.
- **Color/"mode" convention**: `IconMode = 'primary'|'secondary'|'warning'|'danger'|'success'|'alt' variants` (`Icon.tsx:14-24`) maps to classes like `icon-danger`/`icon-success` which resolve to `--ui-error-9`/`--ui-success-6` etc (`icon.css:49-93`). This is a second, older color-application path parallel to just passing Tailwind `text-*`/`th-dark:text-*` classes directly (which most new components do instead, e.g. `ContainerStatus.tsx` uses `mode="success"`/`mode="danger"` while `DashboardItem.tsx` uses raw Tailwind classes on a wrapper div). Two competing icon-coloring APIs coexist.
- **Label pairing**: no single "IconLabel" component exists as a reusable primitive. The pattern is repeated inline: `<div className="vertical-center ..."><Icon .../>{text}</div>` where `.vertical-center` is a small utility class (`inline-flex items-center gap-1`, `bootstrap-override.css:22-24`). Seen in `ContainerStatus.tsx:19-31` (icon + count + word, e.g. "3 running") and `EnvironmentInfo.DockerInfo.tsx:26-32` (icon + "Agent" text). Accessibility-wise, icons themselves are always `aria-hidden="true"` (`Icon.tsx:44,52,63`) -- meaning the adjacent text is required to carry all meaning, which the current call sites do consistently (no icon-only buttons found in the paths inspected).

## 5. Docker-state to color/label mapping

Two independent status representations exist in the codebase for containers; they are **not unified** (different color palettes, different labels, different truth sources):

### 5.1 Container list table "State" column (source of truth: `ContainerStatus` enum)
`app/react/docker/containers/types.ts:5-16`:
```ts
export enum ContainerStatus {
  Paused = 'paused', Stopped = 'stopped', Created = 'created',
  Healthy = 'healthy', Unhealthy = 'unhealthy', Starting = 'starting',
  Running = 'running', Dead = 'dead', Exited = 'exited',
  Restarting = 'restarting', Removing = 'removing',
}
```
Mapping, `app/react/docker/containers/ListView/ContainersDatatable/columns/state.tsx:58-73`:

| Docker/Portainer state | Bootstrap-label class | Resolved color (light theme, via `--ui-*`) | Notes |
|---|---|---|---|
| `paused` | `label-warning` | `--ui-warning-9` (amber) | grouped with health-check-pending states |
| `starting` | `label-warning` | `--ui-warning-9` | has health check, `title="This container has a health check"` |
| `unhealthy` | `label-warning` | `--ui-warning-9` | **unhealthy is rendered as amber/warning, not red/danger** |
| `restarting` | `label-warning` | `--ui-warning-9` | |
| `removing` | `label-warning` | `--ui-warning-9` | |
| `created` | `label-info` | Bootstrap default blue (no Portainer CSS var override found) | inconsistent styling source, see 2.4 |
| `stopped` | `label-danger` | `--ui-error-6` (outside table) / `--ui-error-8` (inside `.table .label`) | |
| `dead` | `label-danger` | same as above | |
| `exited` | `label-danger` | same as above | label text is augmented: `"exited - code {N}"` extracted via regex from `StatusText` (`state.tsx:39-44,75-79`) |
| `healthy` | `label-success` | `--ui-success-7` | |
| `running` | `label-success` (default case) | `--ui-success-7` | |

Text label is always the raw enum string (or the augmented exited/code string) rendered inside the colored pill, so this is **not color-only encoding** at the table level -- text is always present. `hasHealthCheck` also drives a `title` tooltip (`state.tsx:52`), which is mouse-only (no visible always-on text), and the `interactive` CSS class is applied without any additional semantic marker (no `aria-describedby`) -- screen reader users get no equivalent of that tooltip.

### 5.2 Dashboard summary tile (source of truth: aggregate counts from `GET /api/endpoints/{id}/docker/dashboard`, only 4 buckets)
`app/react/docker/DashboardView/ContainerStatus.tsx` (full file, 31 lines):

| Bucket | Icon | Icon `mode` (color) | Label |
|---|---|---|---|
| `running` | `Power` (lucide) | `success` (green) | "`{n}` running" |
| `stopped` | `Power` (lucide) | `danger` (red) | "`{n}` stopped" |
| `healthy` | `Heart` (lucide) | `success` (green) | "`{n}` healthy" |
| `unhealthy` | `Heart` (lucide) | `danger` (red) | "`{n}` unhealthy" |

Discrepancy vs 5.1: on the dashboard, "unhealthy" is red/danger; in the container table, "unhealthy" is amber/warning. There is no single canonical Docker-state color mapping shared across the app -- each view invented its own. Also, the dashboard's backend aggregate (`useDashboard.ts:9-16`) only exposes `running`/`stopped`/`healthy`/`unhealthy` -- `paused`, `restarting`, `dead`, `created`, `exited`, `removing`, `starting` are all invisible at the dashboard-summary level and only visible by drilling into the containers list.

### 5.3 Accessibility concern specific to status
- Neither representation relies on color alone (text/labels always present), which is good.
- But the color mapping is inconsistent between the two views for the same semantic state (`unhealthy`), which is a usability/trust problem more than a strict a11y violation -- worth explicitly avoiding in Docknight by having one canonical status-to-color-to-label table used everywhere.
- No use of icons/shapes to further distinguish severity beyond color+text (e.g. no distinct pause/warning glyph vs a stop/error glyph beyond `Power` reused for both running and stopped, differentiated only by color and word).

## 6. Dashboard IA (`app/react/docker/DashboardView/`)

Route: `docker.dashboard` (per-environment summary). `DashboardView.tsx` (full file) structure:

1. **PageHeader**: title "Dashboard", breadcrumb "Environment summary", a reload button (`reload` prop).
2. **InfoPanels** (conditional, one of three mutually exclusive panels based on environment type):
   - `NonAgentSwarmInfo` -- shown for a Swarm cluster that is not accessed through a Portainer agent.
   - `ClusterAgentInfo` -- shown for a Swarm cluster accessed through an agent.
   - `EnvironmentInfo` -- shown otherwise (standalone Docker engine, or non-swarm agent). Renders inside a `Widget`:
     - Row "Environment": env name + `SnapshotStats` (last-snapshot summary) + separator + `DockerInfo` (engine type/version via `useInfo` proxy query to the Docker `/info` endpoint, plus "Agent" badge with `ZapIcon` if applicable).
     - Row "URL" (hidden for Edge agents): the environment's endpoint URL with protocol stripped.
     - `GpuInfo` row (only if GPUs snapshotted).
     - `TagsInfo` row (environment tags).
     - `ClusterVisualizerLink` row (only if the environment is a Swarm manager) -- links out to the Swarm visualizer.
   - Data source for this whole block: `useCurrentEnvironment()` (Portainer's own `/endpoints/{id}` object, which embeds the latest `Snapshots[0]`) plus a live `useInfo(envId)` proxy call to the Docker Engine `/info` API for version/type.
3. **DashboardGrid** (`grid grid-cols-2 gap-3`, `DashboardGrid.tsx`, full file: a fixed 2-column CSS grid, not responsive -- no `md:grid-cols-*` breakpoints at all): a set of `DashboardItem` tiles, each independently gated by permission/environment-capability checks:
   - **Stacks** tile (`LayersIcon`) -- only if `env.SecuritySettings.allowStackManagementForRegularUsers` or the current user is an environment admin.
   - **Services** tile (`ShuffleIcon`) -- only if `isSwarmManager`.
   - **Containers** tile (`BoxIcon`) -- always shown; embeds the `ContainerStatus` running/stopped/healthy/unhealthy breakdown as `children` (see section 5.2).
   - **Images** tile (`ListIcon`) -- always shown; embeds `ImagesTotalSize` (`PieChart` icon + humanized byte size via `humanize()` filter).
   - **Volumes** tile (`DatabaseIcon`) -- always shown, count only.
   - **Networks** tile (`NetworkIcon`) -- always shown, count only.
   - **GPU** tile (`CpuIcon`) -- only if `env.EnableGPUManagement && isStandalone` (non-swarm), shows `env.Gpus?.length` (a static count from the endpoint record, not a live query).
   - All tiles except GPU are `<Link>`-wrapped (whole tile clickable, `to="docker.stacks"` etc, `DashboardItem.tsx:100-110`) and route to the corresponding resource list view; GPU tile has no `to` and is not clickable (informational only, `DashboardView.tsx:104-110` passes no `to`).
   - Every tile shows a live "Refreshing total"/"Loading total" micro-indicator (`Loader2` spin) in its top-right corner tied to the shared `dashboardStatsQuery` loading/refetching state (`DashboardItem.tsx:44-59`) -- a nice touch for perceived freshness that Docknight should keep.
   - Data source for all counts: a **single aggregate backend call**, `GET .../docker/dashboard` (`useDashboard.ts:29-36`), returning `{ containers: {total, running, stopped, healthy, unhealthy}, services, images: {total, size}, volumes, networks, stacks }` in one round trip. This is a good pattern (one request, not N) worth replicating.
4. Bottom spacer `<div className="pt-6" />`.

Overall the dashboard is a shallow, count-and-drilldown IA: one info panel (environment identity/health metadata) plus a flat grid of clickable resource-count tiles, no charts/timelines/graphs, no "attention needed" or "recently changed" surfacing, and no per-tile trend (no sparkline, no delta since last visit). A mobile-focused Docknight rebuild should reconsider: (a) the fixed 2-column grid (`grid-cols-2` with no responsive variants) will produce cramped tiles on narrow phones; (b) there's no single "problems" view (e.g. "3 containers unhealthy" surfaced prominently) -- unhealthy/stopped counts are visible only if you look inside the Containers tile.

## 7. Density

- **Widget chrome**: `.widget .widget-header` padding `20px 20px 10px 20px`; `.widget .widget-body` padding `20px` (`rdash.css:98-106`). New React `Widget`/`WidgetBody` components (`app/react/components/Widget/Widget.tsx`, `WidgetBody.tsx`) mostly reuse these legacy classes rather than reintroducing Tailwind spacing, e.g. `EnvironmentInfo.tsx:39` explicitly overrides to `!px-5 !py-0` for its `DetailsTable`.
- **Table rows**: base row/cell styling comes from Bootstrap 3 `.table` defaults (not overridden in Portainer's own CSS beyond borders/hover background, `vendor-override.css:11-33`), i.e. Bootstrap 3's stock `padding: 8px` per cell. Table text is deliberately shrunk in widgets: `14px` thead / `13px` tbody (`rdash.css:111-116`), i.e. the design already trends toward a "compact" table look, just not through a configurable density knob.
- **Sidebar items**: fixed `h-8` (32px) row height regardless of viewport (`SidebarItem.tsx:117`, `'flex h-8 w-full ...'`).
- **Buttons**: `.btn` padding `6px 12px`, `font-size: 14px`, `line-height: 1.42857143` (inherited Bootstrap 3 defaults, `app.css:311-318`); a smaller `.btn-datatable` variant exists at `padding: 2.6px 7.8px 3.9px` (`app.css:306-310`) purpose-built for in-row action buttons.
- **No density toggle**: grepping for `density`/`compact`/`rowHeight` across `app/react` returned no feature -- table/row density is **not user-configurable** anywhere in CE. The only "compactness" lever exposed to users is column visibility (`ColumnVisibilityMenu.tsx`) and a "truncate container name" table setting (seen in `NameCell`, `columns/name.tsx:29-31`), neither of which is a true density control.
- Net assessment: Portainer's density is "medium" -- not as dense as e.g. a terminal-style admin tool, but tighter than typical consumer SaaS (small 13-14px table text, 8px cell padding, 32px nav rows). For a mobile-first rebuild, none of these pixel constants are expressed as tokens, so Docknight cannot inherit a "density scale" from here; it would need to define its own (e.g. Tailwind `spacing`/`fontSize` presets keyed to a `comfortable`/`compact` mode), which Portainer does not provide as prior art.

## 8. Accessibility audit (evidence-based)

### 8.1 Focus handling
- Global rule `.btn { @apply !outline-none; }` (`app/assets/css/button.css:1-3`) strips the native focus ring from **every button** unconditionally, replaced by a custom box-shadow **on `:focus`** (not `:focus-visible`): `.btn:focus { box-shadow: 0px 0px 0px 2px var(--tw-shadow-color); }` (`button.css:174-176`). Using `:focus` rather than `:focus-visible` means the ring also appears on mouse click (harmless, arguably fine) but there is no `:focus-visible`-only styling anywhere in the CSS I found (`grep` for `focus-visible` across `app/assets/css` returned zero matches) -- meaning Portainer never differentiates keyboard-vs-mouse focus rendering; it made the simpler, universally-visible-ring choice, which is actually a safe default for accessibility (never invisible for keyboard users) at the cost of a slightly noisier mouse experience.
- Icon-only buttons: `.btn.btn-icon:focus { box-shadow: none !important; }` (`button.css:169-172`) -- this **removes the focus ring specifically from icon buttons**, which is a real accessibility regression: icon-only buttons (common in table row actions) get *no visible focus indicator at all* once this rule applies. This is a concrete, citable gap.
- Sidebar links (`SidebarItem.tsx:117-127`) are plain `<a>` tags styled with `hover:bg-graphite-500` but no explicit `focus:` treatment beyond whatever `.btn`-adjacent global rules cascade in (they are not `.btn`, so it's unclear any focus ring applies at all to keyboard-tabbed sidebar navigation -- not verified further, but no `focus:` Tailwind classes are present in this file).
- Modal dialogs: built on `@reach/dialog` (`Modal.tsx:1`, `DialogOverlay`/`DialogContent`), a library that provides built-in focus trapping and focus restoration, and ties `Escape`/overlay-click to `onDismiss`. This is a solid, standards-following choice -- no custom, error-prone focus-trap code was written by Portainer here.

### 8.2 ARIA
- `Widget` (`Widget.tsx:33-51`) renders a `<section aria-labelledby={titleId}>` and auto-generates a `titleId` consumed by `WidgetTitle`'s `<h2 id={titleId}>` (`WidgetTitle.tsx:24-27`) -- correct, consistent landmark + heading association pattern, good practice.
- `Modal`/`Dialog`: `Modal.tsx:47-48` passes `aria-label`/`aria-labelledby` straight through to `@reach/dialog`'s `DialogContent`, but `Dialog.tsx:24` (the generic confirm/alert dialog builder used by `confirm.ts`) derives `aria-label` from the **raw title/message string** (`requireString(title) || requireString(message) || 'Dialog'`) rather than pointing `aria-labelledby` at the rendered `<h5>` produced by `Modal.Header` (`ModalHeader.tsx:23-25`). The visible heading and the accessible name are computed independently and can drift if `title` is a `ReactNode` rather than a plain string (in which case `requireString` returns `undefined` and the modal falls back to the generic accessible name `"Dialog"` even though a rich, meaningful heading is visibly rendered) -- a concrete, fixable a11y bug.
- Datatable: `TableRow.tsx:19-31` sets `aria-selected` on rows when selection is enabled (correct signal for `role="row"` semantics, which native `<tr>` provides implicitly inside a `<table>`), but `TableHeaderCell.tsx` has **no `aria-sort`** on the sortable `<th>`/wrapping `<button>` (only `aria-label="Sort column"` on the button, `TableHeaderCell.tsx:71`) -- screen reader users get "Sort column, button" with no indication of current sort direction or which column is currently sorted. This is a missing-but-fixable pattern common to homegrown datatables.
- Sidebar `<nav aria-label="Main">` (`Sidebar.tsx:47-53`) is a correctly labelled landmark. Individual `SidebarItem`s have no `aria-current="page"` for the active route (only a CSS class from `useSidebarSrefActive`, not inspected in depth, but no `aria-current` string literal was found in `SidebarItem.tsx`) -- another common, fixable gap: active-nav-item state is visual-only.
- Icons are consistently `aria-hidden="true"` (`Icon.tsx:44,52,63`), which is correct **provided** the adjacent text always carries the label -- true for every call site inspected (Section 4).

### 8.3 Color contrast
Computed from the actual token values in `theme.css` (WCAG 2.1 relative-luminance formula, sRGB):
- `--text-muted-color: var(--grey-26)` = `#777777` on white body background (`--bg-body-color` effectively white/near-white in light theme, `theme.css:6` and default block). Contrast ratio **`#777777` on `#FFFFFF` ≈ 4.04:1**, which **fails WCAG AA (4.5:1)** for normal-size text (it would pass the 3:1 threshold for large/bold text only). `.text-muted` (`vendor-override.css:9-11`) applies this globally to any "muted" caption, timestamp, or secondary label across the entire app (used pervasively, e.g. `DashboardItem.tsx`'s "Loading total" caption, `EnvironmentInfo.DockerInfo.tsx`'s version string). This is a genuine, reproducible AA failure baked into the base theme, not an edge case.
- Status label backgrounds are all built from the "-6" through "-9" steps of saturated ramps (`--ui-success-7`, `--ui-error-6/8`, `--ui-warning-9`) paired with white/near-white label text (Bootstrap `.label` default is white text on colored background) -- these combinations are generally high-contrast by construction (dark saturated background + white text), and were not found to have an obvious AA failure, though exact ratios were not computed for every combination.
- High-contrast theme (`theme.css` `[theme='highcontrast']` block) deliberately maxes out contrast: pure `--black-color`/`--white-color` backgrounds/borders/text almost everywhere (`--bg-card-color: var(--black-color)`, `--border-widget-color: var(--white-color)`, etc), which is the correct approach for a dedicated high-contrast mode.

### 8.4 Color-only encoding
- As established in Section 5, container status is never color-only: text labels/word are always rendered alongside color. No violation found in the paths inspected.
- The dashboard's running/stopped/healthy/unhealthy mini-summary (`ContainerStatus.tsx`) also always pairs an icon (already `aria-hidden`) with an explicit number+word (e.g. "3 stopped"), so it is compliant, though (per 5.3) the *icon shape* itself (`Power` reused for both running and stopped) provides zero redundant signal beyond color -- a screen-reader user is unaffected (text carries meaning) but a colorblind sighted user relies entirely on position/text, not icon shape, to disambiguate running vs stopped at a glance.

### 8.5 Keyboard traps
No custom keyboard-trap code was found. Modal focus containment is delegated entirely to `@reach/dialog`, a well-tested library; no bespoke `tabindex` cycling or manual `keydown` capturing for focus containment was found in `app/react/components/modals/**`. No evidence of a keyboard trap; this is one of the stronger areas of the implementation.

### 8.6 Honest summary of gaps for Docknight to avoid repeating
1. Icon-only buttons losing their focus ring entirely (`btn.btn-icon:focus { box-shadow: none !important; }`).
2. `text-muted` color fails WCAG AA contrast (4.04:1 vs 4.5:1 required) and is used everywhere secondary text appears.
3. Sortable table headers lack `aria-sort`.
4. Active sidebar item lacks `aria-current`.
5. Confirm/alert dialogs can silently fall back to a generic "Dialog" accessible name when `title` is a rich `ReactNode`, decoupling the visible heading from the accessible name.
6. Two different, inconsistent status-to-color mappings for the same semantic state ("unhealthy" = amber in the table, red on the dashboard) -- a consistency bug adjacent to accessibility, worth fixing structurally by centralizing the status-color table.
7. No `prefers-contrast`/`forced-colors` support in "auto" theme mode -- only light/dark are auto-detected, high contrast is manual-only.

## Files referenced (for follow-up reading)

| Path | Why it matters |
|---|---|
| `tailwind.config.js` | Palette wiring, `th-dark`/`th-highcontrast`/`be` custom variants |
| `app/assets/css/colors.json` | Canonical hex palette (all ramps) |
| `app/assets/css/colors.ts` | Runtime `--ui-*` CSS var generator, injected into `<head>` |
| `app/assets/css/theme.css` | Legacy semantic CSS vars, 3 theme blocks (default/dark/highcontrast) |
| `app/assets/css/app.css` | Global resets, font-face, ad hoc typography pixel values |
| `app/assets/css/icon.css` | Icon size (`--icon-size`) and color-mode classes |
| `app/assets/css/button.css` | `.btn` focus/outline rules (a11y-relevant) |
| `app/react/portainer/services/applyTheme.ts` | The actual theme-switch mechanism (attribute + matchMedia) |
| `app/portainer/services/authentication.js:114-121` | Server-side theme preference loaded at login |
| `app/portainer/services/themeManager.js` | Deprecated AngularJS wrapper around `applyTheme` |
| `app/react/portainer/account/AccountView/theme-options.tsx` | The 4 user-facing theme choices |
| `app/react/components/PageHeader/UserMenuThemeSelector.tsx` | Quick theme switcher in header |
| `app/react/components/Icon.tsx` | Icon abstraction (Lucide + legacy string + SVG sprite) |
| `app/react/components/Widget/*.tsx` | Card/Widget chrome primitives |
| `app/react/components/DashboardItem/*.tsx` | Dashboard tile primitive + grid |
| `app/react/docker/DashboardView/*.tsx` | The environment dashboard itself |
| `app/react/docker/containers/types.ts` | `ContainerStatus` enum (canonical Docker states modeled) |
| `app/react/docker/containers/ListView/ContainersDatatable/columns/state.tsx` | Status-to-color-to-label mapping (table view) |
| `app/react/components/datatables/Table*.tsx` | Datatable primitives (aria gaps) |
| `app/react/components/modals/Modal/*.tsx`, `Dialog.tsx` | Modal/dialog primitives (built on `@reach/dialog`) |
| `app/react/sidebar/Sidebar.tsx`, `SidebarItem/SidebarItem.tsx` | IA navigation shell, aria landmark |
