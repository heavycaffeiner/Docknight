import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { AppError } from "../../common/errors.ts";

const CAPTURE_BYTE_CAP = 4 * 1024 * 1024;

/**
 * Build the docker argument vector for one compose command, inserting --env-file for
 * global.env and the stack's own .env when they exist, in that precedence order. When neither
 * exists the flags are omitted entirely, so compose applies its own default .env rule and a
 * stack directory behaves identically outside Docknight.
 */
export function composeArgs(
    stacksDir: string,
    stackDir: string,
    command: string,
    ...extra: string[]
): string[] {
    const args = ["compose"];
    if (existsSync(join(stacksDir, "global.env"))) {
        args.push("--env-file", "../global.env");
        if (existsSync(join(stackDir, ".env"))) args.push("--env-file", "./.env");
    }
    args.push(command, ...extra);
    return args;
}

/**
 * Run one short docker command, capture its output, and resolve with stdout. No shell is
 * involved; `argv` is passed as-is to `docker`.
 *
 * @throws AppError("commandFailed", ...) on a timeout, a missing docker binary, or a non-zero
 *         exit.
 */
export function runCapture(argv: string[], cwd: string, timeoutMs: number): Promise<string> {
    return new Promise((promiseResolve, promiseReject) => {
        const child = spawn("docker", argv, { cwd, env: process.env });
        let stdout = "";
        let stderr = "";
        let timedOut = false;

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
        }, timeoutMs);

        child.stdout.on("data", (chunk: Buffer) => {
            if (stdout.length < CAPTURE_BYTE_CAP) stdout += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk: Buffer) => {
            if (stderr.length < CAPTURE_BYTE_CAP) stderr += chunk.toString("utf8");
        });

        child.on("error", (error: NodeJS.ErrnoException) => {
            clearTimeout(timer);
            if (error.code === "ENOENT") {
                promiseReject(
                    new AppError("commandFailed", "the docker binary is not available", "dockerUnavailable"),
                );
                return;
            }
            promiseReject(new AppError("commandFailed", error.message));
        });

        child.on("exit", (code) => {
            clearTimeout(timer);
            if (timedOut) {
                promiseReject(new AppError("commandFailed", `timeout after ${timeoutMs}ms`));
                return;
            }
            if (code !== 0) {
                promiseReject(
                    new AppError(
                        "commandFailed",
                        `exit ${code}: ${stderr.slice(0, 500)}`,
                        "composeCommandFailed",
                        { code: code ?? -1 },
                    ),
                );
                return;
            }
            promiseResolve(stdout);
        });
    });
}
