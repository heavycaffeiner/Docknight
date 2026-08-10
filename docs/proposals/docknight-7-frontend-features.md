# Frontend Screens - Spec Proposal

| Item       | Detail                           |
|------------|----------------------------------|
| Author     | heavycaffeiner(Dong Hyun Kim)    |
| Created    | 2026-08-09                       |
| Status     | **Draft** / In Review / Approved |
| Reviewers  |                                  |

---

## 1. Summary

This proposal specifies every user-facing screen: first-run setup, login, the dashboard, the stack
list, the compose editor with its service cards and YAML round trip, the terminal views, the host
console, and the five settings sections. It also owns the one backend method that exists purely for
the UI, the `docker run` to compose converter. Every screen follows the 4 pixel grid and the alignment
rules defined in proposal 6.

## 2. Background & Motivation

Proposals 0 to 5 make the server capable and proposal 6 makes the client able to talk to it and look
like one product. This is where the application becomes usable, and three screens carry enough
intrinsic difficulty to be worth naming before they are specified.

**The compose editor has to be two editors at once.** Users who know compose want to type YAML.
Users who do not want a form with fields for image, ports, and volumes. Offering only one loses half
the audience, and offering both means the text buffer and the structured object must stay in sync in
both directions on every keystroke. That is a real invariant with a real failure mode: a naive
implementation loops, each side rewriting the other forever. It also has to preserve comments, because
a compose file that loses its comments the first time someone clicks a checkbox is a file people stop
letting the tool touch. Section 4.3.3 specifies the loop condition and the comment-matching rule
rather than leaving them to be discovered.

**What the editor shows is not what compose runs.** Ports, image tags, and URLs are routinely
parameterised through `.env`, so `${PORT}:80` in the file is `8080:80` at deploy time. A port chip
built from the raw text is a dead link for most real stacks. Display values therefore come from a
variable-expanded copy of the document, while the file on disk keeps its variables.

**The stack list is navigation, not content.** It is on screen at all times, it updates from server
events while the user is doing something else, and once more than one host is configured it has to
group without becoming a tree the user must manage. Its behaviour is specified as part of the shell
experience rather than as one more list component.

## 3. Goals & Non-Goals

### 3.1 Goals

- [ ] Setup and login screens, including the TOTP step.
- [ ] Dashboard: counts by status, `docker run` conversion, host management panel.
- [ ] Stack list: search, grouping by host, collapse, live updates.
- [ ] Compose editor: YAML and `.env` editing, bidirectional structured sync, comment preservation,
      validation feedback.
- [ ] Service cards: add and remove, image, ports, volumes, environment, restart policy, dependencies,
      live status, statistics, per-service start, stop, restart, and shell.
- [ ] Network editor for external and internal networks.
- [ ] Stack action bar: deploy, save draft, start, stop, restart, update, down, delete, with
      confirmation.
- [ ] Terminal views: progress pane, combined log pane, container shell page, host console page.
- [ ] Settings: general, updates, appearance, security, global environment, about.
- [ ] The `docker.composerize` backend method.
- [ ] Conformance with the 4 pixel grid and alignment rules on every screen.

### 3.2 Non-Goals

- [ ] Editing files inside a stack other than the compose file and `.env`.
- [ ] A visual compose graph, dependency diagram, or drag-and-drop service arrangement.
- [ ] Image search against a registry.
- [ ] Bulk selection and bulk actions across stacks.
- [ ] Stack tags or filtering by anything other than the search box.
- [ ] Mobile-first redesign. The layout is responsive; the target is a desktop browser.

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

Setup is shown when the server emits the `setup` event. One form: username, password, repeat password.
The repeat is checked in the browser only; the server never receives it. Password strength is
evaluated live against the same policy the server enforces, shown as a hint rather than as a blocking
gate until submit.

`auth.setup` returns no token, so on success the screen immediately calls `login` with the credentials
just chosen and lands on the home route. The user is never shown a login form for the account they
created one second earlier.

Login is username, password, and a remember-me checkbox that decides between `localStorage` and
`sessionStorage`. When `auth.login` answers `{ totpRequired: true }` the form swaps to a single
six-digit field, `inputmode="numeric"` and `autocomplete="one-time-code"`, and resubmits with all
three values. Failure returns to the code field with the message and does not clear the username or
password, so a mistyped code costs one field.

Both screens are a single centred card of `--measure-form`, padded `--space-6`, with `--space-4`
between fields and `--space-6` above the submit button.

#### 4.3.2 Dashboard

Three regions, each a card separated by `--space-6`:

- Status counts. Active, exited, inactive, computed from the merged stack store across every host.
  Each count is a link that filters the stack list. Numbers use tabular figures and are centred within
  equal-width columns so they do not shift as values change.
- `docker run` conversion. A textarea, a convert button, and on success a navigation to `/compose`
  with the produced YAML preloaded.
- Hosts. One row per configured host showing the status badge, the display name or the endpoint, a
  rename control, and a remove control behind a confirmation naming the URL. An add form takes URL,
  username, password, and an optional name, and reports the credential test's result inline rather
  than as a toast, because it is a form validation result. Rows are `--size-control-lg` tall with
  `--space-2` between them, and every badge shares one start edge.

#### 4.3.3 Compose editor, the two-way sync

This is the one piece of the frontend with a real invariant, so it is specified as a state machine
rather than as reactive watchers.

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

The three second grace before showing a YAML error exists because a half-typed line is invalid for a
moment on nearly every keystroke, and an error message that flickers is worse than none. The grace is
cancelled as soon as the document parses again.

`copyComments` walks both documents in parallel, matching an item to its source by comparing the
serialised key and value, and copies `comment` and `commentBefore` on the node, on its key, and on its
value, recursing into nested collections. Matching by content rather than by position is what keeps a
comment attached to its service after a service above it is deleted.

#### 4.3.4 Environment expansion

Port links and URL chips must show what the container actually publishes, so the displayed values come
from expanded YAML, not from the raw text:

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
`--env-file` precedence the server applies. The expansion is display only; the file on disk keeps its
variables.

Port parsing handles every form compose accepts: `"3000"`, `"3000-3005"`, `"8000:8000"`,
`"9090-9091:8080-8081"`, `"127.0.0.1:8001:8001"`, `"6060:6060/udp"`, and the
`"0.0.0.0:8080->8080/tcp"` form that container listings print. The host port is taken, or the first of
a host range, the protocol maps to `https` for 443 and `http` otherwise, and the host comes from the
stack's `primaryHostname`. A port that fails to parse renders as plain text, never as a broken link.

#### 4.3.5 Service cards

One card per entry in `config.services`, rendered from the structured object so that edits flow
through the sync in 4.3.3. Card padding is `--space-6`, the gap between cards is `--space-4`, and
chips within a row are separated by `--space-2`.

View mode shows the image with its tag, a status chip, port chips as links, and, when statistics are
available, CPU and memory for each container of that service with an expander for the full set of
counters. Buttons appear conditionally: a shell link when the service is running or healthy, and
start, stop, restart when the stack has more than one service, since with a single service the stack
buttons already do the job.

Edit mode exposes image, ports, volumes, environment variables, restart policy, `depends_on`,
`container_name`, networks, and a remove control behind a confirmation. Ports, volumes, environment
and dependencies use a shared array editor: one row per entry at `--size-control-md`, add, remove,
reorder, and a placeholder showing the expected shape such as `HOST:CONTAINER`. Every field label sits
on the same start edge as the card title.

Status vocabulary, taken from the server's per-service result, is `running`, `healthy`, `unhealthy`,
`starting`, `exited`, `created`, `paused`, and `restarting`. Each maps to a chip colour and, because
colour alone never carries meaning, the chip always shows the word.

Service status and statistics are polled by the stack page every five seconds while it is mounted, and
the polling stops on navigation away. Both requests are addressed to the stack's endpoint.

#### 4.3.6 Stack page actions

| Action     | Availability              | Behaviour                                                                  |
|------------|---------------------------|-----------------------------------------------------------------------------|
| Deploy     | edit mode                 | `stack.deploy`; on success leaves edit mode and navigates to the stack URL  |
| Save draft | edit mode                 | `stack.save`; writes files without running anything                         |
| Edit       | view mode                 | Enters edit mode                                                            |
| Discard    | edit mode, existing stack | Reloads from the server and leaves edit mode                                |
| Start      | view mode, not running    | `stack.start`                                                               |
| Restart    | view mode, running        | `stack.restart`                                                             |
| Stop       | view mode, running        | `stack.stop`                                                                |
| Update     | view mode                 | `stack.update`                                                              |
| Down       | view mode, overflow menu  | `stack.down`                                                                |
| Delete     | view mode                 | Confirmation naming the stack, then `stack.delete`, then navigate home      |

The bar is one row of `--size-control-md` buttons with `--space-2` between them and `--space-6` below.
Every action disables the whole bar while in flight. Long-running actions pass `timeout: 0` per
proposal 1 and rely on the progress terminal for feedback, so a ten minute image pull does not produce
a spurious timeout.

Leaving the page in edit mode with unsaved changes triggers the router's `beforeLeave` confirmation,
and a `beforeunload` handler covers a browser close or reload.

A stack the server reports with `managed: false`, meaning it is deployed but has no directory under
the stacks directory, renders a short explanation instead of the editor and offers no actions.

#### 4.3.7 Terminal views

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

on reconnect (proposal 6 clears stores and re-authenticates):
    re-run the mount sequence, so the pane refills from the server's buffer
```

The pane's outer container is padded with a token and its height is a multiple of the terminal's line
height, which keeps the surrounding layout on the grid even though the character cells themselves are
not grid-aligned. This is the second documented exception in proposal 6.

The four uses:

- Progress pane on the stack page, `compose-<endpoint>-<stack>`, hidden until it first receives data,
  read-only.
- Combined log pane on the stack page, `logs-<endpoint>-<stack>`, read-only, joined by `stack.get`.
- Container shell at `/terminal/:stack/:service/:type`, interactive. `type` is the shell name, which
  the server validates against its allowlist. Keystrokes go to `terminal.input`.
- Host console at `/console/:endpoint?`, interactive, reachable only when `terminal.mainEnabled`
  answers true; the navigation entry is hidden otherwise.

The renderer's palette is rebuilt when the resolved theme changes, since it takes colours as values
rather than as CSS custom properties.

#### 4.3.8 Stack list

A persistent panel: a search field, then rows grouped by host when more than one host is configured.

- Search filters on the stack name, case-insensitive, substring.
- Each row is `--size-control-lg` tall, padded `--space-3` inline, and shows the status chip, the
  name, and the host name when grouping is active. Chips share one start edge across every row so the
  names form a single column.
- Groups are collapsible and their collapsed state lives in component state, not in storage.
- With exactly one host the group headers are not rendered at all.
- An empty list shows a link to create the first stack.
- Rows update in place from `stackList` events; the list never refetches on its own.

#### 4.3.9 Settings

| Section     | Contents                                                                                                                                  |
|-------------|--------------------------------------------------------------------------------------------------------------------------------------------|
| General     | Primary hostname with an auto-fill button reading `location.hostname`; trust proxy toggle                                                   |
| Updates     | Running and latest version; update check, beta check and automatic upgrade toggles; the resolved image and an upgrade button, or the reason the upgrade is unavailable here |
| Appearance  | Language selector listing every available locale by its own name; theme selector light, dark, system                                        |
| Security    | Current user, change password, TOTP enrolment and removal, disable and enable authentication, log out                                       |
| Global env  | A code editor over the global environment file with the same validation as `.env`                                                           |
| About       | Product version, the latest available version when the check reports one newer, protocol version, whether running in a container, a link to the repository, and a note that removing the agent key file makes stored host credentials unrecoverable |

Every section is a single column of `--measure-settings`. Field labels sit above their controls with
`--space-2` between them, `--space-4` between fields, and `--space-8` between subsections.

TOTP enrolment renders the provisioning URI as a QR code and shows the base32 secret as selectable
text for manual entry, then asks for one code to confirm. Disabling asks for the password and a
current code together.

Disabling authentication asks for the current password inside the confirmation dialog and states in
plain terms what it does. Re-enabling asks for nothing and reloads the page.

Upgrading asks for confirmation, saying that Docknight is unreachable for a few seconds while the
container is replaced and that the browser reconnects on its own. The pull output streams into a
terminal view below the button, which stays mounted after the process exits so the last lines remain
readable. The four toggles in this section save together with the hostname field.

Every settings section saves through one `settings.set` call and reports the outcome as a toast.

#### 4.3.10 Docker run conversion

The only backend method this proposal owns.

```
docker.composerize({ command }):
    require authentication
    reject a command longer than 8 KiB
    yaml := composerize(command, "", "latest")
    drop the first line, which is the generated `name:` key
    return { yaml }
```

The converter parses a command line with dozens of flags, which is why it is a dependency rather than
hand-written. It runs on the server so the parser stays out of the initial bundle. It never executes
the command; it only parses it.

On success the dashboard stores the result in the shell's transient state and navigates to
`/compose`, where the new-stack screen picks it up as the initial buffer.

#### 4.3.11 Grid conformance

Every screen in this proposal is built against proposal 6's rules and is verified by the toolchain in
`docknight-8-design-verification`, which also defines the `data-audit-*` attributes each component
carries. The concrete obligations:

- No raw pixel value appears in any component stylesheet. Spacing, sizes and radii come from tokens,
  which stylelint enforces.
- Every column in a screen shares one inline-start edge, including card titles, field labels, and the
  chips that lead a list row.
- Every numeric value, meaning counts, ports, CPU percentages and memory figures, is end-aligned and
  rendered with tabular figures.
- Control heights come from the size tokens. A button, an input, and a select placed in one row are
  all the same height by construction, not by adjustment.
- Spacing between siblings is set by the container's `gap`, never by a margin on the child.
- Every element a rule addresses carries a `data-audit-id`, and columns, rows, and numeric cells are
  marked with the attributes the auditor reads.
- The development grid overlay is used during implementation of each screen and the screen is not
  considered done while anything sits off the rule.

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
  Renders every stack from the merged store, grouped by host when more than one is configured.
  `filter` narrows by substring on the stack name. Emits nothing; rows navigate directly.
-->
<StackList filter={string} />
```

```svelte
<!-- ServiceCard.svelte -->
<!--
  One compose service. `service` is a live reference into the editor's config object, so
  edits mutate the document and flow through the YAML sync. `status` and `stats` come from
  the stack page's pollers and are absent in edit mode.
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
  `interactive` enables keyboard input. `rows` sets the initial height before the first fit.
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

| Situation                                  | Presentation                                                                                             |
|--------------------------------------------|-----------------------------------------------------------------------------------------------------------|
| YAML fails to parse while typing            | Message under the editor after a 3 s grace; the form keeps the last valid state; deploy and save disabled |
| `services` is missing or not a mapping      | Same message path; deploy is refused before the request is sent                                          |
| `.env` line without `=`                     | Message under the env editor naming the line number                                                      |
| `stack.deploy` or `stack.save` rejects       | Error toast keyed on the server's i18n key; edit mode is retained with contents intact                   |
| A compose command exits non-zero             | Error toast, and the progress pane is scrolled into view since it holds the real output                   |
| Stack not found on load                      | An empty-state card with a link back home, not a toast on a blank page                                   |
| Statistics or service status request fails   | Silently retried on the next tick; the card shows the last known values or none                          |
| A managed host goes offline with its page open | Banner on the page naming the host; actions disabled until it returns                                   |
| `docker.composerize` rejects                 | Error shown inline under the textarea, not as a toast                                                    |
| Terminal join for a name that does not exist | Empty pane, no error; the terminal appears once the command starts                                       |

## 6. Implementation Plan

### 6-1. Milestones

| Phase    | Task                                                                                                | Estimated Duration | Owner          |
|----------|-----------------------------------------------------------------------------------------------------|--------------------|----------------|
| Phase 1  | Setup and login screens including the TOTP step                                                     | TBD                | heavycaffeiner |
| Phase 2  | `StatusChip`, `ConfirmDialog`, `ArrayInput`, `HiddenInput`, and the empty-state card                | TBD                | heavycaffeiner |
| Phase 3  | `StackList` with search, host grouping, and collapse                                                | TBD                | heavycaffeiner |
| Phase 4  | `TerminalView` over the renderer: join, replay, resize, input, theme rebinding                      | TBD                | heavycaffeiner |
| Phase 5  | Compose editor shell: code editors for YAML and `.env`, the two-way sync, comment preservation      | TBD                | heavycaffeiner |
| Phase 6  | `expandForDisplay`, `parsePort`, and the URL and port chips, with a port parsing test table         | TBD                | heavycaffeiner |
| Phase 7  | `ServiceCard` view mode: status, ports, statistics, per-service actions                             | TBD                | heavycaffeiner |
| Phase 8  | `ServiceCard` edit mode: image, ports, volumes, environment, restart policy, dependencies, removal  | TBD                | heavycaffeiner |
| Phase 9  | `NetworkInput` and the stack action bar with confirmations and leave guards                         | TBD                | heavycaffeiner |
| Phase 10 | Container terminal page and host console page                                                       | TBD                | heavycaffeiner |
| Phase 11 | Dashboard: counts, host panel, `docker.composerize` backend method and its form                     | TBD                | heavycaffeiner |
| Phase 12 | Settings: general, appearance, security with TOTP and QR, global env, about                         | TBD                | heavycaffeiner |
| Phase 13 | Grid and alignment conformance pass across every screen using the development overlay               | TBD                | heavycaffeiner |
| Phase 14 | Accessibility pass against proposal 6's rules, plus a keyboard-only walkthrough of every screen     | TBD                | heavycaffeiner |

Phases 1 to 4 depend on proposal 6 Phase 9. Phases 5 to 9 depend on proposal 3. Phase 10 depends on
proposal 4. Phase 12 depends on proposal 2 Phase 7.

### 6-2. Dependencies

| Package                                     | Purpose                                     | Why not the standard library                                                          |
|---------------------------------------------|---------------------------------------------|----------------------------------------------------------------------------------------|
| `@xterm/xterm`                              | Terminal renderer                            | A VT sequence interpreter with a performant renderer is not something to rewrite       |
| `@xterm/addon-fit`                          | Fit the renderer to its container            | Part of the same project                                                                |
| `@xterm/addon-web-links`                    | Make URLs in output clickable                | Part of the same project                                                                |
| `codemirror` 6 with `@codemirror/lang-yaml` | YAML editing with syntax highlighting        | A syntax-aware editor with selection, undo, and large-document performance             |
| `yaml`                                      | Document round trip on the client too        | Already a backend dependency; the client needs the same comment-preserving AST         |
| `composerize`                               | `docker run` parsing, backend only           | Parsing the full docker run flag surface is a well-known, tedious solved problem       |
| `dotenv`                                    | Parse `.env` buffers                         | Quoting, escapes, and multi-line values have real edge cases                            |
| `@fontsource/jetbrains-mono`                | Self-hosted monospace face                   | No external font fetch, and terminal columns must align                                 |
| A QR renderer                               | TOTP provisioning code                       | Reed-Solomon error correction and version selection are not worth reimplementing        |

Icons are inline SVG at the sizes defined in proposal 6, not an icon font, so nothing loads a glyph
set over the network and every icon lands on the grid.

Internal dependencies: proposal 6 for the shell, router, stores, i18n, theme, and design tokens.
Proposals 2 to 5 for every method these screens call.

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
- Companion proposals: `docknight-2-auth`, `docknight-3-stack`, `docknight-4-terminal`,
  `docknight-5-agent`, `docknight-6-frontend-shell`, `docknight-8-design-verification`
