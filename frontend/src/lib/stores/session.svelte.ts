import { RequestError } from "$common/errors.ts";
import { request } from "../connection.svelte.ts";
import { clearAgents } from "./agents.svelte.ts";
import { clearSettings } from "./settings.svelte.ts";
import { clearStacks } from "./stacks.svelte.ts";

export type SessionState = "anonymous" | "authenticating" | "authenticated";

const TOKEN_KEY = "token";
const REMEMBER_KEY = "remember";

export const session = $state<{
    state: SessionState;
    username: string | null;
    /** The server said no user exists yet, so the setup screen owns the page. */
    needsSetup: boolean;
}>({ state: "anonymous", username: null, needsSetup: false });

function remembered(): boolean {
    return localStorage.getItem(REMEMBER_KEY) === "1";
}

function storage(): Storage {
    return remembered() ? localStorage : sessionStorage;
}

function readToken(): string | null {
    return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
}

function writeToken(token: string): void {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    storage().setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
}

export function setRemember(remember: boolean): void {
    localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
}

export function rememberPreference(): boolean {
    return remembered();
}

/**
 * Log in and persist the returned token. Returns "totp" when the account requires a second
 * factor, in which case the caller re-invokes with `totp` supplied.
 */
export async function login(
    username: string,
    password: string,
    totp?: string,
): Promise<"ok" | "totp"> {
    session.state = "authenticating";
    try {
        const result = await request("", "auth.login", {
            username,
            password,
            ...(totp === undefined ? {} : { totp }),
        });
        if ("totpRequired" in result) {
            session.state = "anonymous";
            return "totp";
        }
        writeToken(result.token);
        session.username = result.username;
        session.state = "authenticated";
        return "ok";
    } catch (error) {
        session.state = "anonymous";
        throw error;
    }
}

/** Resume from a persisted token on connect. Clears the token when it is rejected. */
export async function resume(): Promise<boolean> {
    const token = readToken();
    if (token === null) {
        session.state = "anonymous";
        return false;
    }
    session.state = "authenticating";
    try {
        const result = await request("", "auth.loginByToken", { token });
        session.username = result.username;
        session.state = "authenticated";
        return true;
    } catch (error) {
        if (error instanceof RequestError && error.code === "unauthorized") clearToken();
        session.state = "anonymous";
        return false;
    }
}

/** The server authenticated this connection itself, because authentication is disabled. */
export function acceptAutoLogin(): void {
    session.username = null;
    session.state = "authenticated";
}

function reset(): void {
    session.state = "anonymous";
    session.username = null;
    clearStacks();
    clearAgents();
    clearSettings();
}

/** Revoke the session, clear every store, and return to the login gate. */
export async function logout(): Promise<void> {
    try {
        await request("", "auth.logout", undefined);
    } finally {
        clearToken();
        reset();
    }
}

/** Called on socket close and on an unauthorized response: never render stale rows as live. */
export function invalidate(): void {
    reset();
}

export async function changePassword(
    currentPassword: string,
    newPassword: string,
): Promise<void> {
    const result = await request("", "auth.changePassword", { currentPassword, newPassword });
    writeToken(result.token);
}
