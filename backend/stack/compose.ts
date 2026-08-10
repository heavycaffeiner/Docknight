import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { commandFailed } from "../../common/errors.ts";
import { GLOBAL_ENV_FILE_NAME } from "../../common/stack.ts";
import type { Config } from "../config.ts";
import { log } from "../log.ts";
import type { Stack } from "./stack.ts";

const CAPTURE_LIMIT = 4 * 1024 * 1024;
export const SHORT_TIMEOUT_MS = 10_000;
export const STATS_TIMEOUT_MS = 15_000;

async function exists(path: string): Promise<boolean> {
    try {
        await access(path, constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Compose's default progress display addresses the cursor and clips itself to the height of the
 * terminal it is writing to: in a pane a few rows tall it draws one container and "... 11 more",
 * which reads as the command having touched one container out of twelve. Plain writes one line per
 * event and scrolls.
 */
export const PLAIN_PROGRESS: readonly string[] = ["--progress", "plain"];

/**
 * Build the docker argument vector for one compose command. The order matters: compose applies
 * later --env-file values over earlier ones, so the stack's own .env comes after global.env.
 * When no global.env exists the flags are omitted entirely, which is what makes a stack
 * directory behave identically outside Docknight.
 */
export async function composeArgs(
    config: Readonly<Config>,
    stack: Stack,
    command: string,
    extra: readonly string[] = [],
    globals: readonly string[] = [],
): Promise<string[]> {
    const args = ["compose", ...globals];
    if (await exists(join(config.stacksDir, GLOBAL_ENV_FILE_NAME))) {
        args.push("--env-file", `../${GLOBAL_ENV_FILE_NAME}`);
        if (await exists(join(stack.dir, ".env"))) args.push("--env-file", "./.env");
    }
    args.push(command, ...extra);
    return args;
}

export interface CaptureResult {
    stdout: string;
    stderr: string;
    code: number;
}

/**
 * Run a short read-only docker command with captured output. No shell, an explicit timeout, and
 * a bounded buffer, so a hung daemon produces an error rather than a promise that never settles.
 */
export function runCapture(
    argv: string[],
    cwd: string,
    timeoutMs: number,
): Promise<CaptureResult> {
    return new Promise<CaptureResult>((resolve, reject) => {
        const child = spawn("docker", argv, { cwd, env: process.env, windowsHide: true });

        let stdout = "";
        let stderr = "";
        let settled = false;

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill("SIGKILL");
            reject(
                commandFailed(`docker ${argv.join(" ")} timed out after ${timeoutMs} ms`, {
                    i18n: "composeCommandFailed",
                    values: { detail: "timeout" },
                }),
            );
        }, timeoutMs);
        timer.unref();

        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
            if (stdout.length < CAPTURE_LIMIT) stdout += chunk;
        });
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
            if (stderr.length < CAPTURE_LIMIT) stderr += chunk;
        });

        child.on("error", (error: NodeJS.ErrnoException) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            const missing = error.code === "ENOENT";
            reject(
                commandFailed(missing ? "the docker binary is not on PATH" : error.message, {
                    i18n: missing ? "dockerUnavailable" : "composeCommandFailed",
                    cause: error,
                }),
            );
        });

        child.on("close", (code: number | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ stdout, stderr, code: code ?? -1 });
        });
    });
}

/** Capture and require a zero exit. Errors carry the code and the head of stderr. */
export async function runCaptureOk(
    argv: string[],
    cwd: string,
    timeoutMs: number,
): Promise<string> {
    const result = await runCapture(argv, cwd, timeoutMs);
    if (result.code !== 0) {
        const detail = result.stderr.trim().slice(0, 500);
        if (/permission denied|cannot connect to the docker daemon/i.test(detail)) {
            throw commandFailed(`docker is unavailable: ${detail}`, {
                i18n: "dockerUnavailable",
                values: { detail },
            });
        }
        throw commandFailed(`docker ${argv[0] ?? ""} exited ${result.code}: ${detail}`, {
            i18n: "composeCommandFailed",
            values: { code: result.code, detail },
        });
    }
    return result.stdout;
}

/**
 * Parse output that compose emits either as one JSON array or as one JSON object per line,
 * depending on the release. A line that fails to parse is skipped, not fatal.
 */
export function parseJsonRecords<T>(text: string): T[] {
    const trimmed = text.trim();
    if (trimmed === "") return [];
    if (trimmed.startsWith("[")) {
        try {
            const parsed: unknown = JSON.parse(trimmed);
            return Array.isArray(parsed) ? (parsed as T[]) : [];
        } catch (error) {
            log.debug("compose", "json array did not parse", error);
            return [];
        }
    }
    const records: T[] = [];
    for (const line of trimmed.split(/\r?\n/)) {
        if (line.trim() === "") continue;
        try {
            records.push(JSON.parse(line) as T);
        } catch {
            // Both output shapes are in the field; a stray line is not worth failing over.
        }
    }
    return records;
}
