# Frontend Screens - Spec Proposal (v2)

| Item       | Detail                                     |
|------------|--------------------------------------------|
| Author     | heavycaffeiner(Dong Hyun Kim)              |
| Created    | 2026-08-20                                 |
| Status     | **Draft** / In Review / Approved           |
| Reviewers  |                                            |
| Supersedes | docknight-7-frontend-features (2026-08-09), and absorbs the screen portions of docknight-9-mobile-accessibility (2026-08-11) |

---

## 1. Summary

Every user-facing screen: first-run setup, login, the dashboard, the stack list, the compose editor
with its service cards and YAML round trip, the terminal views, the host console, and the settings
sections. Also the one backend method that exists purely for the UI, the `docker run` to compose
converter. Every screen follows the grid, alignment, size class, and disclosure rules in proposal 6.

This is a full rewrite. Each screen now carries an explicit compact specification: what stays
visible, what moves behind an overflow or a tab, and where the primary action sits. In v1 the
compact behaviour was implied ("the layout is responsive; the target is a desktop browser") and the
result was documented in the retired proposal 9: 48 controls on the working screen at phone width,
34 of them below the fold, and functionality that disappeared entirely below 840 pixels. The
desktop-first framing is dropped; every screen is specified for compact and expanded as equals.

## 2. Background & Motivation

Proposals 0 to 5 make the server capable and proposal 6 makes the client able to talk to it and look
like one product. Three screens carry intrinsic difficulty worth naming before they are specified.

**The compose editor has to be two editors at once.** Users who know compose type YAML. Users who do
not want a form. Both means the text buffer and the structured object stay in sync in both
directions on every keystroke, without looping and without losing comments. Section 4.3.3 specifies
the loop condition and the comment-matching rule.

**What the editor shows is not what compose runs.** Ports, image tags, and URLs are routinely
parameterised through `.env`, so `${PORT}:80` in the file is `8080:80` at deploy time. Display
values come from a variable-expanded copy of the document; the file on disk keeps its variables.

**A compact working screen is a disclosure problem, not a scaling problem.** The stack page in edit
mode holds two code editors, N service cards each with actions and array editors, a network editor,
and an action bar. At 390 pixels the design question is which of those is on screen at once, not how
small each can be drawn. Every compact specification below answers that question explicitly, under
proposal 6's rule: fewer controls, never smaller ones, and everything reachable in at most two
interactions.

## 3. Goals & Non-Goals

### 3.1 Goals

- [ ] Setup and login screens, including the TOTP step.
- [ ] Dashboard: stack list on compact and medium, counts by status, `docker run` conversion, host
      management, reachable at every width.
- [ ] Stack list: search, grouping by host, collapse, live updates.
- [ ] Compose editor: YAML and `.env` editing, bidirectional structured sync, comment preservation,
      validation feedback, tabbed editors on compact.
- [ ] Service cards: add and remove, image, ports, volumes, environment, restart policy,
      dependencies, live status, statistics, per-service actions with compact collapse.
- [ ] Network editor for external and internal networks.
- [ ] Stack action bar: deploy, save draft, start, stop, restart, update, down, delete, with
      confirmation, one primary action plus overflow on compact, bottom app bar placement.
- [ ] Terminal views: progress pane, combined log pane, container shell page, host console page.
- [ ] Settings: general, updates, appearance, security, global environment, about.
- [ ] The `docker.composerize` backend method.
- [ ] Conformance with proposal 6's grid, optical alignment, and touch target rules on every screen
      at every geometry in proposal 8's matrix.

### 3.2 Non-Goals

- [ ] Editing files inside a stack other than the compose file and `.env`.
- [ ] A visual compose graph, dependency diagram, or drag-and-drop service arrangement.
- [ ] Reordering controls in array editors. Compose assigns no meaning to the order of `ports`,
      `volumes`, `environment`, `depends_on`, or `networks`; an order that matters to a reader is
      set in the YAML editor, which is always in sync.
- [ ] Image search against a registry.
- [ ] Bulk selection and bulk actions across stacks.
- [ ] Stack tags or filtering beyond the search box.

## 4. Technical Design

### 4.1 Architecture Overview

```mermaid
flowchart TB
    subgraph Routes
        SETUP[/setup/]
        HOME[//]
        NEW[/compose/]
        EDIT[/compose/:name/:endpoint?/]
        TERM[/terminal/:stack/:service/:type/]
        CONS[/console/:endpoint?/]
        SET[/settings/:section/]
    end

    subgraph "Shared components"
        SL[StackList]
        SC[ServiceCard]
        TERMV[TerminalView]
        AI[ArrayInput]
        NI[NetworkInput]
        CONF[ConfirmDialog]
        ST[StatusChip]
        MB[MenuButton]
    end

    subgraph "Compose editor internals"
        DOC[YAML document<br/>text and object, two-way]
        ENV[env parse and expand]
        VAL[validation]
    end

    HOME --> SL
    EDIT --> SL
    EDIT --> DOC
    DOC --> SC
    DOC --> NI
    SC --> AI
    SC --> ST
    SC --> MB
    EDIT --> TERMV
    TERM --> TERMV
    CONS --> TERMV
    ENV --> SC
    DOC --> VAL
```

### 4.2 Data Model Changes

No server-side change. One compose extension key is defined:

```yaml
x-docknight:
  urls:
    - https://photos.example.com
```

`x-docknight.urls` renders as link chips at the top of a stack page. Extension fields beginning with
`x-` are reserved by the compose specification for exactly this and are ignored by `docker compose`.

Client-side view state, none of it persisted:

```ts
interface ComposeEditorState {
    mode: "view" | "edit";
    yamlText: string;             // the editor buffer
    envText: string;
    doc: Document | null;         // yaml AST, source of comments
    config: ComposeConfig;        // structured view bound to the form controls
    expanded: ComposeConfig;      // config after env expansion, used for links and ports
    yamlError: string | null;
    writer: "text" | "form" | null;   // which side last wrote, see 4.3.3
    dirty: boolean;
}
```

### 4.3 Core Logic

#### 4.3.1 Setup and login

Setup is shown when the server emits the `setup` event. One form: username, password, repeat
password. The repeat is checked in the browser only. Password strength is evaluated live against the
same policy the server enforces, shown as a hint rather than a blocking gate until submit.

`auth.setup` returns no token, so on success the screen immediately calls `login` with the
credentials just chosen and lands on the home route.

Login is username, password, and a remember-me checkbox deciding between `localStorage` and
`sessionStorage`. When `auth.login` answers `{ totpRequired: true }` the form swaps to a single
six-digit field, `inputmode="numeric"` and `autocomplete="one-time-code"`, and resubmits with all
three values. Failure returns to the code field with the message and does not clear the username or
password.

Both screens are a single centred card of `--measure-form`, padded `--space-6`, with `--space-4`
between fields and `--space-6` above the submit button. Both carry a text field, so both are in the
keyboard-geometry cells of proposal 8's matrix; the submit button must stay in the visible band
while the keyboard is open, which the shell's viewport handling provides.

#### 4.3.2 Dashboard

Reachable at `/` at every width; there is no width at which any of its regions ceases to exist.

Regions, each a card separated by `--space-6`:

- **Stack list (compact and medium only).** At these widths there is no persistent side panel, so
  the stack list is the first card, carrying the search field in its header. Selecting a stack
  navigates to it. At expanded width this card is not rendered, because the persistent panel beside
  the outlet holds the same component.
- **Status counts.** Active, exited, inactive, computed from the merged stack store across every
  host. Each count is a link that filters the stack list. Numbers use tabular figures and are
  centred within equal-width columns.
- **`docker run` conversion.** A textarea, a convert button, and on success a navigation to
  `/compose` with the produced YAML preloaded.
- **Hosts.** One row per configured host: status badge, display name or endpoint, a rename control,
  and a remove control behind a confirmation naming the URL. On compact the rename and remove
  controls collapse into one overflow menu per row. An add form takes URL, username, password, and
  an optional name, and reports the credential test's result inline. Rows are `--size-control-lg`
  tall with `--space-2` between them; every badge shares one start edge.

#### 4.3.3 Compose editor, the two-way sync

The one piece of the frontend with a real invariant, specified as a state machine rather than
reactive watchers.

```
The editor holds two representations of the same compose file:
    yamlText   the character buffer the user types into
    config     the structured object the form controls bind to

Exactly one of them is authoritative at any moment, tracked by `writer`.

On editor input (the code editor has focus):
    writer := "text"
    debounce 250 ms, then:
        parsed := YAML.parseDocument(yamlText)
        if parsed.errors is non-empty:
            yamlError := the first error's message           # after a 3 s grace, see below
            leave config untouched                            # the form keeps the last good state
        else:
            doc       := parsed
            config    := doc.toJS() with services defaulted to {}
            expanded  := expand(yamlText, parse(envText))
            yamlError := null

On form input (a form control has focus):
    writer := "form"
    immediately:
        next := new YAML.Document(config)
        copyComments(next, doc)                               # match nodes by key and value
        doc      := next
        yamlText := next.toString()
        expanded := expand(yamlText, parse(envText))

Guard: a write from one side never triggers the other side's handler, because each handler
runs only while its own surface holds focus. That focus condition is the loop breaker and is
the reason the editor tracks focus explicitly rather than relying on value equality checks.
Blur does not flush; the last keystroke has already been applied.
```

The three second grace before showing a YAML error exists because a half-typed line is invalid on
nearly every keystroke, and a flickering error message is worse than none. The grace is cancelled as
soon as the document parses again.

`copyComments` walks both documents in parallel, matching an item to its source by comparing the
serialised key and value, and copies `comment` and `commentBefore` on the node, its key, and its
value, recursing into nested collections. Matching by content rather than by position keeps a
comment attached to its service after a service above it is deleted.

#### 4.3.4 Environment expansion

Port links and URL chips show what the container actually publishes, so displayed values come from
expanded YAML, not raw text:

```
expand(yamlText, env):
    doc := YAML.parseDocument(yamlText)
    for every scalar string value in the document:
        replace ${VAR}, $VAR, ${VAR:-default}, ${VAR-default} using env
        an unset variable with no default expands to the empty string
        ${VAR:?message} and ${VAR?message} expand to the empty string and are noted as a warning
    return doc.toJS()
```

`env` is the parsed `.env` buffer merged over the parsed global environment file, matching the
`--env-file` precedence the server applies. The expansion is display only.

Port parsing handles every form compose accepts: `"3000"`, `"3000-3005"`, `"8000:8000"`,
`"9090-9091:8080-8081"`, `"127.0.0.1:8001:8001"`, `"6060:6060/udp"`, and the
`"0.0.0.0:8080->8080/tcp"` form that container listings print. The host port is taken, or the first
of a host range; the protocol maps to `https` for 443 and `http` otherwise; the host comes from
`primaryHostname`. A port that fails to parse renders as plain text, never as a broken link.

#### 4.3.5 The editors

Two `CodeEditor` panes, compose YAML and `.env`, each with a small toolbar.

- **Expanded (1280 and up in practice, the `2fr 1fr` grid from 840):** both editors side by side.
- **Compact:** a two-tab container showing one editor at a time. Same `CodeEditor`, same toolbar,
  one container that resolves to tabs or a grid. This removes roughly 400 pixels of scroll and half
  of the toolbar buttons from the viewport at once.

The `.env` tab shows a dirty dot when its buffer differs from the loaded state, so an edit hidden
behind an unselected tab cannot be forgotten.

#### 4.3.6 Service cards

One card per entry in `config.services`, rendered from the structured object so edits flow through
the sync. Card padding is `--space-6`, gap between cards `--space-4`, chips within a row separated
by `--space-2`. On compact, cards are full-bleed per proposal 6's rule.

**View mode** shows the image with its tag, a status chip, port chips as links, and, when statistics
are available, CPU and memory per container with an expander for the full set. Actions:

- **Expanded:** a shell link when the service is running or healthy, and start, stop, restart when
  the stack has more than one service.
- **Compact:** one overflow menu per card holding the same items, rendered as a bottom sheet per
  proposal 6's `MenuButton`. The header keeps only the service name, the status chip, and the menu
  button.

**Edit mode** exposes image, ports, volumes, environment variables, restart policy, `depends_on`,
`container_name`, networks, and a remove control behind a confirmation. Ports, volumes, environment
and dependencies use a shared `ArrayInput`: one row per entry at `--size-control-md`, add and
remove, and a placeholder showing the expected shape such as `HOST:CONTAINER`. There are no reorder
controls at any width; the YAML editor is where order is expressed. Every field label sits on the
same start edge as the card title.

Status vocabulary, from the server's per-service result: `running`, `healthy`, `unhealthy`,
`starting`, `exited`, `created`, `paused`, `restarting`. Each maps to a chip colour and the chip
always shows the word.

Service status and statistics are polled by the stack page every five seconds while mounted; polling
stops on navigation away. Both requests are addressed to the stack's endpoint.

#### 4.3.7 Stack page actions

| Action     | Availability              | Behaviour                                                                  |
|------------|---------------------------|-------------------------------------------------------------------------------|
| Deploy     | edit mode                 | `stack.deploy`; on success leaves edit mode and navigates to the stack URL    |
| Save draft | edit mode                 | `stack.save`; writes files without running anything                           |
| Edit       | view mode                 | Enters edit mode                                                              |
| Discard    | edit mode, existing stack | Reloads from the server and leaves edit mode                                  |
| Start      | view mode, not running    | `stack.start`                                                                 |
| Restart    | view mode, running        | `stack.restart`                                                               |
| Stop       | view mode, running        | `stack.stop`                                                                  |
| Update     | view mode                 | `stack.update`                                                                |
| Down       | view mode, overflow menu  | `stack.down`                                                                  |
| Delete     | view mode, overflow menu  | Confirmation naming the stack, then `stack.delete`, then navigate home        |

Placement:

- **Expanded:** one row of `--size-control-md` buttons with `--space-2` between them and `--space-6`
  below, at the top of the page. The status chip does not sit in this row; it sits on the `h1` row
  beside the endpoint badge, so the action row holds only same-height controls and the text column
  keeps one ink edge.
- **Compact:** the bar becomes the bottom app bar defined in proposal 6, replacing the bottom
  navigation bar on this screen. It carries a back affordance, the single primary action (Deploy in
  edit mode; Start or Restart in view mode, whichever is available), and an overflow menu holding
  everything else. The primary action is in the thumb zone instead of at the top of a multi-screen
  scroll.

Every action disables the whole bar while in flight. Long-running actions pass `timeout: 0` per
proposal 1 and rely on the progress terminal for feedback.

Leaving the page in edit mode with unsaved changes triggers the router's `beforeLeave` confirmation;
a `beforeunload` handler covers a browser close or reload.

A stack the server reports with `managed: false` renders a short explanation instead of the editor
and offers no actions.

#### 4.3.8 Terminal views

One `TerminalView` component wraps the renderer, used in four places.

```
mount:
    build the renderer with the theme palette for the resolved scheme and a font stack
      of JetBrains Mono then the system monospace
    attach the fit addon and the web-links addon
    res := await request(endpoint, "terminal.join", { terminal })
    write res.buffer                              # scrollback replay
    subscribe to terminalWrite and terminalExit for this terminal name
    observe the container with ResizeObserver; on change fit, then send terminal.resize

unmount:
    request terminal.leave, unsubscribe, dispose the renderer

on reconnect (keyed on connection.generation):
    re-run the join sequence without the leave, so the pane refills from the server's buffer
```

The pane's outer container is padded with a token and its height is a multiple of the terminal's
line height, keeping the surrounding layout on the grid even though the character cells are not
grid-aligned (proposal 6's second exception).

The four uses:

- Progress pane on the stack page, `compose-<endpoint>-<stack>`, hidden until it first receives
  data, read-only.
- Combined log pane on the stack page, `logs-<endpoint>-<stack>`, read-only, joined by `stack.get`.
- Container shell at `/terminal/:stack/:service/:type`, interactive. `type` is the shell name,
  validated server-side against the allowlist. Keystrokes go to `terminal.input`.
- Host console at `/console/:endpoint?`, interactive, reachable only when `terminal.mainEnabled`
  answers true; the navigation entry is hidden otherwise.

Interactive terminal pages carry a soft-key row (Escape, Tab, Ctrl, arrows) for keyboards that lack
them. Soft keys are `--size-control-md` targets, laid out in one horizontally scrollable row rather
than wrapping, and the row sits directly above the terminal so it stays visible with the virtual
keyboard open. Wrap behaviour and any other media-query-derived state is computed reactively, not
read once at mount, so a window resized across a breakpoint behaves as if it had started there.

The renderer's palette is rebuilt when the resolved theme changes, since it takes colours as values
rather than CSS custom properties.

#### 4.3.9 Stack list

One component used in two placements: the persistent panel at expanded width, the first Dashboard
card at compact and medium.

- A search field in the header filters on the stack name, case-insensitive, substring.
- Each row is `--size-control-lg` tall, padded `--space-3` inline, and shows the status chip, the
  name, and the host name when grouping is active. Chips share one start edge across rows so the
  names form a single ink column.
- Rows group by host when more than one host is configured; groups are collapsible, collapsed state
  in component state, not storage. With one host, no group headers.
- An empty list shows a link to create the first stack.
- Rows update in place from `stackList` events; the list never refetches on its own.

#### 4.3.10 Settings

| Section    | Contents                                                                                                                        |
|------------|------------------------------------------------------------------------------------------------------------------------------------|
| General    | Primary hostname with an auto-fill button reading `location.hostname`; trust proxy toggle                                          |
| Updates    | Running and latest version; update check, beta and automatic upgrade toggles; the resolved image and an upgrade button, or the reason the upgrade is unavailable |
| Appearance | Language selector listing every available locale by its own name; theme selector light, dark, system                               |
| Security   | Current user, change password, TOTP enrolment and removal, disable and enable authentication, log out                              |
| Global env | A code editor over the global environment file with the same validation as `.env`                                                  |
| About      | Product version, latest available version, protocol version, container flag, repository link, and the note that removing the agent key file makes stored host credentials unrecoverable |

Section navigation: tabs on medium and expanded. On compact the six tabs would wrap into two rows of
pills before any content, so the sections render as a single-column index list of `--size-control-lg`
rows, and selecting one navigates to `/settings/:section` with the bottom app bar carrying the back
affordance.

Every section is a single column of `--measure-settings`. Field labels sit above their controls with
`--space-2` between them, `--space-4` between fields, `--space-8` between subsections.

TOTP enrolment renders the provisioning URI as a QR code and shows the base32 secret as selectable
text, then asks for one code to confirm. Disabling asks for the password and a current code
together.

Disabling authentication asks for the current password inside the confirmation dialog and states
plainly what it does. Re-enabling asks for nothing and reloads the page. These dialogs carry a
password field, so they are subject to the keyboard-open dialog placement rule in proposal 6.

Upgrading asks for confirmation, saying that Docknight is unreachable for a few seconds and that the
browser reconnects on its own. The pull output streams into a terminal view below the button, which
stays mounted after the process exits.

Every settings section saves through one `settings.set` call and reports the outcome as a toast.

#### 4.3.11 Docker run conversion

The only backend method this proposal owns.

```
docker.composerize({ command }):
    require authentication
    reject a command longer than 8 KiB
    yaml := composerize(command, "", "latest")
    drop the first line, which is the generated `name:` key
    return { yaml }
```

The converter parses a command line with dozens of flags, which is why it is a dependency. It runs
on the server so the parser stays out of the initial bundle. It never executes the command.

On success the dashboard stores the result in the shell's transient state and navigates to
`/compose`, where the new-stack screen picks it up as the initial buffer.

#### 4.3.12 Conformance obligations

Every screen is built against proposal 6's rules and verified by proposal 8. The concrete
obligations:

- No raw pixel value in any component stylesheet; tokens only, enforced by stylelint.
- One ink column per region: glyph edges, not just box edges, verified by `glyph-edge`.
- Numeric values end-aligned with tabular figures.
- Control heights from the size tokens; interactive elements in one row share one height token.
- Spacing from the container's `gap`, never a margin on the child.
- Under a coarse pointer every target is at least 48 by 48 with the size-scaled gap, verified by
  `touch-target`.
- Every element a rule addresses carries `data-audit-id`; columns, rows, and numeric cells carry
  the attributes the auditor reads.
- No screen state is unreachable at any geometry in the matrix, including keyboard-open and
  landscape-phone cells.
- Media-query state used in component logic is reactive, never sampled once at mount.

## 5. API Design

### 5-1. New / Modified

One new method, not routable:

```ts
/**
 * Convert a `docker run ...` command line into compose YAML.
 * The command is parsed, never executed. Input is capped at 8 KiB.
 */
"docker.composerize": {
    params: { command: string };
    result: { yaml: string };
}
```

Component contracts used across screens:

```svelte
<!-- StackList.svelte -->
<!--
  Renders every stack from the merged store, grouped by host when more than one is
  configured. `filter` narrows by substring on the stack name. Rows navigate directly.
-->
<StackList filter={string} />
```

```svelte
<!-- ServiceCard.svelte -->
<!--
  One compose service. `service` is a live reference into the editor's config object, so
  edits mutate the document and flow through the YAML sync. `status` and `stats` come from
  the stack page's pollers and are absent in edit mode. Actions collapse into an overflow
  menu at compact width.
-->
<ServiceCard
    name={string}
    bind:service={ComposeService}
    editable={boolean}
    status={ServiceInstance[] | undefined}
    stats={DockerStat[] | undefined}
    onstart={(name: string) => void}
    onstop={(name: string) => void}
    onrestart={(name: string) => void}
    onremove={(name: string) => void}
/>
```

```svelte
<!-- TerminalView.svelte -->
<!--
  Joins `terminal` on `endpoint`, replays its buffer, streams output, and reports resizes.
  `interactive` enables keyboard input and the soft-key row. `rows` sets the initial height
  before the first fit.
-->
<TerminalView endpoint={string} terminal={string} interactive={boolean} rows={number} />
```

```ts
// pages/compose/sync.ts

/**
 * Reserialise `config` to YAML while restoring the comments held in `previous`.
 * Comments are matched by node content rather than by position, so an insertion or a
 * deletion elsewhere in the document does not move them.
 */
export function serialiseWithComments(config: ComposeConfig, previous: Document | null): {
    text: string;
    doc: Document;
};

/**
 * Expand ${VAR} style references in every scalar of `yamlText` using `env`, and return
 * the resulting structure. Display only; the file on disk is never rewritten.
 */
export function expandForDisplay(yamlText: string, env: Record<string, string>): ComposeConfig;

/**
 * Parse one compose port entry into a link target and a display label.
 * Returns null when the entry does not parse, in which case the caller renders plain text.
 */
export function parsePort(entry: string, hostname: string): { url: string; display: string } | null;
```

### 5-2. Error Handling

| Situation                                     | Presentation                                                                                                |
|-----------------------------------------------|----------------------------------------------------------------------------------------------------------------|
| YAML fails to parse while typing              | Message under the editor after a 3 s grace; the form keeps the last valid state; deploy and save disabled      |
| `services` is missing or not a mapping        | Same message path; deploy is refused before the request is sent                                                |
| `.env` line without `=`                       | Message under the env editor naming the line number                                                            |
| `stack.deploy` or `stack.save` rejects        | Error toast keyed on the server's i18n key; edit mode is retained with contents intact                         |
| A compose command exits non-zero              | Error toast, and the progress pane is scrolled into view since it holds the real output                        |
| Stack not found on load                       | An empty-state card with a link back home, not a toast on a blank page                                         |
| Statistics or service status request fails    | Silently retried on the next tick; the card shows the last known values or none                                |
| A managed host goes offline with its page open | Banner on the page naming the host; actions disabled until it returns                                          |
| `docker.composerize` rejects                  | Error shown inline under the textarea, not as a toast                                                          |
| Terminal join for a name that does not exist  | Empty pane, no error; the terminal appears once the command starts                                              |

## 6. Implementation Plan

### 6-1. Milestones

| Phase    | Task                                                                                                | Estimated Duration | Owner          |
|----------|---------------------------------------------------------------------------------------------------------|--------------------|----------------|
| Phase 1  | Setup and login screens including the TOTP step and keyboard-open verification                           | TBD                | heavycaffeiner |
| Phase 2  | `StatusChip`, `ConfirmDialog` with keyboard-aware placement, `ArrayInput`, empty-state card              | TBD                | heavycaffeiner |
| Phase 3  | `StackList` with search, host grouping, collapse, and both placements                                    | TBD                | heavycaffeiner |
| Phase 4  | `TerminalView`: join, replay, resize, input, theme rebinding, soft-key row                               | TBD                | heavycaffeiner |
| Phase 5  | Compose editor shell: code editors, the tab pair on compact, the two-way sync, comment preservation      | TBD                | heavycaffeiner |
| Phase 6  | `expandForDisplay`, `parsePort`, URL and port chips, with a port parsing test table                      | TBD                | heavycaffeiner |
| Phase 7  | `ServiceCard` view mode: status, ports, statistics, per-service actions with compact collapse            | TBD                | heavycaffeiner |
| Phase 8  | `ServiceCard` edit mode: image, ports, volumes, environment, restart policy, dependencies, removal       | TBD                | heavycaffeiner |
| Phase 9  | `NetworkInput`, the stack action bar with the compact bottom app bar, confirmations, leave guards        | TBD                | heavycaffeiner |
| Phase 10 | Container terminal page and host console page                                                            | TBD                | heavycaffeiner |
| Phase 11 | Dashboard: stack list card, counts, host panel, `docker.composerize` method and its form                 | TBD                | heavycaffeiner |
| Phase 12 | Settings: sections, compact index navigation, security with TOTP and QR, global env, about               | TBD                | heavycaffeiner |
| Phase 13 | Conformance pass across every screen and every matrix geometry, using the development overlay            | TBD                | heavycaffeiner |
| Phase 14 | Accessibility pass against proposal 6's rules, plus a keyboard-only walkthrough of every screen          | TBD                | heavycaffeiner |

Phases 1 to 4 depend on proposal 6 Phase 10. Phases 5 to 9 depend on proposal 3. Phase 10 depends on
proposal 4. Phase 12 depends on proposal 2 Phase 7. Phase 13 depends on proposal 8's matrix being in
place, which is why proposal 8 Phases 1 to 4 land before the first screen.

### 6-2. Dependencies

| Package                                     | Purpose                              | Why not the standard library                                                     |
|---------------------------------------------|--------------------------------------|-------------------------------------------------------------------------------------|
| `@xterm/xterm`                              | Terminal renderer                    | A VT sequence interpreter with a performant renderer is not something to rewrite    |
| `@xterm/addon-fit`                          | Fit the renderer to its container    | Part of the same project                                                            |
| `@xterm/addon-web-links`                    | Make URLs in output clickable        | Part of the same project                                                            |
| `codemirror` 6 with `@codemirror/lang-yaml` | YAML editing with syntax highlighting | A syntax-aware editor with selection, undo, and large-document performance         |
| `yaml`                                      | Document round trip on the client    | Already a backend dependency; the client needs the same comment-preserving AST      |
| `composerize`                               | `docker run` parsing, backend only   | Parsing the full docker run flag surface is a well-known, tedious solved problem    |
| `dotenv`                                    | Parse `.env` buffers                 | Quoting, escapes, and multi-line values have real edge cases                        |
| `@fontsource/jetbrains-mono`                | Self-hosted monospace face           | No external font fetch, and terminal columns must align                             |
| A QR renderer                               | TOTP provisioning code               | Reed-Solomon error correction and version selection are not worth reimplementing    |

Icons are inline SVG at the sizes defined in proposal 6.

Internal dependencies: proposal 6 for the shell, router, stores, i18n, theme, viewport handling, and
design tokens. Proposals 2 to 5 for every method these screens call. Proposal 8 for the matrix that
gates the conformance phases.

## 7. References

- Compose extension fields, the basis for `x-docknight`: https://github.com/compose-spec/compose-spec/blob/main/11-extension.md
- Compose ports short syntax: https://github.com/compose-spec/compose-spec/blob/main/05-services.md#ports
- Compose variable interpolation: https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/
- Compose environment file precedence: https://docs.docker.com/compose/how-tos/environment-variables/envvars-precedence/
- xterm.js: https://github.com/xtermjs/xterm.js
- CodeMirror 6: https://codemirror.net/docs/
- `yaml` package document API, comments and round trip: https://eemeli.org/yaml/#comments
- composerize: https://github.com/composerize/composerize
- Key URI format, for the TOTP QR payload: https://github.com/google/google-authenticator/wiki/Key-Uri-Format
- Material 3 bottom app bar: https://m3.material.io/components/bottom-app-bar/overview
- Companion proposals: `docknight-2-auth`, `docknight-3-stack`, `docknight-4-terminal`,
  `docknight-5-agent`, `docknight-6-frontend-shell`, `docknight-8-design-verification`
