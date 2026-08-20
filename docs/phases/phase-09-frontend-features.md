# Phase 9: Frontend Features

Implements proposal 7: every screen. Order follows component dependency: primitives, then the
list and terminal, then the editor, then pages. Every component carries its `data-audit-*`
attributes from the start; phase 10's rules will read them.

Compact behaviour is part of each step, not a later pass. A step is not done until its screen
works at `phone` (390x844) and `laptop` (1280x900) in the fixture matrix.

## Step 1: Primitives

```
StatusChip.svelte
    props: status (string from the service vocabulary or stack status constant)
    renders: coloured chip + ALWAYS the word           # colour never carries meaning alone
    height: --size-control-md                          # one outline height per row, incl. coarse
    data-audit-id="status-chip"

ConfirmDialog       from phase 8, reused
EmptyState.svelte   icon + message + optional action link, --space-16 vertical padding

ArrayInput.svelte
    props: items (bind), placeholder, label
    one row per entry:
        <input> (monospace) + one remove icon button, both --size-control-md
        # invariant: NO reorder buttons at any width (non-goal; order lives in the YAML)
    add row: one button below, full width on compact
    row gap --space-2; container is data-audit-column
    remove is an icon button -> aria-label required (lint enforces)

HiddenInput.svelte  password-style input with a reveal toggle, used by dialogs and settings
```

## Step 2: `StackList.svelte`

```
props: filter (string)
data := $derived: group stacks.byKey by endpoint, filter by case-insensitive substring on name
render:
    search field in the header (only when used as the Dashboard card; the expanded panel
    passes its own field via slot or prop)
    if agents count > 1: one collapsible group per endpoint, header = display name or endpoint
    else: flat list, no group headers
    row (a <a> navigating to /compose/:name/:endpoint?):
        height --size-control-lg, padding-inline --space-3
        StatusChip + name (+ host when grouped); chips share one start edge
        data-audit-row="center", list container data-audit-column
    empty -> EmptyState with a "create your first stack" link
collapse state: plain $state in the component, not persisted
updates: purely reactive from the store; no fetching here
```

## Step 3: `TerminalView.svelte`

```
props: endpoint, terminal, interactive, rows

mount:
    term := new Terminal({ theme: paletteFor(theme.resolved), fontFamily: mono stack,
                           fontSize: 13, lineHeight: matching the 20px grid row })
    fit := new FitAddon(); term.loadAddon(fit); term.loadAddon(new WebLinksAddon())
    term.open(container)
    res := await request(endpoint, "terminal.join", { terminal })
    term.write(res.buffer)
    unsubWrite := on("terminalWrite", (ep, d) => ep == endpoint and d.terminal == terminal
                                                 and term.write(d.data))
    unsubExit  := on("terminalExit", ... show exit code line ...)
    ro := ResizeObserver(container): fit.fit(); request(endpoint, "terminal.resize",
                                                 { terminal, cols, rows })
    if interactive: term.onData(data => request(endpoint, "terminal.input", { terminal, data }))

reconnect: $effect on connection.generation:
    if generation changed since mount: re-join (NOT leave first), rewrite buffer
    # the skip-leave matters: leaving on reconnect closes the shell being rejoined

unmount: request terminal.leave (fire and forget), unsubscribe, ro.disconnect(), term.dispose()

theme: $effect on theme.resolved -> term.options.theme := paletteFor(resolved)

soft keys (interactive only):
    one horizontally scrollable row directly above the terminal   # stays visible over the keyboard
    keys: Esc, Tab, Ctrl (sticky modifier), arrows
    each --size-control-md; row does NOT wrap
    # invariant: all viewport-conditional behaviour here is reactive (MediaQuery store),
    # never window.matchMedia(...).matches read once at init

container: padding is a token; inner geometry is the character-cell exception
data-audit-id="terminal-surface" (matches the standing exemption)
```

## Step 4: Compose editor internals (`pages/compose/sync.ts`)

```ts
export function serialiseWithComments(config, previous): { text: string; doc: Document };
export function expandForDisplay(yamlText, env): ComposeConfig;
export function parsePort(entry, hostname): { url: string; display: string } | null;
export function parseEnv(text: string): Record<string, string>;      // dotenv wrapper
```

```
serialiseWithComments(config, previous):
    next := new YAML.Document(config)
    if previous: copyComments(next.contents, previous.contents)
    return { text: next.toString(), doc: next }

copyComments(target, source):
    if both are collections:
        for item of target.items:
            match := source item with equal serialised key AND equal serialised value
                     (fall back to key-only match when the value changed)
            if match:
                copy commentBefore/comment on the pair, its key, and its value
                recurse into the values
    # invariant: matching is by content, not index; deleting service A keeps
    # service B's comments attached to B

expandForDisplay(yamlText, env):
    doc := YAML.parseDocument(yamlText)
    visit every scalar string:
        replace ${VAR:-def} -> env[VAR] ?? def
                ${VAR-def}  -> VAR in env ? env[VAR] : def
                ${VAR:?m} / ${VAR?m} -> env[VAR] ?? "" (collect a warning)
                ${VAR} / $VAR -> env[VAR] ?? ""
    return doc.toJS()

parsePort(entry, hostname):
    normalise the "0.0.0.0:8080->8080/tcp" listing form to "8080:8080/tcp" first
    grammar: [host_ip ":"] host_port ["-" host_range_end] [":" container_port ...] ["/" proto]
    hostPort := first host port (or the single port when no colon)
    if not parseable: return null                       # caller renders plain text
    scheme := hostPort == "443" ? "https" : "http"
    return { url: scheme + "://" + hostname + ":" + hostPort, display: entry }
```

Table-driven tests for `parsePort` over every form in proposal 7 section 4.3.4, and comment
preservation tests: edit a value, delete a service above, add a service between commented ones.

## Step 5: The Stack page (`pages/Stack.svelte`)

The largest screen. Substructure:

```
state: ComposeEditorState per proposal 7 section 4.2

load:
    res := await request(endpoint, "stack.get", { name })    # joins the log terminal server-side
    yamlText := res.stack.composeYAML; envText := res.stack.composeENV
    parse into doc/config/expanded; mode := "view"
    notFound -> EmptyState card with a home link

two-way sync (the invariant of this screen):
    codeEditorInput (editor has focus):
        writer := "text"; debounce 250 ms:
            parsed := YAML.parseDocument(yamlText)
            if parsed.errors: schedule yamlError after 3 s grace; keep config untouched
            else: cancel grace; doc := parsed; config := parsed.toJS() (services ??= {})
                  expanded := expandForDisplay(yamlText, mergedEnv()); yamlError := null
    formInput (a form control has focus):
        writer := "form"; immediately:
            { text, doc: next } := serialiseWithComments(config, doc)
            doc := next; yamlText := text
            expanded := expandForDisplay(yamlText, mergedEnv())
    # loop breaker: each handler runs only while its own surface holds focus.
    # The code editor's value is set programmatically only from formInput, and that
    # set does not fire codeEditorInput because focus is on the form.

mergedEnv(): parseEnv(globalEnvText) overridden by parseEnv(envText)   # matches --env-file order

editors region:
    width >= 840: grid "2fr 1fr", compose | env, each with its toolbar
    width < 600:  tab pair, one visible at a time; env tab shows a dirty dot when edited
    CodeEditor.svelte wraps CodeMirror 6: yaml language, theme extension from theme.resolved,
        Escape-then-Tab keyboard escape documented in its aria-description

header row (data-audit-row="baseline"):
    h1 stack name, endpoint badge when remote, StatusChip, x-docknight url chips
    # the chip lives HERE, not in the action bar: one outline height per row below

action bar:
    availability table per proposal 7 section 4.3.7
    width >= 600: one row of --size-control-md buttons, gap --space-2; Down and Delete
                  inside a MenuButton overflow
    width < 600:  bottom app bar (replaces the nav bar on this route):
                  back affordance | primary action (Deploy / Start / Restart) | MenuButton
                  height --size-bottom-bar; stays visible when the keyboard is open
    all actions: disable the whole bar while in flight; long-running ones use timeout: 0
    Delete and Down confirm via ConfirmDialog naming the stack

services region: one ServiceCard per config.services entry (step 6)
networks region: NetworkInput bound to config plus docker.networks for the external picker

terminals region:
    progress pane: TerminalView compose-<endpoint>-<name>, hidden until first data
    log pane: TerminalView logs-<endpoint>-<name>

pollers, every 5 s while mounted, stopped on unmount:
    stack.serviceStatus and docker.stats addressed to this endpoint
    failures: keep last known values; retry next tick; no toast

guards:
    beforeLeave: dirty and edit mode -> ConfirmDialog
    beforeunload handler while dirty

managed == false -> explanation card, no editor, no actions
host offline (agents.statuses[endpoint].status == "offline") -> banner, actions disabled
```

## Step 6: `ServiceCard.svelte`

```
view mode:
    header (data-audit-row="center"): service name, StatusChip per container, MenuButton?
    body: image:tag, port chips (parsePort over expanded config; null -> plain text),
          stats when available (CPU, memory, expander for the full set)
          numeric cells: data-audit-numeric, tabular figures, end-aligned
    actions:
        width >= 600: text buttons: Shell (running/healthy only),
                      Start/Stop/Restart (multi-service stacks only)
        width < 600:  ONE MenuButton per card holding the same items (bottom sheet)
edit mode:
    fields: image, container_name, restart policy (select), depends_on (ArrayInput),
            ports/volumes/environment (ArrayInput), networks (NetworkInput slice)
    remove service behind ConfirmDialog
    every label on the card-title start edge (data-audit-column on the card body)
    edits mutate `service` (a live reference into config) -> formInput sync path fires
```

## Step 7: Dashboard, Setup, Login (`pages/`)

```
Dashboard.svelte (route /, every width):
    width < 840: StackList card first (with search)      # replaces the absent panel
    counts card: Active / Exited / Inactive from the merged store; each a filter link;
                 equal-width columns, tabular figures, data-audit-numeric
    converter card: textarea + convert button
        request("", "docker.composerize", { command })
        success -> stash yaml in shell transient state -> navigate("/compose")
        failure -> inline error under the textarea (not a toast)
    hosts card:
        row per agent: status badge, name/endpoint, [rename] [remove] (>= 600px)
                       or one MenuButton (< 600px)
        remove -> ConfirmDialog naming the URL -> agent.remove
        add form: url, username, password, optional name
            agent.add errors render inline on the form (credential test = form validation)

Setup.svelte:
    username, password, repeat (client-only check), live strength hint (same policy text)
    submit: auth.setup -> immediately session.login(same credentials) -> navigate("/")

Login.svelte:
    username, password, remember-me
    session.login -> "totp" -> swap to a single 6-digit field
        inputmode="numeric" autocomplete="one-time-code"
        resubmit with all three; failure keeps username and password
    rateLimited -> disable the form for the reported wait
    both forms: centred card --measure-form; submit reachable with the keyboard open
```

## Step 8: Terminal page, Console page

```
Terminal.svelte (/terminal/:stack/:service/:type/:endpoint?):
    name := await request(endpoint, "terminal.exec", { stack, service, shell: type })
    TerminalView interactive with the returned name
    header: stack/service breadcrumb back to the stack page

Console.svelte (/console/:endpoint?):
    enabled := await request(endpoint, "terminal.mainEnabled")
    if not enabled.enabled: EmptyState explaining the flag
    else: name := await request(endpoint, "terminal.main"); TerminalView interactive
    # the nav destination itself is hidden when disabled (Layout asks terminal.mainEnabled
    # once per generation)
```

## Step 9: Settings (`pages/Settings.svelte` + section components)

```
navigation:
    width >= 600: tab row, sections as tabs; /settings/:section
    width < 600:  /settings/<none> renders an index list (rows --size-control-lg);
                  a section renders alone with the bottom app bar back affordance

sections (each a single column --measure-settings, saving via one settings.set + toast):
    General:    primaryHostname (+ "use current host" button), trustProxy toggle
    Updates:    versions readout; checkUpdate/checkBeta/autoUpgrade toggles;
                upgrade.status readout (image or unavailability reason);
                Upgrade button -> ConfirmDialog -> upgrade.start ->
                TerminalView "upgrade" stays mounted after exit
    Appearance: locale selector (each language named in itself), theme selector
    Security:   username display; change password (current + new + repeat);
                TOTP: begin -> QR (render provisioning uri) + selectable secret ->
                      one code -> enable; disable needs password + code
                disableAuth: enable -> ConfirmDialog with password field; disable -> plain, reload
                logout button; disconnect other sessions button
    GlobalEnv:  CodeEditor over globalENV with the .env validation messages
    About:      version, latestVersion, protocolVersion, isContainer, repo link,
                the agent-key warning text
```

## Step 10: Audit attribute sweep

Walk every component built above and confirm the markup contract:

```
- data-audit-root on the Layout outlet
- data-grid-origin on the outlet and the panel
- data-audit-column on: card bodies, form field stacks, list containers, settings columns
- data-audit-row="center|baseline" on: header rows, action bars, list rows
- data-audit-numeric on: counts, ports, CPU/memory cells
- data-audit-clip where truncation is intended (stack name ellipsis in list rows)
- data-audit-id on every element named by any rule or exemption
```

## Tests

```
- sync unit tests: type YAML -> form updates; edit form -> YAML updates with comments kept;
  invalid YAML mid-typing -> form frozen, error after grace, recovery cancels it;
  no infinite loop under alternating rapid edits (bounded update count assertion)
- parsePort table; expandForDisplay defaults and warnings; mergedEnv precedence
- component tests (Playwright against fixtures):
    login incl. totp swap and rateLimited disable
    dashboard converter inline error; host add validation error inline
    stack lifecycle button availability per status (typical scenario)
    service card collapse at 390 (menu present, text buttons absent)
    editor tabs at 390 with the env dirty dot
    settings index navigation at 390
- extend the phase-7 smoke matrix to assert each screen's key element exists per cell
```

## Done checklist

- [ ] Full walkthrough against `pnpm fixtures --scenario typical` at 390x844: create, edit,
      deploy (fixture-faked), open a shell page, change settings, without touching anything
      smaller than 48px (spot-check; phase 10 proves it).
- [ ] Same walkthrough at 1280x900 with the persistent panel.
- [ ] `dense` scenario renders the wide-stack edit page without horizontal overflow at 390.
- [ ] Comment round-trip: a commented compose file survives ten form edits unchanged except
      the edited values.
- [ ] Keyboard-only pass: every action on every screen reachable and operable.
