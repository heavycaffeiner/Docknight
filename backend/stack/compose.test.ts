import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dockerCliPresent, dockerDaemonReachable } from "../../tests/support/docker-available.ts";
import { composeArgs, runCapture } from "./compose.ts";

test("composeArgs: neither global.env nor a stack .env exist, so no --env-file flags at all", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-compose-args-"));
    try {
        const stackDir = join(root, "demo");
        await mkdir(stackDir);
        assert.deepEqual(composeArgs(root, stackDir, "up", "-d"), ["compose", "up", "-d"]);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("composeArgs: only global.env exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-compose-args-"));
    try {
        const stackDir = join(root, "demo");
        await mkdir(stackDir);
        await writeFile(join(root, "global.env"), "FOO=bar\n");
        assert.deepEqual(composeArgs(root, stackDir, "up", "-d"), [
            "compose",
            "--env-file",
            "../global.env",
            "up",
            "-d",
        ]);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("composeArgs: only the stack's own .env exists, without global.env", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-compose-args-"));
    try {
        const stackDir = join(root, "demo");
        await mkdir(stackDir);
        await writeFile(join(stackDir, ".env"), "FOO=bar\n");
        // Per the invariant, a stack .env alone never adds a flag; compose finds it by default.
        assert.deepEqual(composeArgs(root, stackDir, "up", "-d"), ["compose", "up", "-d"]);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("composeArgs: both global.env and the stack's own .env exist, in that order", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-compose-args-"));
    try {
        const stackDir = join(root, "demo");
        await mkdir(stackDir);
        await writeFile(join(root, "global.env"), "FOO=bar\n");
        await writeFile(join(stackDir, ".env"), "FOO=baz\n");
        assert.deepEqual(composeArgs(root, stackDir, "up", "-d"), [
            "compose",
            "--env-file",
            "../global.env",
            "--env-file",
            "./.env",
            "up",
            "-d",
        ]);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

// `docker --version` and a bad subcommand never reach the daemon socket, but they still spawn
// the CLI, so they need it on PATH. The timeout case runs a real `docker events`, which needs
// the daemon as well.

test("runCapture returns stdout on success", { skip: !dockerCliPresent }, async () => {
    const out = await runCapture(["--version"], process.cwd(), 10_000);
    assert.match(out, /Docker version/);
});

test(
    "runCapture rejects with commandFailed and the exit code on a non-zero exit",
    { skip: !dockerCliPresent },
    async () => {
        await assert.rejects(
            runCapture(["help", "definitely-not-a-real-subcommand-xyz"], process.cwd(), 10_000),
            (error: unknown) => error instanceof Error && error.message.includes("exit"),
        );
    },
);

test("runCapture rejects with dockerUnavailable when the docker binary is missing", async () => {
    const originalPath = process.env.PATH;
    // An empty PATH still lets some libuv builds fall back to a search that finds a
    // non-executable file and reports EACCES instead; a PATH pointing at a directory that
    // does not exist at all is what reliably reproduces ENOENT across platforms.
    process.env.PATH = "/nonexistent-dir-for-docknight-tests";
    try {
        await assert.rejects(
            runCapture(["--version"], process.cwd(), 10_000),
            (error: unknown) => error instanceof Error && error.message.includes("docker binary"),
        );
    } finally {
        process.env.PATH = originalPath;
    }
});

test(
    "runCapture rejects with a timeout message when the process outlives the deadline",
    { skip: !dockerDaemonReachable },
    async () => {
        await assert.rejects(
            runCapture(["events"], process.cwd(), 50),
            (error: unknown) => error instanceof Error && error.message.includes("timeout"),
        );
    },
);
