import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decryptSecret, encryptSecret, loadOrCreateKey } from "./crypto.ts";

test("round trip: encryptSecret then decryptSecret returns the original plaintext", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-agent-crypto-"));
    try {
        const key = await loadOrCreateKey(root);
        const encrypted = encryptSecret(key, "hunter2 correct horse battery staple");
        assert.notEqual(encrypted, "hunter2 correct horse battery staple");
        assert.equal(decryptSecret(key, encrypted), "hunter2 correct horse battery staple");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("a tampered ciphertext is rejected", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-agent-crypto-"));
    try {
        const key = await loadOrCreateKey(root);
        const encrypted = encryptSecret(key, "the password");
        const parts = encrypted.split("$");
        const tampered = Buffer.from(parts[2] as string, "base64");
        tampered[0] = (tampered[0] as number) ^ 0xff;
        parts[2] = tampered.toString("base64");
        assert.throws(
            () => decryptSecret(key, parts.join("$")),
            (error: unknown) => error instanceof Error && error.message.includes("decrypt"),
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("a tampered authentication tag is rejected", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-agent-crypto-"));
    try {
        const key = await loadOrCreateKey(root);
        const encrypted = encryptSecret(key, "the password");
        const parts = encrypted.split("$");
        const tampered = Buffer.from(parts[3] as string, "base64");
        tampered[0] = (tampered[0] as number) ^ 0xff;
        parts[3] = tampered.toString("base64");
        assert.throws(
            () => decryptSecret(key, parts.join("$")),
            (error: unknown) => error instanceof Error && error.message.includes("decrypt"),
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("the key file is created with mode 0600", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-agent-crypto-"));
    try {
        await loadOrCreateKey(root);
        const info = await stat(join(root, "agent-key"));
        assert.equal(info.mode & 0o777, 0o600);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("a second loadOrCreateKey call returns the same key", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-agent-crypto-"));
    try {
        const first = await loadOrCreateKey(root);
        const second = await loadOrCreateKey(root);
        assert.deepEqual(first, second);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("decryptSecret rejects a value with an unrecognised format", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-agent-crypto-"));
    try {
        const key = await loadOrCreateKey(root);
        assert.throws(
            () => decryptSecret(key, "not-the-right-format"),
            (error: unknown) => error instanceof Error && error.message.includes("format"),
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("loadOrCreateKey rejects a key file that is not exactly 32 bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-agent-crypto-"));
    try {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(join(root, "agent-key"), Buffer.from("too short"), { mode: 0o600 });
        await assert.rejects(
            loadOrCreateKey(root),
            (error: unknown) => error instanceof Error && error.message.includes("32-byte"),
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("concurrent loadOrCreateKey calls agree on one winning key", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-agent-crypto-"));
    try {
        const [a, b, c] = await Promise.all([
            loadOrCreateKey(root),
            loadOrCreateKey(root),
            loadOrCreateKey(root),
        ]);
        assert.deepEqual(a, b);
        assert.deepEqual(b, c);
        const onDisk = await readFile(join(root, "agent-key"));
        assert.deepEqual(a, onDisk);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
