import type { WebSocket } from "ws";
import type { ServerMessage } from "../../common/protocol.ts";

export interface Conn {
    /** Random 12-character id, used in logs and as the key for per-connection terminals. */
    id: string;
    socket: WebSocket;
    /** null until authenticated. */
    userId: number | null;
    /** The session row this connection presented, set together with userId. */
    sessionId: number | null;
    /** "" for browser clients, host:port for inbound management links. */
    endpoint: string;
    isAgentLink: boolean;
    joinedTerminals: Set<string>;
    inflight: Map<number, AbortController>;
    openedAt: number;
    /** Client address, resolved once at upgrade and honouring trustProxy. */
    ip: string;
    /** Last pong, for the keepalive sweep. */
    lastPongAt: number;
    /** Coalescing state for terminalWrite, see proposal 1 section 4.3.7. */
    pendingWrites: Map<string, string[]>;
    flushTimer: NodeJS.Timeout | null;
    droppedBytes: number;
    dropping: boolean;
    send: (message: ServerMessage) => void;
    closed: boolean;
}
