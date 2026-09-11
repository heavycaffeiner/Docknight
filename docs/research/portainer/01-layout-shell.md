# Portainer CE 2.45.0: Application Shell (Sidebar, Header, Layout, Navigation)

Source: `.ref/portainer/` at commit 4a4a157. All paths below are relative to that root unless stated otherwise. Read-only investigation, no builds/tests run.

## 1. Top-level DOM/component tree

The root shell is still a plain AngularJS template (`app/index.html`); React only takes over two named `ui-view` slots (`sidebar` and `content`). There is no single React root for the whole app: the sidebar and the page content are two independent React trees mounted via `react2angular` (`r2a`), each bridged back into the same AngularJS `$rootScope`/state machine.

```
<body ng-controller="MainController">                          app/index.html:29
  <react-query-dev-tools/>
  <div id="page-wrapper" class="[open?] [nopadding?]">          index.html:32-40 (ng-class driven by isSidebarOpen() + current state name)
    <div id="sideview" ui-view="sidebar">                       index.html:41
      <sidebar> (AngularJS component, r2a-wrapped React tree)   app/portainer/react/views/sidebar.ts:10-16
        <SidebarProvider>                                        app/react/sidebar/Sidebar.tsx:20-25
          <div class="root sidebar flex flex-col">                Sidebar.tsx:44 / Sidebar.module.css (position:fixed, left:0)
            <UpgradeBEBannerWrapper/>                              Sidebar.tsx:45 (CE-only nag banner)
            <nav class="nav flex flex-1 flex-col overflow-y-auto py-5 pl-5" aria-label="Main">   Sidebar.tsx:46-51
              <Header logo={LogoURL}/>                             Sidebar.tsx:53 (logo + "Powered by" tagline)
              <div class="navListContainer mt-6 flex-1 overflow-y-auto">  Sidebar.tsx:55-65
                <ul class="space-y-5">
                  <SidebarItem to="portainer.home" icon={Home}/>   Sidebar.tsx:67-72
                  <EnvironmentSidebar>                             Sidebar.tsx:74 -> EnvironmentSidebar.tsx
                    <SidebarSection title=<EnvTitle/> showTitleWhenOpen>
                      <DockerSidebar|KubernetesSidebar|AzureSidebar>  (platform-dispatched, EnvironmentSidebar.tsx:79-92)
                        <DashboardLink/>
                        <SidebarParent>...<SidebarItem isSubMenu/>...</SidebarParent>
                        <SidebarItem/> (Stacks, Services, Containers, Images, Networks, Volumes, Configs, Secrets, Events, Host/Swarm)
                  <AppDeliverySidebar>                             Sidebar.tsx:76 (Workflows, Sources - BE-flavored but present in CE tree)
                  {isAdmin && <EdgeComputeSidebar/>}                Sidebar.tsx:78
                  <SettingsSidebar>                                 Sidebar.tsx:80-84
                    <SidebarSection title="Administration">
                      <SidebarParent label="User-related">...</SidebarParent>
                      <SidebarParent label="Environment-related">...</SidebarParent>
                      <SidebarItem label="Registries"/>
                      {isBE && <SidebarItem label="Licenses"/>}
                      <SidebarParent label="Logs">...</SidebarParent>
                      <SidebarItem label="Notifications"/>
                      <SidebarParent label="Settings">...<a>Get Help</a></SidebarParent>
                </ul>
              </div>
              <div class="mt-auto pt-8"><Footer/></div>            Sidebar.tsx:86-88
    <div id="content-wrapper">                                    index.html:43
      <div class="page-content">                                  index.html:44
        <div class="page-wrapper" ng-if="applicationState.loading">...spinner...</div>  index.html:45-77 (NOTE: this is a DIFFERENT ".page-wrapper" class, not the #page-wrapper id above - unfortunate naming collision, see Weaknesses)
        <div id="view" ui-view="content">                          index.html:80
          <!-- Either an AngularJS templateUrl/component OR a React view mounted via r2a -->
          <PageHeader>                                             app/react/components/PageHeader/PageHeader.tsx:36-73
            <HeaderContainer id?>                                    HeaderContainer.tsx:16-30 (bootstrap ".row"/".col-xs-12" leftovers)
              <div id="loadingbar-placeholder"/>
              <div class="col-xs-12">
                <div class="flex items-center justify-between [&_div]:truncate">
                  <div class="flex min-w-0 items-center">
                    <SidebarToggleButton/>                            SidebarToggleButton.tsx:9-22
                    <VerticalSeparator/>
                    <Breadcrumbs breadcrumbs=.../>                    Breadcrumbs.tsx:15-33
                  <HeaderTitle>                                       HeaderTitle.tsx:10-17
                    {isBE && <AskAILink/>} <NotificationsMenu/> <ContextHelp/> {!ddExtension && <UserMenu/>}
            {showTitle && title && (
              <PageTitle title>                                     PageTitle.tsx:5-19
                <h1>{title}</h1>
                {(reload || children) && <div class="ml-auto flex items-center gap-2">
                  {reload && <Button RefreshCw/>}                     PageHeader.tsx:57-67
                  {children}  <!-- per-view action slot -->
                </div>}
          <!-- view-specific body: Datatable / forms / dashboards, each view composes its own <PageHeader> -->
```

Key architectural fact: **the sidebar and the content area are not siblings inside one React tree.** They are two separately-bootstrapped React roots that only agree on layout via a shared AngularJS-owned DOM node (`#page-wrapper`) and a global CSS class (`open`) that AngularJS toggles via `ng-class` reading a value pushed from React through `AngularSidebarService` (see section 2). This is a real seam a rewrite should NOT preserve: Docknight should have one React tree owning the whole shell.

## 2. Sidebar: full behavior

### 2.1 Composition primitives

| Primitive | File | Role |
|---|---|---|
| `Sidebar` / `InnerSidebar` | `app/react/sidebar/Sidebar.tsx:19-89` | Top container: banner, `<nav>`, scrollable list, footer |
| `SidebarSection` | `app/react/sidebar/SidebarSection.tsx:11-33` | Renders an optional title `<li>` (hidden when collapsed unless `showTitleWhenOpen`) plus a `<nav><ul>` of children |
| `SidebarItem` | `app/react/sidebar/SidebarItem/SidebarItem.tsx:29-90` | Single leaf link; renders a real `<a>` (via uirouter `href`/`onClick`), wrapped in a `Tippy` tooltip when the sidebar is collapsed and item is top-level |
| `SidebarParent` | `app/react/sidebar/SidebarItem/SidebarParent.tsx:25-122` | Collapsible group: a clickable parent row (link + separate chevron button) plus a child `<ul>` that toggles `hidden`/`block`. When the sidebar itself is collapsed, the whole group (parent + children) is rendered inside a single Tippy tooltip instead of expanding inline |
| `Wrapper` | `app/react/sidebar/SidebarItem/Wrapper.tsx:9-27` | Just an `<li>` with shared item classes |
| `SidebarTooltip` | `app/react/sidebar/SidebarItem/SidebarTooltip.tsx:6-24` | Thin wrapper over `@tippyjs/react`, `placement="right"`, zero delay, `interactive` |
| `Head.tsx` | `app/react/sidebar/SidebarItem/Head.tsx` | An alternate/near-duplicate of `SidebarItem` used nowhere else found in this scan except itself - looks like dead/legacy code sharing 90% of `SidebarItem`'s logic (its own `useSrefActive` helper duplicates `useSidebarSrefActive`) |
| `useSidebarSrefActive` | `app/react/sidebar/SidebarItem/useSidebarSrefActive.tsx:14-52` | Wraps uirouter's `useSrefActive`, adds `ignorePaths`/`includePaths` overrides so a child route can still highlight a different sidebar parent |

Each platform gets its own composition file directly under `app/react/sidebar/`: `DockerSidebar.tsx`, `KubernetesSidebar/KubernetesSidebar.tsx`, `AzureSidebar/AzureSidebar.tsx`, dispatched by `EnvironmentSidebar.tsx:79-92` based on `getPlatformType(environment.Type)`. Podman currently reuses `DockerSidebar` verbatim (`EnvironmentSidebar.tsx:85`, comment: "same as docker for now, until pod management is added").

### 2.2 Environment selector

`app/react/sidebar/EnvironmentSidebar.tsx`:
- Reads the current environment id from the uirouter route params (`params.endpointId`) and pushes it into a global zustand store `environmentStore` (`app/react/hooks/current-environment-store.ts`, referenced at `EnvironmentSidebar.tsx:96-101`).
- There is no dropdown/search "selector" widget in the sidebar itself; switching environments happens by navigating to `portainer.endpoints` (the Environments list page) and picking a card there. The sidebar only *displays* the active environment's name/icon/platform sub-nav, plus a small "X" button (`Content > Title`, `EnvironmentSidebar.tsx:139-154`) that calls `clearEnvironment()` and routes back to `portainer.home`.
- When no environment is selected and the sidebar is expanded, it shows a "Environment: (slash icon) None selected" row (`EnvironmentSidebar.tsx:41-48`).
- When collapsed (`isOpen === false`) and no environment is active, the whole block renders `null` (`EnvironmentSidebar.tsx:33-35`) - i.e. collapsing the sidebar with no environment picked leaves a visual gap with no icon at all in that slot.

### 2.3 Collapse/expand mechanics

State lives in a plain zustand store, **not** React Context, so it can be read from both React trees and from AngularJS:

```
app/react/sidebar/sidebarStore.ts:9-25
const storageKey = 'toolbar_toggle';
const mobileWidth = 992;
function getInitialIsOpen() {
  if (window.ddExtension) return false;
  if (window.innerWidth < mobileWidth) return false;
  return getFromStorage<boolean>(storageKey, true);
}
export const sidebarStore = create<SidebarStore>()((set, get) => ({
  isOpen: getInitialIsOpen(),
  toggle: () => { ...; setToStorage(storageKey, newIsOpen); set({ isOpen: newIsOpen }); },
  setOpen: (value) => set({ isOpen: value }),
}));
```

- **localStorage key:** `toolbar_toggle` (boolean), persisted only for desktop widths; on Docker Desktop Extension (`window.ddExtension`) it is always forced closed and never persisted.
- `useSidebarState` (`app/react/sidebar/useSidebarState.tsx:24-32`) is a separate React Context (`SidebarProvider`) that mirrors the zustand store's `isOpen`/`toggle` and additionally:
  - Pushes `isOpen` into AngularJS via `AngularSidebarService` (`useSidebarState.tsx:76-88`, `$rootScope.$evalAsync`) every time it changes, because the `open` class on `#page-wrapper` is computed by an AngularJS expression (`isSidebarOpen()`) in `index.html:34`, not by React.
  - Adds a **debounced (50ms) `window.resize` listener** (`useSidebarState.tsx:41-58`) that force-closes the sidebar when crossing below 992px and restores the previous `isOpen` when growing back above it. This listener is skipped entirely for the Docker Desktop Extension build.
  - Note the duplication: `mobileWidth = 992` is hard-coded independently in both `sidebarStore.ts:9` and `useSidebarState.tsx:16` (two literals that must be kept in sync manually).

CSS widths and transition (`app/react/sidebar/Sidebar.module.css:1-30`):

```css
:global(#page-wrapper) {
  padding-left: var(--sidebar-closed-width);
  transition: all 0.4s ease 0s;
}
@media only screen and (min-width: 561px) {
  :global(#page-wrapper.open) { padding-left: var(--sidebar-width); }
}
@media only screen and (max-width: 560px) {
  :global(#page-wrapper.open) { padding-left: var(--sidebar-closed-width); }
}
:global(#page-wrapper) {
  --sidebar-width: 300px;
  --sidebar-closed-width: 72px;
}
:global(#page-wrapper.open) .root { width: var(--sidebar-width); }
.root {
  width: var(--sidebar-closed-width);
  height: 100%;
  position: fixed;
  left: 0;
  z-index: 10;
  transition: all 0.4s ease 0s;
}
```

The sidebar itself is `position: fixed` and always full viewport height; the content column is pushed over purely with `padding-left` on `#page-wrapper`. There is no CSS `max-width` clamp relative to viewport - see Weaknesses for the consequence below 560px.

### 2.4 Small-screen ("mobile") behavior

There is **no drawer/overlay/backdrop component anywhere in the sidebar code** (confirmed by exhaustive grep across `app/react/sidebar/**` for drawer/overlay/backdrop/swipe patterns - none exist). "Responsive" behavior is entirely the side effect of three uncoordinated pieces:
1. `sidebarStore.getInitialIsOpen()` starts closed below 992px.
2. The `resize` listener in `useSidebarState.tsx:41-58` force-closes it if the window shrinks below 992px while open.
3. The `max-width: 560px` media query in `Sidebar.module.css:9-11` caps the **content's** `padding-left` at the closed width even when the `open` class is present - but it does **not** cap `.root`'s own width (that rule, `Sidebar.module.css:17-19`, is unconditional). So if a user manually taps the toggle button while below 560px (nothing prevents this - the toggle button and `toggle()` action have no width guard), the sidebar panel visually expands to 300px and physically overlaps the content underneath it (`z-index: 10`, `position: fixed`), because the content was never pushed over to make room. This produces an accidental, undesigned "overlay," with:
   - no backdrop/scrim,
   - no focus trap,
   - no close-on-outside-click,
   - no close-on-navigate (selecting a nav item does not call `setOpen(false)`),
   - no swipe-to-close gesture.

### 2.5 Keyboard and focus handling

- The sidebar nav has `aria-label="Main"` (`Sidebar.tsx:50`) and each `SidebarSection` gets its own `<nav aria-label=...>` (`SidebarSection.tsx:26-29`), which is reasonable landmark structure.
- Items are real `<a href>` elements built from uirouter's `href`/`onClick` (`SidebarItem.tsx:105-135`), so they are natively tab-focusable and support the browser's native Enter/Cmd-click/middle-click behaviors - this part is solid.
- `SidebarParent`'s chevron is a separate `<button>` (`CollapseExpandButton`, via `SidebarParent.tsx:79-84`) nested next to (not inside) the parent `<a>`-equivalent link, so keyboard tab order visits: link, then expand button, which is fine; but the two controls are visually merged into one 32px-tall row (see Weaknesses W6/W7 below) making them hard to target with touch and easy to confuse with a single control.
- When the sidebar is **collapsed**, `SidebarItem`/`SidebarParent` render their real link+label only *inside* a Tippy tooltip (`SidebarItem.tsx:60-83`, `SidebarParent.tsx:98-113`), and the tooltip's trigger element is a **plain `<span>` wrapping the icon-only anchor** (no `tabIndex`, no keyboard-triggerable open). A keyboard-only user tabbing through the collapsed sidebar reaches the real `<a>` (which is focusable) and can activate it, but never sees the Tippy-rendered label text pop up (Tippy's default trigger is `mouseenter focus`, so focusing *should* also show it - this is inherited default behavior, not custom code, and was not verified visually since no browser run was performed).
- No skip-link, no `role="navigation"` region distinct from `aria-label="Main"`, no explicit roving-tabindex/keyboard-arrow navigation model (relies entirely on native tab order through anchors).

### 2.6 CSS/behavior fact table

| Fact | Value | Citation |
|---|---|---|
| localStorage key | `toolbar_toggle` (boolean) | `app/react/sidebar/sidebarStore.ts:9` |
| Mobile breakpoint constant | `992px`, duplicated in two files | `sidebarStore.ts:9`, `useSidebarState.tsx:16` |
| Expanded width | `--sidebar-width: 300px` | `Sidebar.module.css:22` |
| Collapsed width | `--sidebar-closed-width: 72px` | `Sidebar.module.css:23` |
| Position | `position: fixed; left: 0; z-index: 10` | `Sidebar.module.css:26-28` |
| Transition | `all 0.4s ease 0s` on both `.root` and `#page-wrapper` | `Sidebar.module.css:2, 29` |
| Narrow-screen content offset cap | `max-width: 560px` keeps padding at closed width even when "open" | `Sidebar.module.css:12-16` |
| Sidebar panel width NOT capped at narrow screens | unconditional `#page-wrapper.open .root { width: 300px }` | `Sidebar.module.css:17-19` |
| Resize debounce | 50ms via lodash `_.debounce` | `useSidebarState.tsx:41-58` |
| Item row height | `h-8` (32px) | `SidebarItem.tsx:118`, `SidebarParent.tsx:53` |
| Toggle button size | `h-6` (24px), no explicit width class (intrinsic to icon+padding) | `SidebarToggleButton.tsx:14` |
| Collapse chevron hit area | icon `size="md"` inside `p-[3px]` padding | `CollapseExpandButton.tsx:24` |
| Docker Desktop Extension override | sidebar always starts (and stays, no resize handling) closed | `sidebarStore.ts:11`, `useSidebarState.tsx:37-39` |

## 3. PageHeader

`app/react/components/PageHeader/PageHeader.tsx:20-73` is a stateless component every view instantiates directly in JSX (there is no central "page registers its header via route data" mechanism - it is pure prop-drilling per view, e.g. `app/react/docker/containers/ListView/ListView.tsx:24-28`, `app/react/azure/DashboardView/DashboardView.tsx:30`).

Props:
- `title?: string` - rendered by `PageTitle` (`PageTitle.tsx:5-19`) only when `showTitle` (defaults to `!!title`) is true.
- `breadcrumbs?: (Crumb | string)[] | string` - passed straight to `Breadcrumbs`.
- `reload?: boolean` + `onReload?()` - shows a `RefreshCw` icon button; default behavior on click is `dispatchCacheRefreshEvent()` then `router.stateService.reload()` (full state reload), or the caller's own `onReload` (`PageHeader.tsx:70-73`).
- `children` - rendered inside the title row's trailing `<div class="ml-auto flex items-center gap-2">`, i.e. this is literally the "actions slot" pattern (e.g. "Add container" buttons live here in list views).
- `id?: string` - forwarded to `HeaderContainer`'s outer div, used by some views for CSS/anchor targeting.

`Breadcrumbs` (`Breadcrumbs/Breadcrumbs.tsx:16-33`):
- Always prepends a home icon link to `portainer.home` (`Breadcrumbs.tsx:19-24`).
- Accepts either a bare string, an array of strings, or an array of `{label, link?, linkParams?}` objects; string/no-link entries render as plain text, entries with `link` render as `<Link>`.
- No responsive collapsing (no "..." truncation for long chains) - see Weaknesses.

`HeaderContainer` (`HeaderContainer.tsx:16-30`) supplies the header's outer chrome: a bootstrap-era `row`/`col-xs-12` pair plus Tailwind arbitrary-value overrides (`!mb-[15px] min-h-[60px] ... border-b`), and a `Context.Provider` whose only purpose is to assert `HeaderTitle`/similar children are nested correctly (throws if used outside, `HeaderContainer.tsx:5-11`).

`HeaderTitle` (`HeaderTitle.tsx:10-17`) is the right-hand cluster: `AskAILink` (BE-only), `NotificationsMenu`, `ContextHelp`, `UserMenu` (hidden entirely for `window.ddExtension`).

`PageTitle` (`PageTitle.tsx:5-19`) renders the `<h1 data-cy="page-title">` plus the reload button and the action-slot children, in a horizontal `flex items-center gap-2` row with no wrap - see Weaknesses.

## 4. Navigation/routing model

Portainer CE still runs entirely on **UI-Router** (`@uirouter/angularjs` for state registration, `@uirouter/react` for React-side hooks); there is no React Router anywhere in this shell.

- States are registered old-AngularJS-style via `$stateRegistryProvider.register(...)` in per-domain `__module.js` files, e.g. the root tree in `app/portainer/__module.js:35-514` and the Docker tree root in `app/docker/__module.js:15-20+`.
- Pattern: an `abstract: true` parent state owns a named `sidebar@` view slot (often left empty, `'sidebar@': {}`, to *not* re-render the sidebar on transition - see e.g. `app/portainer/__module.js:151-153,171-172,373-375`) and leaf states declare a `content@` view pointing either to a legacy `templateUrl` or to a `component:` (which is itself frequently an `r2a`-wrapped React view).
- Sidebar nav items reference these state names directly as strings (`to="docker.containers"`, `to="portainer.settings"`, etc.) - there is no shared manifest/config mapping icons/labels/paths; each sidebar file (`DockerSidebar.tsx`, `SettingsSidebar.tsx`, ...) hand-declares its own list of `<SidebarItem>`/`<SidebarParent>` JSX matching state names it assumes exist. Docknight rewriting this should NOT reproduce this "stringly-typed, hand-synced" nav/route coupling - a typed route table for nav data would remove an entire class of link-rot bugs.
- **Active-state detection** happens client-side via UI-Router's own `useSrefActive`/`useCurrentStateAndParams` hooks, wrapped by `useSidebarSrefActive` (`app/react/sidebar/SidebarItem/useSidebarSrefActive.tsx:14-52`) which layers `ignorePaths`/`includePaths` string-matching (`stateName.includes(path)`) on top so, e.g., the "Environments" sidebar item can also light up while on the environment-creation wizard state (`SettingsSidebar.tsx:82-89` uses `includePaths: ['portainer.wizard.endpoints', ...]`) or NOT light up while on `portainer.endpoints.updateSchedules` (`ignorePaths` on the "Environments" leaf item, `SettingsSidebar.tsx:93-97`). This is a fragile, ad hoc mechanism: it is plain substring matching on state names, so a new state whose name happens to contain a listed substring would silently start matching too.
- `SidebarParent`'s expand/collapse state (`isExpanded`) is separate from route-active state: it is initialized from `hasActiveChild` (`SidebarParent.tsx:47`) but once a user manually toggles it, it never re-syncs to the route again for the lifetime of the mounted component - navigating away and back within the same environment leaves a parent group's open/closed state exactly as the user last set it (arguably fine, but undocumented/implicit behavior).

## 5. Named weaknesses (cited)

1. **No mobile drawer/overlay pattern exists at all.** Exhaustive search of `app/react/sidebar/**` for drawer/overlay/backdrop/swipe/gesture code returns nothing. "Mobile support" is only "start collapsed below 992px + force-collapse on resize." Citation: `app/react/sidebar/sidebarStore.ts:9-14`, `app/react/sidebar/useSidebarState.tsx:15-16,41-58` (no matches for overlay/backdrop anywhere in the directory).

2. **Manually opening the sidebar below 560px visually overlaps content instead of pushing it**, because the panel-width rule is unconditional while the content-offset rule is capped by a `max-width: 560px` media query. This is a genuine CSS bug/gap, not an intentional overlay (no z-index scrim, no dismiss handling). Citation: `app/react/sidebar/Sidebar.module.css:9-19`.

3. **No backdrop, no outside-click-to-close, no close-on-navigate for the sidebar**, so the accidental overlap in #2 has no graceful dismissal besides re-tapping the same tiny toggle button. Citation: absence confirmed across `app/react/sidebar/useSidebarState.tsx` and `SidebarItem.tsx` (no `setOpen(false)` call anywhere on item click).

4. **Touch targets under the 44px accessibility guideline.** Every sidebar row (`SidebarItem`, `SidebarParent` parent row) is a fixed `h-8` = 32px tall, and the header's sidebar-toggle button is `h-6` = 24px. Citations: `app/react/sidebar/SidebarItem/SidebarItem.tsx:118`, `app/react/sidebar/SidebarItem/SidebarParent.tsx:53`, `app/react/components/PageHeader/SidebarToggleButton.tsx:14`.

5. **Collapsed-sidebar labels are hover/tooltip-only (Tippy, `placement="right"`).** On a touch device with no mouse, discovering what an icon-only nav item means requires either an accessible focus+tooltip interaction (unverified, default Tippy behavior, not custom-built for touch) or opening the sidebar first. There is no persistent visible label fallback for touch users. Citation: `app/react/sidebar/SidebarItem/SidebarItem.tsx:60-84`, `app/react/sidebar/SidebarItem/SidebarTooltip.tsx:6-24`.

6. **Two independently-clickable controls crammed into one 32px row** in `SidebarParent` (the link area and the chevron `CollapseExpandButton`), each with small internal padding (`p-[3px]`), which on a touch screen makes it easy to mis-tap the wrong control or miss both. Citation: `app/react/sidebar/SidebarItem/SidebarParent.tsx:52-84`, `app/react/components/CollapseExpandButton.tsx:16-24`.

7. **Fixed-pixel dropdown menus that exceed common mobile viewport widths.** `NotificationsMenu` is hard-coded to `width: 500px` regardless of viewport (a typical phone viewport is 360-430px), guaranteeing horizontal overflow/clipping when opened on a phone. Citation: `app/react/components/PageHeader/NotificationsMenu.module.css:1-3`.

8. **Breadcrumbs row has no wrap/truncation strategy.** `Breadcrumbs` renders a `flex items-center gap-2` row with no `overflow-hidden`/`flex-wrap`/per-crumb `truncate`; the outer `HeaderContainer` only applies `[&_div]:truncate` to descendant `<div>`s, but breadcrumb text nodes are wrapped in `<span>`, so long chains (common on detail pages, e.g. container inspect view with a long container name) will overflow the header horizontally on narrow screens instead of eliding. Citation: `app/react/components/PageHeader/Breadcrumbs/Breadcrumbs.tsx:19-33`, `app/react/components/PageHeader/HeaderContainer.tsx:24-28`.

9. **Global CSS class collision between two unrelated things named "page-wrapper".** The AngularJS shell's `#page-wrapper` (the whole app shell, id-selector) and a completely separate `.page-wrapper` class used both for the boot-loading spinner (`app/index.html:45`) and for the standalone auth/init/logout pages (`app/portainer/views/auth/auth.html:1`, `initAdmin.html:1`, `logout.html:1`) share a name but not a purpose; several sidebar CSS rules key off `#page-wrapper` by id while `app/assets/css/app.css:321-324` separately styles the unrelated `.page-wrapper` *class* as `display:flex; height:100%; width:100%`. This is exactly the kind of ambiguous global-CSS naming that produces regressions when someone touches either one, and is a strong argument for scoped styles (CSS modules/Tailwind-only) in the rewrite. Citation: `app/index.html:32,45`, `app/assets/css/app.css:41-42,321-324`, `app/react/sidebar/Sidebar.module.css:1` (`:global(#page-wrapper)`).

10. **A persistent, non-dismissible upgrade/promo banner permanently occupies vertical space at the very top of the sidebar in CE**, above the logo, shrinking the already-limited nav real estate further on short viewports (common on landscape phones). It cannot be permanently hidden - it only opens a modal (`UpgradeDialog`) on click; the only way it disappears is `withHideOnExtension` (Docker Desktop Extension build) or actually being on a `Docker Standalone/Swarm/Kubernetes` platform mismatch. Citation: `app/react/sidebar/UpgradeBEBanner/UpgradeBEBanner.tsx:19-20,53-73`, mounted unconditionally at `app/react/sidebar/Sidebar.tsx:45`.

11. **Hybrid AngularJS/React shell doubles the state-sync burden and is a maintenance trap, not a feature.** The `open`/collapsed boolean must be pushed from the React `sidebarStore` into an AngularJS service (`AngularSidebarService`) every render via `$rootScope.$evalAsync`, purely so a plain AngularJS `ng-class` expression in `index.html:33-35` can react to it. Two independent React root trees (sidebar vs. content) plus one AngularJS root communicate through global DOM ids/classes and a zustand store attached to module scope, rather than a single component tree with normal prop/context flow. Citation: `app/react/sidebar/useSidebarState.tsx:76-97`, `app/index.html:32-41`, `app/portainer/react/views/sidebar.ts:10-16`.

12. **Sidebar mobile-breakpoint constant (`992`) is duplicated in two files with no shared source of truth**, risking silent drift if one is changed without the other. Citation: `app/react/sidebar/sidebarStore.ts:9`, `app/react/sidebar/useSidebarState.tsx:16`.

13. **Nav-to-route mapping is entirely hand-written/string-typed with no compile-time link between a `SidebarItem`'s `to="..."` and an actually-registered UI-Router state name**, and "active" highlighting is done by ad hoc `stateName.includes(path)` substring checks (`ignorePaths`/`includePaths`), which is both fragile (future state names containing the same substring will falsely match) and impossible to statically verify. Citation: `app/react/sidebar/SidebarItem/useSidebarSrefActive.tsx:33-49`, usage example `app/react/sidebar/SettingsSidebar.tsx:82-97`.

14. **A near-duplicate, seemingly-unused component (`Head.tsx`) reimplements ~90% of `SidebarItem`'s active-link/tooltip logic with its own private `useSrefActive` helper**, rather than reusing `useSidebarSrefActive`. This is legacy/dead-code risk worth deleting rather than porting. Citation: `app/react/sidebar/SidebarItem/Head.tsx:1-40,79-96` versus `app/react/sidebar/SidebarItem/SidebarItem.tsx` and `useSidebarSrefActive.tsx`.

## Summary of most load-bearing files for a rewrite

- `app/index.html` - the entire shell skeleton (AngularJS), including the loading spinner, the `#page-wrapper`/`#sideview`/`#content-wrapper`/`#view` nesting and the `ng-class` rules that must be replicated as real component state in any rewrite.
- `app/react/sidebar/Sidebar.tsx`, `Sidebar.module.css` - source of truth for widths (`300px`/`72px`), transition timing (`0.4s ease`), and the fixed/z-indexed positioning strategy.
- `app/react/sidebar/sidebarStore.ts`, `useSidebarState.tsx` - the entire "responsive" behavior boils down to these two files; a rewrite should replace both with one hook plus real CSS media queries and drop the AngularJS bridge entirely.
- `app/react/sidebar/SidebarItem/*` - the item/parent/tooltip/active-link pattern to modernize (bump touch targets, add a real mobile-visible-label affordance instead of hover tooltips).
- `app/react/components/PageHeader/*` - the breadcrumbs/title/reload/actions-slot API is a reasonable shape to keep conceptually (per-view `<PageHeader>` with children as an actions slot) but needs responsive wrapping/truncation and fixed-width menu fixes.

---

**IMPORTANT DELIVERY NOTE:** This subagent's `write` tool rejected the required output path (`/home/hyun/Projects/Docknight/.ref/notes/01-layout-shell.md`) with the error: "this write tool is limited to the xd:// device transport ... Filesystem writes are not available elsewhere." This is a tool-configuration limitation of this session (already reported via `xd://report_issue`). The orchestrating agent (Main) MUST write the markdown content above verbatim to `/home/hyun/Projects/Docknight/.ref/notes/01-layout-shell.md` since this subagent has no filesystem write capability in this session.