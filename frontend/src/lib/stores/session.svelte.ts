import { request, on, setAuthed } from "../connection.svelte.ts";

export type SessionState = "anonymous" | "authenticating" | "authenticated";

export interface Session {
    state: SessionState;
    username: string | null;
}

export const session = $state<Session>({
    state: "anonymous",
    username: null,
});

export async function login(username: string, password: string, remember: boolean, totp?: string): Promise<"ok" | "totp"> {
    session.state = "authenticating";
    try {
        const res = await request<{ totpRequired?: boolean; token?: string; username?: string }>("", "auth.login", {
            username,
            password,
            totp,
        });
        if (res.totpRequired === true) {
            session.state = "anonymous";
            return "totp";
        }
        const storage = remember ? localStorage : sessionStorage;
        if (res.token !== undefined) {
            storage.setItem("docknight-token", res.token);
        }
        session.state = "authenticated";
        session.username = res.username ?? username;
        setAuthed(true);
        return "ok";
    } catch (err) {
        session.state = "anonymous";
        throw err;
    }
}

export async function resume(): Promise<boolean> {
    if (typeof localStorage === "undefined") return false;
    const token = localStorage.getItem("docknight-token") || sessionStorage.getItem("docknight-token");
    if (token === null || token === "") return false;

    try {
        const res = await request<{ username?: string }>("", "auth.loginByToken", { token });
        session.state = "authenticated";
        session.username = res.username ?? null;
        setAuthed(true);
        return true;
    } catch {
        localStorage.removeItem("docknight-token");
        sessionStorage.removeItem("docknight-token");
        session.state = "anonymous";
        session.username = null;
        setAuthed(false);
        return false;
    }
}

export async function logout(): Promise<void> {
    try {
        await request("", "auth.logout");
    } finally {
        if (typeof localStorage !== "undefined") {
            localStorage.removeItem("docknight-token");
            sessionStorage.removeItem("docknight-token");
        }
        session.state = "anonymous";
        session.username = null;
        setAuthed(false);
    }
}

on("autoLogin", (payload: unknown) => {
    const data = payload as { username?: string } | undefined;
    session.state = "authenticated";
    session.username = data?.username ?? null;
    setAuthed(true);
});
