import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadConfig } from "../backend/config.ts";
import { checkPasswordStrength, hashPassword } from "../backend/auth/password.ts";
import { closeDatabase, database, openDatabase, run } from "../backend/db/index.ts";
import { initLogging } from "../backend/log.ts";

/**
 * Offline recovery for a locked-out administrator: rewrite the password hash, clear TOTP, and drop
 * every session. Refuses to run while a Docknight process holds the database.
 */
async function main(): Promise<void> {
    const config = loadConfig(process.argv, process.env);
    initLogging("warn");

    const db = openDatabase(config);

    try {
        db.exec("BEGIN IMMEDIATE");
        db.exec("ROLLBACK");
    } catch (error) {
        console.error(
            "The database is busy, which means a Docknight process is running. Stop it first.",
        );
        console.error(String(error instanceof Error ? error.message : error));
        closeDatabase();
        process.exit(1);
    }

    const users = database().prepare("SELECT id, username FROM user ORDER BY id").all() as {
        id: number;
        username: string;
    }[];
    if (users.length === 0) {
        console.error("There is no account to reset. Start Docknight and complete first-run setup.");
        closeDatabase();
        process.exit(1);
    }

    const target = users[0] as { id: number; username: string };
    console.log(`Resetting the password for ${target.username}.`);

    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    const password = await rl.question("New password: ");
    const repeat = await rl.question("Repeat: ");
    rl.close();

    if (password !== repeat) {
        console.error("Those do not match. Nothing was changed.");
        closeDatabase();
        process.exit(1);
    }
    if (checkPasswordStrength(password) !== null) {
        console.error(
            "That password is too weak: at least 8 characters and two of letters, digits, symbols.",
        );
        closeDatabase();
        process.exit(1);
    }

    run(
        `UPDATE user SET password_hash = :hash, totp_secret = NULL, totp_enabled = 0,
                         totp_last_step = NULL WHERE id = :id`,
        { hash: hashPassword(password), id: target.id },
    );
    run("DELETE FROM session WHERE user_id = :id", { id: target.id });
    closeDatabase();

    console.log("Done. Two-factor authentication was removed and every session was revoked.");
}

void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
