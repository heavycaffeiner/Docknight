# Phase 3: Authentication, Sessions, Settings

Implements proposal 2 in full. After this phase the WebSocket gate is real: `Conn.userId` is set by
actual logins, and `afterLogin` is the single point where a connection starts receiving data.

## Step 1: `backend/auth/password.ts`

```ts
export function hashPassword(plain: string): string;
export function verifyPassword(plain: string, stored: string): boolean;
export function checkPasswordStrength(plain: string): string | null;   // null = ok, else i18n key
```

```
PARAMS := { N: 32768, r: 8, p: 1, keyLen: 64, maxmem: 64 MiB }

hashPassword(plain):
    salt := randomBytes(16)
    key  := scryptSync(plain.normalize("NFKC"), salt, 64, PARAMS)
    return "scrypt$32768$8$1$" + b64(salt) + "$" + b64(key)

verifyPassword(plain, stored):
    parts := stored.split("$")
    if parts[0] != "scrypt" or parts.length != 6: return false     # unknown prefix, no throw
    { N, r, p } := parse ints from parts[1..3]; salt, expected := b64decode parts[4..5]
    actual := scryptSync(plain.normalize("NFKC"), salt, expected.length, { N, r, p, maxmem })
    if actual.length != expected.length: return false
    return timingSafeEqual(actual, expected)                       # invariant: constant time

checkPasswordStrength(plain):
    if plain.length < 8: return "passwordTooWeak"
    classes := count of [letters present, digits present, symbols present]
    return classes >= 2 ? null : "passwordTooWeak"

DUMMY_HASH := hashPassword("docknight-dummy") computed once at module load
    # used by login to equalise latency for unknown usernames
```

Tests: round trip, NFKC (compose "é" both ways), wrong password false, malformed stored value
false, parameter change tolerated via the self-describing format.

## Step 2: `backend/auth/totp.ts`

```ts
export function generateSecret(): string;                      // 20 random bytes, base32 no padding
export function provisioningUri(username: string, secret: string): string;
export function verifyTotp(user: UserRow, code: string): boolean;
```

```
base32encode/decode: RFC 4648 alphabet, no padding, ~20 lines each

hotp(secretBytes, step):
    counter := 8-byte big-endian(step)
    mac := createHmac("sha1", secretBytes).update(counter).digest()
    offset := mac[19] & 0x0f
    binary := ((mac[offset] & 0x7f) << 24) | (mac[offset+1] << 16)
            | (mac[offset+2] << 8) | mac[offset+3]
    return String(binary % 1_000_000).padStart(6, "0")

verifyTotp(user, code):
    if not /^[0-9]{6}$/.test(code): return false
    now := floor(unixSeconds() / 30)
    for step in [now - 1, now, now + 1]:
        if step <= (user.totp_last_step ?? -1): continue      # invariant: replay guard on counter
        if timingSafeEqual(buf(hotp(secret, step)), buf(code)):
            run("UPDATE user SET totp_last_step = :step WHERE id = :id", ...)
            return true
    return false
```

Tests: RFC 6238 appendix test vectors (SHA-1 rows), replay rejection inside the window, window
edges, non-numeric code rejected before any crypto.

## Step 3: `backend/auth/session.ts`

```ts
export function mintSession(userId: number): { token: string; sessionId: number };
export function resolveSession(token: string): { userId: number; sessionId: number } | null;
export function revokeSession(sessionId: number): void;
export function revokeAllSessions(userId: number): void;
export function startSessionSweep(): () => void;      // returns stop, wired into shutdown
```

```
THIRTY_DAYS := 30 * 86400

mintSession(userId):
    token := base64url(randomBytes(32))
    run(INSERT session (user_id, token_hash, created_at, last_used_at, expires_at)
        VALUES (:userId, sha256hex(token), :now, :now, :now + THIRTY_DAYS))
    return { token, sessionId: lastInsertRowid }
    # invariant: the raw token exists only in this return value; never stored, never logged

resolveSession(token):
    row := one(SELECT ... WHERE token_hash = :hash, { hash: sha256hex(token) })
    if row is undefined: return null
    if row.expires_at <= now: run(DELETE ... WHERE id = :id); return null
    run(UPDATE session SET last_used_at = :now, expires_at = :now + THIRTY_DAYS WHERE id = :id)
    return { userId: row.user_id, sessionId: row.id }

sweep(): run(DELETE FROM session WHERE expires_at <= :now)   # at startup + every 6 h
```

## Step 4: `backend/rate-limit.ts`

```ts
export function makeBucket(capacity: number, refillPerMinute: number): {
    take(key: string): boolean;
};
export function clientIp(conn: Conn, trustProxy: boolean): string;
```

```
bucket state: Map<key, { tokens: number, updatedAt: number }>

take(key):
    entry := map.get(key) or { tokens: capacity, updatedAt: now }
    entry.tokens := min(capacity, entry.tokens + elapsedMinutes * refillPerMinute)
    if entry.tokens < 1: map.set(...); return false
    entry.tokens -= 1; entry.updatedAt := now; map.set(...); return true

eviction sweep every 10 min: delete entries idle > 10 min

clientIp(conn, trustProxy):
    if trustProxy and X-Forwarded-For header captured at upgrade:
        return first comma-separated entry, trimmed
    return socket.remoteAddress
    # the upgrade handler in phase 2 must stash req.headers["x-forwarded-for"]
    # and remoteAddress on Conn; add that field now
```

Tests: refill math, exhaustion, eviction, forwarded-for parsing honoured only when trusted.

## Step 5: `backend/settings.ts`

```ts
export const Settings: {
    get(key: string): unknown;
    set(key: string, value: unknown, type: string): void;
    getGroup(type: string): Record<string, unknown>;
    setGroup(type: string, values: Record<string, unknown>): void;
};
```

```
cache := Map<key, { value, at }>; TTL 60 s; sweeper every 60 s, cleared at shutdown

get(key):
    hit := cache.get(key); if hit and now - hit.at < 60_000: return hit.value
    row := one(SELECT value FROM setting WHERE key = :key)
    value := row ? JSON.parse(row.value) : DEFAULTS[key]
    cache.set(key, { value, at: now }); return value

set(key, value, type):
    run(INSERT INTO setting (key, value, type) VALUES (...)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value)
    cache.delete(key)

setGroup(type, values):                      # invariant: cannot capture a row of another type
    tx(() => {
        for key, value of values:
            existing := one(SELECT type FROM setting WHERE key = :key)
            if existing and existing.type != type: skip and log.warn
            else: upsert with :type
    })
    for key of values: cache.delete(key)
```

## Step 6: `backend/auth/methods.ts`

Registers every `auth.*` and `settings.*` method with the phase-2 router. All
`requiresAuth`/`routable` flags per proposal 1's method table.

```
loginBucket := makeBucket(20, 20); totpBucket := makeBucket(30, 30)

method "auth.setup" (no auth):
    parse: obj({ username: str({max:64}), password: str({max:1024}) })
    handle:
        if one(SELECT count(*) c FROM user).c > 0: throw AppError("conflict", ..., "setupAlreadyDone")
        weak := checkPasswordStrength(password); if weak: throw AppError("validation", ..., weak)
        run(INSERT INTO user (username, password_hash) VALUES (...hashPassword...))
        return { ok: true }

method "auth.login" (no auth):
    parse: obj({ username, password, totp: optional(str({pattern: 6 digits})) })
    handle(conn, p):
        ip := clientIp(conn, Settings.get("trustProxy"))
        if not loginBucket.take(ip): throw AppError("rateLimited", ..., "tooManyAttempts")

        user := one(SELECT * FROM user WHERE username = :u AND active = 1)
        ok := user ? verifyPassword(p.password, user.password_hash)
                   : (verifyPassword(p.password, DUMMY_HASH), false)
            # invariant: one scrypt derivation on every path; same error either way
        if not ok:
            log.warn("auth", "login failed for " + p.username + " from " + ip)
            throw AppError("unauthorized", "incorrect credentials", "authIncorrectCreds")

        if user.totp_enabled == 1:
            if p.totp is undefined: return { totpRequired: true }    # server state unchanged
            if not totpBucket.take(ip): throw rateLimited
            if not verifyTotp(user, p.totp):
                throw AppError("unauthorized", ..., "authInvalidToken")

        conn.userId := user.id
        { token, sessionId } := mintSession(user.id)
        conn.sessionId := sessionId
        afterLogin(conn)
        return { token, username: user.username }

method "auth.loginByToken" (no auth):
    handle(conn, { token }):
        ip-limited by loginBucket like login
        resolved := resolveSession(token)
        if resolved is null: throw AppError("unauthorized", ..., "authSessionExpired")
        conn.userId := resolved.userId; conn.sessionId := resolved.sessionId
        afterLogin(conn)
        return { username: ... }

method "auth.logout":
    revokeSession(conn.sessionId); conn.userId := null; conn.sessionId := null
    return { ok: true }

method "auth.changePassword":
    verify currentPassword against the user row, else AppError("unauthorized", ..., "authIncorrectPassword")
    check strength of newPassword
    tx: UPDATE user hash; revokeAllSessions(userId)
    { token, sessionId } := mintSession(userId); conn.sessionId := sessionId
        # invariant: the acting connection keeps a live session; every other device is out
    return { token }

method "auth.disconnectOthers":
    for other in conns where other.userId == conn.userId and other != conn:
        sendEvent(other, "", "refresh", {}); other.socket.close(1000)
    return { ok: true }

method "auth.totp.begin":
    verify currentPassword
    if user.totp_enabled: throw AppError("conflict", ..., "totpAlreadyEnabled")
    secret := generateSecret()
    UPDATE user SET totp_secret = :secret          # totp_enabled stays 0
    return { secret, uri: provisioningUri(username, secret) }

method "auth.totp.enable":
    if user.totp_secret is null: throw AppError("validation", ..., "totpNotStarted")
    if not verifyTotp(user, p.totp): throw AppError("unauthorized", ..., "authInvalidToken")
    UPDATE user SET totp_enabled = 1
    return { ok: true }

method "auth.totp.disable":
    verify currentPassword AND verifyTotp(user, p.totp)
    UPDATE user SET totp_secret = NULL, totp_enabled = 0, totp_last_step = NULL
    return { ok: true }

method "settings.get":
    return { ...Settings.getGroup("general") merged over defaults, globalENV: readGlobalEnv() }
        # readGlobalEnv is a stub returning "" until phase 5 wires the real file

method "settings.set":
    if p.settings.disableAuth == true and Settings.get("disableAuth") == false:
        require p.currentPassword, verify it, else authIncorrectPassword
        # invariant: enabling disableAuth is password-confirmed; disabling it is not
    Settings.setGroup("general", p.settings)
    if p.globalENV is defined: writeGlobalEnv(p.globalENV)     # stub until phase 5
    for c in authenticated conns: sendEvent(c, "", "info", buildInfo())
    return { ok: true }
```

## Step 7: Connection open hook and `afterLogin`

```
services.onConnOpened(conn):                 # registered with the phase-2 WS layer
    sendEvent(conn, "", "info", buildInfo())
    if one(SELECT count(*) FROM user) == 0:
        sendEvent(conn, "", "setup", {}); return
    if Settings.get("disableAuth") == true:  # read per connect, never cached across process
        admin := one(SELECT * FROM user ... LIMIT 1)
        conn.userId := admin.id              # no session row; nothing to revoke
        sendEvent(conn, "", "autoLogin", {})
        afterLogin(conn)

afterLogin(conn):                            # invariant: the only place data starts flowing
    sendEvent(conn, "", "info", buildInfo())
    sendEvent(conn, "", "stackList", localSnapshot())        # stub {} until phase 5
    for endpoint, cached of agentPool.stackCache:            # empty until phase 6
        sendEvent(conn, endpoint, "stackList", cached)
    sendEvent(conn, "", "agentList", agentStore.list())      # local-only until phase 6
    for endpoint, status of agentPool.statuses:
        sendEvent(conn, endpoint, "agentStatus", status)

buildInfo():
    { version: VERSION, latestVersion, protocolVersion: PROTOCOL_VERSION,
      isContainer: config.isContainer, primaryHostname: Settings.get("primaryHostname") }
```

## Step 8: `scripts/reset-password.ts`

```
main():
    config := loadConfig(process.argv, process.env)
    db := openDatabase(config)
    try: db.exec("BEGIN IMMEDIATE"); db.exec("ROLLBACK")
    catch busy: print "database is in use; stop Docknight first"; exit 1

    password := prompt twice on the tty, must match, strength-checked
    tx:
        UPDATE user SET password_hash = hash, totp_secret = NULL,
                        totp_enabled = 0, totp_last_step = NULL
        DELETE FROM session
    print "password reset; TOTP cleared; all sessions revoked"
```

## Tests

```
- setup: creates once, conflicts the second time, weak password rejected
- login: wrong user and wrong password produce identical error and comparable latency
         (assert both run one scrypt: expose a counter test hook)
- login + TOTP: totpRequired shape, wrong code, replayed code, success sets conn fields
- loginByToken: expiry deletion, sliding renewal
- changePassword: other sessions gone, acting session valid, new token works
- disableAuth: enabling requires password, connect-time autoLogin fires, disabling is free
- rate limit: 21st login from one IP rejected, different IP unaffected
- settings: group write cannot change a row of another type; cache invalidation
```

## Done checklist

- [ ] All auth methods registered and the conformance suite from phase 2 still green.
- [ ] Redaction test: a login request logged at debug never contains the password.
- [ ] `pnpm reset-password` works against a stopped dev database and refuses a locked one.
