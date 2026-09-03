# Docknight

Docknight is a self-hosted control panel for Docker Compose stacks. It works with ordinary
compose files and directories. You can still use `docker compose` and your usual editor at any
time.

Use this guide to install Docknight, create the first administrator account, and manage your
first stack.

## What Docknight manages

- Docker Compose stacks stored on the same host.
- `compose.yaml`, `compose.yml`, `docker-compose.yaml`, and `docker-compose.yml` files.
- Stack lifecycle actions: deploy, start, stop, restart, update, take down, and delete.
- Compose and `.env` file editing, command output, service state, health, CPU, and memory.
- A shell in a container. The optional host console is off by default.
- Other Docknight hosts from the same dashboard.

Docknight reads and writes the files in your stack directory. It does not replace them with a
separate database or configuration format.

## Before you start

You need:

- A Linux host running Docker Engine 20 or later and the Docker Compose v2 plugin.
- Access to the Docker socket at `/var/run/docker.sock`.
- A browser that can reach the host on port `5001`.
- A directory where each stack has its own immediate child directory.

## Security first

Mounting the Docker socket gives Docknight control over the Docker daemon. Anyone who can sign in
can create containers that access the host.

- Do not expose port `5001` directly to the public internet.
- Put Docknight on a private network or behind a VPN.
- Use a reverse proxy with TLS when people access it over a network you do not control.
- Create a unique administrator password. The password needs at least eight characters and two
  of these groups: letters, digits, and symbols.
- Leave the host console disabled unless you intentionally need a host shell in the browser.

## Quick start

The reference deployment keeps Docknight data in `/opt/docknight` and stacks in `/opt/stacks`.
You can change these paths later, but the stack path must have the same absolute path on the host
and inside the Docknight container.

1. Create the data and stack directories.

   ```sh
   sudo install -d -m 0700 /opt/docknight
   sudo install -d -m 0755 /opt/stacks
   ```

2. Download the reference Compose file.

   ```sh
   sudo curl -fsSL \
     https://raw.githubusercontent.com/heavycaffeiner/Docknight/main/docker/compose.yaml \
     --output /opt/docknight/compose.yaml
   ```

3. Start Docknight.

   ```sh
   sudo docker compose -f /opt/docknight/compose.yaml up -d
   ```

4. Open `http://<host-address>:5001` in a browser. On the host itself, use
   `http://localhost:5001`.

5. Create the first administrator account. This account can manage every stack visible to
   Docknight.

6. On an empty dashboard, select **Create your first stack**. Enter a stack name, add a Compose
   file, save it, then select **Deploy**.

To watch startup output:

```sh
sudo docker compose -f /opt/docknight/compose.yaml logs -f docknight
```

## Add an existing stack

Create one directory per stack directly inside the configured stack directory. For example:

```text
/opt/stacks/
  paperless/
    compose.yaml
  monitoring/
    docker-compose.yml
```

Docknight discovers those directories during its next refresh. It also shows stacks reported by
`docker compose ls`, including stacks outside the configured directory. Those outside stacks are
read-only because Docknight cannot safely edit files it does not manage.

## Everyday use

1. Select a stack from the sidebar or the mobile stack list.
2. Use **Edit** to change `compose.yaml` or `.env`.
3. Select **Save draft** before deploying file changes.
4. Use **Deploy** after changing the Compose definition. Use **Start**, **Stop**, or
   **Restart** for a stack that already exists.
5. Open a service to inspect its status or start a shell in that container.

Deleting a stack removes its managed files. Export or copy anything you need before selecting
**Delete**.

## Configuration

Edit `/opt/docknight/compose.yaml`, then recreate the container after changing its environment or
mounts:

```sh
sudo docker compose -f /opt/docknight/compose.yaml up -d
```

| Setting | Default | Use |
| --- | --- | --- |
| `DOCKNIGHT_STACKS_DIR` | `/opt/stacks` | Directory that contains managed stack directories. |
| `DOCKNIGHT_DATA_DIR` | `/app/data` | Application data inside the container. Keep this on a persistent volume. |
| `DOCKNIGHT_ENABLE_CONSOLE` | `false` | Set to `true` only to enable the host console. |
| `PUID` and `PGID` | Unset | Set both to a host user ID and group ID so files saved by Docknight stay editable by that user. |
| `DOCKNIGHT_PORT` | `5001` | Listening port inside the container. Change the Compose port mapping for a different external port. |

If you change the stack directory, update all three places together:

1. The host directory in the volume mount.
2. The container directory in the same volume mount.
3. `DOCKNIGHT_STACKS_DIR`.

The host and container paths must match exactly. Compose files can contain host bind mounts, and
the Docker daemon resolves those paths on the host.

## Updates

The reference deployment uses `ghcr.io/heavycaffeiner/docknight:stable`. To update it manually:

```sh
sudo docker compose -f /opt/docknight/compose.yaml pull
sudo docker compose -f /opt/docknight/compose.yaml up -d
```

`stable`, `latest`, and version tags are release builds for `linux/amd64` and `linux/arm64`.
`nightly` follows every commit on `main` and is intended for testing unreleased changes.

## Recovery and troubleshooting

### Reset a forgotten administrator password

Stop Docknight before running the reset command. It clears configured two-factor authentication
and signs out every active session.

```sh
sudo docker compose -f /opt/docknight/compose.yaml down
sudo docker compose -f /opt/docknight/compose.yaml run --rm docknight node scripts/reset-password.ts
sudo docker compose -f /opt/docknight/compose.yaml up -d
```

### No stacks appear

Check that each stack is an immediate child directory of `DOCKNIGHT_STACKS_DIR`, has a supported
Compose filename, and that its host path is mounted at the identical path inside Docknight.

### Docknight does not open in the browser

Check the container status and its logs:

```sh
sudo docker compose -f /opt/docknight/compose.yaml ps
sudo docker compose -f /opt/docknight/compose.yaml logs docknight
```

Then check the host firewall, port mapping, reverse proxy, and address used in the browser.

## Project documentation

The technical implementation plans in [`docs/proposals/`](docs/proposals/) and
[`docs/phases/`](docs/phases/) are for contributors. Start with this README when deploying or
using Docknight.

## License

MIT. See [LICENSE](LICENSE).
