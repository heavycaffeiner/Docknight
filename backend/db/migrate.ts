import type { DatabaseSync } from "node:sqlite";
import { log } from "../log.ts";
import { MIGRATIONS } from "./migrations/index.ts";

export class MigrationError extends Error {
    constructor(message: string, cause: unknown) {
        super(message, { cause });
        this.name = "MigrationError";
    }
}

interface MigrationRow {
    version: number;
}

/**
 * Apply every migration whose version is absent from the migration table, in ascending version
 * order, each inside its own IMMEDIATE transaction.
 *
 * Versions present in the table but absent from the source tree are logged as a warning and
 * ignored, so a rolled-back binary still starts against a newer database.
 *
 * @throws MigrationError wrapping the original error, naming the failed version.
 */
export function runMigrations(db: DatabaseSync): void {
    // The runner's own bookkeeping, created directly because it has to be read before the first
    // migration can be applied.
    db.exec(`
        CREATE TABLE IF NOT EXISTS migration (
            version    INTEGER PRIMARY KEY,
            name       TEXT NOT NULL,
            applied_at INTEGER NOT NULL
        ) STRICT;
    `);

    const applied = new Set(
        (db.prepare("SELECT version FROM migration").all() as unknown as MigrationRow[]).map(
            (row) => row.version,
        ),
    );

    const modules = [...MIGRATIONS].sort((a, b) => a.version - b.version);
    const known = new Set(modules.map((m) => m.version));

    const unknown = [...applied].filter((version) => !known.has(version)).sort((a, b) => a - b);
    if (unknown.length > 0) {
        log.warn(
            "db",
            `database carries migrations this build does not know: ${unknown.join(", ")}`,
        );
    }

    const insert = db.prepare(
        "INSERT INTO migration(version, name, applied_at) VALUES (?, ?, ?)",
    );

    for (const migration of modules) {
        if (applied.has(migration.version)) continue;
        db.exec("BEGIN IMMEDIATE");
        try {
            migration.up(db);
            insert.run(migration.version, migration.name, Math.floor(Date.now() / 1000));
            db.exec("COMMIT");
        } catch (error) {
            try {
                db.exec("ROLLBACK");
            } catch {
                // Already rolled back; the original error is what matters.
            }
            throw new MigrationError(
                `migration ${String(migration.version).padStart(3, "0")}-${migration.name} failed`,
                error,
            );
        }
        log.info(
            "db",
            `applied migration ${String(migration.version).padStart(3, "0")}-${migration.name}`,
        );
    }
}
