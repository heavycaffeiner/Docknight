import { on, request, tokenStorage } from "../connection.svelte.ts";
import { resetAgentsStore } from "./agents.svelte.ts";
import { resetSettingsStore } from "./settings.svelte.ts";
import { resetStacksStore } from "./stacks.svelte.ts";

export type SessionState = "anonymous" | "authenticating" | "authenticated";

const state = $state<{ sessionState: SessionState; username: string | null }>({
    sessionState: "anonymous",
    username: null,
});

export const session: { readonly state: SessionState; readonly username: string | null } = {
    get state() {
        return state.sessionState;
    },
    get username() {
        return state.username;
    },
};

function persistToken(token: string, remember: boolean): void {
    localStorage.setItem("remember", remember ? "1" : "0");
    localStorage.removeItem("token");
    sessionStorage.removeItem("token");
    tokenStorage().setItem("token", token);
}

function clearToken(): void {
    localStorage.removeItem("token");
    sessionStorage.removeItem("token");
}

/**
 * Log in and persist the returned token. Returns "totp" when the account requires a second
 * factor, in which case the caller re-invokes with `totp` supplied.
 */
export async function login(
    username: string,
    password: string,
    remember: boolean,
    totp?: string,
): Promise<"ok" | "totp"> {
    state.sessionState = "authenticating";
    try {
        const result = await request("", "auth.login", { username, password, totp });
        if ("totpRequired" in result) {
            state.sessionState = "anonymous";
            return "totp";
        }
        persistToken(result.token, remember);
        state.sessionState = "authenticated";
        state.username = result.username;
        return "ok";
    } catch (error) {
        state.sessionState = "anonymous";
        throw error;
    }
}

/** Resume from a persisted token on connect. Clears the token when it is rejected. */
export async function resume(): Promise<boolean> {
    const token = localStorage.getItem("token") ?? sessionStorage.getItem("token");
    if (token === null || token === "") return false;
    try {
        const result = await request("", "auth.loginByToken", { token });
        state.sessionState = "authenticated";
        state.username = result.username;
        return true;
    } catch {
        clearToken();
        return false;
    }
}

/** Revoke the session, clear every store, and return to the login gate. */
export async function logout(): Promise<void> {
    try {
        await request("", "auth.logout", undefined);
    } catch {
        // A logout that fails to reach the server still clears the client's own state.
    }
    clearToken();
    resetStacksStore();
    resetAgentsStore();
    resetSettingsStore();
    state.sessionState = "anonymous";
    state.username = null;
}

/** The autoLogin event, fired when disableAuth means a fresh connection is already authenticated. */
on("autoLogin", () => {
    state.sessionState = "authenticated";
});
