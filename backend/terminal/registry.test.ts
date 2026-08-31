import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { EventName } from "../../common/protocol.ts";
import type { Conn } from "../ws/conn.ts";
import type { WsLayer } from "../ws/server.ts";
import { createTerminalRegistry } from "./registry.ts";

interface SentEvent {
    conn: Conn;
    endpoint: string;
    event: EventName;
    data: unknown;
}

function fakeWsLayer(): { ws: WsLayer; sent: SentEvent[] } {
    const sent: SentEvent[] = [];
    const conns = new Set<Conn>();
    const ws: WsLayer = {
        upgradeHandler: () => {
            throw new Error("not used in this test");
        },
        conns,
        sendEvent: (conn, endpoint, event, data) => {
            sent.push({ conn, endpoint, event, data });
        },
        broadcastEvent: () => {
            throw new Error("not used in this test");
        },
        closeAll: () => Promise.resolve(),
    };
    return { ws, sent };
}

let nextConnId = 0;

function fakeConn(overrides: Partial<Conn> = {}): Conn {
    nextConnId += 1;
    return {
        id: `conn${nextConnId}`,
        socket: {} as Conn["socket"],
        userId: 1,
        sessionId: 1,
        endpoint: "",
        isAgentLink: false,
        joinedTerminals: new Set(),
        inflight: new Map(),
        openedAt: Date.now(),
        lastPongAt: Date.now(),
        remoteAddress: "127.0.0.1",
        forwardedFor: undefined,
        termQueues: new Map(),
        ...overrides,
    };
}

function eventsFor(sent: SentEvent[], event: EventName): unknown[] {
    return sent.filter((s) => s.event === event).map((s) => s.data);
}

/**
 * Poll until `pid` is reclaimed. closeTerminal escalates Ctrl-C, then SIGTERM at 2 s, then
 * SIGKILL at 5 s, and the exit is delivered asynchronously, so a fixed sleep races the
 * teardown whenever the suite is under load.
 */
async function waitForExit(pid: number, timeoutMs = 8000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        let alive = true;
        try {
            process.kill(pid, 0);
        } catch {
            alive = false;
        }
        if (!alive) return;
        assert.ok(Date.now() < deadline, `process ${pid} still alive after ${timeoutMs}ms`);
        await delay(25);
    }
}

test("run() resolves with the exit code; output lands in the buffer; a joined conn sees it", async () => {
    const { ws, sent } = fakeWsLayer();
    const registry = createTerminalRegistry(ws);
    const conn = fakeConn();

    const exitCode = await registry.run("t1", "/bin/sh", ["-c", "echo hello"], process.cwd(), conn);
    assert.equal(exitCode, 0);

    const writes = eventsFor(sent, "terminalWrite") as { terminal: string; data: string }[];
    assert.ok(writes.some((w) => w.terminal === "t1" && w.data.includes("hello")));

    const exits = eventsFor(sent, "terminalExit") as { terminal: string; exitCode: number }[];
    assert.deepEqual(exits.at(-1), { terminal: "t1", exitCode: 0 });
});

test("run() with every subscriber gone still resolves; the name is reusable after exit", async () => {
    const { ws } = fakeWsLayer();
    const registry = createTerminalRegistry(ws);
    const conn = fakeConn();

    const promise = registry.run("t2", "/bin/sh", ["-c", "sleep 0.1; exit 3"], process.cwd(), conn);
    registry.leave(conn, "t2");
    const exitCode = await promise;
    assert.equal(exitCode, 3);
    assert.equal(registry.has("t2"), false);

    const rerun = await registry.run("t2", "/bin/sh", ["-c", "exit 0"], process.cwd(), null);
    assert.equal(rerun, 0);
});

test("join before creation returns an empty buffer; join after output replays it", async () => {
    const { ws } = fakeWsLayer();
    const registry = createTerminalRegistry(ws);
    const conn = fakeConn();

    const early = registry.join(conn, "does-not-exist-yet");
    assert.deepEqual(early, { buffer: "", exited: false, exitCode: null });

    registry.getOrCreate(
        "t3",
        "follow",
        "/bin/sh",
        ["-c", "printf hello; sleep 5"],
        process.cwd(),
        { cols: 80, rows: 24 },
    );
    await delay(150);
    const late = registry.join(conn, "t3");
    assert.equal(late.buffer, "hello");
    assert.equal(late.exited, false);

    registry.leave(conn, "t3");
});

test("scrollback caps: a process printing past the byte cap leaves at most 256 KiB buffered", async () => {
    const { ws } = fakeWsLayer();
    const registry = createTerminalRegistry(ws);
    const conn = fakeConn();

    // 1100 lines of 1000 bytes each is a little over 1 MiB, comfortably past the 256 KiB cap.
    const script = "for i in $(seq 1 1100); do printf '%01000d\\n' 0; done";
    const exitCode = await registry.run("t4", "/bin/sh", ["-c", script], process.cwd(), conn);
    assert.equal(exitCode, 0);
    // The terminal already exited and was removed from the registry; verify indirectly by
    // spawning a fresh one that stays alive and asserting the same script does not overflow.
    registry.getOrCreate("t4b", "follow", "/bin/sh", ["-c", script + "; sleep 5"], process.cwd(), {
        cols: 80,
        rows: 24,
    });
    await delay(300);
    const joined = registry.join(conn, "t4b");
    assert.ok(Buffer.byteLength(joined.buffer, "utf8") <= 256 * 1024);
    registry.leave(conn, "t4b");
});

test("leave on an exec terminal closes the pty; detach does not", async () => {
    const { ws } = fakeWsLayer();
    const registry = createTerminalRegistry(ws);
    const connA = fakeConn();
    const connB = fakeConn();

    const state = registry.getOrCreate("t5", "exec", "/bin/sh", [], process.cwd(), {
        cols: 80,
        rows: 24,
    });
    const pid = state.pty.pid;
    registry.join(connA, "t5");
    registry.join(connB, "t5");

    registry.detachConnection(connA);
    assert.equal(registry.has("t5"), true, "detach must not close a terminal with a remaining viewer");

    registry.leave(connB, "t5");
    await waitForExit(pid);
});

test("idle sweeper: a follow terminal is reaped after its idle grace, an exec after its own", async () => {
    const { ws } = fakeWsLayer();
    const registry = createTerminalRegistry(ws, {
        idleSweepIntervalMs: 20,
        followIdleMs: 50,
        execHostIdleMs: 220,
    });
    const conn = fakeConn();

    const follow = registry.getOrCreate("f1", "follow", "/bin/sh", ["-c", "sleep 5"], process.cwd(), {
        cols: 80,
        rows: 24,
    });
    // An interactive shell ignores SIGINT by default, so closeTerminal's Ctrl-C would never
    // take effect within this test's window; sleep responds to it immediately and still
    // exercises the same escalation path.
    const exec = registry.getOrCreate("e1", "exec", "/bin/sh", ["-c", "sleep 30"], process.cwd(), {
        cols: 80,
        rows: 24,
    });
    registry.join(conn, "f1");
    registry.join(conn, "e1");
    registry.leave(conn, "f1"); // follow.idleSince starts now, kind "follow" is not auto-closed on leave
    registry.detachConnection(conn); // detach both without an explicit exec leave

    await delay(140);
    assert.equal(follow.exited, true, "follow should be reaped after its 50ms grace");
    assert.equal(exec.exited, false, "exec should still be alive inside its 220ms grace");

    await delay(160);
    assert.equal(exec.exited, true, "exec should be reaped after its 220ms grace");
});

test("input to a follow terminal is rejected as not interactive", () => {
    const { ws } = fakeWsLayer();
    const registry = createTerminalRegistry(ws);
    const conn = fakeConn();
    registry.getOrCreate("f2", "follow", "/bin/sh", ["-c", "sleep 5"], process.cwd(), {
        cols: 80,
        rows: 24,
    });
    registry.join(conn, "f2");
    assert.throws(
        () => registry.input(conn, "f2", "x"),
        (error: unknown) => error instanceof Error && error.message.includes("does not accept input"),
    );
    registry.leave(conn, "f2");
});

test("input from a connection that never joined is rejected", () => {
    const { ws } = fakeWsLayer();
    const registry = createTerminalRegistry(ws);
    const joined = fakeConn();
    const stranger = fakeConn();
    registry.getOrCreate("e2", "exec", "/bin/sh", [], process.cwd(), { cols: 80, rows: 24 });
    registry.join(joined, "e2");
    assert.throws(
        () => registry.input(stranger, "e2", "x"),
        (error: unknown) => error instanceof Error && error.message.includes("not joined"),
    );
    registry.leave(joined, "e2");
});

test("resize clamps out-of-range values into [20,500] and [5,200]", () => {
    const { ws } = fakeWsLayer();
    const registry = createTerminalRegistry(ws);
    const conn = fakeConn();
    const state = registry.getOrCreate("e3", "exec", "/bin/sh", [], process.cwd(), {
        cols: 80,
        rows: 24,
    });
    registry.join(conn, "e3");
    registry.resize(conn, "e3", 1, 9999);
    assert.equal(state.cols, 20);
    assert.equal(state.rows, 200);
    registry.leave(conn, "e3");
});

test("spawn of a missing binary throws commandFailed and notifies a waiting connection", async () => {
    const { ws, sent } = fakeWsLayer();
    const registry = createTerminalRegistry(ws);
    const conn = fakeConn();

    // run() throws synchronously on a spawn failure rather than returning a rejected promise,
    // so a plain try/catch is used instead of assert.rejects.
    try {
        await registry.run("t6", "definitely-not-a-real-binary-xyz", [], process.cwd(), conn);
        assert.fail("expected run() to throw");
    } catch (error) {
        assert.ok(error instanceof Error && error.message.includes("not found"));
    }
    const exits = eventsFor(sent, "terminalExit") as { terminal: string; exitCode: number }[];
    assert.deepEqual(exits.at(-1), { terminal: "t6", exitCode: 127 });
});

test(
    "closeAll leaves zero children even for a process that traps SIGINT and SIGTERM",
    { timeout: 10_000 },
    async () => {
        const { ws } = fakeWsLayer();
        const registry = createTerminalRegistry(ws);
        const state = registry.getOrCreate(
            "t7",
            "host",
            "/bin/sh",
            ["-c", "trap '' INT TERM; sleep 30"],
            process.cwd(),
            { cols: 80, rows: 24 },
        );
        const pid = state.pty.pid;
        await registry.closeAll();
        await waitForExit(pid);
    },
);
