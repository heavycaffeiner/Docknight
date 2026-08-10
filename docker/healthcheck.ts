import { connect } from "node:net";

/**
 * Open a TCP connection to the configured port and exit non-zero on failure. It performs no
 * authentication and touches no application state.
 */
const port = Number(process.env.DOCKNIGHT_PORT ?? "5001");
const host = process.env.DOCKNIGHT_HOSTNAME ?? "127.0.0.1";
const TIMEOUT_MS = 4_000;

const socket = connect({ port, host });
socket.setTimeout(TIMEOUT_MS);

socket.on("connect", () => {
    socket.destroy();
    process.exit(0);
});

socket.on("timeout", () => {
    console.error(`healthcheck: ${host}:${port} did not accept a connection in ${TIMEOUT_MS} ms`);
    socket.destroy();
    process.exit(1);
});

socket.on("error", (error: Error) => {
    console.error(`healthcheck: ${host}:${port} ${error.message}`);
    process.exit(1);
});
