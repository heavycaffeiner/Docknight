import { connect } from "node:net";

const TIMEOUT_MS = 3_000;

/**
 * A plain TCP connect to the configured port, nothing more: no HTTP request, no auth, no read
 * of application state. If something is listening, the process is alive; that is the entire
 * question a container healthcheck needs answered.
 */
function check(): void {
    const port = Number.parseInt(process.env.DOCKNIGHT_PORT ?? "5001", 10);
    const socket = connect({ port, host: "127.0.0.1" });

    const fail = (): void => {
        socket.destroy();
        process.exit(1);
    };

    socket.setTimeout(TIMEOUT_MS, fail);
    socket.once("error", fail);
    socket.once("connect", () => {
        socket.end();
        process.exit(0);
    });
}

check();
