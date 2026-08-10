import type { DatabaseSync } from "node:sqlite";

export const version = 1;
export const name = "initial";

export function up(db: DatabaseSync): void {
    db.exec(`
        CREATE TABLE setting (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL,           -- JSON encoded
            type  TEXT                     -- grouping tag, e.g. 'general'
        ) STRICT;
    `);

    db.exec(`
        CREATE TABLE user (
            id             INTEGER PRIMARY KEY,
            username       TEXT NOT NULL UNIQUE,
            password_hash  TEXT NOT NULL,
            active         INTEGER NOT NULL DEFAULT 1,
            totp_secret    TEXT,
            totp_enabled   INTEGER NOT NULL DEFAULT 0,
            totp_last_step INTEGER
        ) STRICT;
    `);

    db.exec(`
        CREATE TABLE session (
            id           INTEGER PRIMARY KEY,
            user_id      INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
            token_hash   TEXT NOT NULL UNIQUE,
            created_at   INTEGER NOT NULL,
            last_used_at INTEGER NOT NULL,
            expires_at   INTEGER NOT NULL
        ) STRICT;
    `);

    db.exec("CREATE INDEX session_user_id ON session(user_id);");

    db.exec(`
        CREATE TABLE agent (
            id       INTEGER PRIMARY KEY,
            url      TEXT NOT NULL UNIQUE,
            username TEXT NOT NULL,
            secret   TEXT NOT NULL,
            name     TEXT,
            active   INTEGER NOT NULL DEFAULT 1
        ) STRICT;
    `);
}
