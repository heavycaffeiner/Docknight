import { on, request, setAuthed } from "./transport.ts";
import { createStore } from "./store.ts";

export type SessionState = "anonymous" | "authenticating" | "authenticated";

export interface Session {
    state: SessionState;
    username: string | null;
}

const TOKEN_KEY = "docknight-token";

export const session = createStore<Session>({ state: "anonymous", username: null });

export async function login(
    username: string,
    password: string,
    remember: boolean,
    totp?: string,
): Promise<"ok" | "totp"> {
    session.set({ state: "authenticating", username: null });
    try {
        const res = await request<{ totpRequired?: boolean; token?: string; username?: string }>(
            "",
            "auth.login",
            { username, password, totp },
        );
        if (res.totpRequired === true) {
            session.set({ state: "anonymous", username: null });
            return "totp";
        }
        if (res.token !== undefined) {
            (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, res.token);
        }
        session.set({ state: "authenticated", username: res.username ?? username });
        setAuthed(true);
        return "ok";
    } catch (err) {
        session.set({ state: "anonymous", username: null });
        throw err;
    }
}

export async function resume(): Promise<boolean> {
    if (typeof localStorage === "undefined") return false;
    const token = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
    if (token === null || token === "") return false;

    try {
        const res = await request<{ username?: string }>("", "auth.loginByToken", { token });
        session.set({ state: "authenticated", username: res.username ?? null });
        setAuthed(true);
        return true;
    } catch {
        localStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(TOKEN_KEY);
        session.set({ state: "anonymous", username: null });
        setAuthed(false);
        return false;
    }
}

export async function logout(): Promise<void> {
    try {
        await request("", "auth.logout");
    } finally {
        if (typeof localStorage !== "undefined") {
            localStorage.removeItem(TOKEN_KEY);
            sessionStorage.removeItem(TOKEN_KEY);
        }
        session.set({ state: "anonymous", username: null });
        setAuthed(false);
    }
}

on("autoLogin", (payload: unknown) => {
    const data = payload as { username?: string } | undefined;
    session.set({ state: "authenticated", username: data?.username ?? null });
    setAuthed(true);
});
