# Docknight

[한국어 README](README.ko.md)

A self-hosted web interface for `docker compose` stacks. Deploy, start, stop, edit and watch your
stacks from a browser, and open a shell inside any container.

A stack is a directory with a compose file in it. Docknight edits those files in place and runs the
real `docker compose` CLI, so every stack it manages still works from a terminal with Docknight
switched off. It never becomes the authority on what is on disk.

## What it does

- Finds stacks by scanning a directory and merges them with what `docker compose ls` reports,
  including stacks it did not create.
- Edits `compose.yaml` and `.env` through a YAML editor and a form that stay in sync, keeping your
  comments.
- Runs deploy, start, stop, restart, update, down and delete, streaming the real command output.
- Shows per-service status and health plus container CPU and memory.
- Opens a shell inside any container, and optionally a shell on the host.
- Manages stacks on other Docknight hosts from one interface.
- Single administrator, optional two-factor authentication, revocable sessions.

## Before you start

- A Linux host with Docker Engine 20 or newer and the Compose v2 plugin. Podman works through
  `podman-docker`.
- Access to `/var/run/docker.sock` on that host, which means root or a user in the `docker` group.
- Docknight controls the whole Docker daemon. Anyone who can sign in can run anything on the host,
  so put it behind your own network boundary and do not expose port 5001 to the internet.

## Install

The image is published to `ghcr.io/heavycaffeiner/docknight:latest`, built for `linux/amd64` and
`linux/arm64` on every commit to `main`. Create the two directories it uses and drop in the
reference deployment.

```
sudo mkdir -p /opt/docknight /opt/stacks
sudo curl -fsSL -o /opt/docknight/compose.yaml \
  https://raw.githubusercontent.com/heavycaffeiner/Docknight/main/docker/compose.yaml
cd /opt/docknight
sudo docker compose up -d
```

Open `http://<your-host>:5001`, pick a username and password, and you are in. Your stacks live in
`/opt/stacks`, one directory each.

**One rule about that path.** `/opt/stacks` must be the same path on both sides of the mount.
Compose files name host paths and the Docker daemon resolves them on the host, so mounting your
stacks somewhere else inside the container makes every bind mount in every managed stack point at
the wrong place, with no error to tell you. Change both sides together or neither.

## Back up `/opt/docknight`

The directory holds four files: the SQLite database and `agent-key`, 32 random bytes that encrypt
the password of every remote host you add.

**`agent-key` is not recoverable.** Restoring only the database leaves those remote hosts
permanently offline and the only fix is adding them again. Back up the whole directory or neither
part of it.

Docknight reads and writes only those four files and never lists the directory, so your own
`compose.yaml` sitting there is left alone.

## Updating

Settings, Updates has an **Upgrade now** button. It pulls the new image with the output on screen,
then replaces the container from a short-lived helper container. Docknight is unreachable for a few
seconds and the browser reconnects on its own. Running stacks are untouched. Turn on **Upgrade
automatically** in the same place to have that run as soon as the update check finds a newer
release.

The button needs the Docker socket mounted and the container started by `docker compose`, which the
reference deployment does. Otherwise, from the host:

```
cd /opt/docknight
sudo docker compose pull
sudo docker compose up -d
```

Building from source instead:

```
git clone https://github.com/heavycaffeiner/Docknight.git
cd Docknight
docker build -f docker/Dockerfile -t docknight:1 .
```

## Locked out

Stop the container first. The tool refuses to run while Docknight holds the database.

```
cd /opt/docknight
sudo docker compose stop
sudo docker compose run --rm docknight node scripts/reset-password.ts
sudo docker compose start
```

It prompts for a new password, clears two-factor authentication, and signs out every session.

## Configuration

Set these as environment variables in `compose.yaml`. Each also has a CLI flag, and the precedence
per key is CLI flag, then environment variable, then default. An unknown flag is a fatal error; an
unknown environment variable is ignored.

| Environment                    | CLI                    | Default          | What it does                          |
|--------------------------------|------------------------|------------------|---------------------------------------|
| `DOCKNIGHT_PORT`               | `--port`               | `5001`           | Port to listen on                     |
| `DOCKNIGHT_HOSTNAME`           | `--hostname`           | unset, binds all | Address to bind                       |
| `DOCKNIGHT_DATA_DIR`           | `--data-dir`           | `/app/data`      | Database and key file                 |
| `DOCKNIGHT_STACKS_DIR`         | `--stacks-dir`         | `/opt/stacks`    | Where stacks are scanned              |
| `DOCKNIGHT_ENABLE_CONSOLE`     | `--enable-console`     | `false`          | Host shell in the browser             |
| `DOCKNIGHT_SSL_KEY`            | `--ssl-key`            | unset            | TLS private key                       |
| `DOCKNIGHT_SSL_CERT`           | `--ssl-cert`           | unset            | TLS certificate                       |
| `DOCKNIGHT_SSL_KEY_PASSPHRASE` | `--ssl-key-passphrase` | unset            | Passphrase for the key                |
| `DOCKNIGHT_LOG_LEVEL`          | `--log-level`          | `info`           | `debug`, `info`, `warn`, `error`      |
| `PUID` / `PGID`                | none                   | unset            | Own written files as this user        |

Set both `PUID` and `PGID` to keep files Docknight writes into the stacks directory editable by
your own user. Set both TLS options or neither. `DOCKNIGHT_DATA_DIR` and `DOCKNIGHT_STACKS_DIR` may
not overlap.

`DOCKNIGHT_ENABLE_CONSOLE` turns on a full shell as the user Docknight runs as, usually root inside
the container, with the Docker socket mounted. It is not sandboxed and is not meant to be.

## Development

Node 24 or newer and pnpm. The backend runs from TypeScript sources through Node's type stripper,
so there is no backend build step. Linux is the supported platform; Windows and macOS are expected
to work through WSL or a container but are not tested.

```
pnpm install
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

```
pnpm verify                  # typecheck, lint, unit tests
pnpm build:verify            # the bundle the browser projects run against
pnpm test:layout             # 260 cells: the grid, overflow, contrast, target size
pnpm test:a11y               # axe-core on every screen, both themes
```

Nothing here compares screenshots. Appearance is checked by geometry and contrast rules, which
survive a redesign. Both browser projects measure rendered text: the faces the application styles
text with ship in the bundle, but anything falling through to a generic family is measured in
whatever font your machine holds, so a result can differ from CI for that reason.

In a development build, `Ctrl+Shift+G` draws the 4 pixel rule over the viewport and `Ctrl+Shift+A`
runs the layout auditor against the rendered DOM.

## Layout

```
common/       protocol types, compose helpers, constants; imported by both sides
backend/      one Node process: HTTP, WebSocket, SQLite, docker child processes
frontend/     Svelte 5 application
docker/       image, healthcheck, reference deployment
tools/        theme generation, stylelint rules, fixture backend, layout auditor
docs/         the specification proposals this implementation follows
```

## License

MIT. See [LICENSE](LICENSE).
