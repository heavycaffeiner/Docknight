# Implementation Phases

The proposals in `docs/proposals/` define what to build. This directory defines the order and the
concrete steps. Each phase file carries module-level pseudocode, the tests that close the phase, and
an explicit done checklist.

## Ordering

The proposals number their own milestones, but the build order is global, driven by three hard
dependencies the proposals state:

- The terminal layer (proposal 4) must exist before the stack layer (proposal 3) can run long
  commands, so terminals are built before stack lifecycle methods.
- The verification foundations (proposal 8 phases 1 to 4: linters, fixture backend, geometry
  matrix) must land before the first screen is built. Retrofitting the token scale or the matrix
  across finished screens costs more than everything else combined.
- The container image, the version check, and the self upgrade need settings (phase 3) and the
  terminal registry (phase 4), so packaging is last.

| Phase | File                                  | Scope                                                        | Depends on |
|-------|---------------------------------------|--------------------------------------------------------------|------------|
| 1     | `phase-01-foundation.md`              | Repo skeleton, config, logging, data dir, SQLite, HTTP, lifecycle | none  |
| 2     | `phase-02-transport.md`               | Protocol types, WS server, router, events, backpressure, browser client | 1 |
| 3     | `phase-03-auth.md`                    | Password, sessions, TOTP, rate limit, settings store, reset script | 1, 2 |
| 4     | `phase-04-terminal.md`                | Ring buffer, pty registry, join and leave, exec, host shell  | 1, 2       |
| 5     | `phase-05-stack.md`                   | Discovery, atomic writes, compose execution, status, lock    | 1, 2, 4    |
| 6     | `phase-06-agent.md`                   | Host store, crypto, link pool, forwarding, event relay       | 1, 2, 3, 5 |
| 7     | `phase-07-verification-foundations.md`| stylelint and eslint rules, fixture backend, Playwright harness, geometry matrix | 2 |
| 8     | `phase-08-frontend-shell.md`          | Vite, tokens, viewport, theme, i18n, router, stores, layout  | 2, 7       |
| 9     | `phase-09-frontend-features.md`       | Every screen                                                 | 3, 4, 5, 6, 8 |
| 10    | `phase-10-verification-runtime.md`    | Auditor rules, scenarios, pseudo-locale, a11y, overlay, CI gate | 7, 9    |
| 11    | `phase-11-packaging.md`               | Dockerfile, healthcheck, version check, self upgrade, release CI | 3, 4, 10 |

Phases 3 and 4 are independent of each other and can be built in either order or interleaved.
Phase 7 is independent of 3 through 6 and can start as soon as phase 2's protocol types exist.

## Working rules

These hold for every phase.

- **Backend code runs without a build step.** No enums, no parameter properties, no namespaces,
  `import type` for type-only imports. `common/` uses no Node-only API.
- **All SQL parameters are bound.** No string concatenation into SQL, ever.
- **Every spatial CSS value is a token.** Raw px lengths fail lint from phase 7 on; write frontend
  styles that way from the first line even before the linter lands.
- **Trust-boundary validation is never skipped.** Every protocol method validates its params in its
  `parse` function before the handler sees them. Every filesystem path derived from a name goes
  through containment checking.
- **Writes are atomic or absent.** Any file the user depends on is written through the
  temp-fsync-rename helper.
- **Each phase ends with its verification step green** (`pnpm verify` covering typecheck, lint, and
  the unit tests that exist at that point), then a review pass over the phase's own checklist.
- **Commits follow Conventional Commits**, one logical unit per commit, scoped to the area
  (`feat(ws): ...`, `feat(stack): ...`).

## Pseudocode conventions

- `:=` is assignment, `->` is a return or mapping.
- Function signatures shown in TypeScript are the real exported contracts from the proposals;
  bodies in indented pseudocode are the required behaviour, not the required text.
- Anything marked `# invariant` must survive refactoring and gets a test.
