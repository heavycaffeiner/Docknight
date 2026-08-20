# Phase 7: Verification Foundations

Implements proposal 8 phases 1 to 4: the static linters, the fixture backend, and the Playwright
harness with the geometry matrix. This lands **before any screen is built** (it only needs phase
2's protocol types), so every screen is written against the token linter and rendered against real
device geometry from its first commit.

The auditor rules themselves are phase 10; they need screens to run against.

## Step 1: `tools/stylelint/grid-tokens.cjs`

```
rule "docknight/grid-tokens":
    SPATIAL_PROPS := margin*, padding*, gap, row-gap, column-gap, inset*, top, right,
                     bottom, left, width, height, min/max-width, min/max-height,
                     border-radius*, translate
    APPROVED_TOKENS := the token names from proposal 6 section 5-1 (read from a shared list)

    for each declaration where prop matches SPATIAL_PROPS:
        for each value node (postcss-value-parser):
            accept: "0", "auto", "100%", "min-content", "max-content", "fit-content",
                    <number>fr, var(--<approved token>),
                    calc() whose every length operand is itself accepted
            accept raw px ONLY when prop is border*-width or outline-width
            accept literals listed in tools/stylelint/allowed-raw.json (ships empty)
            otherwise: report(prop, value, nearestToken(value))

    nearestToken(value):
        if value parses as px: return the token whose px value is closest
        else: return "a spacing token"
```

## Step 2: `tools/stylelint/logical-properties.cjs`

```
rule "docknight/logical-properties":
    BANNED := { margin-left: margin-inline-start, margin-right: margin-inline-end,
                padding-left: ..., padding-right: ..., left: inset-inline-start,
                right: inset-inline-end, border-left*: border-inline-start*, ... }
    for each declaration:
        if prop in BANNED: report(prop, "use " + BANNED[prop])
        if prop == "text-align" and value in ["left", "right"]:
            report("use start or end")
```

`stylelint.config.cjs` wires both custom rules plus `stylelint-config-standard` over `**/*.css` and
Svelte style blocks (via `postcss-html` custom syntax). Fixture-driven tests for both rules: a
`.css` fixture per accept/reject case, asserted with stylelint's test utils.

## Step 3: ESLint markup rules

Extend `eslint.config.js` for `**/*.svelte`:

```
- eslint-plugin-svelte recommended
- no inline style attributes containing a length:
    selector: Attribute[name="style"] whose value matches /\d+(px|rem|em|vh|vw|%)/
    message: "dynamic geometry goes through a CSS custom property set from a token"
- role completeness and accessible names: enable the svelte a11y rules that cover
    role-has-required-aria-props, img alt, aria-label on icon-only buttons
- no sampled media queries:
    selector: CallExpression[callee.object.name="window"][callee.property.name="matchMedia"]
              not inside a $effect / subscription
    message: "media-query state must be reactive, not read once at mount"
```

## Step 4: `tools/fixtures/data/` scenarios

Each scenario is one module exporting a plain object. No clock reads, no randomness; every
timestamp and statistic is a literal.

```ts
export interface Scenario {
    settings: SettingsPayload;
    stacks: Record<string, StackSummary>;            // local host
    stackDetails: Record<string, StackDetail>;       // compose text and env per stack
    serviceStatus: Record<string, Record<string, ServiceInstance[]>>;
    stats: Record<string, DockerStat>;
    agents: Record<string, AgentSummary>;
    agentStacks: Record<string, Record<string, StackSummary>>;   // per remote endpoint
    terminalBuffer: string;                          // replayed once at join
    latencyMs: number;                               // 0 except "slow"
}
```

| Scenario       | Construction notes                                                                  |
|----------------|--------------------------------------------------------------------------------------|
| `typical`      | 6 stacks, mixed status, 1-4 services, one host; compose files with comments and env vars |
| `empty`        | Everything empty; settings defaults                                                  |
| `single-stack` | One stack, one service                                                               |
| `dense`        | 60 stacks over 4 endpoints; `wide-stack` with 12 services, 20 ports each             |
| `extreme`      | 63-char stack name, 80-char image ref, 40-char service name, 120-char volume path    |
| `degraded`     | Two agents `status: offline`, one stack `managed: false`, one detail with broken YAML |
| `slow`         | `typical` with `latencyMs: 3000`                                                     |

## Step 5: `tools/fixtures/server.ts`

```ts
export function startFixtureServer(scenario: ScenarioName, port: number): Promise<FixtureServer>;
```

```
startFixtureServer(name, port):
    scenario := import data module
    http server + ws upgrade on /ws (no origin check, no protocol header check)

    per connection state: authed := false
    onMessage(msg):
        if msg.t == "ping": reply pong
        if msg.t != "req": return
        await sleep(scenario.latencyMs)
        respond := data => send { t: "res", id: msg.id, ok: true, data }
        switch msg.method:
            "auth.login":
                if credentials == ("fixture", "fixture-password-1"):
                    authed := true
                    respond({ token: "fixture-token", username: "fixture" })
                    pushAfterLogin(conn)
                else: send error unauthorized authIncorrectCreds
            "auth.loginByToken":
                if token == "fixture-token": authed := true; respond; pushAfterLogin(conn)
            "settings.get"        -> scenario.settings
            "stack.list"          -> { stacks: scenario.stacks }
            "stack.get"           -> { stack: scenario.stackDetails[name] } or notFound
            "stack.serviceStatus" -> scenario.serviceStatus[name] ?? {}
            "docker.stats"        -> { stats: scenario.stats }
            "docker.networks"     -> { networks: ["bridge", "proxy"] }
            "agent.list"          -> { agents: scenario.agents }
            "terminal.join"       -> { buffer: scenario.terminalBuffer, exited: false, exitCode: null }
            "terminal.*" others   -> { ok: true } shapes
            any mutating stack method ->
                respond({ exitCode: 0 } or { ok: true })
                re-emit stackList with the scenario data (unchanged; determinism)
            default -> error unknownMethod

    pushAfterLogin(conn):
        emit info, stackList(""), one stackList per agent endpoint, agentList,
        one agentStatus per endpoint      # mirrors the real afterLogin order

    return { emit(event, endpoint, data): broadcast to authed conns, close() }
```

Add script: `pnpm fixtures --scenario typical` starts it on 5001 so `pnpm dev:frontend` can develop
against it. Determinism test: two runs of (connect, login, collect every frame for a fixed request
script) produce byte-identical transcripts.

## Step 6: `tests/support/matrix.ts`

```ts
export interface Geometry { id: string; width: number; height: number; touch: boolean }

export const GEOMETRIES: readonly Geometry[] = [
    { id: "reflow",     width: 320,  height: 900,  touch: false },
    { id: "phone",      width: 390,  height: 844,  touch: true  },
    { id: "phone-wide", width: 600,  height: 900,  touch: true  },
    { id: "phone-land", width: 780,  height: 390,  touch: true  },
    { id: "keyboard",   width: 390,  height: 380,  touch: true  },
    { id: "tablet",     width: 840,  height: 1120, touch: true  },
    { id: "laptop",     width: 1280, height: 900,  touch: false },
    { id: "desktop",    width: 1920, height: 1080, touch: false },
];

export interface Cell { id; screen; geometry; theme; locale; scenario; rules? }
export function cells(): Cell[];
```

```
cells():
    result := []
    SCREENS := every route from proposal 6 + compose editor in edit mode
    TEXT_FIELD_SCREENS := [login, setup, stack, dashboard, settings.*]

    # base: every screen x every geometry x both themes, en, typical
    for screen x geometry x theme:
        if geometry.id == "reflow": rules := REFLOW_RULES         # overflow only
        if geometry.id in ["keyboard", "phone-land"] and screen not in TEXT_FIELD_SCREENS:
            continue                                              # sampled, per proposal 8
        push cell

    # locale stress: every screen at phone and laptop, en-XA and the RTL locale, light
    # scenario stress: extreme, dense, empty, degraded at phone and laptop, en, light
    push those cells

    cell.id := screen + "." + theme + "." + geometry.id
    return result
```

## Step 7: `tests/support/harness.ts`

```ts
export async function openCell(cell: Cell): Promise<{ page: Page; done: () => Promise<void> }>;
```

```
openCell(cell):
    server := await startFixtureServer(cell.scenario, ephemeralPort)
    context := browser.newContext({
        viewport: { width: cell.geometry.width, height: cell.geometry.height },
        hasTouch: cell.geometry.touch,            # invariant: this is what makes
                                                  # pointer: coarse match; never omitted
        colorScheme: cell.theme,
        locale: cell.locale,
    })
    page := context.newPage()
    inject verification stylesheet:
        * { animation-duration: 0s !important; transition-duration: 0s !important }
    navigate to the built frontend (vite preview or static file server) pointed at the fixture port
    login as fixture / fixture-password-1
    navigate to cell.screen; if the screen needs edit mode, click Edit
    await settle(page)
    return { page, done: close context + server }

settle(page):
    await page.evaluate(() => document.fonts.ready)      # 10 s cap -> fail "fonts did not load"
    await two animation frames
    assert no running animations on measured nodes       # guard; the stylesheet zeroed them
```

Smoke spec (`tests/layout/smoke.spec.ts`) until phase 10 supplies rules: for every cell, the page
reaches its screen without a console error and `document.scrollingElement.scrollWidth <=
innerWidth + 1`. This makes the matrix itself, geometry and all, part of CI from this phase on.

## Step 8: Package scripts and CI skeleton

```
pnpm lint:style   -> stylelint "**/*.{css,svelte}"
pnpm lint:js      -> eslint .
pnpm fixtures     -> node tools/fixtures/cli.ts --scenario <name>
pnpm test:layout  -> playwright test tests/layout
pnpm verify       -> typecheck + lint:style + lint:js + test + test:layout

.github/workflows/verify.yml:
    jobs typecheck, lint, unit on every push
    job test:layout on pull requests, sharded, report artifact uploaded on success and failure
```

## Done checklist

- [ ] A raw `padding: 14px` in any stylesheet or Svelte style block fails `lint:style` naming the
      nearest token.
- [ ] `margin-left` fails lint suggesting `margin-inline-start`.
- [ ] Fixture transcript determinism test green.
- [ ] Smoke spec runs the full matrix: correct viewport sizes and `hasTouch` observable from the
      page (`matchMedia("(pointer: coarse)")` matches exactly on touch cells).
- [ ] `pnpm fixtures --scenario typical` + a manual WebSocket client can log in and receive the
      afterLogin event sequence.
