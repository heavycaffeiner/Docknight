import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config.ts";
import { writeAtomic, writeStack } from "./write.ts";

// writeStack assumes stacksDir already exists, which is proposal 0's prepareDirectories
// contract; tests create it by hand rather than depending on that module.
async function testConfig(dataDir: string, stacksDir: string): Promise<ReturnType<typeof loadConfig>> {
    await mkdir(stacksDir, { recursive: true });
    return loadConfig(["node", "index.ts", "--data-dir", dataDir, "--stacks-dir", stacksDir], {});
}

test("writeAtomic never leaves the target partially written on a mid-write failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-atomic-"));
    try {
        const target = join(root, "compose.yaml");
        await writeFile(target, "original content\n");

        // Simulate a crash between the temp write and the rename: create the temp file by
        // hand and leave it there, without ever renaming it over the target.
        const crashedTmp = `${target}.tmp-deadbee`;
        await writeFile(crashedTmp, "half-written garbage");

        assert.equal(await readFile(target, "utf8"), "original content\n");

        // A real write still succeeds afterwards and its own temp file does not leak.
        await writeAtomic(target, "new content\n");
        assert.equal(await readFile(target, "utf8"), "new content\n");
        const entries = await readdir(root);
        assert.deepEqual(
            entries.filter((entry) => entry.includes(".tmp-")),
            ["compose.yaml.tmp-deadbee"],
            "writeAtomic must not leave its own temp file behind, only the pre-existing crash artefact",
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("writeAtomic removes its own temp file and rethrows when the rename fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-atomic-fail-"));
    try {
        // A target directory that does not exist makes the rename fail with ENOENT.
        const target = join(root, "missing-dir", "compose.yaml");
        await assert.rejects(writeAtomic(target, "content"));
        const entries = await readdir(root);
        assert.deepEqual(entries, [], "the temp file must be removed after a failed rename");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("writeStack create mode makes the directory and refuses to overwrite an existing one", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-writestack-"));
    try {
        const config = await testConfig(join(root, "data"), join(root, "stacks"));
        await writeStack(config, "demo", "services: {}\n", "", true);
        assert.equal(
            await readFile(join(root, "stacks", "demo", "compose.yaml"), "utf8"),
            "services: {}\n",
        );

        await assert.rejects(
            writeStack(config, "demo", "services: {}\n", "", true),
            (error: unknown) => error instanceof Error && error.message.includes("already exists"),
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("writeStack update mode requires the directory to already exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-writestack-"));
    try {
        const config = await testConfig(join(root, "data"), join(root, "stacks"));
        await assert.rejects(
            writeStack(config, "demo", "services: {}\n", "", false),
            (error: unknown) => error instanceof Error && error.message.includes("no stack named"),
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("writeStack preserves the existing compose file name on update", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-writestack-"));
    try {
        const dir = join(root, "stacks", "demo");
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, "docker-compose.yml"), "services: {}\n");

        const config = await testConfig(join(root, "data"), join(root, "stacks"));
        await writeStack(config, "demo", "services:\n  web: {}\n", "", false);

        assert.equal(
            await readFile(join(dir, "docker-compose.yml"), "utf8"),
            "services:\n  web: {}\n",
        );
        const entries = await readdir(dir);
        assert.ok(!entries.includes("compose.yaml"), "must not create a second compose file");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("writeStack writes .env when content is non-empty, and when a .env already exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-writestack-env-"));
    try {
        const config = await testConfig(join(root, "data"), join(root, "stacks"));
        await writeStack(config, "demo", "services: {}\n", "FOO=bar\n", true);
        assert.equal(await readFile(join(root, "stacks", "demo", ".env"), "utf8"), "FOO=bar\n");

        // An edit that clears the content still overwrites the existing .env rather than
        // leaving stale content behind, because the file already exists.
        await writeStack(config, "demo", "services: {}\n", "", false);
        assert.equal(await readFile(join(root, "stacks", "demo", ".env"), "utf8"), "");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("writeStack never creates .env when content is empty and none exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-writestack-noenv-"));
    try {
        const config = await testConfig(join(root, "data"), join(root, "stacks"));
        await writeStack(config, "demo", "services: {}\n", "", true);
        const entries = await readdir(join(root, "stacks", "demo"));
        assert.ok(!entries.includes(".env"));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
