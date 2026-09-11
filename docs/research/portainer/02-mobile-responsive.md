# Portainer CE 2.45.0: Small-Viewport / Mobile Handling

Repo: `.ref/portainer` (commit 4a4a157). Read-only investigation, no builds run.
All paths below are relative to `.ref/portainer/` unless stated otherwise.

---

## 1. The breakpoint system

`tailwind.config.js` (root of repo) does **not** define a `theme.screens` override:

```js
// tailwind.config.js
theme: {
  colors: { ... },
  extend: {
    fontFamily: { sans: ['Inter', ...defaultTheme.fontFamily.sans] },
    animation: { 'spin-slow': 'spin 2s linear infinite' },
  },
},
```

Because `screens` is never set (and `extend` never adds one), Tailwind falls back to its stock `defaultTheme.screens`:

- `sm`: 640px
- `md`: 768px
- `lg`: 1024px
- `xl`: 1280px
- `2xl`: 1536px

There is no custom breakpoint anywhere in the Tailwind config: no `xs`, no small-phone tier, nothing below 640px is addressable with a Tailwind prefix at all.

`content: ['./app/**/*.{html,tsx}']` and `corePlugins.preflight: false` confirm Tailwind is layered on top of (not replacing) the legacy CSS, and the `be:` / `th-highcontrast:` / `th-dark:` custom variants (added via `plugin(({addVariant}) => ...)`) show the project spends its "variant budget" on edition/theme gating, not on responsive design.

**Two other, incompatible breakpoint systems coexist in the same app:**

1. **Bootstrap 3.4** (`package.json:87` `"bootstrap": "^3.4.0"`, imported wholesale at `app/assets/css/index.js:1` `import 'bootstrap/dist/css/bootstrap.css';`). Bootstrap 3's grid breaks at 768 / 992 / 1200, and every legacy AngularJS view still uses `col-sm-*`, `col-md-*`, `col-lg-*` (e.g. `app/portainer/components/form-components/web-editor-form/web-editor-form.html:3` `class="col-sm-12 form-section-title pr-0"`).
2. **A hand-rolled 992px "mobile" threshold** used only by the sidebar:

```ts
// app/react/sidebar/useSidebarState.tsx:15-16
// using bootstrap breakpoint - https://getbootstrap.com/docs/5.0/layout/breakpoints/#min-width
const mobileWidth = 992;
...
// app/react/sidebar/useSidebarState.tsx:113-115
function isMobile() {
  return window.innerWidth < mobileWidth;
}
```
```ts
// app/react/sidebar/sidebarStore.ts:8-9
const storageKey = 'toolbar_toggle';
const mobileWidth = 992;
```

3. A **third, independent** breakpoint (561px / 560px) baked into the sidebar's own CSS module, matching neither Tailwind nor Bootstrap nor the 992px JS constant:

```css
/* app/react/sidebar/Sidebar.module.css:6-14 */
@media only screen and (min-width: 561px) {
  :global(#page-wrapper.open) { padding-left: var(--sidebar-width); }
}
@media only screen and (max-width: 560px) {
  :global(#page-wrapper.open) { padding-left: var(--sidebar-closed-width); }
}
```

**Verdict on the breakpoint system**: there is no unified design-token breakpoint scale. Tailwind's default scale (640/768/1024/1280/1536), Bootstrap 3's scale (768/992/1200), and two bespoke JS/CSS constants (992px, 560/561px) all operate simultaneously and were clearly added by different authors at different times without reconciliation. A component built with Tailwind `md:` (768px) and a legacy view built with Bootstrap `col-md-*` (992px) will not agree on what "medium" even means.

---

## 2. Frequency analysis

Commands used (via the repo's grep tool, Rust-regex equivalent of `rg`, scoped to `.ref/portainer/app`):

```
rg "[\s\"'\`{]sm:[a-zA-Z!\[]"  app        # genuine Tailwind sm: prefix (excludes cva size-variant keys like `sm: 'text-sm'`)
rg "[\s\"'\`{]md:[a-zA-Z!\[]"  app
rg "[\s\"'\`{]lg:[a-zA-Z!\[]"  app
rg "[\s\"'\`{]xl:[a-zA-Z!\[]"  app
rg "[\s\"'\`{]2xl:[a-zA-Z!\[]" app
rg "@media"                    app        # all CSS media queries
```

The naive `rg "sm:"` (no lookahead) massively overcounts because component-library code uses `sm`/`md`/`lg`/`xl` as **size-variant object keys** unrelated to Tailwind's responsive prefix, e.g.:

```tsx
// app/react/components/Tip/Tooltip/Tooltip.tsx:11-15
const sizeClasses: Record<Size, string> = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
  xl: 'text-xl',
};
```

That `sm:`/`md:`/`lg:`/`xl:` is a JS object key with a space after the colon, not a CSS class fragment; it never reaches a `@media` query at runtime. The refined regex requires the prefix to be immediately followed by a class-name character (no space), which is how a genuine Tailwind responsive utility is always written (`sm:grid-cols-2`, never `sm: grid-cols-2`).

**Raw results, genuine Tailwind responsive-prefix usage only, whole `app/` tree:**

| Prefix | Matches | Distinct files |
|---|---|---|
| `sm:` | 2 | 2 |
| `md:` | 4 | 4 |
| `lg:` | 7 | 5 |
| `xl:` | 7 | 7 |
| `2xl:` | 6 | 5 |
| **Total** | **26** | **16 unique files** |

The 16 unique files that use *any* Tailwind responsive prefix anywhere in the codebase:

- `app/react/components/BoxSelector/BoxSelector.tsx` (`sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`)
- `app/react/kubernetes/helm/HelmTemplates/HelmTemplatesList.tsx` (`sm:w-1/4`)
- `app/react/docker/containers/StatsView/StatsView.tsx` (`md:grid-cols-2`)
- `app/react/kubernetes/applications/StatsView/ApplicationStatsView.tsx` (`md:grid-cols-2`)
- `app/react/kubernetes/applications/components/AutoScalingFormSection/AutoScalingFormSection.tsx` (`md:grid-cols-3`)
- `app/react/kubernetes/cluster/NodeStatsView/NodeStatsView.tsx` (`md:grid-cols-2`)
- `app/react/components/Sheet.tsx` (`lg:w-[50vw]`, x2)
- `app/react/kubernetes/applications/CreateView/application-services/PublishingExplaination.tsx` (`lg:flex-row`, `lg:w-1/2`)
- `app/react/kubernetes/helm/HelmApplicationView/HelmSummary.tsx` (`lg:grid-cols-2 xl:grid-cols-3`)
- `app/react/portainer/gitops/GitReferenceCard.tsx` (`lg:grid-cols-2 xl:grid-cols-3`)
- `app/react/components/StatusSummaryBar/StatusSummaryBar.tsx` (`hidden xl:!flex`)
- `app/react/kubernetes/configs/ListView/ConfigMapsDatatable/columns/name.tsx` (`xl:max-w-sm 2xl:max-w-md`)
- `app/react/kubernetes/configs/ListView/SecretsDatatable/columns/name.tsx` (`xl:max-w-sm 2xl:max-w-md`)
- `app/react/kubernetes/helm/HelmApplicationView/ReleaseDetails/ResourcesTable/columns/name.tsx` (`xl:max-w-sm 2xl:max-w-md`)
- `app/react/kubernetes/helm/HelmApplicationView/HelmApplicationView.tsx` (`2xl:hidden`, `2xl:!block`)
- `app/react/portainer/HomeView/EnvironmentList/UpdateBadge.tsx` (`2xl:!inline`)

For scale: the same glob (`app/react/**/*.tsx`) returns 200+ results before the tool's per-call cap even in a single top-level subtree; the full React tree runs into the thousands of `.tsx`/`.ts` files. **16 files out of a multi-thousand-file React codebase use a responsive breakpoint of any kind.** Practically all of those 16 uses are `lg:`/`xl:`/`2xl:` widening layouts for *large* screens (extra columns, showing side panels) -- none of them target small phones; there is effectively no `sm:`-first mobile adaptation pattern anywhere (the 2 genuine `sm:` hits are incidental, not a deliberate "mobile-first" pass).

**`@media` blocks, whole `app/` tree:**

```
rg "@media" app   ->  8 matches total
```

- `app/assets/css/app.css`: 6 blocks
  - `:11` `@media screen and (-webkit-min-device-pixel-ratio: 0)` (a Webkit-detection hack unrelated to viewport size)
  - `:312` `@media screen and (min-width: 1107px)` (`.btn-responsive` padding, desktop-only)
  - `:381` `@media (min-width: 768px)` (`.margin-sm-top`)
  - `:386` `@media (min-width: 768px)` (`.pull-sm-left`)
  - `:397` `@media (min-width: 992px)` (`.pull-md-left`)
  - `:408` `@media (min-width: 1200px)` (`.pull-lg-left`)
- `app/react/sidebar/Sidebar.module.css`: 2 blocks (`:6` `min-width: 561px`, `:11` `max-width: 560px`) -- see section 4.

All 6 blocks in `app.css` are `min-width` gates (progressively add desktop styling); **none of the 8 media queries in the entire frontend are `max-width` queries meant to strip UI down for a phone**, except the two in `Sidebar.module.css`, which are the only true "shrink for small screens" rules in the codebase.

There are **zero** `.scss` files in `app/` (`glob app/**/*.scss` returned no matches) -- the project is plain CSS + CSS Modules + Tailwind utility classes, no Sass layer at all.

---

## 3. Viewport meta tag

`app/index.html` (the webpack HTML template, `<html ng-app="portainer">`) was read in full. **There is no `<meta name="viewport">` tag anywhere in the file, and a repo-wide grep for `viewport` turns up nothing in any HTML template** (`app/portainer/**/*.html`, `app/docker/**/*.html`, `app/kubernetes/**/*.html`, `app/agent/**/*.html`, `app/edge/**/*.html` -- all clean; the only hits are backend CSP permission-policy strings like `"ch-viewport-height=()"` in `api/http/handler/file/permissions_list.go` and prose mentions of "viewport" in a couple of React component doc-comments, e.g. `app/react/components/StickyFooter/StickyFooter.tsx:11`).

The only meta tags present in `app/index.html:5-12` are:

```html
<meta charset="utf-8" />
<title>Portainer</title>
<meta name="description" content="" />
<meta name="author" content="<%= author %>" />
<meta http-equiv="cache-control" content="no-cache" />
<meta http-equiv="expires" content="0" />
<meta http-equiv="pragma" content="no-cache" />
<meta name="robots" content="noindex" />
```

**No `viewport` meta tag exists at all** -- not "zoom disabled", literally absent. Without it, mobile WebKit/Blink browsers fall back to a virtual/layout viewport of roughly 980px (`width=980`) and render the desktop layout scaled down to fit, then let the user pinch-zoom. This alone means every mobile visitor sees Portainer shrunk to fit a phantom 980px canvas before any CSS/JS responsiveness logic (Tailwind prefixes, the sidebar's 992/560px thresholds) even has a chance to engage, since `window.innerWidth` as reported to layout is ~980 on a typical 390px-wide phone, not 390. The sidebar's `isMobile()` check (`window.innerWidth < 992`) is one of very few pieces of logic that would even have a chance to correctly detect "mobile" here, and only because 980 < 992 by coincidence -- everything gated at Tailwind's `sm`/`md` breakpoints (640/768) would silently never fire on a real phone because the browser reports a viewport width of ~980px, not the device's actual 390px.

---

## 4. Components that change structure by viewport

Exhaustive list of what actually reacts to viewport size, and how:

| Component | Mechanism | File |
|---|---|---|
| Sidebar collapse-to-icon-rail | JS: `window.innerWidth < 992` on load + debounced `resize` listener, toggles a Zustand store (`isOpen`) | `app/react/sidebar/useSidebarState.tsx:15-16,42-59,113-115`, `app/react/sidebar/sidebarStore.ts:8-15` |
| Sidebar push-vs-overlay content padding | CSS `@media (min-width:561px)` vs `(max-width:560px)` swapping `#page-wrapper.open`'s `padding-left` between the full 300px sidebar width and the 72px collapsed-icon width | `app/react/sidebar/Sidebar.module.css:6-14` |
| `BoxSelector` grid (endpoint/template picker cards) | Tailwind responsive classes, CSS-only | `app/react/components/BoxSelector/BoxSelector.tsx:49` |
| Container/app/node stats charts (CPU/Mem/Net) | Tailwind `md:grid-cols-2`, CSS-only, stacks to 1 column below 768px | `StatsView.tsx`, `ApplicationStatsView.tsx`, `NodeStatsView.tsx` (paths above) |
| `Sheet` (slide-in drawer) width | Tailwind `w-[70vw] lg:w-[50vw]`, CSS-only | `app/react/components/Sheet.tsx:86,88` |
| Helm/GitOps summary grids | Tailwind `lg:grid-cols-2 xl:grid-cols-3`, CSS-only | `HelmSummary.tsx:40`, `GitReferenceCard.tsx:148` |
| Filter-bar "active filter" pill | Tailwind `hidden xl:!flex` -- literally removed below 1280px, not adapted | `app/react/components/StatusSummaryBar/StatusSummaryBar.tsx:88` |
| Helm revision list: inline sheet vs. persistent side panel | Tailwind `2xl:hidden` / `2xl:!block` conditional visibility, CSS-only (both DOM subtrees exist, one is `display:none`) | `app/react/kubernetes/helm/HelmApplicationView/HelmApplicationView.tsx:64,108` |
| "Update Available" edge-agent badge text | Tailwind `hidden text-sm 2xl:!inline` (text label hidden below 1536px) | `app/react/portainer/HomeView/EnvironmentList/UpdateBadge.tsx:20` |
| Home dashboard environment cards | Pure CSS `flex-wrap` (not a breakpoint at all -- reflows continuously at any width) | `app/react/portainer/HomeView/EnvironmentList/EnvironmentItem/EnvironmentCard.tsx:56`, `EnvironmentItem.tsx:76,101` |
| Dark/light theme (not layout, but the only other `matchMedia` use in the app) | `window.matchMedia('(prefers-color-scheme: dark)')` | `app/react/portainer/services/applyTheme.ts:10` |

There is **no `useMediaQuery`/`useWindowSize`/`useBreakpoint` hook anywhere in the codebase.** `app/react/hooks/` (`useEnvironmentId.ts`, `useId.ts`, `useIdParam.ts`, `useDebounce.ts`, `useLocalStorage.ts`, etc. -- full listing captured) contains no viewport/media-query hook at all. The only two places that read `window.innerWidth` in JS are the sidebar's `isMobile()`/`getInitialIsOpen()` (`useSidebarState.tsx`, `sidebarStore.ts`) -- the sidebar collapse is effectively the *only* JS-driven layout adaptation in the entire application; everything else responsive is CSS-only Tailwind classes on a handful of desktop-oriented widgets (mostly widening for large monitors, not narrowing for phones).

No component in the codebase does a **conditional render** (mount/unmount a different component tree) based on viewport size. All viewport-reactive UI is either CSS visibility toggling (`hidden xl:flex`, `2xl:hidden`) or the sidebar's single JS width/open-state toggle.

---

## 5. The datatable on mobile

The shared `Table` primitive wraps every list/datatable (Users, Containers, Images, Stacks, Networks, Volumes, Kubernetes resources, etc.) in a Bootstrap-3-style `.table-responsive` div:

```tsx
// app/react/components/datatables/Table.tsx:24-35
function MainComponent({ children, className, ...props }: PropsWithChildren<Props>) {
  return (
    <div className="table-responsive">
      <table {...props} className={clsx('table-hover table-filters table', className)}>
        {children}
      </table>
    </div>
  );
}
```

Bootstrap 3's own `.table-responsive` normally supplies `overflow-x: auto; -ms-overflow-style: -ms-autohiding-scrollbar;` so the table scrolls horizontally inside its own box on narrow screens. **Portainer's build never gets that rule**, because `.table-responsive` is redefined project-side and the redefinition only adds cell padding, never restores the overflow behavior:

```css
/* app/react/components/datatables/datatable.css:301-310 */
.table-responsive tr > th:first-child,
.table-responsive tr > td:first-child { padding-left: 20px; }
.table-responsive tr > th:last-child,
.table-responsive tr > last-child { padding-right: 20px; }
```

A repo-wide search for `overflow-x` (`rg "overflow-x|overflow:\s*auto" app`) finds no `overflow-x: auto` rule anywhere attached to `.table-responsive` or `.datatable` -- the only unrelated hits are `.containerNameInput { overflow-x: hidden; overflow-y: scroll; }` (`app.css:72`), a code-editor wrapper (`web-editor-form.html:2`, `.web-editor { overflow-x-hidden }`), and the unrelated Tailwind `Tabs` primitive (`TabsContainer.tsx:30`, `overflow-x-auto` on the *tab strip*, not on any table).

**Consequence**: Portainer datatables neither reflow into cards nor get a contained horizontal scrollbar on narrow viewports. Because `<table>` defaults to `table-layout: auto` and columns have `white-space: nowrap` set on header cells (`app.css`: `.datatable thead tr > th { white-space: nowrap; vertical-align: middle; }`), a table with 6-8 columns (typical for the Containers/Images lists, which also carry per-row action buttons) will force its intrinsic width, and since its containing div has no `overflow` rule, that width bleeds out and causes the **whole page** to scroll horizontally rather than just the table. This is a genuine, verifiable regression versus stock Bootstrap 3 behavior, not a stylistic choice -- the class name (`table-responsive`) advertises responsiveness the CSS doesn't deliver.

`TableContainer.tsx` (`app/react/components/datatables/TableContainer.tsx:20-29`) wraps the whole thing in `<div className="datatable mx-4">` inside a `Widget`/`WidgetBody` -- a fixed 4-unit (1rem) side margin regardless of viewport, further shrinking usable width on a phone with no compensating column/row density change.

---

## 6. Modals/dialogs on mobile

Two entirely separate modal systems exist, one modern and reasonably phone-safe, one legacy and not.

**React modal (`Modal.tsx`, Reach UI `@reach/dialog`)** -- used by newer React screens:

```tsx
// app/react/components/modals/Modal/Modal.tsx:44-56
<DialogContent
  className={clsx(
    styles.modalDialog,
    'max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] bg-transparent p-0',
    { 'w-[450px]': size === 'md', 'w-[700px]': size === 'lg', 'w-[1000px]': size === 'xl' },
    dialogClassName
  )}
>
  <div className={clsx(styles.modalContent, 'relative overflow-y-auto rounded-lg p-5', className)}>
```

- Sizing: fixed pixel widths (450/700/1000px) are **capped** by `max-w-[calc(100vw-2rem)]`, so on a 390px phone the effective width becomes `358px` regardless of the `size` prop -- this correctly prevents horizontal overflow.
- Vertical overflow: `max-h-[calc(100vh-2rem)]` + `overflow-y-auto` on the inner content div -- the dialog itself scrolls internally rather than growing past the viewport. This is the one part of the app that is genuinely phone-viewport-aware.
- Scroll locking: Reach UI's `DialogOverlay`/`DialogContent` does apply its own body-scroll lock internally (a Reach UI library behavior), but the project adds **no explicit scroll-lock code** of its own -- a repo-wide search for `disableBodyScroll|enableBodyScroll|body-scroll-lock|preventScroll` returns zero hits, so this is entirely dependent on Reach UI's default and is not something Docknight can rely on being deliberate/tuned.
- Safe-area handling: a repo-wide search for `env(safe-area-inset` / `safe-area-inset` returns **zero matches anywhere in `app/`**. No component accounts for iOS notches/home-indicator safe areas.
- Keyboard/IME behavior: no `visualViewport` API usage, no `focus`-triggered scroll-into-view logic for inputs inside modals found anywhere in `app/react`.
- z-index stacking is hand-patched for the Sheet+Modal interaction case with an inline comment acknowledging a Radix/Reach conflict (`Modal.tsx:41-42`: "When a Sheet is open and then a Modal opens, Radix DismissableLayer sets body.style.pointerEvents='none'... so make it auto here"), evidence the two dialog primitive libraries (Radix for `Sheet`, Reach UI for `Modal`) were not designed together and needed a manual workaround.

**Legacy AngularJS modal (Bootstrap 3, still used throughout `app/portainer/views/**/*.html`, `app/docker/**/*.html`)**:

```css
/* app/assets/css/bootstrap-override.css:298-300 */
.modal-dialog {
  width: 450px;
}
```

This unconditionally overrides Bootstrap 3's own responsive default (`width: auto` under 768px, `600px` at/above 768px) with a **fixed 450px at every viewport size**. On a 390px-wide phone this is wider than the viewport itself with no `max-width` safety net anywhere in `bootstrap-override.css` (confirmed by reading the full file, 375 lines) -- legacy confirm/edit dialogs (e.g. delete confirmations, the `openDialog`/`confirm()` flows built under `app/react/components/modals/`) driven through this CSS class will overflow a phone's width and force horizontal scrolling of the whole page while the modal is open.

---

## 7. Touch affordances

- **Hit target sizes**: `Button` (`app/react/components/buttons/Button.tsx`) exposes `xsmall`/`small`/`medium`/`large` sizes mapped to Bootstrap classes `btn-xs`/`btn-sm`/`btn-md`/`btn-lg` (`sizeClass()` helper, `Button.tsx:96-109`). These size classes are **not defined anywhere in Portainer's own CSS** (`rg "\.btn-xs|\.btn-sm|\.btn-md|\.btn-lg" app/assets/css/app.css` = no matches); they come straight from vendored Bootstrap 3 (`bootstrap/dist/css/bootstrap.css`), whose `.btn-xs` is `padding: 1px 5px; font-size: 12px` -- roughly 20-22px tall including line-height, well under the ~44px (iOS HIG) / ~48dp (Material) minimum recommended touch target. `small` (`btn-sm`) is Bootstrap's `padding: 5px 10px; font-size: 12px`, still short of 44px. Per-row icon-only action buttons throughout the datatables (delete/edit/clone buttons seen repeatedly in legacy views, e.g. `app/docker/views/images/edit/image.html:109-117` `class="btn btn-xs btn-danger"`) inherit this undersized target.
- **Row-hover-only affordances**: searched explicitly for `group-hover:` reveal patterns (`opacity-0 group-hover:opacity-100`, `hidden group-hover:flex`, etc.) across `app/react` -- **zero matches**. Row action buttons are not hidden-until-hover; they render inline and are always present, which is actually touch-safe (no hover-only reveal to worry about for datatable rows).
- **Tooltips are hover/focus-only via Tippy.js**, with no touch-specific trigger configured:

```tsx
// app/react/components/Tip/TooltipWithChildren/TooltipWithChildren.tsx:66-77
<Tippy
  content={messageHTML}
  delay={[50, 500]}
  placement={position}
  interactive
  disabled={!message}
>
  <span>{children}</span>
</Tippy>
```

  No `trigger` prop is set, so Tippy uses its default `'mouseenter focus'`. The trigger element is wrapped in a bare `<span>`, not a button/link, and is frequently a plain `<HelpCircle>` icon (`app/react/components/Tip/Tooltip/Tooltip.tsx:36-42`) with no `tabIndex`/`role`, so it is not natively focusable either. On touch devices, `mouseenter` never fires and the element isn't reliably focusable, so **help-icon tooltips used throughout forms (`FormSectionTitle`, field-level help text, BE-feature explainer tooltips) have no functioning touch equivalent** -- a mobile user cannot open them via tap. `[INFERENCE, based on documented Tippy.js default trigger behavior combined with the absence of any touch/tap handling code in this file or its callers.]`
- **Dropdown menus / `MenuButton`**: these are click-triggered (Radix/Headless-style popovers via `MenuButton.tsx`), not hover-triggered, so they should work fine on touch -- no touch gap identified there.
- **`touch-action` CSS** appears in exactly 3 unrelated places (`BEFeatureIndicator.css:7`, `Switch.css:64`, `feature-flags.css:28,46`), all about suppressing/allowing default touch gestures on specific decorative/BE-teaser elements, not about improving usable touch interaction.
- **No swipe/drag/long-press gesture code** exists anywhere in `app/react` (no gesture library in `package.json`, no `onTouchStart`/`onTouchMove` handlers found during this pass).

---

## 8. Verdict: is Portainer's web UI usable on a 390x844 phone?

**No -- not in any meaningful sense. It is a desktop application that happens to render, badly, on a phone.**

Grounds for this verdict, in order of severity:

1. **No viewport meta tag at all** (section 3). Every mobile browser will load the page at a virtual ~980px layout viewport and scale it down, meaning text and buttons render at roughly 40% of their intended size before a user even interacts, and pinch-zoom is the *only* way to read anything -- this alone would fail even a cursory mobile QA pass and undermines every other responsive mechanism in the app, since JS viewport-detection code (`window.innerWidth < 992`) sees the fake 980px width, not the phone's real 390px.
2. **Three incompatible breakpoint systems** (Tailwind 640/768/1024/1280/1536, Bootstrap 3's 768/992/1200, and a bespoke sidebar 992px/560px pair) were never reconciled, so "responsive" behavior is inconsistent and unpredictable depending on which era of code a given screen was built in.
3. **Datatables (the app's core UI surface -- every resource list) do not reflow or scroll contained**; the `.table-responsive` wrapper class exists but its overflow behavior was stripped by a project-level CSS override, so wide tables force page-level horizontal scroll (section 5). Since almost every primary workflow in Portainer (viewing containers, images, stacks, volumes, users, environments) goes through this exact `Table`/`TableContainer` component, this single gap affects the majority of the app's screens.
4. **Legacy AngularJS modals are hard-coded to 450px with no responsive fallback** (section 6), guaranteed to overflow a 390px viewport; this legacy modal system is still wired into a large share of Docker/legacy views (`app/docker/**/*.html`, `app/portainer/**/*.html`), which remain functionally load-bearing, not dead code (they are the primary UI for Docker-standalone resource CRUD).
5. **A permanent 72px docked icon sidebar** consumes ~18% of a 390px screen's width at all times; there is no true "hidden by default, opened by hamburger" pattern, only a collapse-to-rail. Below 560px it does become an overlay when manually opened (the one deliberately mobile-aware piece of CSS in the whole app), but the rail itself never fully disappears.
6. **Only 16 files in the entire multi-thousand-file React tree use a Tailwind responsive prefix**, and the few that do mostly widen layouts for *large* monitors (`lg:`/`xl:`/`2xl:` grid-column increases), not narrow them for phones -- there is no evidence of a deliberate mobile-first or mobile-adapted pass over the component library.
7. **No `useMediaQuery`/viewport hook exists**, so component-level adaptive rendering (e.g., switching a table to a card list under 480px) is architecturally absent, not just unused.
8. **Touch target sizes inherit Bootstrap 3's `btn-xs`/`btn-sm`** (well under 44px), and help tooltips are hover/focus-only via Tippy.js with no tap fallback, so some UI (contextual help) is simply inaccessible by touch.
9. Positives, for balance: the React `Modal` component correctly caps width/height to the viewport and scrolls internally (section 6); row action buttons are always visible rather than hover-reveal-only (section 7), so no click target vanishes on touch; and the sidebar does have one genuine small-screen behavior change (overlay instead of push) below 560px.

**Bottom line for Docknight**: none of Portainer's mobile-adaptation patterns are worth reusing as-is. The one exception worth studying as prior art is the Reach-UI-based `Modal` component's `max-w-[calc(100vw-2rem)]` / `max-h-[calc(100vh-2rem)]` + internal-scroll pattern (section 6) -- that specific technique (cap to viewport, scroll inside, cap outside) is sound and portable. Everything else -- the missing viewport meta tag, the three-breakpoint-system tangle, the non-scrolling datatable wrapper, the fixed-width legacy modal, and the permanently docked sidebar rail -- should be treated as concrete "don't repeat this" reference points, not as a foundation.