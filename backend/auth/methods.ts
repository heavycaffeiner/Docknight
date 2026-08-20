import { AppError } from "../../common/errors.ts";
import { bool, noParams, obj, optional, str } from "../../common/validate.ts";
import type { Config } from "../config.ts";
import { one, run, tx } from "../db/index.ts";
import { afterLogin, broadcastInfo, disconnectOtherConnections } from "../lifecycle.ts";
import { log } from "../log.ts";
import { makeBucket, manage } from "../rate-limit.ts";
import { Settings } from "../settings.ts";
import { readGlobalEnv, writeGlobalEnv } from "../stack/global-env.ts";
import type { Conn } from "../ws/conn.ts";
import { method } from "../ws/router.ts";
import { DUMMY_HASH, checkPasswordStrength, hashPassword, verifyPassword } from "./password.ts";
import { mintSession, resolveSession, revokeAllSessions, revokeSession } from "./session.ts";
import { generateSecret, provisioningUri, verifyTotp } from "./totp.ts";

declare module "../../common/protocol.ts" {
    interface MethodMap {
        "auth.setup": { params: { username: string; password: string }; result: { ok: true } };
        "auth.login": {
            params: { username: string; password: string; totp?: string };
            result: { token: string; username: string } | { totpRequired: true };
        };
        "auth.loginByToken": { params: { token: string }; result: { username: string } };
        "auth.logout": { params: undefined; result: { ok: true } };
        "auth.changePassword": {
            params: { currentPassword: string; newPassword: string };
            result: { token: string };
        };
        "auth.disconnectOthers": { params: undefined; result: { ok: true } };
        "auth.totp.begin": {
            params: { currentPassword: string };
            result: { secret: string; uri: string };
        };
        "auth.totp.enable": { params: { totp: string }; result: { ok: true } };
        "auth.totp.disable": {
            params: { currentPassword: string; totp: string };
            result: { ok: true };
        };
        "settings.get": {
            params: undefined;
            result: {
                disableAuth: boolean;
                primaryHostname: string;
                checkUpdate: boolean;
                checkBeta: boolean;
                autoUpgrade: boolean;
                trustProxy: boolean;
                globalENV: string;
            };
        };
        "settings.set": {
            params: {
                settings: Partial<{
                    disableAuth: boolean;
                    primaryHostname: string;
                    checkUpdate: boolean;
                    checkBeta: boolean;
                    autoUpgrade: boolean;
                    trustProxy: boolean;
                }>;
                globalENV?: string;
                currentPassword?: string;
            };
            result: { ok: true };
        };
    }
}

interface UserRow {
    id: number;
    username: string;
    password_hash: string;
    active: number;
    totp_secret: string | null;
    totp_enabled: number;
    totp_last_step: number | null;
}

const USERNAME_PATTERN = /^[A-Za-z0-9._-]{2,64}$/;
const TOTP_PATTERN = /^[0-9]{6}$/;

const loginBucket = manage(makeBucket(20, 20));
const totpBucket = manage(makeBucket(30, 30));

function trustProxy(): boolean {
    return Settings.get("trustProxy") === true;
}

/** The IP a rate-limit bucket keys on: X-Forwarded-For only when the operator trusts the proxy. */
function limiterIp(conn: Conn): string {
    if (trustProxy() && conn.forwardedFor !== undefined) {
        const first = conn.forwardedFor.split(",")[0]?.trim();
        if (first !== undefined && first !== "") return first;
    }
    return conn.remoteAddress;
}

function findByUsername(username: string): UserRow | undefined {
    return one<UserRow>("SELECT * FROM user WHERE username = :username AND active = 1", { username });
}

function findById(id: number): UserRow | undefined {
    return one<UserRow>("SELECT * FROM user WHERE id = :id", { id });
}

function requireUser(userId: number | null): UserRow {
    const user = userId === null ? undefined : findById(userId);
    if (user === undefined || user.active !== 1) {
        throw new AppError(
            "unauthorized",
            "this session no longer names an active account",
            "authSessionExpired",
        );
    }
    return user;
}

function requireCurrentPassword(user: UserRow, password: string): void {
    if (!verifyPassword(password, user.password_hash)) {
        throw new AppError("unauthorized", "the current password did not verify", "authIncorrectPassword");
    }
}

// Every parse function is bound to a name outside the method() call: TypeScript cannot unify
// the P type parameter between an object literal's `parse` and `handle` fields inline, so
// hoisting `parse` first is what makes `params` inside `handle` a real type instead of `unknown`.

const setupParse = obj({
    username: str({ min: 2, max: 64, pattern: USERNAME_PATTERN }),
    password: str({ min: 1, max: 1024 }),
});

const loginParse = obj({
    username: str({ min: 1, max: 64 }),
    password: str({ min: 1, max: 1024 }),
    totp: optional(str({ pattern: TOTP_PATTERN })),
});

const loginByTokenParse = obj({ token: str({ min: 8, max: 256 }) });

const changePasswordParse = obj({
    currentPassword: str({ min: 1, max: 1024 }),
    newPassword: str({ min: 1, max: 1024 }),
});

const totpBeginParse = obj({ currentPassword: str({ min: 1, max: 1024 }) });
const totpEnableParse = obj({ totp: str({ pattern: TOTP_PATTERN }) });
const totpDisableParse = obj({
    currentPassword: str({ min: 1, max: 1024 }),
    totp: str({ pattern: TOTP_PATTERN }),
});

const settingsSetParse = obj({
    settings: obj({
        disableAuth: optional(bool()),
        primaryHostname: optional(str({ max: 255 })),
        checkUpdate: optional(bool()),
        checkBeta: optional(bool()),
        autoUpgrade: optional(bool()),
        trustProxy: optional(bool()),
    }),
    globalENV: optional(str({ max: 1024 * 1024 })),
    currentPassword: optional(str({ max: 1024 })),
});

export function registerAuthMethods(config: Readonly<Config>): void {
    method("auth.setup", {
        requiresAuth: false,
        routable: false,
        parse: setupParse,
        handle: (_conn, params) => {
            const count = one<{ c: number }>("SELECT count(*) AS c FROM user")?.c ?? 0;
            if (count > 0) {
                throw new AppError("conflict", "an administrator already exists", "setupAlreadyDone");
            }

            const weak = checkPasswordStrength(params.password);
            if (weak !== null) throw new AppError("validation", "that password is too weak", weak);

            run("INSERT INTO user (username, password_hash) VALUES (:username, :hash)", {
                username: params.username,
                hash: hashPassword(params.password),
            });
            log.info("auth", `administrator ${params.username} created`);
            return { ok: true as const };
        },
    });

    method("auth.login", {
        requiresAuth: false,
        routable: false,
        parse: loginParse,
        handle: (conn: Conn, params) => {
            const ip = limiterIp(conn);
            if (!loginBucket.take(ip)) {
                throw new AppError("rateLimited", "too many attempts from this address", "tooManyAttempts");
            }

            const user = findByUsername(params.username);
            // invariant: one scrypt derivation on every path; same error either way
            const ok = user !== undefined && verifyPassword(params.password, user.password_hash);
            if (user === undefined) verifyPassword(params.password, DUMMY_HASH);
            if (!ok || user === undefined) {
                log.warn("auth", `login failed for ${params.username} from ${ip}`);
                throw new AppError("unauthorized", "incorrect credentials", "authIncorrectCreds");
            }

            if (user.totp_enabled === 1) {
                if (params.totp === undefined) return { totpRequired: true as const };
                if (!totpBucket.take(ip)) {
                    throw new AppError("rateLimited", "too many attempts from this address", "tooManyAttempts");
                }
                if (!verifyTotp(user, params.totp)) {
                    throw new AppError(
                        "unauthorized",
                        "that code is wrong, expired, or already used",
                        "authInvalidToken",
                    );
                }
            }

            conn.userId = user.id;
            const { token, sessionId } = mintSession(user.id);
            conn.sessionId = sessionId;
            afterLogin(conn);
            log.info("auth", `${user.username} signed in from ${ip}`);
            return { token, username: user.username };
        },
    });

    method("auth.loginByToken", {
        requiresAuth: false,
        routable: false,
        parse: loginByTokenParse,
        handle: (conn: Conn, params) => {
            if (!loginBucket.take(limiterIp(conn))) {
                throw new AppError("rateLimited", "too many attempts from this address", "tooManyAttempts");
            }
            const resolved = resolveSession(params.token);
            if (resolved === null) {
                throw new AppError("unauthorized", "that session is no longer valid", "authSessionExpired");
            }
            const user = findById(resolved.userId);
            if (user === undefined || user.active !== 1) {
                revokeSession(resolved.sessionId);
                throw new AppError("unauthorized", "that session is no longer valid", "authSessionExpired");
            }
            conn.userId = user.id;
            conn.sessionId = resolved.sessionId;
            afterLogin(conn);
            return { username: user.username };
        },
    });

    method("auth.logout", {
        requiresAuth: true,
        routable: false,
        parse: noParams(),
        handle: (conn: Conn) => {
            if (conn.sessionId !== null) revokeSession(conn.sessionId);
            conn.userId = null;
            conn.sessionId = null;
            return { ok: true as const };
        },
    });

    method("auth.changePassword", {
        requiresAuth: true,
        routable: false,
        parse: changePasswordParse,
        handle: (conn: Conn, params) => {
            const user = requireUser(conn.userId);
            requireCurrentPassword(user, params.currentPassword);
            const weak = checkPasswordStrength(params.newPassword);
            if (weak !== null) throw new AppError("validation", "that password is too weak", weak);

            let minted: { token: string; sessionId: number } | undefined;
            tx(() => {
                run("UPDATE user SET password_hash = :hash WHERE id = :id", {
                    hash: hashPassword(params.newPassword),
                    id: user.id,
                });
                revokeAllSessions(user.id);
                minted = mintSession(user.id);
            });
            if (minted === undefined) throw new AppError("internal", "session mint failed unexpectedly");
            // invariant: the acting connection keeps a live session; every other device is out
            conn.sessionId = minted.sessionId;
            log.info("auth", `${user.username} changed their password`);
            return { token: minted.token };
        },
    });

    method("auth.disconnectOthers", {
        requiresAuth: true,
        routable: false,
        parse: noParams(),
        handle: (conn: Conn) => {
            requireUser(conn.userId);
            disconnectOtherConnections(conn);
            return { ok: true as const };
        },
    });

    method("auth.totp.begin", {
        requiresAuth: true,
        routable: false,
        parse: totpBeginParse,
        handle: (conn: Conn, params) => {
            const user = requireUser(conn.userId);
            requireCurrentPassword(user, params.currentPassword);
            if (user.totp_enabled === 1) {
                throw new AppError("conflict", "TOTP is already enabled", "totpAlreadyEnabled");
            }
            const secret = generateSecret();
            run(
                "UPDATE user SET totp_secret = :secret, totp_enabled = 0, totp_last_step = NULL WHERE id = :id",
                { secret, id: user.id },
            );
            return { secret, uri: provisioningUri(user.username, secret) };
        },
    });

    method("auth.totp.enable", {
        requiresAuth: true,
        routable: false,
        parse: totpEnableParse,
        handle: (conn: Conn, params) => {
            const user = requireUser(conn.userId);
            if (user.totp_secret === null) {
                throw new AppError("validation", "TOTP enrolment has not started", "totpNotStarted");
            }
            if (!totpBucket.take(limiterIp(conn))) {
                throw new AppError("rateLimited", "too many attempts from this address", "tooManyAttempts");
            }
            if (!verifyTotp(user, params.totp)) {
                throw new AppError("unauthorized", "that code is wrong or expired", "authInvalidToken");
            }
            run("UPDATE user SET totp_enabled = 1 WHERE id = :id", { id: user.id });
            log.info("auth", `${user.username} enabled TOTP`);
            return { ok: true as const };
        },
    });

    method("auth.totp.disable", {
        requiresAuth: true,
        routable: false,
        parse: totpDisableParse,
        handle: (conn: Conn, params) => {
            const user = requireUser(conn.userId);
            requireCurrentPassword(user, params.currentPassword);
            if (!totpBucket.take(limiterIp(conn))) {
                throw new AppError("rateLimited", "too many attempts from this address", "tooManyAttempts");
            }
            if (!verifyTotp(user, params.totp)) {
                throw new AppError(
                    "unauthorized",
                    "that code is wrong, expired, or already used",
                    "authInvalidToken",
                );
            }
            run(
                "UPDATE user SET totp_secret = NULL, totp_enabled = 0, totp_last_step = NULL WHERE id = :id",
                { id: user.id },
            );
            log.info("auth", `${user.username} disabled TOTP`);
            return { ok: true as const };
        },
    });

    method("settings.get", {
        requiresAuth: true,
        routable: false,
        parse: noParams(),
        handle: async () => {
            const general = Settings.getGroup("general") as Partial<{
                disableAuth: boolean;
                primaryHostname: string;
                checkUpdate: boolean;
                checkBeta: boolean;
                autoUpgrade: boolean;
                trustProxy: boolean;
            }>;
            return {
                disableAuth: general.disableAuth ?? false,
                primaryHostname: general.primaryHostname ?? "",
                checkUpdate: general.checkUpdate ?? true,
                checkBeta: general.checkBeta ?? false,
                autoUpgrade: general.autoUpgrade ?? false,
                trustProxy: general.trustProxy ?? false,
                globalENV: await readGlobalEnv(config),
            };
        },
    });

    method("settings.set", {
        requiresAuth: true,
        routable: false,
        parse: settingsSetParse,
        handle: async (conn: Conn, params) => {
            const currentlyDisabled = Settings.get("disableAuth") === true;
            if (params.settings.disableAuth === true && !currentlyDisabled) {
                // invariant: enabling disableAuth is password-confirmed; disabling it is not
                const user = requireUser(conn.userId);
                if (params.currentPassword === undefined) {
                    throw new AppError(
                        "unauthorized",
                        "the current password is required to remove the password gate",
                        "authIncorrectPassword",
                    );
                }
                requireCurrentPassword(user, params.currentPassword);
            }

            const settingsToWrite: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(params.settings)) {
                if (value !== undefined) settingsToWrite[key] = value;
            }
            if (Object.keys(settingsToWrite).length > 0) {
                Settings.setGroup("general", settingsToWrite);
            }
            if (params.globalENV !== undefined) await writeGlobalEnv(config, params.globalENV);
            broadcastInfo();
            return { ok: true as const };
        },
    });
}
