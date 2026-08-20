import type { DatabaseSync } from "node:sqlite";
import type { Config } from "./config.ts";
import type { StackRegistry } from "./stack/registry.ts";
import type { TerminalRegistry } from "./terminal/registry.ts";
import type { WsLayer } from "./ws/server.ts";

/**
 * The shared container every module wires itself into at startup. Grown by later phases.
 */
export interface Services {
    config: Readonly<Config>;
    db: DatabaseSync;
    ws: WsLayer;
    terminals: TerminalRegistry;
    stacks: StackRegistry;
    /** Run in registration order during shutdown: WS first, then terminals, then agent links. */
    shutdownHooks: Array<() => Promise<void>>;
}
