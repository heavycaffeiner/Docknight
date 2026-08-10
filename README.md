# Docknight

A self-hosted web manager for `docker compose` stacks.

A stack is a directory containing a compose file. Docknight reads and writes those files in place
and shells out to the `docker compose` CLI to act on them, so every stack remains fully operable
from a shell with Docknight stopped. Nothing that exists on disk becomes authoritative in the
database.

## What it does

- Discovers stacks by scanning the stacks directory and merges them with what `docker compose ls`
  reports, including stacks it did not create.
- Edits `compose.yaml` and `.env` through a YAML editor and a structured form that stay in sync,
  preserving comments.
- Runs deploy, start, stop, restart, update, down and delete, streaming the real command output to
  a terminal pane in the browser.
- Reports per-service status and health plus container CPU and memory.
- Opens a shell inside any container of any stack, and optionally a shell on the host.
- Manages stacks on other Docknight hosts from one interface, with a per-host status badge.
- Single administrator, scrypt password, optional TOTP second factor, revocable sessions.

## Requirements

- Docker Engine 20 or newer with the Compose v2 plugin, reachable through `/var/run/docker.sock`.
  Podman works through `podman-docker`, which supplies a `docker` shim on `PATH`.
- Linux. Development on Windows or macOS is expected to work through a container or WSL but is not
  supported or tested.

## Running it

Copy `docker/compose.yaml` to `/opt/docknight/compose.yaml` on the host and run `docker compose up
-d`. Open port 5001 and complete first-run setup.

The two bind mounts follow different rules, and the difference is not cosmetic.

`/opt/stacks` **must carry the identical path on both sides.** Compose files reference host paths
and the daemon resolves them on the host, so a stacks directory mounted at a different path inside
the container makes every relative bind mount in every managed stack resolve somewhere else,
silently and without an error. The startup checks cannot detect this.

`/opt/docknight` to `/app/data` may differ freely. Nothing outside the process reads the database
or the key file, so the container path is an implementation detail of the image.

## Configuration

Precedence per key is CLI argument, then environment variable, then default. An unknown CLI
argument is a fatal error; an unknown environment variable is ignored.

| Key                | CLI                    | Environment                    | Default          |
|--------------------|------------------------|--------------------------------|------------------|
| `port`             | `--port`               | `DOCKNIGHT_PORT`               | `5001`           |
| `hostname`         | `--hostname`           | `DOCKNIGHT_HOSTNAME`           | unset, binds all |
| `dataDir`          | `--data-dir`           | `DOCKNIGHT_DATA_DIR`           | `/app/data`      |
| `stacksDir`        | `--stacks-dir`         | `DOCKNIGHT_STACKS_DIR`         | `/opt/stacks`    |
| `enableConsole`    | `--enable-console`     | `DOCKNIGHT_ENABLE_CONSOLE`     | `false`          |
| `sslKey`           | `--ssl-key`            | `DOCKNIGHT_SSL_KEY`            | unset            |
| `sslCert`          | `--ssl-cert`           | `DOCKNIGHT_SSL_CERT`           | unset            |
| `sslKeyPassphrase` | `--ssl-key-passphrase` | `DOCKNIGHT_SSL_KEY_PASSPHRASE` | unset            |
| `logLevel`         | `--log-level`          | `DOCKNIGHT_LOG_LEVEL`          | `info`           |
| `puid` / `pgid`    | none                   | `PUID` / `PGID`                | unset            |

Set both `PUID` and `PGID` to keep files Docknight writes into the stacks directory editable by the
host user. Set both TLS options or neither. `dataDir` and `stacksDir` may not overlap.

`--enable-console` turns on a full shell as the user Docknight runs as, usually root inside the
container, with the docker socket mounted. It is not sandboxed and is not meant to be.

## The data directory

```
/opt/docknight/          on the host, mounted at /app/data in the container
  docknight.db           SQLite database: settings, the account, sessions, managed hosts
  docknight.db-wal
  docknight.db-shm
  agent-key              32 random bytes, mode 0600
```

**`agent-key` is not recoverable.** It encrypts the password of every managed host. Restoring only
the database from a backup leaves those hosts permanently offline, and the fix is to add them
again. Back up the whole directory or neither part of it.

Docknight creates and reads only those four files plus a write probe. It never enumerates the
directory, so the operator's own `compose.yaml` can live there untouched.

## Locked out

`pnpm reset-password` runs against the same data directory, prompts for a new password on the
terminal, clears the TOTP secret, and deletes every session. It refuses to run while a Docknight
process holds the database.

## Development

Node 24 or newer and pnpm. The backend runs from TypeScript sources through Node's type stripper,
so there is no backend build step.

```
pnpm install
pnpm theme:generate          # regenerate styles/theme.css from the source colour
pnpm build:frontend
pnpm dev:backend             # port 5001, data and stacks under .dev/
pnpm dev:frontend            # port 5000, proxies /ws to the backend
```

Working on the interface without a Docker host:

```
pnpm fixtures --scenario typical    # a deterministic protocol server on 5001
pnpm dev:frontend                   # sign in as fixture / fixture-password-1
```

Scenarios: `typical`, `empty`, `single-stack`, `dense`, `extreme`, `degraded`, `slow`.

In a development build, `Ctrl+Shift+G` draws the 4 pixel rule over the viewport and
`Ctrl+Shift+A` runs the layout auditor against the rendered DOM.

```
pnpm typecheck               # TypeScript 7, backend and frontend
pnpm lint                    # eslint plus the spacing-token stylelint rules
pnpm test                    # node:test unit tests
pnpm verify                  # all of the above
```

Design rules, including the 4 pixel grid every screen satisfies, are specified in
`docs/proposals/docknight-6-frontend-shell.md` and enforced by the tooling described in
`docs/proposals/docknight-8-design-verification.md`.

## Verification

The browser projects run against a built bundle and the fixture backends, so
`pnpm build:verify` comes first.

```
pnpm build:verify
pnpm test:layout             # 260 cells: the grid, overflow, contrast, target size
pnpm test:a11y               # axe-core on every screen, both themes
```

Every run writes `test-results/verification-report.html`, and a layout run also writes
`design/exemption-usage.json`, which lists the escape hatches that were actually used.

Both projects measure rendered text, so a result is only comparable between runs where the browser
build and the font set are pinned:

```
docker build -f docker/verify.Dockerfile -t docknight-verify .
docker run --rm -v "$PWD:/work" docknight-verify pnpm test:layout
```

A run outside that image measures whatever fonts the host holds and is advisory. Nothing here
compares screenshots: appearance is checked by the geometry and contrast rules, which survive a
redesign, rather than by images, which do not.

## Layout

```
common/       protocol types, compose helpers, constants; imported by both sides
backend/      one Node process: HTTP, WebSocket, SQLite, docker child processes
frontend/     Svelte 5 application
docker/       image, healthcheck, reference deployment
tools/        theme generation, stylelint rules, fixture backend, layout auditor
docs/         the specification proposals this implementation follows
```
