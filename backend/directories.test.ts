import assert from "node:assert/strict";
import { test } from "node:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyOwnership, DataDirError, prepareDirectories } from "./directories.ts";
import { loadConfig } from "./config.ts";

function configFor(dataDir: string, stacksDir: string) {
    return loadConfig(["node", "index.ts", "--data-dir", dataDir, "--stacks-dir", stacksDir], {});
}

test("prepareDirectories creates both directories when absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-dirs-"));
    try {
        const dataDir = join(root, "data");
        const stacksDir = join(root, "stacks");
        await prepareDirectories(configFor(dataDir, stacksDir));
        // No throw means both directories exist and are writable; re-running is idempotent.
        await prepareDirectories(configFor(dataDir, stacksDir));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("prepareDirectories rejects a path that is a file, not a directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-dirs-"));
    try {
        const dataDir = join(root, "data-as-file");
        await writeFile(dataDir, "not a directory");
        await assert.rejects(
            prepareDirectories(configFor(dataDir, join(root, "stacks"))),
            DataDirError,
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("prepareDirectories names the path in a read-only directory error", async () => {
    if (process.getuid?.() === 0) return; // root ignores directory permissions
    const root = await mkdtemp(join(tmpdir(), "docknight-dirs-"));
    try {
        const dataDir = join(root, "data");
        const stacksDir = join(root, "stacks");
        await prepareDirectories(configFor(dataDir, stacksDir));
        await chmod(dataDir, 0o500);
        try {
            await assert.rejects(prepareDirectories(configFor(dataDir, stacksDir)), (error: unknown) => {
                return error instanceof DataDirError && error.message.includes(dataDir);
            });
        } finally {
            await chmod(dataDir, 0o700);
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("applyOwnership is a no-op when PUID/PGID are unset", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-dirs-"));
    try {
        await assert.doesNotReject(applyOwnership(configFor(join(root, "data"), join(root, "stacks")), root));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
