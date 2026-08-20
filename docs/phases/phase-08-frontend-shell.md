# Phase 8: Frontend Shell

Implements proposal 6 in full. Every stylesheet written in this phase already passes the phase-7
linters, and every shell state renders in the phase-7 matrix. No feature screens yet; the router
serves placeholder pages so the shell is testable.

## Step 1: Vite setup

```
vite.config.ts:
    plugins: [svelte()]
    root: frontend
    build.outDir: ../dist/frontend, emptyOutDir
    define: { FRONTEND_VERSION: JSON.stringify(pkg.version) }
    server.port: 5000
    server.proxy: { "/ws": { target: "ws://localhost:5001", ws: true } }
        # one origin in dev, so the origin check runs the same as production
    build: emit brotli + gzip siblings (vite-plugin-compression or a small emit hook)

frontend/index.html:
    <meta name="viewport"
          content="width=device-width, initial-scale=1, interactive-widget=resizes-content" />
    <meta name="theme-color" content="...">   # updated by the theme store
    font preloads for JetBrains Mono (declared in phase 9's deps, wired here)
```

## Step 2: `styles/tokens.css`, `theme.css`, `global.css`

`tokens.css` verbatim from proposal 6 section 5-1, including:

```css
@media (pointer: coarse) {
    :root { --size-control-md: var(--size-control-lg); }
}
```

```
# invariant: no --m3-util-density declaration exists anywhere in the tree.
# invariant: no width-based media query changes a control size token.
# Width queries may change layout (gutters, columns, nav); only the pointer changes density.
```

`theme.css`: every Material 3 colour role under `:root[data-theme="light"]` and `[data-theme="dark"]`,
generated once by `tools/theme/generate.ts` from a single source colour (m3-svelte's generator, run
manually, output committed). `global.css`: reset, one `:focus-visible` ring, the type scale with
4px-multiple line heights, scrollbar styling, and:

```css
.optical-lead { margin-inline-start: calc(-1 * var(--optical-inset)); }
    /* pulls a leading control's box out so its ink lands on the text column */
```

## Step 3: `lib/viewport.svelte.ts`

```ts
export function trackViewport(): () => void;
export const keyboardOpen: { readonly value: boolean };
```

```
KEYBOARD_THRESHOLD := 120        # px; constant, not a token (not a spatial value on the grid)

trackViewport():
    if window.visualViewport is undefined:
        return noop unsubscribe            # --viewport-block stays unset; 100dvh fallback applies

    update():
        vv := window.visualViewport
        inset := max(0, document.documentElement.clientHeight - vv.height - vv.offsetTop)
            # clamp: transient negatives while the two viewports disagree
        root.style.setProperty("--viewport-block", vv.height + "px")
        root.style.setProperty("--keyboard-inset", inset + "px")
        open := inset > KEYBOARD_THRESHOLD
        root.dataset.keyboard := open ? "open" : "closed"
        keyboardState.value := open

    vv.addEventListener("resize", update); vv.addEventListener("scroll", update)
    update()
    return () => remove both listeners
```

Unit test (jsdom or a stubbed `visualViewport` object): heights in, properties and `data-keyboard`
out, negative clamp, threshold edges. This is the Safari-path coverage proposal 8 requires, since
Playwright never opens a real keyboard.

## Step 4: `lib/connection.svelte.ts`

Built in phase 2; land it in the tree now if it was developed against tests only, and bind
`FRONTEND_VERSION` reload behaviour.

## Step 5: Stores

```
lib/stores/session.svelte.ts
    session := $state({ state: "anonymous", username: null })
    login(username, password, totp?):
        session.state := "authenticating"
        res := await request("", "auth.login", { username, password, totp })
        if res.totpRequired: session.state := "anonymous"; return "totp"
        storage(remember).token := res.token
        session.state := "authenticated"; session.username := res.username
        return "ok"
    resume():
        token := localStorage.token ?? sessionStorage.token
        if none: return false
        try res := await request("", "auth.loginByToken", { token })
        catch: clear token; return false
        session -> authenticated
    logout():
        await request("", "auth.logout")
        clear token, clear every store (stacks, agents, settings), session -> anonymous
    on("autoLogin") -> session -> authenticated       # third signal; without it a
                                                      # disableAuth deployment shows a login form

lib/stores/stacks.svelte.ts
    per proposal 6 section 4.3.4:
    stacks := $state({ byKey: {}, loaded: false })
    applyStackList(endpoint, list):
        delete every byKey entry whose key ends with " " + endpoint
        for name, summary of list: byKey[name + " " + endpoint] := summary
        loaded := true
    dropEndpoint(endpoint): delete matching keys
    on("stackList", (endpoint, data) => applyStackList(endpoint, data.stacks))
    # invariant: no method result ever writes this store; events only

lib/stores/agents.svelte.ts
    agents := $state({ byEndpoint: {}, statuses: {} })
    on("agentList"):
        removed := old endpoints not in the new payload
        byEndpoint := payload.agents
        for e of removed: stacksStore.dropEndpoint(e)
            # invariant: the ONLY path that removes an endpoint's stacks
    on("agentStatus"): statuses[data.endpoint] := data

lib/stores/settings.svelte.ts
    values := $state(null); load() -> settings.get; save(partial) -> settings.set
    on("info"): update version/latestVersion/primaryHostname mirrors

    # rule for every store: cleared on logout, NOT on socket close
```

## Step 6: `router.ts`

```
routes := [
    { pattern: "/",                          load: () => import(".../Dashboard.svelte"), guard: "auth" },
    { pattern: "/compose",                   load: NewStack,   guard: "auth" },
    { pattern: "/compose/:name",             load: Stack,      guard: "auth" },
    { pattern: "/compose/:name/:endpoint",   load: Stack,      guard: "auth" },
    { pattern: "/terminal/:stack/:service/:type",            load: Terminal, guard: "auth" },
    { pattern: "/terminal/:stack/:service/:type/:endpoint",  load: Terminal, guard: "auth" },
    { pattern: "/console",                   load: Console,    guard: "auth" },
    { pattern: "/console/:endpoint",         load: Console,    guard: "auth" },
    { pattern: "/settings/:section",         load: Settings,   guard: "auth" },
    { pattern: "/setup",                     load: Setup,      guard: "setup" },
]
# every load is a dynamic import -> code splitting; placeholders until phase 9

match(path): first route whose pattern segments match; ":x" captures into params

navigate(path, { replace } = {}):
    for hook of beforeLeaveHooks: if not await hook(): return   # unsaved-edit guard
    history[replace ? "replaceState" : "pushState"]({}, "", path)
    render(path)

render(path):
    r := match(path) ?? notFound
    if r.guard == "auth" and session.state != "authenticated":
        route.component := LoginInPlace       # render login IN PLACE; the path survives
        return
    if r.guard == "setup" and not needsSetup: navigate("/", { replace: true }); return
    route := { path, params, component: await r.load() }
    moveFocusToHeading(); announce(title)     # a11y: silent client navigation is a defect

window.addEventListener("popstate", () => render(location.pathname))
# invariant: every route renders at every width; no width-conditional unreachability
```

## Step 7: `lib/stores/theme.svelte.ts` and `i18n.svelte.ts`

Direct transcription of proposal 6 sections 4.3.7 and 4.3.8:

```
theme:
    preference := $state(localStorage.theme ?? "system")
    mq := matchMedia("(prefers-color-scheme: dark)")
    resolved := $derived(preference == "system" ? (mq.matches ? "dark" : "light") : preference)
    $effect: root.dataset.theme := resolved; update <meta name="theme-color">
    mq listener re-resolves while preference == "system"     # reactive, never sampled once

i18n:
    catalogues := import.meta.glob("../locales/*.json")      # file list = language list
    en bundled statically; others lazy
    t(key, values):  messages[locale]?.[key] ?? messages.en[key] ?? key, interpolate {name}
    tc(key, count):  Intl.PluralRules category selection with .other fallback chain
    setLocale(tag):  lazy import, set locale, persist, document.lang, document.dir (RTL set)
    dev-only: warn once per missing key
```

## Step 8: `App.svelte`, `Layout.svelte`, navigation

```
App.svelte:
    onMount: trackViewport(); connect()
    render priority:
        never-connected and connecting -> full-page progress
        setup event received           -> Setup
        session.state != authenticated -> Login
        else                           -> Layout > routed component
    svelte:boundary at the top: error card + reload action, console log

Layout.svelte structure:
    .shell { block-size: var(--viewport-block, 100dvh) }
    header: --size-control-xl; product name, connection indicator, account menu
    nav:
        width >= 600  -> .rail (nav rail, --size-nav-rail wide)
        width < 600   -> .rail (bottom bar, --size-bottom-bar tall)
        destinations: Home, Console (only when terminal.mainEnabled), Settings
    .shell[data-keyboard="open"] .rail { display: none }
        # scoped to .rail only: the bottom APP bar (phase 9) carries the current task
        # and must stay above the keyboard
    panel:
        width >= 840  -> persistent StackList panel beside the outlet
        width < 840   -> no panel at any route; the Dashboard carries the list
        # invariant: no `panel-home` style special case; the outlet always renders
    outlet: the routed component; its own scroll container

ConnectionBanner:
    driven by connection.degraded (2 s grace), not raw socket state
    shows condition + retry countdown; does not block interaction

MenuButton.svelte:
    props: items [{ label, icon?, danger?, onSelect }]
    width >= 600: anchored popup
        position: below the anchor; if anchor bottom + popup height > viewport: flip above
        # invariant: never clipped by a scroll container (position: fixed, coords computed)
    width < 600: bottom sheet
        fixed to viewport bottom, full width, items at --size-control-lg
        focus trap, Escape closes, backdrop click closes
    width reactivity comes from a MediaQuery rune/store, never a one-time read

ToastHost + toast.svelte.ts:
    queue max 5, drop oldest; success 6 s, error sticky
    container: bottom-inline-end, offset --space-4, plus --size-bottom-bar on compact
    role="status" aria-live polite; error toasts assertive

ConfirmDialog:
    m3-svelte dialog wrapper; focus trap, restore focus on close, Escape, aria-modal
    when keyboardOpen.value: anchor block-start with margin instead of centring
    optional password field slot (used by disableAuth and delete confirmations)
```

## Step 9: Placeholder pages and matrix wiring

Each route gets a placeholder rendering its name as an `h1` inside the real Layout. Extend the
phase-7 smoke spec: every cell renders its route inside the shell with no horizontal overflow, the
bottom bar exists below 600px, the rail from 600px, the panel only from 840px, and on `keyboard`
cells with `data-keyboard` forced open (test hook) the `.rail` is hidden.

## Tests

```
- router: matching table, params, guard renders login in place and survives to the target path,
  beforeLeave veto blocks navigation, popstate renders
- stores: applyStackList replaces one endpoint only; agentList removal drops stacks;
  logout clears everything; socket close clears nothing
- i18n: fallback chain, plural categories, dir switch on an RTL tag, 40% expansion fits
  (assert no fixed-width label styles exist: lint-level)
- theme: system preference change re-resolves; data-theme set before first paint (no flash:
  inline script in index.html reads localStorage)
- viewport: unit tests from step 3
- shell matrix smoke per step 9
```

## Done checklist

- [ ] `pnpm dev:frontend` + `pnpm fixtures --scenario typical`: login as fixture, see the shell,
      navigate every placeholder route at 390x844 and 1920x1080.
- [ ] No stylesheet in `frontend/` contains a raw px spatial value (lint proves it).
- [ ] `matchMedia("(pointer: coarse)")` toggles `--size-control-md` 40 -> 48 (assert computed
      style in a touch cell).
- [ ] Reloading on a deep link lands on that route after login.
- [ ] The account menu, as a MenuButton, renders as a sheet at 390 and a popup at 1280.
