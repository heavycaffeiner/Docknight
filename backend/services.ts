import type { DatabaseSync } from "node:sqlite";
import type { Config } from "./config.ts";
import type { WsLayer } from "./ws/server.ts";

/**
 * The shared container every module wires itself into at startup. Grown by later phases; empty
 * beyond the WebSocket layer and the shutdown hook list in this one.
 */
export interface Services {
    config: Readonly<Config>;
    db: DatabaseSync;
    ws: WsLayer;
    /** Run in registration order during shutdown: WS first, then terminals, then agent links. */
    shutdownHooks: Array<() => Promise<void>>;
}
