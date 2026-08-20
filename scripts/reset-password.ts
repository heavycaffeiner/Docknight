import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { checkPasswordStrength, hashPassword } from "../backend/auth/password.ts";
import { loadConfig } from "../backend/config.ts";
import { closeDatabase, one, openDatabase, run, tx } from "../backend/db/index.ts";
import { initLogging } from "../backend/log.ts";

interface UserRow {
    id: number;
    username: string;
}

/**
 * Offline recovery for a locked-out administrator: rewrite the password hash, clear TOTP, and
 * drop every session. Refuses to run while a Docknight process holds the database.
 */
async function main(): Promise<void> {
    const config = loadConfig(process.argv, process.env);
    initLogging("warn");

    const db = openDatabase(config);

    try {
        db.exec("BEGIN IMMEDIATE");
        db.exec("ROLLBACK");
    } catch (error) {
        process.stderr.write("database is in use; stop Docknight first\n");
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        closeDatabase();
        process.exit(1);
    }

    const target = one<UserRow>("SELECT id, username FROM user ORDER BY id LIMIT 1");
    if (target === undefined) {
        process.stderr.write("there is no account to reset; start Docknight and complete first-run setup\n");
        closeDatabase();
        process.exit(1);
    }

    process.stdout.write(`Resetting the password for ${target.username}.\n`);

    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    const password = await rl.question("New password: ");
    const repeat = await rl.question("Repeat: ");
    rl.close();

    if (password !== repeat) {
        process.stderr.write("those do not match; nothing was changed\n");
        closeDatabase();
        process.exit(1);
    }
    const weak = checkPasswordStrength(password);
    if (weak !== null) {
        process.stderr.write(
            "that password is too weak: at least 8 characters and two of letters, digits, symbols\n",
        );
        closeDatabase();
        process.exit(1);
    }

    tx(() => {
        run(
            "UPDATE user SET password_hash = :hash, totp_secret = NULL, totp_enabled = 0, totp_last_step = NULL WHERE id = :id",
            { hash: hashPassword(password), id: target.id },
        );
        run("DELETE FROM session WHERE user_id = :id", { id: target.id });
    });
    closeDatabase();

    process.stdout.write("password reset; TOTP cleared; all sessions revoked\n");
}

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
});
