import type { WebSocket } from "ws";
import type { ServerMessage } from "../../common/protocol.ts";

/** Per-terminal coalescing state for one connection, see proposal 1 section 4.3.7. */
export interface TermQueue {
    endpoint: string;
    terminal: string;
    pending: string;
    dropped: number;
    timer: NodeJS.Timeout | null;
}

export interface Conn {
    /** Random 12-character id, used only in logs. */
    id: string;
    socket: WebSocket;
    /** null until authenticated, see proposal 2. */
    userId: number | null;
    /** The session row this connection presented, set together with userId. */
    sessionId: number | null;
    /** "" for browser clients, host:port for inbound management links. */
    endpoint: string;
    isAgentLink: boolean;
    joinedTerminals: Set<string>;
    inflight: Map<number, AbortController>;
    openedAt: number;
    /** Last WebSocket-level pong, for the keepalive sweep. */
    lastPongAt: number;
    /** The raw socket address, captured once at upgrade. */
    remoteAddress: string;
    /** The raw X-Forwarded-For header, captured once at upgrade; interpreted only if trustProxy. */
    forwardedFor: string | undefined;
    /** Coalescing state for terminalWrite, keyed by "endpoint\0terminal". */
    termQueues: Map<string, TermQueue>;
}

/** Send one frame if the socket is still open. Never throws. */
export function sendRaw(conn: Conn, msg: ServerMessage): void {
    if (conn.socket.readyState !== conn.socket.OPEN) return;
    try {
        conn.socket.send(JSON.stringify(msg));
    } catch {
        // The socket died between the readyState check and the call; nothing to do.
    }
}
