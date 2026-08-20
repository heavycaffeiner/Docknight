# Docknight

[한국어 README](README.ko.md)

A self-hosted web interface for `docker compose` stacks. Deploy, start, stop, edit and watch your
stacks from a browser, and open a shell inside any container.

A stack is a directory with a compose file in it. Docknight edits those files in place and runs the
real `docker compose` CLI, so every stack it manages still works from a terminal with Docknight
switched off. It never becomes the authority on what is on disk.

## Status

**Rewrite in progress.** The first implementation is retired; this repository currently holds the
revised specification set that the second implementation follows. See
[`docs/proposals/`](docs/proposals/) for the full design:

| Proposal | Scope |
|----------|-------|
| [0 - Foundation](docs/proposals/docknight-0-foundation.md) | Runtime, configuration, SQLite, HTTP, container image, self upgrade |
| [1 - Transport](docs/proposals/docknight-1-transport.md) | WebSocket protocol, routing, errors, mobile-aware reconnection |
| [2 - Auth](docs/proposals/docknight-2-auth.md) | Login, TOTP, sessions, settings store, offline recovery |
| [3 - Stack](docs/proposals/docknight-3-stack.md) | Discovery, atomic file writes, compose execution, status |
| [4 - Terminal](docs/proposals/docknight-4-terminal.md) | Pty registry, scrollback, container exec, host shell |
| [5 - Agent](docs/proposals/docknight-5-agent.md) | Multi-host federation |
| [6 - Frontend shell](docs/proposals/docknight-6-frontend-shell.md) | Design system, size classes, pointer density, viewport and keyboard handling |
| [7 - Frontend features](docs/proposals/docknight-7-frontend-features.md) | Every screen, with explicit compact specifications |
| [8 - Design verification](docs/proposals/docknight-8-design-verification.md) | Layout auditor, device-geometry matrix, fixture backend, CI |

The rewrite exists because the first frontend treated the compact layout as a shrunken desktop
layout and its verification matrix never rendered a phone. Proposals 6 through 8 are full rewrites
that bake the corrections into the design system and the test matrix; proposals 0 through 5 are
re-issued with clarifications only.

## What it will do

- Find stacks by scanning a directory and merge them with what `docker compose ls` reports,
  including stacks it did not create.
- Edit `compose.yaml` and `.env` through a YAML editor and a form that stay in sync, keeping your
  comments.
- Run deploy, start, stop, restart, update, down and delete, streaming the real command output.
- Show per-service status and health plus container CPU and memory.
- Open a shell inside any container, and optionally a shell on the host.
- Manage stacks on other Docknight hosts from one interface.
- Single administrator, optional two-factor authentication, revocable sessions.
- Work properly from a phone: touch-sized targets, keyboard-aware layout, thumb-zone actions.

## Requirements

- A Linux host with Docker Engine 20 or newer and the Compose v2 plugin. Podman works through
  `podman-docker`.
- Access to `/var/run/docker.sock` on that host.
- Docknight controls the whole Docker daemon. Anyone who can sign in can run anything on the host,
  so put it behind your own network boundary and do not expose port 5001 to the internet.

## License

MIT. See [LICENSE](LICENSE).
