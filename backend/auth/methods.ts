import { conflict, rateLimited, unauthorized, validation } from "../../common/errors.ts";
import {
    GENERAL_SETTINGS_GROUP,
    LOCAL_ENDPOINT,
    type GeneralSettings,
} from "../../common/protocol.ts";
import { asObject, noParams, optionalBool, optionalStr, str } from "../../common/validate.ts";
import type { Config } from "../config.ts";
import { afterLogin, broadcastInfo } from "../lifecycle.ts";
import { log } from "../log.ts";
import { loginBucket, totpBucket } from "../rate-limit.ts";
import * as settings from "../settings.ts";
import { readGlobalEnv, writeGlobalEnv } from "../stack/global-env.ts";
import { authenticatedConnections, emitTo } from "../ws/hub.ts";
import { method } from "../ws/router.ts";
import {
    checkPasswordStrength,
    hashPassword,
    needsRehash,
    verifyDummy,
    verifyPassword,
} from "./password.ts";
import { mintSession, resolveSession, revokeAllForUser, revokeSession } from "./session.ts";
import { checkCode, generateSecret, provisioningUri } from "./totp.ts";
import {
    clearTotp,
    createUser,
    enableTotp,
    findById,
    findByUsername,
    recordTotpStep,
    setTotpSecret,
    updatePasswordHash,
    userCount,
    type UserRow,
} from "./users.ts";

const USERNAME_PATTERN = /^[A-Za-z0-9._-]{2,64}$/;

function requireStrength(password: string): void {
    const weak = checkPasswordStrength(password);
    if (weak !== null) {
        throw validation("that password is too weak", { i18n: weak });
    }
}

function requireUser(userId: number | null): UserRow {
    const user = userId === null ? undefined : findById(userId);
    if (user === undefined || user.active !== 1) {
        throw unauthorized("this session no longer names an active account", {
            i18n: "authSessionExpired",
        });
    }
    return user;
}

function requireCurrentPassword(user: UserRow, password: string): void {
    if (!verifyPassword(password, user.password_hash)) {
        throw unauthorized("the current password did not verify", {
            i18n: "authIncorrectPassword",
        });
    }
}

/** Verify a code and record the accepted counter step, which is the replay guard. */
function requireTotp(user: UserRow, code: string): void {
    if (user.totp_secret === null) {
        throw validation("TOTP enrolment has not started", { i18n: "totpNotStarted" });
    }
    const result = checkCode(user.totp_secret, code, user.totp_last_step);
    if (result.step === null) {
        throw unauthorized("that code is wrong, expired, or already used", {
            i18n: "authInvalidToken",
        });
    }
    recordTotpStep(user.id, result.step);
}

export function registerAuthMethods(config: Readonly<Config>): void {
    method("auth.setup", {
        requiresAuth: false,
        routable: false,
        parse: (raw: unknown) => {
            const object = asObject(raw);
            return {
                username: str(object, "username", { min: 2, max: 64, pattern: USERNAME_PATTERN }),
                password: str(object, "password", { min: 1, max: 512 }),
            };
        },
        handle: (_conn, params) => {
            if (userCount() > 0) {
                throw conflict("an administrator already exists", { i18n: "setupAlreadyDone" });
            }
            requireStrength(params.password);
            createUser(params.username, hashPassword(params.password));
            log.info("auth", `administrator ${params.username} created`);
            return { ok: true as const };
        },
    });

    method("auth.login", {
        requiresAuth: false,
        routable: false,
        parse: (raw: unknown) => {
            const object = asObject(raw);
            return {
                username: str(object, "username", { min: 1, max: 64 }),
                password: str(object, "password", { min: 1, max: 512 }),
                totp: optionalStr(object, "totp", { min: 1, max: 12 }),
            };
        },
        handle: (conn, params) => {
            if (!loginBucket.take(conn.ip)) {
                throw rateLimited("too many attempts from this address", { i18n: "tooManyAttempts" });
            }

            const user = findByUsername(params.username);
            if (user === undefined) {
                // One derivation against a fixed hash, so response time does not reveal whether the
                // username is right.
                verifyDummy(params.password);
                log.warn("auth", `login failed for ${params.username} from ${conn.ip}`);
                throw unauthorized("those credentials are not accepted", {
                    i18n: "authIncorrectCreds",
                });
            }
            if (!verifyPassword(params.password, user.password_hash)) {
                log.warn("auth", `login failed for ${params.username} from ${conn.ip}`);
                throw unauthorized("those credentials are not accepted", {
                    i18n: "authIncorrectCreds",
                });
            }

            if (user.totp_enabled === 1) {
                // Not an error: the client re-sends with the code. Nothing changes on the server, so
                // a dropped socket cannot leave a half-authenticated connection behind.
                if (params.totp === undefined) return { totpRequired: true as const };
                if (!totpBucket.take(conn.ip)) {
                    throw rateLimited("too many attempts from this address", {
                        i18n: "tooManyAttempts",
                    });
                }
                requireTotp(user, params.totp);
            }

            if (needsRehash(user.password_hash)) {
                updatePasswordHash(user.id, hashPassword(params.password));
            }

            conn.userId = user.id;
            const { token, sessionId } = mintSession(user.id);
            conn.sessionId = sessionId;
            afterLogin(conn);
            log.info("auth", `${user.username} signed in from ${conn.ip}`);
            return { token, username: user.username };
        },
    });

    method("auth.loginByToken", {
        requiresAuth: false,
        routable: false,
        parse: (raw: unknown) => ({ token: str(asObject(raw), "token", { min: 8, max: 256 }) }),
        handle: (conn, params) => {
            if (!loginBucket.take(conn.ip)) {
                throw rateLimited("too many attempts from this address", { i18n: "tooManyAttempts" });
            }
            const resolved = resolveSession(params.token);
            if (resolved === null) {
                throw unauthorized("that session is no longer valid", { i18n: "authSessionExpired" });
            }
            const user = findById(resolved.userId);
            if (user === undefined || user.active !== 1) {
                revokeSession(resolved.sessionId);
                throw unauthorized("that session is no longer valid", { i18n: "authSessionExpired" });
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
        parse: noParams,
        handle: (conn) => {
            if (conn.sessionId !== null) revokeSession(conn.sessionId);
            conn.userId = null;
            conn.sessionId = null;
            return { ok: true as const };
        },
    });

    method("auth.changePassword", {
        requiresAuth: true,
        routable: false,
        parse: (raw: unknown) => {
            const object = asObject(raw);
            return {
                currentPassword: str(object, "currentPassword", { min: 1, max: 512 }),
                newPassword: str(object, "newPassword", { min: 1, max: 512 }),
            };
        },
        handle: (conn, params) => {
            const user = requireUser(conn.userId);
            requireCurrentPassword(user, params.currentPassword);
            requireStrength(params.newPassword);

            updatePasswordHash(user.id, hashPassword(params.newPassword));
            // Every device is signed out; the browser that made the change is not.
            revokeAllForUser(user.id);
            const { token, sessionId } = mintSession(user.id);
            conn.sessionId = sessionId;
            log.info("auth", `${user.username} changed their password`);
            return { token };
        },
    });

    method("auth.disconnectOthers", {
        requiresAuth: true,
        routable: false,
        parse: noParams,
        handle: (conn) => {
            const user = requireUser(conn.userId);
            for (const other of authenticatedConnections()) {
                if (other === conn || other.userId !== user.id) continue;
                emitTo(other, "refresh", LOCAL_ENDPOINT, {});
                other.socket.close(1000, "signed out from another session");
            }
            return { ok: true as const };
        },
    });

    method("auth.totp.begin", {
        requiresAuth: true,
        routable: false,
        parse: (raw: unknown) => ({
            currentPassword: str(asObject(raw), "currentPassword", { min: 1, max: 512 }),
        }),
        handle: (conn, params) => {
            const user = requireUser(conn.userId);
            requireCurrentPassword(user, params.currentPassword);
            if (user.totp_enabled === 1) {
                throw conflict("TOTP is already enabled", { i18n: "totpAlreadyEnabled" });
            }
            const secret = generateSecret();
            setTotpSecret(user.id, secret);
            return { secret, uri: provisioningUri(user.username, secret) };
        },
    });

    method("auth.totp.enable", {
        requiresAuth: true,
        routable: false,
        parse: (raw: unknown) => ({ totp: str(asObject(raw), "totp", { min: 6, max: 6 }) }),
        handle: (conn, params) => {
            const user = requireUser(conn.userId);
            if (user.totp_secret === null) {
                throw validation("TOTP enrolment has not started", { i18n: "totpNotStarted" });
            }
            if (user.totp_enabled === 1) {
                throw conflict("TOTP is already enabled", { i18n: "totpAlreadyEnabled" });
            }
            if (!totpBucket.take(conn.ip)) {
                throw rateLimited("too many attempts from this address", { i18n: "tooManyAttempts" });
            }
            const result = checkCode(user.totp_secret, params.totp, user.totp_last_step);
            if (result.step === null) {
                throw unauthorized("that code is wrong or expired", { i18n: "authInvalidToken" });
            }
            enableTotp(user.id, result.step);
            log.info("auth", `${user.username} enabled TOTP`);
            return { ok: true as const };
        },
    });

    method("auth.totp.disable", {
        requiresAuth: true,
        routable: false,
        parse: (raw: unknown) => {
            const object = asObject(raw);
            return {
                currentPassword: str(object, "currentPassword", { min: 1, max: 512 }),
                totp: str(object, "totp", { min: 6, max: 6 }),
            };
        },
        handle: (conn, params) => {
            const user = requireUser(conn.userId);
            requireCurrentPassword(user, params.currentPassword);
            if (!totpBucket.take(conn.ip)) {
                throw rateLimited("too many attempts from this address", { i18n: "tooManyAttempts" });
            }
            requireTotp(user, params.totp);
            clearTotp(user.id);
            log.info("auth", `${user.username} disabled TOTP`);
            return { ok: true as const };
        },
    });

    method("settings.get", {
        requiresAuth: true,
        routable: false,
        parse: noParams,
        handle: async (conn) => ({
            ...settings.generalSettings(),
            globalENV: await readGlobalEnv(config),
            totpEnabled: requireUser(conn.userId).totp_enabled === 1,
        }),
    });

    method("settings.set", {
        requiresAuth: true,
        routable: false,
        parse: (raw: unknown) => {
            const object = asObject(raw);
            const rawSettings = object.settings === undefined ? {} : asObject(object.settings, "settings");
            const next: Partial<GeneralSettings> = {};

            const disableAuth = optionalBool(rawSettings, "disableAuth");
            if (disableAuth !== undefined) next.disableAuth = disableAuth;
            const checkUpdate = optionalBool(rawSettings, "checkUpdate");
            if (checkUpdate !== undefined) next.checkUpdate = checkUpdate;
            const checkBeta = optionalBool(rawSettings, "checkBeta");
            if (checkBeta !== undefined) next.checkBeta = checkBeta;
            const trustProxy = optionalBool(rawSettings, "trustProxy");
            if (trustProxy !== undefined) next.trustProxy = trustProxy;
            const autoUpgrade = optionalBool(rawSettings, "autoUpgrade");
            if (autoUpgrade !== undefined) next.autoUpgrade = autoUpgrade;
            const primaryHostname = optionalStr(rawSettings, "primaryHostname", { max: 255 });
            if (primaryHostname !== undefined) next.primaryHostname = primaryHostname;

            return {
                settings: next,
                globalENV: optionalStr(object, "globalENV", { max: 1024 * 1024 }),
                currentPassword: optionalStr(object, "currentPassword", { max: 512 }),
            };
        },
        handle: async (conn, params) => {
            const current = settings.generalSettings();

            // Enabling disableAuth requires the password in the same request. Turning
            // authentication back on requires nothing, because it only increases restriction.
            if (params.settings.disableAuth === true && !current.disableAuth) {
                const user = requireUser(conn.userId);
                if (params.currentPassword === undefined) {
                    throw unauthorized("the current password is required to remove the password gate", {
                        i18n: "authIncorrectPassword",
                    });
                }
                requireCurrentPassword(user, params.currentPassword);
            }

            if (Object.keys(params.settings).length > 0) {
                settings.setGroup(GENERAL_SETTINGS_GROUP, params.settings as Record<string, unknown>);
            }
            if (params.globalENV !== undefined) await writeGlobalEnv(config, params.globalENV);
            broadcastInfo();
            return { ok: true as const };
        },
    });
}
