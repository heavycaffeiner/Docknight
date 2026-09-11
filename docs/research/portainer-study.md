# Portainer Study, and the Docknight Overlay Plan

| Item      | Detail                                                                 |
|-----------|------------------------------------------------------------------------|
| Author    | heavycaffeiner(Dong Hyun Kim)                                           |
| Created   | 2026-09-11                                                              |
| Status    | **Report, implemented.** The overlay plan in sections 9 and 10 was built.  |
| Subject   | Portainer CE 2.45.0, commit `4a4a157`, cloned read-only at `.ref/portainer` |
| Evidence  | `.ref/notes/01` to `.ref/notes/05`, five source dossiers, all citations relative to `.ref/portainer/` |

The Docknight side of this report was written against the Svelte 5 client, which the rebuild
replaced with React, TanStack Query, and mdui 2. Docknight file references below name files
that no longer exist; the Portainer findings and the design decisions still stand.

---

## 1. Summary

Portainer CE is a broad Docker management console with a desktop-only interface. Its feature
surface is worth studying and partially copying. Its layout, its responsive behaviour, and its
overlay handling are worth studying and not copying.

Three findings drive everything below.

**Portainer's breadth is a UX cost, not only a feature list.** The administration section alone
exposes 15 destinations before a user touches a container, and the General settings page is seven
stacked widgets. A large share of that surface is multi-tenant machinery (users, teams, five RBAC
roles, per-resource ownership), multi-environment machinery (environments, groups, tags, Edge), or
Business Edition advertising. None of it applies to one host with one admin.

**Portainer's mobile support does not exist.** There is no viewport meta tag in `app/index.html`,
so a phone renders the desktop layout inside a virtual 980px canvas. Sixteen files in a
multi-thousand-file React tree use any responsive prefix, and most of those widen layouts for large
monitors. The datatable, which is the app's primary surface, has a `.table-responsive` wrapper
whose `overflow-x` was stripped by a project override, so wide tables scroll the whole page
sideways. Legacy modals are pinned to `width: 450px` with no cap.

**Docknight is already ahead on the shell and behind on overlays.** The size class model, the
pointer-driven density, the keyboard insets, and the geometry test matrix are in place and are
better than anything in Portainer. What is missing is the overlay layer itself: there is no
navigation drawer, no reusable sheet, no focus trap, no scroll lock, no layer ordering, and no
focus restoration. Section 10 specifies that layer.

---

## 2. Method and sources

The clone was read only. No build, install, lint, or test was run against it. Five parallel
investigations produced the dossiers in `.ref/notes/`:

| Note | Subject |
|---|---|
| `01-layout-shell.md` | Shell DOM tree, sidebar internals, PageHeader, routing, 14 cited weaknesses |
| `02-mobile-responsive.md` | Breakpoints, responsive-prefix frequency, viewport meta, datatable and modal behaviour on a phone |
| `03a-routes-resources.md` | Docker route map and exhaustive per-resource action tables |
| `03b-stacks-compose.md` | Stack creation, lifecycle, env vars, git, versioning, editor, templates, registries |
| `03c-platform-gating.md` | Platform features, CE RBAC, the Business Edition gating mechanism, MVP table |
| `04-ux-patterns.md` | Component inventory, datatable architecture, modal system, forms, feedback, wizards |
| `05-design-system.md` | Tokens, theming, icons, status colours, dashboard IA, density, accessibility |

Claims below carry a file path when they came from the clone, and a `frontend/` or `backend/` path
when they came from Docknight itself.

---

## 3. What Portainer is

Portainer CE 2.45.0 is a Go API (`api/`) plus a hybrid AngularJS and React frontend (`app/`) that
has been migrating for years and has not finished. The shell is still an AngularJS template; React
occupies two named `ui-view` slots inside it.

| Layer | Technology |
|---|---|
| Backend | Go, BoltDB or equivalent via `api/dataservices`, Docker Engine proxy under `/api/endpoints/{id}/docker/*` |
| Routing | UI-Router only, states registered per domain in `__module.js` files |
| Frontend | React 18 in `app/react/`, AngularJS templates in `app/docker/views/`, `app/portainer/views/` |
| Bridge | `react2angular` (`r2a`), plus `$rootScope.$evalAsync` pushes from React stores into AngularJS services |
| Data | TanStack Query v4 |
| Forms | Formik with Yup |
| Styling | Tailwind layered on vendored Bootstrap 3.4, `preflight: false` |
| Primitives | Reach UI (Modal, Menu) and Radix (Sheet) in the same app |
| Build | webpack, Storybook, vitest |

The hybrid is the root of several defects. The sidebar's open state lives in a zustand store, is
pushed into an AngularJS service, and is read back by an `ng-class` expression on `#page-wrapper`
that toggles the CSS class that actually moves the layout
(`app/react/sidebar/useSidebarState.tsx:76-97`, `app/index.html:32-41`). Two React roots and one
AngularJS root coordinate through global DOM ids.

---

## 4. Feature surface

### 4.1 Docker resources

Route tree root `docker` (`app/docker/__module.js:16-19`) guards every child by pinging the
environment. Resource families: containers, images, networks, volumes, services, tasks, configs,
secrets, nodes, events, host, templates, registries, stacks.

Container actions, the deepest set, from
`app/react/docker/containers/ListView/ContainersDatatable/ContainersDatatableActions.tsx` and
`app/react/docker/containers/ItemView/ContainerActionsSection/`:

| Action | Confirmation | Class |
|---|---|---|
| Start, Stop, Kill, Restart, Pause, Resume | no | core |
| Remove | yes, with an "also remove non-persistent volumes" switch | core |
| Create, Recreate, Duplicate/Edit, Rename | Recreate asks whether to pull the latest image | core |
| Commit to image, with optional registry push | no | advanced |
| Update restart policy, Connect network, Disconnect network | no | core |
| Logs, Inspect, Exec console | no | core |
| Stats, Attach console | no | advanced |
| Webhook toggle | no | BE badge, functional in CE |

Images: pull, remove, force remove, prune (with clear-build-cache option), import tar, export tar,
build. Networks: create, remove, disconnect container; system networks are excluded from selection
(`app/react/docker/networks/ListView/NetworksDatatable.tsx:69,79-99`). Volumes: create, remove,
browse contents (agent only), list consuming containers.

Swarm-only families (services, tasks, configs, secrets, node availability and labels, the cluster
visualizer) exist and are irrelevant to a single host that never runs `docker swarm init`. All
filesystem browsing (host, node, volume) requires the Portainer Agent bind-mounting `/host`, so it
is invisible on a direct-socket deployment, which is Docknight's deployment model.

### 4.2 Stacks and Compose

Four creation methods behind one `BoxSelector`
(`app/react/docker/stacks/CreateView/CreateStackForm/CreateStackInnerForm.tsx:41-49`): web editor,
file upload, git repository, custom template.

Lifecycle from `app/react/docker/stacks/ItemView/StackInfoTab/StackActions.tsx`: start, stop,
delete, update and redeploy (with a "re-pull image and redeploy" switch and a prune toggle), git
pull-now, detach from git, associate an orphaned stack, create a template from a stack, duplicate
or migrate.

Two findings matter more than the list.

**Stack version rollback is dead code in CE.** The UI renders a version selector, but the backend
ignores both the version query parameter on `GET /stacks/{id}/file` and the `rollbackTo` field on
`PUT /stacks/{id}`. Anyone copying the feature by looking at the UI would copy a stub.

**Custom template variable substitution is fully implemented and hidden behind `isBE`.** Mustache
substitution works; CE simply does not render the variables field. It is a free win for a project
without a licence gate.

Git integration was refactored around a reusable Source object
(`app/react/portainer/gitops/sources/`) with server-side polling in
`api/gitops/scheduling/scheduler.go`. The polling interval now lives on the Source, not the stack.
For one host this abstraction is pure overhead: a per-stack interval field is equivalent.

The editor is CodeMirror with YAML schema completion and a diff viewer, guarded on navigation by
`confirmWebEditorDiscard`. That combination is the right shape and Docknight already uses CodeMirror
6 (`frontend/src/components/CodeEditor.svelte`).

### 4.3 Platform layer and Business Edition gating

CE's access model is two orthogonal layers. A global role (`Admin`, `Standard`, `EdgeAdmin`,
`app/portainer/users/types.ts:9-13`) and a per-resource ownership
(`public | private | restricted | administrators`,
`app/react/portainer/access-control/types.ts:8-13`). The five-role RBAC catalogue is presented in
the UI but only `Standard user` is selectable in CE; the rest render a Business Feature badge
(`app/portainer/components/accessManagement/porAccessManagementController.js:63-77`,
`RbacRolesDatatable.tsx:52-62`).

Gating is a build-time constant (`PORTAINER_EDITION`) feeding `isBE`, a hardcoded
`Record<FeatureId, Edition.BE>` map, and three enforcement tiers:

| Tier | Mechanism | Example |
|---|---|---|
| Cosmetic badge | `BEFeatureIndicator` beside a working control | Stack and container webhook switches |
| Soft overlay | Page renders, content is an empty stub | Auth logs hardcode `{ logs: [], totalCount: 0 }` (`auth-logs-view.controller.js:82`) |
| Hard disable | Control is in the DOM and inert | Registry Browse button, `BETeaserButton` with `disabled` hardcoded |

The cost to the user is concrete. Fifteen administration destinations, a settings page that is
nine semantically distinct panels, and a non-dismissible upgrade banner mounted above the sidebar
logo in every CE install (`app/react/sidebar/UpgradeBEBanner/UpgradeBEBanner.tsx`, mounted at
`Sidebar.tsx:45`). A user looking for "restart my stack" navigates past all of it.

---

## 5. Layout and navigation

Authenticated DOM, condensed from `.ref/notes/01-layout-shell.md`:

```
#page-wrapper[.open]                     AngularJS, padding-left drives the layout shift
  #sideview[ui-view=sidebar]             React root 1
    Sidebar  (UpgradeBEBanner, nav, Home, EnvironmentSidebar, AppDelivery, Settings, Footer)
  #content-wrapper > .page-content
    #view[ui-view=content]               React root 2, per route
      PageHeader (SidebarToggle, Breadcrumbs, Notifications, Help, UserMenu, Title, actions slot)
      view body (Datatable / form / dashboard)
```

Sidebar facts:

| Fact | Value | Citation |
|---|---|---|
| Persisted key | `toolbar_toggle` in localStorage | `sidebarStore.ts:9` |
| Mobile threshold | `992`, duplicated in two files | `sidebarStore.ts:9`, `useSidebarState.tsx:16` |
| Widths | 300px open, 72px closed | `Sidebar.module.css:22-23` |
| Position | `fixed; left: 0; z-index: 10` | `Sidebar.module.css:26-28` |
| Transition | `all 0.4s ease` | `Sidebar.module.css:2,29` |
| Item height | `h-8`, 32px | `SidebarItem.tsx:118` |
| Toggle height | `h-6`, 24px | `SidebarToggleButton.tsx:14` |

There is no drawer. There is no backdrop, no close on outside click, no close on navigate, no focus
trap, and no swipe. Below 560px a media query caps the content offset but not the panel width
(`Sidebar.module.css:9-19`), so manually opening the sidebar on a phone produces an accidental
overlay that covers the content with no way to dismiss it except the same 24px toggle.

PageHeader is prop-drilled per view, not registered by route. The breadcrumb row has no wrap or
truncation strategy, so long container names overflow the header. The notifications dropdown is
hardcoded to `width: 500px` (`NotificationsMenu.module.css:1-3`), wider than a phone.

---

## 6. Mobile: the evidence

`app/index.html` has eight meta tags and none of them is `viewport`. Mobile engines therefore lay
out at a virtual width near 980px and scale down. Every downstream responsive mechanism reads that
fake width, including the sidebar's own `window.innerWidth < 992` check.

Three breakpoint systems coexist and disagree:

| System | Breakpoints | Source |
|---|---|---|
| Tailwind defaults | 640 / 768 / 1024 / 1280 / 1536 | `tailwind.config.js` sets no `screens` |
| Bootstrap 3.4 | 768 / 992 / 1200 | vendored at `app/assets/css/index.js:1` |
| Sidebar constants | 992 in JS, 560/561 in CSS | `sidebarStore.ts:9`, `Sidebar.module.css:6-14` |

Responsive-prefix usage across the whole `app/` tree: 26 matches in 16 files. `sm:` appears twice.
Almost every hit widens a grid for a large monitor. There are eight `@media` blocks in total, six
of them `min-width` desktop additions.

Datatables do not reflow and do not scroll inside their own box. `Table.tsx:24-35` wraps every
table in `.table-responsive`, and `datatable.css:301-310` redefines that class to add cell padding
without restoring Bootstrap's `overflow-x: auto`. Header cells are `white-space: nowrap`. The result
is page-level horizontal scrolling on every list view.

Modals split in two. The React modal caps correctly with `max-w-[calc(100vw-2rem)]` and
`max-h-[calc(100vh-2rem)]` plus internal scroll (`modals/Modal/Modal.tsx:44-56`). The legacy
AngularJS modal is `width: 450px` unconditionally (`bootstrap-override.css:298-300`), which
overflows a 390px viewport.

No `env(safe-area-inset-*)` anywhere. No `visualViewport` usage. No media-query hook. No touch
gesture code. Tooltips use Tippy with the default `mouseenter focus` trigger on a bare `<span>`, so
contextual help has no tap path.

Verdict from the dossier, which this report adopts: Portainer's web UI is not usable on a phone in
any meaningful sense. The one technique worth porting is the React modal's viewport clamp.

---

## 7. Patterns worth taking, and patterns to refuse

Take:

1. One table state contract behind two renderers. `Datatable` and `CardExpandableList` share the
   settings, columns, and dataset shape and differ only in the leaf renderer
   (`datatables/CardExpandableList.tsx`). This is the correct way to serve a phone and a desktop
   from one data layer.
2. A promise-returning confirmation vocabulary. `confirmDelete`, `confirmDestructive`,
   `confirmUpdate`, `confirmWebEditorDiscard` (`modals/confirm.ts`), used at 60 call sites, keeps
   the call site at one line and the copy consistent.
3. `validateOnMount` as the default. Submit buttons reflect real validity from first paint.
4. Composable persisted-settings mixins per table (`datatables/types.ts`) instead of one monolithic
   settings object.
5. A single aggregate dashboard request. One `GET /docker/dashboard` returns every tile count
   (`useDashboard.ts:29-36`) instead of one request per tile.
6. Per-tile freshness indicators tied to the shared query state (`DashboardItem.tsx:44-59`).
7. A form-field loading slot with a fixed-height placeholder to prevent layout shift
   (`FormControl.tsx:63-67`).
8. The viewport clamp on dialogs: cap width and height to the viewport, scroll inside.
9. Selects that upgrade themselves to async paginated mode past a threshold
   (`ReactSelect.tsx:88-97`).
10. A single-Formik wizard whose steps swap validation schemas, rather than a wizard whose steps
    each submit independently.

Refuse:

1. Two headless primitive libraries in one app. Radix's `DismissableLayer` sets
   `body.style.pointerEvents = 'none'`, which Reach's overlay had to undo by hand
   (`Modal.tsx:41-46`).
2. Imperative `ReactDOM.render` modal mounting with manual DOM node lifecycle
   (`open-modal.tsx`).
3. No error boundaries anywhere in the tree. A render exception white-screens the view.
4. Bootstrap grid classes inside otherwise modern components (`FormControl.tsx:78-99`).
5. Per-component hand-written theme triplets (`bg-gray-2 th-dark:... th-highcontrast:...`) instead
   of semantic tokens. This is the design system's largest maintenance liability.
6. Two inconsistent status colour mappings for the same state. `unhealthy` is amber in the
   containers table (`columns/state.tsx:58-73`) and red on the dashboard tile
   (`DashboardView/ContainerStatus.tsx`).
7. Datatable loading states rendered as a plain `Loading...` text row.
8. Empty states that cannot distinguish "no data" from "no results for this filter".

Accessibility gaps worth naming, because they are cheap to avoid and expensive to retrofit:
`.btn.btn-icon:focus { box-shadow: none !important; }` removes the focus ring from every icon-only
button (`button.css:169-172`); `--text-muted-color: #777777` on white is 4.04:1 and fails AA; sortable
headers carry no `aria-sort`; the active sidebar item carries no `aria-current`.

---

## 8. Docknight today, measured against the study

Docknight is Svelte 5 with m3-svelte, a WebSocket RPC protocol, and a Playwright geometry matrix.
On the axes this study cares about, it is ahead of Portainer in four places and behind in one.

Ahead:

| Axis | Docknight | Portainer |
|---|---|---|
| Viewport meta | `width=device-width, initial-scale=1, interactive-widget=resizes-content` (`frontend/index.html:5`) | absent |
| Breakpoints | one system, Material 3 size classes at 600 and 840 (`Layout.svelte:19-20`) | three disagreeing systems |
| Density | pointer-driven only, one media query grows every control token (`styles/tokens.css:62-67`) | Bootstrap `btn-xs` at roughly 20px |
| Keyboard | `visualViewport` publishes `--viewport-block`, `--keyboard-inset`, `data-keyboard` (`lib/viewport.svelte.ts`) | no handling |
| Verification | 8 geometries including phone 390x844, keyboard 390x380, reflow 320x900, run through `tools/audit` rules (`tests/support/matrix.ts:11-20`) | none |

Behind, and this is the whole subject of section 10:

| Gap | Evidence |
|---|---|
| No navigation drawer | The stack list is rendered only when `isExpanded` is true (`Layout.svelte:130-134`). Below 840px the only path between stacks is back to the Dashboard. |
| No reusable sheet | The only bottom sheet is private markup inside `MenuButton.svelte:94-109`. The `--shadow-sheet` token exists for it (`tokens.css:47`) and nothing else can use it. |
| No focus trap, no focus restore | `ConfirmDialog.svelte` sets `role="alertdialog"` and `aria-modal="true"` but never moves focus in, never traps it, and never returns it to the trigger. `MenuButton`'s sheet has `role="menu"` and no focus management at all. |
| No background inertness, no scroll lock | Nothing in `frontend/src` sets `inert` or locks body scroll. The page behind a dialog scrolls and is reachable by Tab. |
| Unordered layers | `z-index` literals are scattered: 10, 100, 1000, 1001, 2000, 3000 across `Stack.svelte`, `ConnectionBanner`, `MenuButton`, `ConfirmDialog`, `ToastHost`. No token, no stacking policy. |
| Menu popup can be clipped | `.gcp-menu-popup` is `position: absolute` inside `.gcp-menu-container` (`MenuButton.svelte:158-163`); `.gcp-outlet` is `overflow-y: auto` (`Layout.svelte:334`). Proposal 6 phase 11 required flip logic; it does not exist. |
| Sheet ignores safe area and keyboard | `.gcp-menu-sheet` ends with `padding-block-end: var(--space-4)` (`MenuButton.svelte:209`). The bottom bar next to it does use `env(safe-area-inset-bottom)` (`Layout.svelte:345`). On a notched phone the last sheet item sits under the home indicator. |

Feature-wise, Docknight's RPC surface today is: stack list, get, save, deploy, start, stop,
restart, down, update, delete, service status, per-service start/stop/restart, exec terminal,
follow-log terminal, host console, `docker.stats`, `docker.networks`, composerize, multi-host
agents, auth with TOTP, settings, self-upgrade (`backend/*/methods.ts`).

---

## 9. Recommendation A: the lightweight feature set

The target is a single host, a single admin, Compose as the primary object. Everything below is
measured against one question: does a person running six stacks on one box hit this weekly?

### Tier 1, build

| Feature | State in Docknight | Rationale |
|---|---|---|
| Stack lifecycle: deploy, start, stop, restart, down, update, delete | present | The product |
| Compose and `.env` editing with YAML schema completion and a save guard | editor present, guard unverified | Portainer's `confirmWebEditorDiscard` prevents the single most annoying data loss in the app |
| Per-service state, health, CPU, memory | present | Answers "is it up" without a terminal |
| Exec shell and follow logs | present | The two reasons a person opens a panel at 2am |
| Image inventory with prune | absent | Disk pressure is the number one self-hosted failure mode, and prune is one Docker call |
| Volume inventory with orphan removal | absent | Same reason, plus Compose leaves volumes behind on `down -v` omissions |
| Network inventory with orphan removal | read-only (`docker.networks`) | Compose leaves orphan networks after renames |
| Unmanaged container list, read only | absent | Without it a user cannot see what else is on the host and will not trust the panel |
| Env var editor with simple and paste modes | partial | Portainer's dual mode is cheap and high value (`EnvironmentVariablesFieldset`) |
| Pull-image-and-redeploy toggle on update | absent | One flag on the compose call, removes a whole class of "why is it still old" |

### Tier 2, build after Tier 1 proves out

| Feature | Rationale |
|---|---|
| Git-backed stacks: ref, path, credentials, per-stack poll interval, manual pull-now | The "point at a repo" workflow, minus Portainer's Source and Workflow abstraction, which exists to share credentials across environments Docknight does not have |
| Webhook redeploy endpoint | Fully functional in CE, genuinely useful, one public POST route |
| Real stack file version history | Store the last N compose files and restore them for real. Portainer's version selector is UI-only for Docker stacks; do not copy the shape, copy the intent |
| Built-in template gallery with variable substitution | The Mustache substitution Portainer hides behind `isBE` is trivial and is what makes a template reusable |
| Registry credentials, flat list | Needed for private images, without the per-environment access assignment |
| Aggregate dashboard call | One request returning stack, container, image, volume, network counts, following `useDashboard.ts` |

### Tier 3, cut

| Cut | Rationale |
|---|---|
| Kubernetes, Helm, all of it | Out of scope by definition, and Portainer's single largest area |
| Swarm: services, tasks, configs, secrets, nodes, visualizer | Those Engine endpoints do not exist outside swarm mode |
| Edge Compute, tunnels, Edge stacks and groups | Built for NAT'd fleets |
| Environments, groups, tags, the environment wizard | Docknight's agent list already covers multi-host without the taxonomy |
| Users, teams, five RBAC roles, Effective Access Viewer | One admin account. Adding a scaled-down RBAC would be building the machinery without the requirement |
| Per-resource ownership (public/private/restricted) | Follows from the above |
| Container create and duplicate-edit forms | Compose is the creation path. A 40-field container form competes with the product's premise |
| Image build UI, import and export tar | A path in the compose file covers build; tar transfer is a shell task |
| Stack duplicate and migrate | Nowhere to migrate to |
| Activity and auth logs as datatables | A lightweight local event feed if anything, not a compliance surface |
| Remote app template catalog | Hosting and consuming a remote manifest for a curated gallery of someone else's compose files |
| Custom login banners, licence screens, upsell chrome | Not applicable |

The cut list is the point. Portainer's problem is not that any single feature is wrong; it is that
the sum of them buries the three actions a person performs daily.

---

## 10. Recommendation B: the overlay system

This is the part the study exists for. Docknight's shell is correct and its overlays are not. The
proposal is three pieces, built in order, with the existing components migrated onto them rather
than left beside them.

### 10.1 The layer model

Add ordering tokens to `frontend/src/styles/tokens.css` and delete every `z-index` literal in
`frontend/src`:

```css
--layer-content: 0;
--layer-sticky: 10;    /* bottom app bar inside a page */
--layer-banner: 100;   /* connection banner */
--layer-scrim: 1000;   /* one scrim per modal layer, index-offset by depth */
--layer-overlay: 1010; /* drawer, sheet, dialog, menu; offset by depth */
--layer-toast: 3000;   /* above every overlay, never scrimmed */
```

Depth offset comes from the layer module, not from the component: a component asks for a layer and
receives its computed `z-index`. Two overlays open at once then stack in open order instead of by
whichever literal was typed last.

### 10.2 `frontend/src/lib/overlay.svelte.ts`

A behaviour module, not a portal host. Every overlay component keeps rendering its own markup and
registers the behaviour it cannot implement alone.

```ts
export type LayerKind = "drawer" | "sheet" | "dialog" | "menu";

export interface LayerOptions {
    kind: LayerKind;
    /** Escape, scrim click, and route change all call this. */
    dismiss: () => void;
    /** A menu takes no scrim and does not lock scroll; every other kind does. */
    modal?: boolean;
}

export interface Layer {
    readonly zIndex: number;
    readonly scrimIndex: number;
    close(): void;
}

export function openLayer(options: LayerOptions): Layer;
export const layers: { readonly depth: number; readonly top: Layer | null };
```

Responsibilities held once, in the module, instead of once per component:

- **Escape** is one `keydown` listener on `window`, routed to the topmost layer only. Today
  `ConfirmDialog` and `MenuButton` each install their own and both fire when both are open.
- **Scroll lock** is refcounted on `document.documentElement`, released when depth returns to zero.
- **Background inertness** sets `inert` on `.gcp-shell` while any modal layer is open, which
  removes the whole page behind the overlay from the tab order and the accessibility tree in one
  attribute. This replaces a hand-written focus trap and is supported by every browser Docknight
  targets.
- **Focus** is saved on open (`document.activeElement`), moved into the layer's first focusable
  element or the layer root, and restored on close. Without this, dismissing a sheet on a phone
  drops focus to `<body>` and the next Tab starts from the page top.
- **Route change** closes every layer. Today navigating from an open menu leaves it mounted.

The alternative design, a portal host that owns rendering, was rejected: it forces every call site
to hand over a snippet, is a larger cutover, and buys only the ability to escape an `overflow:
hidden` ancestor, which `position: fixed` already provides for sheets and dialogs.

### 10.3 `Sheet.svelte`

Extract the markup currently private to `MenuButton.svelte:94-109,202-251` into one component, and
make it correct.

```
Props:
  open: boolean
  side: "bottom" | "inline-end"     default "bottom" on compact, "inline-end" above
  title?: string                     renders a labelled header, sets aria-labelledby
  detent?: "content" | "half" | "full"   default "content"
  onclose: () => void
  children: Snippet
```

Requirements the current markup misses:

- `padding-block-end: max(var(--space-4), env(safe-area-inset-bottom))`, so the last row clears the
  home indicator.
- `max-block-size: calc(var(--viewport-block, 100dvh) - var(--size-control-lg))` with the content
  region scrolling inside, following the one Portainer technique worth porting.
- `inset-block-end: var(--keyboard-inset)` while `data-keyboard="open"`, so a sheet containing a
  field sits on the keyboard rather than behind it. The shell already publishes the inset
  (`lib/viewport.svelte.ts:23`).
- A drag handle that is decorative on a fine pointer and a real dismiss target on a coarse one,
  with a visible close control so dismissal never depends on a gesture. WCAG 2.5.1 requires a
  single-pointer alternative, and proposal 6 already rules gestures out as a primary mechanism.
- `role="dialog"` with `aria-modal="true"` and a label, not `role="menu"`, unless the content
  really is a menu.
- Enter and exit transitions on `transform`, not on `inset`, so the sheet does not repaint the
  scrim every frame.

`MenuButton` then becomes: popup above compact, `Sheet` at compact, and the popup gains the flip
logic proposal 6 already requires, because a popup anchored at `inset-block-start: 100%` inside the
scrolling outlet is clipped near the bottom of a long page.

### 10.4 `NavDrawer.svelte`, the Sidebar

This is the largest single mobile win available. Today the stack list exists only at 840px and up.
A person on a phone who wants to jump from `paperless` to `monitoring` must navigate back to the
Dashboard and scroll a card.

One component, three placements, selected by size class:

| Size class | Placement | Behaviour |
|---|---|---|
| Compact, under 600px | Modal drawer over the content, from the inline start, `--measure-panel` wide with a `calc(100vw - var(--size-control-xl))` cap | Scrim, Escape, scrim click, close on navigate, focus trapped by `inert` on the shell |
| Medium, 600 to 839px | Modal drawer, same as compact | The rail stays; the drawer carries the stack list the rail has no room for |
| Expanded, 840px and up | Standard drawer, in flow, no scrim | Exactly today's `.gcp-panel` |

Contents, in order: host switcher when more than one agent exists, stack search field, stack list
grouped by host (all of which `StackList.svelte` already renders), then a divider and the
destinations currently duplicated in the rail and the bottom bar.

Trigger: a menu button at the header start on compact and medium, which is where the brand link
sits today (`Layout.svelte:70-80`). The bottom navigation bar stays as it is; the drawer is
additive, not a replacement, because Material 3 puts primary destinations in the bottom bar and
secondary navigation in the drawer, and the stack list is secondary navigation.

Dismissal on navigate is mandatory. Portainer's sidebar does not do it
(`.ref/notes/01-layout-shell.md`, weakness 3) and the result is a drawer covering the page the user
just asked for.

An edge-swipe to open is explicitly out of scope, matching proposal 6's non-goal: a gesture needs a
single-pointer equivalent, so it is a second control to build and test for a convenience the header
button already provides.

### 10.5 Migrating the existing overlays

| Component | Change |
|---|---|
| `ConfirmDialog.svelte` | Register a `dialog` layer. Delete the local `keydown` handler and the `z-index: 2000`. Keep the keyboard-open block-start anchoring, which is already correct. Add initial focus on the cancel button, the safe default for a destructive prompt. |
| `MenuButton.svelte` | Register a `menu` layer (no scrim, no scroll lock). Replace the private sheet markup with `Sheet`. Add popup flip. Return focus to the trigger on close. |
| `ToastHost.svelte` | Keep above every layer. Replace `z-index: 3000` with `--layer-toast`. Keep the existing bottom-bar offset and add the same offset when a bottom sheet is open. |
| `Layout.svelte` | Add the drawer trigger and the `NavDrawer`. Apply `inert` to `.gcp-shell` from the layer module. Keep the rail and the bottom bar unchanged. |
| `Stack.svelte` | The compact bottom app bar already collapses actions into `MenuButton` (`Stack.svelte:272-274`). No change beyond inheriting the new sheet. |

### 10.6 Accessibility requirements, non-negotiable

These are the items Portainer gets wrong and Docknight currently does not handle at all.

- Every modal layer: labelled (`aria-labelledby` pointing at its own visible heading, never a
  duplicated string), `aria-modal="true"`, background `inert`, focus moved in and restored out.
- Dismissal by at least two paths that are not gestures: Escape, and a visible control. Scrim click
  is a third, not a substitute.
- Active navigation item carries `aria-current="page"`. Neither the rail nor the bottom bar sets it
  today (`Layout.svelte:96-126,147-178`); they carry a CSS class only.
- Every overlay target meets the coarse-pointer size the token scale already enforces. The sheet
  items inherit `--size-control-md`, which the pointer query grows to 48px.
- No meaning carried by colour alone in status chips, which `StatusChip.svelte` already satisfies
  by rendering a word.

### 10.7 Verification

The harness for this already exists and does not need extending, only using.

- `tests/support/matrix.ts` geometries cover the cases that matter: `phone` 390x844, `keyboard`
  390x380, `reflow` 320x900, `phone-land` 780x390. A sheet that ignores the keyboard inset fails
  the `keyboard` cell on `in-viewport`; a sheet without safe-area padding fails `touch-target` or
  `collision` at `phone`.
- `tools/audit/rules/focus-visible.ts` and `target-size.ts` already fail a missing ring or an
  undersized target. The new layers must be audited as part of the screen, which means a cell has
  to open each layer before the audit runs.
- The mechanism for that already exists. `openCell` carries a per-screen interaction branch: the
  `stack-edit` screen waits for the action bar, clicks the overflow trigger when the compact layout
  carries Edit only in the menu, then clicks the Edit item (`tests/support/harness.ts:171-197`).
  Three new `ScreenName` entries with the same shape cover the whole overlay system: `stack-sheet`,
  `stack-dialog`, `dashboard-drawer`. Each becomes a full row of matrix cells and inherits every
  existing rule without a single new rule being written.
- Focus restoration and background inertness are behaviour, not geometry: cover them with the
  Playwright a11y run (`tests/a11y/`) by asserting `document.activeElement` before and after, and
  asserting the shell is `inert` while a layer is open.

---

## 11. Sequencing

| Step | Work | Depends on |
|---|---|---|
| 1 | Layer tokens in `tokens.css`, remove every `z-index` literal | none |
| 2 | `lib/overlay.svelte.ts`: layers, Escape routing, scroll lock, `inert`, focus save and restore | 1 |
| 3 | Migrate `ConfirmDialog` and `MenuButton` onto the layer module | 2 |
| 4 | `Sheet.svelte`, with safe-area, keyboard inset, viewport clamp, internal scroll | 2, 3 |
| 5 | `NavDrawer.svelte` and the header trigger; `Layout.svelte` renders it at every size class | 2, 4 |
| 6 | Matrix scenarios that open each layer; a11y assertions for focus and inertness | 3, 4, 5 |
| 7 | Tier 1 features from section 9, each reusing the sheet for its action set | 4 |

Steps 1 through 6 are the overlay system and are independent of any feature work. Step 7 is where
the lightweight-Portainer feature set lands, and it is cheaper after the overlay layer exists
because every new resource list needs the same action sheet.

---

## 12. Open questions

1. **Unmanaged containers.** Read-only list, or list with stop and remove? Read-only keeps the
   Compose premise intact; actions make the panel able to clean up after itself. Recommendation:
   read-only in Tier 1, revisit with evidence.
2. **Prune scope.** Portainer's prune offers "all" and "clear build cache" as separate switches.
   A single "remove unused" with an explicit preview of what will be deleted is safer and is one
   more Docker call. Which?
3. **Drawer at medium.** Modal drawer at 600 to 839px, as specified above, or a persistent panel
   that pushes the outlet? A tablet in portrait has the width for a persistent panel and loses it
   in landscape. Recommendation: modal, because one behaviour across both orientations is easier to
   reason about than a behaviour that changes at rotation.
4. **Version history storage.** If stack file history lands, where does it live? The stack directory
   itself (visible to the user, survives a Docknight reinstall) or the data directory (invisible,
   removable)? Recommendation: the stack directory, in a dot-prefixed subdirectory, because
   Docknight's stated contract is that it reads and writes the files the user already owns.

---

## 13. Source index

All dossiers are in `.ref/notes/`, all citations relative to `.ref/portainer/`.

| File | Size | Subject |
|---|---|---|
| `01-layout-shell.md` | 30KB | Shell, sidebar, PageHeader, routing, 14 weaknesses |
| `02-mobile-responsive.md` | 27KB | Breakpoints, prefix frequency, viewport meta, tables, modals, touch |
| `03a-routes-resources.md` | 28KB | Docker routes and per-resource actions |
| `03b-stacks-compose.md` | 33KB | Stacks, git, versioning, editor, templates, registries |
| `03c-platform-gating.md` | 26KB | Platform, RBAC, BE gating, MVP table |
| `04-ux-patterns.md` | 51KB | Components, datatable, modals, forms, feedback, wizards |
| `05-design-system.md` | 40KB | Tokens, theming, icons, status colours, dashboard, a11y |

`.ref/` is untracked. The clone is pinned at commit `4a4a157`, dated 2026-09-01.
