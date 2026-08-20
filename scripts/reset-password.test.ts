import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword, verifyPassword } from "../backend/auth/password.ts";
import { loadConfig } from "../backend/config.ts";
import { closeDatabase, one, openDatabase, run } from "../backend/db/index.ts";
import { runMigrations } from "../backend/db/migrate.ts";

const SCRIPT_PATH = fileURLToPath(new URL("./reset-password.ts", import.meta.url));
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface UserRow {
    id: number;
    username: string;
    password_hash: string;
    totp_secret: string | null;
    totp_enabled: number;
}

async function seedDatabase(dataDir: string, stacksDir: string): Promise<void> {
    await mkdir(dataDir, { recursive: true });
    const config = loadConfig(["node", "index.ts", "--data-dir", dataDir, "--stacks-dir", stacksDir], {});
    const db = openDatabase(config);
    runMigrations(db);
    run("INSERT INTO user (username, password_hash, totp_secret, totp_enabled) VALUES (:u, :h, 'ABCDEF', 1)", {
        u: "admin",
        h: hashPassword("OldPassw0rd!"),
    });
    run("INSERT INTO session (user_id, token_hash, created_at, last_used_at, expires_at) VALUES (1, 'x', 0, 0, 99999999999)");
    closeDatabase();
}

/** Run the script, typing the two prompts with a real gap between keystrokes and lines. */
function runResetPassword(
    dataDir: string,
    stacksDir: string,
    password: string,
    repeat: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            [SCRIPT_PATH, "--data-dir", dataDir, "--stacks-dir", stacksDir],
            { stdio: ["pipe", "pipe", "pipe"] },
        );
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
        child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));

        // A real terminal never delivers two lines in the same read(); a gap here is what
        // keeps readline's internal state machine from racing the two question() calls. The
        // gap needs to be generous: readline needs a moment after the first "line" event to
        // register the second question()'s listener before the write below reaches it.
        void (async () => {
            await delay(500);
            child.stdin.write(`${password}\n`);
            await delay(500);
            child.stdin.write(`${repeat}\n`);
        })();
    });
}

test("reset-password rewrites the hash, clears TOTP, and revokes every session", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-reset-"));
    const dataDir = join(root, "data");
    const stacksDir = join(root, "stacks");
    try {
        await seedDatabase(dataDir, stacksDir);

        const result = await runResetPassword(dataDir, stacksDir, "BrandNewPassw0rd!", "BrandNewPassw0rd!");
        assert.equal(result.code, 0, result.stderr);
        assert.match(result.stdout, /password reset; TOTP cleared; all sessions revoked/);

        const config = loadConfig(["node", "index.ts", "--data-dir", dataDir, "--stacks-dir", stacksDir], {});
        openDatabase(config);
        try {
            const user = one<UserRow>("SELECT * FROM user WHERE username = 'admin'");
            assert.ok(user !== undefined);
            assert.equal(user?.totp_secret, null);
            assert.equal(user?.totp_enabled, 0);
            assert.equal(verifyPassword("BrandNewPassw0rd!", user?.password_hash ?? ""), true);
            assert.equal(verifyPassword("OldPassw0rd!", user?.password_hash ?? ""), false);

            const sessions = one<{ c: number }>("SELECT count(*) as c FROM session");
            assert.equal(sessions?.c, 0);
        } finally {
            closeDatabase();
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("reset-password refuses mismatched passwords without changing anything", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-reset-"));
    const dataDir = join(root, "data");
    const stacksDir = join(root, "stacks");
    try {
        await seedDatabase(dataDir, stacksDir);

        const result = await runResetPassword(dataDir, stacksDir, "FirstPassw0rd!", "SecondPassw0rd!");
        assert.notEqual(result.code, 0);
        assert.match(result.stderr, /do not match/);

        const config = loadConfig(["node", "index.ts", "--data-dir", dataDir, "--stacks-dir", stacksDir], {});
        openDatabase(config);
        try {
            const user = one<UserRow>("SELECT * FROM user WHERE username = 'admin'");
            assert.ok(user !== undefined);
            assert.equal(user?.totp_enabled, 1); // untouched: nothing was written on a mismatch
        } finally {
            closeDatabase();
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("reset-password refuses a weak replacement password", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-reset-"));
    const dataDir = join(root, "data");
    const stacksDir = join(root, "stacks");
    try {
        await seedDatabase(dataDir, stacksDir);
        const result = await runResetPassword(dataDir, stacksDir, "weak", "weak");
        assert.notEqual(result.code, 0);
        assert.match(result.stderr, /too weak/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("reset-password refuses to run while a writer holds the database", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-reset-"));
    const dataDir = join(root, "data");
    const stacksDir = join(root, "stacks");
    try {
        await seedDatabase(dataDir, stacksDir);

        const config = loadConfig(["node", "index.ts", "--data-dir", dataDir, "--stacks-dir", stacksDir], {});
        const holder = openDatabase(config);
        holder.exec("BEGIN IMMEDIATE");
        holder.prepare("INSERT INTO setting (key, value, type) VALUES ('k', '1', 'x')").run();
        try {
            const result = await runResetPassword(dataDir, stacksDir, "AnotherPassw0rd!", "AnotherPassw0rd!");
            assert.notEqual(result.code, 0);
            assert.match(result.stderr, /in use|locked|busy/i);
        } finally {
            holder.exec("ROLLBACK");
            closeDatabase();
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
