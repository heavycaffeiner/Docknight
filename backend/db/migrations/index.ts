import type { DatabaseSync } from "node:sqlite";
import * as initial from "./001-initial.ts";

export interface Migration {
    version: number;
    name: string;
    up: (db: DatabaseSync) => void;
}

/**
 * Every migration, listed once. Node has no directory glob at import time, so a new file is
 * added here as well; the runner sorts by version rather than trusting this order.
 */
export const MIGRATIONS: readonly Migration[] = [initial];
