# Phase 6: Multi-Host Federation

Implements proposal 5 in full and completes phase 2's routing stubs. After this phase a request
with a non-empty endpoint reaches the named host and its events come back stamped.

## Step 1: `backend/agent/crypto.ts`

```ts
export function loadOrCreateKey(dataDir: string): Buffer;      // 32 bytes
export function encryptSecret(key: Buffer, plain: string): string;
export function decryptSecret(key: Buffer, stored: string): string;
```

```
loadOrCreateKey(dataDir):
    path := dataDir + "/agent-key"
    try: key := readFile(path); if key.length != 32: throw AppError("internal", ..., "agentKeyUnreadable")
    catch ENOENT:
        key := randomBytes(32)
        writeFile(path, key, { mode: 0o600, flag: "wx" })     # O_EXCL: no clobbering a race
    return key

encryptSecret(key, plain):
    iv := randomBytes(12)
    cipher := createCipheriv("aes-256-gcm", key, iv)
    ct := cipher.update(plain, "utf8") + cipher.final()
    return "v1$" + b64(iv) + "$" + b64(ct) + "$" + b64(cipher.getAuthTag())

decryptSecret(key, stored):
    ["v1", iv, ct, tag] := stored.split("$") else throw agentKeyUnreadable
    decipher := createDecipheriv("aes-256-gcm", key, b64d(iv))
    decipher.setAuthTag(b64d(tag))
    return decipher.update(b64d(ct)) + decipher.final()       # tag mismatch throws
```

Tests: round trip, tampered ciphertext rejected, tampered tag rejected, key file created 0600,
second `loadOrCreateKey` returns the same key.

## Step 2: `backend/agent/store.ts`

```ts
export function normaliseUrl(raw: string): string;
export function deriveEndpoint(url: string): string;
export const agentStore: {
    list(): AgentRow[];
    add(url, username, encryptedSecret, name): AgentRow;
    remove(url: string): void;
    rename(url: string, name: string): void;
    byUrl(url: string): AgentRow | undefined;
};
```

```
normaliseUrl(raw):
    u := try new URL(raw) else throw AppError("validation", ..., "invalidAgentUrl")
    if u.protocol not in ["http:", "https:"]: throw invalidAgentUrl
    u.protocol := lowercase; drop default ports (80 for http, 443 for https)
    strip trailing slash from pathname; drop search and hash
    return u.toString() without trailing "/"

deriveEndpoint(url): return new URL(url).host      # computed at insert, validated there
```

CRUD is four prepared statements over the `agent` table. `add` relies on the UNIQUE constraint and
maps the constraint violation to `conflict "agentAlreadyExists"`.

## Step 3: `backend/agent/link.ts`

One outbound connection with the state machine from proposal 5 section 4.3.1.

```ts
export function createLink(agent: AgentRow, deps: LinkDeps): Link;
export interface Link {
    state: "connecting" | "authenticating" | "online" | "backoff" | "failed" | "closed";
    request(method, params, signal, timeoutMs): Promise<unknown>;
    waitOnline(ms: number): Promise<boolean>;
    close(): void;                            // removal or shutdown; cancels retries
}
```

```
connect():
    setState("connecting"); emitStatus("connecting")
    socket := new WebSocket(agent.url.replace(/^http/, "ws") + "/ws", {
        headers: { "X-Docknight-Endpoint": agent.endpoint,
                   "X-Docknight-Protocol": String(PROTOCOL_VERSION) },
    })

    socket.on("unexpected-response", (req, res)):
        # a 400 here is the protocol version rejection
        fail("unsupported protocol version")               # -> Failed, no retry

    socket.on("open"):
        setState("authenticating")
        res := await rawRequest("auth.login",
                 { username: agent.username, password: decryptSecret(key, agent.secret) })
        if res.ok is false:
            fail("authentication failed")                  # -> Failed, no retry
            socket.close(); return
        setState("online"); emitStatus("online"); backoffStep := 0
        prime := await rawRequest("stack.list", undefined)
        pool.cacheStackList(agent.endpoint, prime.data.stacks)
        pool.relayEvent(agent.endpoint, { event: "stackList", data: prime.data })

    socket.on("message", msg):
        if msg.t == "evt": pool.relayEvent(agent.endpoint, msg)
        if msg.t == "res": settle pendingForwards[msg.id] with msg

    socket.on("close" or "error"):
        reject all pendingForwards with agentUnreachable
        if state in ["failed", "closed"]: return           # Failed does not retry
        setState("backoff"); emitStatus("offline", lastReason ?? "connection refused")
        delay := min(60_000, 1000 * 2 ** backoffStep++) + random(0, 1000)
        retryTimer := setTimeout(connect, delay)

fail(reason):
    setState("failed"); lastReason := reason
    emitStatus("offline", reason)
    # invariant: Failed leaves only when the host record changes (edit or re-add)

rawRequest(method, params, signal?, timeoutMs = 60_000):
    id := nextId++
    send { t: "req", id, endpoint: "", method, params }
        # endpoint "" on the wire: from the receiving host's view the work is local
    await response / abort / deadline:
        abort:    send { t: "cancel", id }; throw AbortError
        deadline: throw AppError("agentTimeout", ..., "agentTimeout")
        error res: rethrow the host's ProtocolError verbatim
            # invariant: the browser sees the remote host's own code and i18n key

waitOnline(ms):
    if state == "online": return true
    await state-change signal or timeout(ms); return state == "online"

keepalive: mirror the server rule; ping every 20 s, close after 60 s of silence.
```

## Step 4: `backend/agent/pool.ts`

```ts
export function createAgentPool(deps): {
    request(endpoint, method, params, signal): Promise<unknown>;   // replaces phase 2 stub
    broadcast(method, params): void;
    connect(agent: AgentRow): void;
    disconnect(endpoint: string): void;
    testConnection(url, username, password): Promise<void>;
    stackCache: Map<string, unknown>;
    statuses: Map<string, AgentStatusPayload>;
    relayEvent(endpoint: string, msg): void;
    closeAll(): Promise<void>;
};
```

```
links := Map<endpoint, Link>

request(endpoint, method, params, signal):
    link := links.get(endpoint)
    if link is undefined: throw AppError("agentUnreachable", ..., "agentUnreachable")
    if link.state != "online":
        ok := await link.waitOnline(10_000)   # covers a request racing a reconnect
        if not ok: throw agentUnreachable
    timeout := LONG_RUNNING_METHODS.has(method) ? 0 : 60_000
    return link.request(method, params, signal, timeout)

broadcast(method, params):
    for link of links.values() where link.state == "online":
        link.request(method, params, none, 60_000).catch(e => log.warn("agent", e))

relayEvent(endpoint, msg):
    if msg.event == "stackList": stackCache.set(endpoint, msg.data)
    for conn of ws.conns where conn.userId != null and not conn.isAgentLink:
        if msg.event in ["terminalWrite", "terminalExit"]:
            if not conn.joinedTerminals.has(msg.data.terminal): continue
                # remote terminal names already carry the endpoint label, so the join
                # set distinguishes hosts without any rewriting
        ws.sendEvent(conn, endpoint, msg.event, msg.data)
        # invariant: the endpoint goes in the envelope; the payload is never mutated

emitStatus(endpoint, status, message?):
    statuses.set(endpoint, { endpoint, status, message })
    broadcast agentStatus to authenticated browser conns

testConnection(url, username, password):
    link := throwaway socket with the same headers
    open -> auth.login -> on success close and resolve
    on failure: map to agentAuthFailed / agentUnreachable and reject
    hard 10 s overall deadline

startup: for row of agentStore.list() where row.active: connect(row)
    # built after migrations, before the HTTP listener (proposal 5 section 4.3.7)
shutdown hook: closeAll() -> link.close() for each; close code 1001
```

## Step 5: `backend/agent/methods.ts`

```
method "agent.list" (auth, NOT routable):
    result := { "": { url: "", endpoint: "", username: "", name: "" } }   # synthetic local entry
    for row of agentStore.list():
        result[row.endpoint] := { url: row.url, endpoint: row.endpoint,
                                  username: row.username, name: row.name ?? "" }
        # invariant: the password never appears in any list payload
    return { agents: result }

method "agent.add" (auth, NOT routable):
    parse: obj({ url: str, username: str, password: str, name: optional(str) })
    handle:
        url := normaliseUrl(p.url); endpoint := deriveEndpoint(url)
        if endpoint == ownListeningHost(config): throw AppError("validation", ..., "cannotAddSelf")
        if agentStore.byUrl(url): throw AppError("conflict", ..., "agentAlreadyExists")
        await pool.testConnection(url, p.username, p.password)
            # a typo becomes a form error here, not a permanently offline row
        row := agentStore.add(url, p.username, encryptSecret(key, p.password), p.name)
        pool.connect(row)
        emit agentList to every authenticated conn
        return { endpoint }

method "agent.remove" (auth, NOT routable):
    row := agentStore.byUrl(normaliseUrl(p.url)) else throw notFound "agentNotFound"
    pool.disconnect(row.endpoint)             # closes the link, cancels retries
    agentStore.remove(row.url)
    pool.stackCache.delete(row.endpoint); pool.statuses.delete(row.endpoint)
    emit agentList
    return { ok: true }
    # clients drop the endpoint's stacks when it disappears from agentList (phase 8 store rule)

method "agent.rename" (auth, NOT routable):
    agentStore.rename(...); emit agentList; return { ok: true }
```

## Step 6: Inbound side

Already mostly built: phase 2's upgrade handler parses `X-Docknight-Endpoint` and
`X-Docknight-Protocol`, and the router's `msg.endpoint == conn.endpoint` branch treats forwarded
requests as local. Verify the one remaining piece:

```
terminal name construction on the managed host uses conn.endpoint,
so a manager link (endpoint "nas:5001") gets "logs-nas:5001-immich" while a local
browser gets "logs--immich": two ptys, no collision, no dedup.   # accepted cost, proposal 5
```

Also update phase 3's `afterLogin`: the pool's `stackCache` and `statuses` now have real content,
so a fresh browser receives every host's last known list immediately.

## Tests

Two real server instances in one test process, on ephemeral ports, one configured as manager.

```
- add: credential test failure -> form error, no row; success -> row, link online, agentList event
- add self -> cannotAddSelf; duplicate URL -> agentAlreadyExists
- forward: stack.list via endpoint returns the remote's stacks; error code passes verbatim
- link resilience: kill the managed server -> status offline + backoff; restart -> online again,
  backoff reset after login
- wrong password stored -> Failed state, no retry storm (assert connect attempts stop)
- protocol mismatch (spoof header) -> Failed with "unsupported protocol version"
- relay: terminalWrite from the remote reaches only conns joined to that terminal name
- remove: link closed, cache dropped, agentList emitted
- crypto: backup-restore simulation; missing agent-key -> agentKeyUnreadable, hosts re-addable
```

## Done checklist

- [ ] Phase 2 conformance suite still green with the real pool in place.
- [ ] A browser on the manager can deploy a stack on the managed host and watch its terminal.
- [ ] No plaintext password in the database file (grep the raw file in a test).
- [ ] Shutdown closes links before the database (hook order asserted).
