import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

function onPath(binary: string): boolean {
    return (process.env.PATH ?? "")
        .split(delimiter)
        .some((dir) => {
            if (dir === "") return false;
            try {
                accessSync(join(dir, binary), constants.X_OK);
                return true;
            } catch {
                return false;
            }
        });
}

/**
 * The `docker` CLI is on PATH. Enough for calls that never reach the daemon, such as
 * `docker --version` or a bad subcommand.
 */
export const dockerCliPresent = onPath("docker");

/**
 * The CLI exists and this process can reach the daemon socket. Required by anything that
 * actually runs a container: a socket alone is not enough, since a runner can mount one with
 * no CLI installed, and a CLI alone spawns fine but fails against a daemon that is not there.
 */
export const dockerDaemonReachable =
    process.env.DOCKER_TESTS === "1" ||
    (dockerCliPresent &&
        (() => {
            try {
                accessSync("/var/run/docker.sock", constants.R_OK | constants.W_OK);
                return true;
            } catch {
                return false;
            }
        })());
