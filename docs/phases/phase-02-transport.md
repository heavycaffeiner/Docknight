# Phase 2: Transport

Implements proposal 1 in full except agent forwarding (the `agentPool.request` branch stays a stub
that throws `agentUnreachable` until phase 6). Ends with a conformance test suite driving a real
socket.

## Step 1: `common/protocol.ts`

Pure types plus two constants. No runtime logic beyond the error-code list.

```ts
export const PROTOCOL_VERSION = 1;

export type ClientMessage =
    | { t: "req"; id: number; endpoint: string; method: string; params?: unknown }
    | { t: "cancel"; id: number }
    | { t: "ping" };

export type ServerMessage =
    | { t: "res"; id: number; ok: true; data: unknown }
    | { t: "res"; id: number; ok: false; error: ProtocolError }
    | { t: "evt"; endpoint: string; event: string; data: unknown }
    | { t: "pong" };

export const ERROR_CODES = ["unauthorized", "unknownMethod", "invalidParams",
    "duplicateRequestId", "notRoutable", "notFound", "conflict", "validation",
    "commandFailed", "agentUnreachable", "agentTimeout", "timeout", "disconnected",
    "rateLimited", "internal"] as const;
export type ErrorCode = typeof ERROR_CODES[number];

export interface ProtocolError {
    code: ErrorCode; message: string;
    i18n?: string; values?: Record<string, string | number>;
}

// Method and event maps are interfaces merged by each owning module:
export interface MethodMap {}       // augmented via declaration merging per proposal
export interface EventMap {}
export type MethodName = keyof MethodMap;   // etc.
```

Also `common/errors.ts`:

```ts
/** Thrown by handlers; the router serialises it onto the wire. */
export class AppError extends Error {
    constructor(public code: ErrorCode, message: string,
                public i18n?: string, public values?: Record<string, string | number>) {}
}
export class ValidationError extends AppError { /* code fixed to "validation" or "invalidParams" */ }
```

## Step 2: `common/validate.ts`

Small combinator set so every method's `parse` is declarative. No dependency.

```
str(opts?)        -> (raw) => string, checks type, maxLength (default 4096), pattern
num(opts?)        -> checks integer/range
bool()            -> strict boolean
optional(v)       -> undefined passes through
obj({ shape })    -> plain-object check, applies each field validator, rejects unknown keys
noParams()        -> raw must be undefined

each throws ValidationError("invalidParams", "<field>: <what failed>")   # names the field
```

## Step 3: `backend/ws/server.ts`

```ts
export interface Conn { /* per proposal 1 section 4.3.1 */ }
export function createWsLayer(config, services): {
    upgradeHandler: UpgradeHandler;
    conns: Set<Conn>;
    sendEvent(conn: Conn, endpoint: string, event: string, data: unknown): void;
    broadcastEvent(filter: (c: Conn) => boolean, endpoint, event, data): void;
    closeAll(code: number): Promise<void>;      // registered as a shutdown hook
};
```

```
upgradeHandler(req, socket, head):
    if req.url != "/ws": socket.destroy(); return

    # Check order matters and each failure is 400 + destroy:
    origin := req.headers.origin
    if origin is present and new URL(origin).host != req.headers.host:
        respond400(socket); return                       # invariant: cross-origin never upgrades

    endpointHeader := req.headers["x-docknight-endpoint"]     # string | undefined
    protoHeader    := req.headers["x-docknight-protocol"]
    if protoHeader is present and parseInt(protoHeader) != PROTOCOL_VERSION:
        respond400(socket); return

    wss.handleUpgrade(req, socket, head, ws => {
        conn := {
            id: randomBase62(12), socket: ws,
            userId: null, sessionId: null,
            endpoint: endpointHeader ?? "", isAgentLink: endpointHeader is present,
            joinedTerminals: new Set(), inflight: new Map(),
            openedAt: now, lastPongAt: now,
            termQueues: new Map(),           # per-terminal coalescing, step 5
        }
        conns.add(conn)
        ws.on("message", raw => onMessage(conn, raw))    # router, step 4
        ws.on("pong", () => conn.lastPongAt := now)
        ws.on("close", () => {
            conns.delete(conn)
            services.onConnClosed?.(conn)    # phase 4 hooks detachConnection here
            reject conn.inflight? no: handlers hold AbortControllers; abort them all
        })
        services.onConnOpened?.(conn)        # phase 3 hooks setup/autoLogin/info emission here
    })

keepalive, one interval for the whole layer, every 20 s:
    for conn in conns:
        if now - conn.lastPongAt > 60_000: conn.socket.close(1001); continue
        conn.socket.ping()

send(conn, msg):
    if socket not OPEN: return
    conn.socket.send(JSON.stringify(msg))

closeAll(code):
    clear keepalive interval
    for conn in conns: conn.socket.close(code)
    await all sockets closed or 3 s
```

Inbound limits: construct `WebSocketServer` with `maxPayload: 1 MiB` so oversize frames close 1009
inside `ws` itself.

## Step 4: `backend/ws/router.ts`

```ts
export function method<P, R>(name: string, d: MethodDescriptor<P, R>): void;
export function onMessage(conn: Conn, raw: Buffer): void;
export function toProtocolError(e: unknown): ProtocolError;
```

```
registry := Map<string, MethodDescriptor>
method(name, d): if registry.has(name): throw at startup; registry.set(name, d)

onMessage(conn, raw):
    msg := try JSON.parse(raw)  else conn.socket.close(1003); return
    if msg is not a plain object or msg.t not in ["req","cancel","ping"]:
        conn.socket.close(1003); return

    if msg.t == "ping": send { t: "pong" }; return       # no auth required
    if msg.t == "cancel":
        conn.inflight.get(msg.id)?.abort(); return       # no response for a cancel

    # msg.t == "req"
    if typeof msg.id != "number" or msg.id <= 0 or not Number.isInteger(msg.id):
        conn.socket.close(1003); return
    if conn.inflight.has(msg.id): respondErr(msg.id, "duplicateRequestId"); return

    d := registry.get(msg.method)
    if d is undefined:            respondErr(msg.id, "unknownMethod"); return
    if d.requiresAuth and conn.userId == null:
                                  respondErr(msg.id, "unauthorized"); return
    if typeof msg.endpoint != "string": conn.socket.close(1003); return
    if msg.endpoint != "" and not d.routable:
                                  respondErr(msg.id, "notRoutable"); return

    params := try d.parse(msg.params)
              catch ValidationError e: respondErr(msg.id, "invalidParams", e.message); return

    controller := new AbortController()
    conn.inflight.set(msg.id, controller)
    (async () => {
        try:
            if msg.endpoint == "*":
                services.agentPool.broadcast(msg.method, params)     # stub logs until phase 6
                result := { dispatched: true }
            else if msg.endpoint == "" or msg.endpoint == conn.endpoint:
                result := await d.handle(conn, params, controller.signal)
            else:
                result := await services.agentPool.request(          # stub throws until phase 6
                    msg.endpoint, msg.method, params, controller.signal)
            send { t: "res", id: msg.id, ok: true, data: result }
        catch e:
            if e is AbortError: return                    # invariant: silence after cancel
            send { t: "res", id: msg.id, ok: false, error: toProtocolError(e) }
        finally:
            conn.inflight.delete(msg.id)
    })()

toProtocolError(e):
    if e is AppError: -> { code, message, i18n, values }
    otherwise:
        log.error("ws", e)                                # full stack server-side
        -> { code: "internal", message: "internal error" }
        # invariant: no path, env value, or stack trace crosses the wire
```

## Step 5: Event emission and terminal backpressure

```
sendEvent(conn, endpoint, event, data):
    if event is "terminalWrite": enqueueTerminalWrite(conn, endpoint, data); return
    send { t: "evt", endpoint, event, data }

enqueueTerminalWrite(conn, endpoint, { terminal, data }):
    q := conn.termQueues.get(endpoint + "\u0000" + terminal) or create
    q.pending += data
    if q.timer is null:
        q.timer := setTimeout(flush(conn, q), 16)         # coalescing: <= 62 frames/s/terminal

flush(conn, q):
    q.timer := null
    buffered := conn.socket.bufferedAmount
    if buffered > 16 MiB: conn.socket.close(1013); return
    if buffered > 4 MiB:
        q.dropped += q.pending.length; q.pending := ""    # drop terminal bytes only
        q.timer := setTimeout(flush, 100); return         # re-check for the truncation notice
    if q.dropped > 0 and buffered < 1 MiB:
        q.pending := "\r\n[docknight] output truncated, " + q.dropped + " bytes dropped\r\n"
                     + q.pending
        q.dropped := 0
    send { t: "evt", endpoint, event: "terminalWrite", data: { terminal, data: q.pending } }
    q.pending := ""

# invariant: responses and non-terminal events bypass this queue and are never dropped
```

## Step 6: `frontend/src/lib/connection.svelte.ts`

The client. Mobile behaviour is the base contract; every bullet from proposal 1 section 4.3.6 maps
to a numbered rule here.

```
state := $state({
    phase: "idle" | "connecting" | "connected" | "authed" | "disconnected",
    degraded: false, generation: 0,
})
pending  := Map<id, { resolve, reject, timer }>
waiters  := []            # requests made while no usable socket exists
nextId   := 1

connect():
    if socket open or connecting: return
    phase := "connecting"
    socket := new WebSocket((https ? "wss" : "ws") + "://" + location.host + "/ws")

    socket.onopen:
        phase := "connected"
        handshake():                          # phase 8's session store drives this
            token := storage.token
            if token: await request("", "auth.loginByToken", { token }) -> authed or clear token
        after handshake settles (success or definitive failure):
            phase := "authed" (or stays "connected" for the login screen)
            generation += 1                   # rule: views rejoin on the generation counter
            degraded := false; clear degrade timer
            release waiters                   # rule: held requests flow only after auth settles

    socket.onclose / onerror:
        phase := "disconnected"
        for p in pending: p.reject(err("disconnected")); pending.clear()
            # rule: pending requests are rejected, never retried
        schedule degrade timer: 2 s -> degraded := true
            # rule: a short drop never reaches the user
        if document.visibilityState == "visible":
            setTimeout(connect, 2000)         # rule: flat 2 s retry, only while visible
        # rule: nothing is scheduled while hidden

liveness, every 25 s while open:
    lastActivity := any inbound frame timestamp
    send { t: "ping" }
    setTimeout(8 s):
        if no frame arrived since the probe: socket.close(4000)
            # rule: silence is probed, not trusted

wake handlers (visibilitychange->visible, pageshow, focus, online), throttled 1/s:
    if socket open: send { t: "ping" }        # probe it instead of trusting it
    else: connect()
    # rule: coming back to the front is what reconnects

request(endpoint, method, params, opts = { timeout: 30000 }):
    if phase not in ["connected", "authed"]:
        await waiter with 15 s deadline       # rule: requests are held, not failed
        on deadline: throw err("disconnected")
    id := nextId++
    send { t: "req", id, endpoint, method, params }
    return promise:
        if opts.timeout > 0:
            timer := setTimeout(() => {
                send { t: "cancel", id }; reject err("timeout")
            }, opts.timeout)
        resolve/reject on the matching res frame

onmessage:
    lastActivity := now
    "pong" -> nothing else
    "res"  -> settle pending[id]
    "evt"  -> if event == "info" and data.version != FRONTEND_VERSION: location.reload()
              dispatch to on() subscribers with (endpoint, data)

on(event, handler) -> add to a Map<event, Set>, return unsubscribe
```

## Step 7: Conformance tests (`tests/protocol/`)

Run against a started server on an ephemeral port with a stub authenticated method registered.

```
- malformed JSON frame            -> close 1003
- frame with unknown t            -> close 1003
- frame > 1 MiB                   -> close 1009
- req before auth on gated method -> res error unauthorized
- unknown method                  -> unknownMethod
- duplicate in-flight id          -> duplicateRequestId
- endpoint set on non-routable    -> notRoutable
- invalid params                  -> invalidParams naming the field
- cancel mid-handler              -> no response ever arrives for that id
- ping                            -> pong, works unauthenticated
- server ping timeout             -> connection closed 1001 (shrink timers via test hook)
- terminal coalescing             -> 1000 rapid writes arrive in << 1000 frames
- backpressure                    -> with a non-reading client, responses still delivered,
                                     truncation notice appears after drain
```

## Done checklist

- [ ] Conformance suite green.
- [ ] Router rejects double registration of a method name at startup.
- [ ] `closeAll` registered as a shutdown hook; `stop()` closes clients with 1001.
- [ ] Client module has zero imports from components (checked by the phase-1 lint rule).
