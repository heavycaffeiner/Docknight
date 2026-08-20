import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config.ts";
import { readGlobalEnv, writeGlobalEnv } from "./global-env.ts";

async function testConfig(): Promise<{ config: ReturnType<typeof loadConfig>; root: string }> {
    const root = await mkdtemp(join(tmpdir(), "docknight-global-env-"));
    const stacksDir = join(root, "stacks");
    await mkdir(stacksDir, { recursive: true });
    const config = loadConfig(
        ["node", "index.ts", "--data-dir", join(root, "data"), "--stacks-dir", stacksDir],
        {},
    );
    return { config, root };
}

test("readGlobalEnv returns the placeholder when the file does not exist", async () => {
    const { config, root } = await testConfig();
    try {
        assert.equal(await readGlobalEnv(config), "# VARIABLE=value #comment");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("writeGlobalEnv writes real content and readGlobalEnv reads it back", async () => {
    const { config, root } = await testConfig();
    try {
        await writeGlobalEnv(config, "FOO=bar\n");
        assert.equal(await readGlobalEnv(config), "FOO=bar\n");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("writing the placeholder deletes an existing file", async () => {
    const { config, root } = await testConfig();
    try {
        await writeGlobalEnv(config, "FOO=bar\n");
        await writeGlobalEnv(config, "# VARIABLE=value #comment");
        const entries = await readdir(config.stacksDir);
        assert.ok(!entries.includes("global.env"));
        assert.equal(await readGlobalEnv(config), "# VARIABLE=value #comment");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("writeGlobalEnv rejects malformed env text before writing anything", async () => {
    const { config, root } = await testConfig();
    try {
        await assert.rejects(writeGlobalEnv(config, "NOT-AN-ASSIGNMENT\n"));
        const entries = await readdir(config.stacksDir);
        assert.ok(!entries.includes("global.env"));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
