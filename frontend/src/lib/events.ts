import { on } from "./connection.svelte.ts";
import { applyAgentList, applyAgentStatus } from "./stores/agents.svelte.ts";
import { applyInfo, loadConsoleEnabled, loadSettings, serverInfo } from "./stores/settings.svelte.ts";
import { acceptAutoLogin, session } from "./stores/session.svelte.ts";
import { applyStackList, retainEndpoints } from "./stores/stacks.svelte.ts";

const RELOADED_KEY = "reloadedForVersion";

/**
 * Bind every server event to its store. Called once at boot; the subscriptions live for the
 * lifetime of the page because reconnection reuses them.
 */
export function bindServerEvents(): void {
    on("info", (_endpoint, info) => {
        const previous = serverInfo.value;
        applyInfo(info);
        // A stale tab cannot talk to an upgraded server. The marker makes this a one-shot: a
        // bundle that is genuinely stale on disk must not put the page in a reload loop.
        const mismatch =
            (previous !== null && previous.version !== info.version) ||
            info.version !== FRONTEND_VERSION;
        if (!mismatch) return;
        if (sessionStorage.getItem(RELOADED_KEY) === info.version) {
            console.warn(
                `docknight: the served bundle reports ${FRONTEND_VERSION} but the server reports ` +
                    `${info.version}. Rebuild the frontend.`,
            );
            return;
        }
        sessionStorage.setItem(RELOADED_KEY, info.version);
        location.reload();
    });

    on("setup", () => {
        session.needsSetup = true;
    });

    on("autoLogin", () => {
        session.needsSetup = false;
        acceptAutoLogin();
        void loadSettings().catch(() => undefined);
        void loadConsoleEnabled();
    });

    on("refresh", () => location.reload());

    on("stackList", (endpoint, payload) => applyStackList(endpoint, payload.stacks));

    on("agentList", (_endpoint, payload) => {
        applyAgentList(payload.agents);
        // The only signal that a host was removed.
        retainEndpoints(Object.keys(payload.agents));
    });

    on("agentStatus", (endpoint, payload) => {
        applyAgentStatus(payload.endpoint || endpoint, payload.status, payload.message);
    });
}
