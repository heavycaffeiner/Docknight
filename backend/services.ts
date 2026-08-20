import type { DatabaseSync } from "node:sqlite";
import type { Config } from "./config.ts";

/**
 * The shared container every module wires itself into at startup. Grown by later phases; empty
 * beyond configuration, the database handle, and the shutdown hook list in this one.
 */
export interface Services {
    config: Readonly<Config>;
    db: DatabaseSync;
    /** Run in registration order during shutdown: WS first, then terminals, then agent links. */
    shutdownHooks: Array<() => Promise<void>>;
}
