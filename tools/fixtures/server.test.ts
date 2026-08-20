import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocket } from "ws";
import { startFixtureServer, type FixtureServer } from "./server.ts";

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil<T>(read: () => T | undefined, what: string, timeoutMs = 3_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = read();
        if (value !== undefined) return value;
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await delay(5);
    }
}

interface ResponseFrame {
    t: "res";
    id: number;
    ok: boolean;
    data?: unknown;
    error?: { code: string };
}
interface EventFrame {
    t: "evt";
    endpoint: string;
    event: string;
    data: unknown;
}
type Frame = ResponseFrame | EventFrame | { t: "pong" };

function isResponse(frame: Frame): frame is ResponseFrame {
    return frame.t === "res";
}
function isEvent(frame: Frame): frame is EventFrame {
    return frame.t === "evt";
}

function collectFrames(socket: WebSocket): Frame[] {
    const frames: Frame[] = [];
    socket.on("message", (raw: Buffer) => {
        frames.push(JSON.parse(raw.toString("utf8")) as Frame);
    });
    return frames;
}

function connect(port: number): Promise<{ socket: WebSocket; frames: Frame[] }> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const frames = collectFrames(socket);
    return new Promise((resolve, reject) => {
        socket.once("open", () => resolve({ socket, frames }));
        socket.once("error", reject);
    });
}

function waitForResponse(
    frames: Frame[],
    id: number,
    what: string,
    timeoutMs?: number,
): Promise<ResponseFrame> {
    return waitUntil(() => {
        const found = frames.find((f) => isResponse(f) && f.id === id);
        return found !== undefined && isResponse(found) ? found : undefined;
    }, what, timeoutMs);
}

/** Connect, log in with the fixture credentials, run a fixed request script, and collect every frame. */
async function runTranscript(port: number): Promise<Frame[]> {
    const { socket, frames } = await connect(port);

    let nextId = 1;
    const req = (method: string, params?: unknown): number => {
        const id = nextId;
        nextId += 1;
        socket.send(JSON.stringify({ t: "req", id, endpoint: "", method, params }));
        return id;
    };

    await waitForResponse(frames, req("auth.login", { username: "fixture", password: "fixture-password-1" }), "login");
    await waitForResponse(frames, req("stack.list"), "stack.list");
    await waitForResponse(frames, req("settings.get"), "settings.get");
    await waitForResponse(frames, req("docker.stats"), "docker.stats");
    await waitForResponse(frames, req("docker.networks"), "docker.networks");
    await waitForResponse(frames, req("agent.list"), "agent.list");

    await delay(50); // let any trailing pushed events land
    socket.close();
    await new Promise<void>((resolve) => socket.once("close", () => resolve()));
    return frames;
}

test("two runs of the same scenario produce byte-identical transcripts", async () => {
    let first: FixtureServer | null = null;
    let second: FixtureServer | null = null;
    try {
        first = await startFixtureServer("typical", 0);
        const firstTranscript = await runTranscript(first.port);
        await first.close();
        first = null;

        second = await startFixtureServer("typical", 0);
        const secondTranscript = await runTranscript(second.port);
        await second.close();
        second = null;

        assert.equal(JSON.stringify(firstTranscript), JSON.stringify(secondTranscript));
        assert.ok(firstTranscript.length > 0);
    } finally {
        await first?.close();
        await second?.close();
    }
});

test("every declared scenario starts, serves auth.login, and closes cleanly", async () => {
    const names = ["typical", "empty", "single-stack", "dense", "extreme", "degraded", "slow"] as const;
    for (const name of names) {
        const server = await startFixtureServer(name, 0);
        try {
            const { socket, frames } = await connect(server.port);
            socket.send(
                JSON.stringify({
                    t: "req",
                    id: 1,
                    endpoint: "",
                    method: "auth.login",
                    params: { username: "fixture", password: "fixture-password-1" },
                }),
            );
            const response = await waitForResponse(frames, 1, `login for ${name}`);
            assert.equal(response.ok, true, `expected ${name} to accept the fixture login`);
            socket.close();
        } finally {
            await server.close();
        }
    }
});

test("auth.login rejects the wrong password", async () => {
    const server = await startFixtureServer("typical", 0);
    try {
        const { socket, frames } = await connect(server.port);
        socket.send(
            JSON.stringify({
                t: "req",
                id: 1,
                endpoint: "",
                method: "auth.login",
                params: { username: "fixture", password: "wrong" },
            }),
        );
        const response = await waitForResponse(frames, 1, "login response");
        assert.equal(response.ok, false);
        socket.close();
    } finally {
        await server.close();
    }
});

test("an unauthenticated request to a gated method is refused", async () => {
    const server = await startFixtureServer("typical", 0);
    try {
        const { socket, frames } = await connect(server.port);
        socket.send(JSON.stringify({ t: "req", id: 1, endpoint: "", method: "stack.list" }));
        const response = await waitForResponse(frames, 1, "response");
        assert.equal(response.ok, false);
        assert.equal(response.error?.code, "unauthorized");
        socket.close();
    } finally {
        await server.close();
    }
});

test("a mutating stack method re-emits stackList", async () => {
    const server = await startFixtureServer("typical", 0);
    try {
        const { socket, frames } = await connect(server.port);
        socket.send(
            JSON.stringify({
                t: "req",
                id: 1,
                endpoint: "",
                method: "auth.login",
                params: { username: "fixture", password: "fixture-password-1" },
            }),
        );
        await waitForResponse(frames, 1, "login");
        const stackListCountBefore = frames.filter((f) => isEvent(f) && f.event === "stackList").length;

        socket.send(
            JSON.stringify({ t: "req", id: 2, endpoint: "", method: "stack.start", params: { name: "immich" } }),
        );
        await waitForResponse(frames, 2, "stack.start response");
        await delay(30);
        const stackListCountAfter = frames.filter((f) => isEvent(f) && f.event === "stackList").length;
        assert.ok(stackListCountAfter > stackListCountBefore);
        socket.close();
    } finally {
        await server.close();
    }
});

test(
    "the slow scenario delays every response by its configured latency",
    { timeout: 10_000 },
    async () => {
        const server = await startFixtureServer("slow", 0);
        try {
            const { socket, frames } = await connect(server.port);
            const started = Date.now();
            socket.send(
                JSON.stringify({
                    t: "req",
                    id: 1,
                    endpoint: "",
                    method: "auth.login",
                    params: { username: "fixture", password: "fixture-password-1" },
                }),
            );
            await waitForResponse(frames, 1, "login", 6_000);
            const elapsed = Date.now() - started;
            assert.ok(elapsed >= 2900, `expected at least ~3000ms of latency, saw ${elapsed}ms`);
            socket.close();
        } finally {
            await server.close();
        }
    },
);
