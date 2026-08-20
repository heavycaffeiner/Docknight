import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { join } from "node:path";
import type { Config } from "../config.ts";
import { log } from "../log.ts";

export const DB_FILE_NAME = "docknight.db";

let db: DatabaseSync | null = null;
const statements = new Map<string, StatementSync>();

/**
 * Open the SQLite database at `${dataDir}/docknight.db`, apply the connection pragmas, and
 * return the handle. Creates the file when absent.
 */
export function openDatabase(config: Readonly<Config>): DatabaseSync {
    const path = join(config.dataDir, DB_FILE_NAME);
    const handle = new DatabaseSync(path);

    // WAL with synchronous NORMAL survives a process crash without corruption and a host power
    // loss with at most the last transaction lost.
    handle.exec("PRAGMA journal_mode = WAL");
    handle.exec("PRAGMA foreign_keys = ON");
    handle.exec("PRAGMA synchronous = NORMAL");
    handle.exec("PRAGMA busy_timeout = 5000");

    db = handle;
    statements.clear();
    log.info("db", `opened ${path}`);
    return handle;
}

function database(): DatabaseSync {
    if (db === null) throw new Error("database is not open");
    return db;
}

/** Prepared statements are cached, because the same few dozen statements run repeatedly. */
function prepared(sql: string): StatementSync {
    const cached = statements.get(sql);
    if (cached) return cached;
    const statement = database().prepare(sql);
    statements.set(sql, statement);
    return statement;
}

/** Run a statement that returns no rows. Throws SqliteError on constraint violation. */
export function run(
    sql: string,
    params: Record<string, SQLInputValue> = {},
): { changes: number; lastInsertRowid: number } {
    const result = prepared(sql).run(params);
    return {
        changes: Number(result.changes),
        lastInsertRowid: Number(result.lastInsertRowid),
    };
}

/** Return the first row, or undefined when the statement matches nothing. */
export function one<T>(sql: string, params: Record<string, SQLInputValue> = {}): T | undefined {
    return prepared(sql).get(params) as T | undefined;
}

/** Return all matching rows. */
export function all<T>(sql: string, params: Record<string, SQLInputValue> = {}): T[] {
    return prepared(sql).all(params) as T[];
}

/** Run fn inside an IMMEDIATE transaction. Commits on return, rolls back on throw. */
export function tx<T>(fn: () => T): T {
    const handle = database();
    handle.exec("BEGIN IMMEDIATE");
    try {
        const result = fn();
        handle.exec("COMMIT");
        return result;
    } catch (error) {
        try {
            handle.exec("ROLLBACK");
        } catch {
            // A rollback failure means the transaction is already gone; the original error wins.
        }
        throw error;
    }
}

/** Checkpoint the WAL and release the handle. Called last in the shutdown sequence. */
export function closeDatabase(): void {
    if (db === null) return;
    try {
        db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch (error) {
        log.warn("db", "wal checkpoint failed", error);
    }
    statements.clear();
    db.close();
    db = null;
    log.info("db", "closed");
}
