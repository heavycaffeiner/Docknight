import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import TerminalView from "../components/TerminalView.tsx";
import { useT } from "../lib/i18n.ts";
import { qk } from "../lib/query.ts";
import { linkHandler } from "../lib/router.ts";
import { request } from "../lib/transport.ts";
import { useParams } from "../routes.ts";
import "./Console.css";

/**
 * The host's own shell. Unlike a per-service exec, this terminal is shared: the server keeps
 * one running session per host (`terminal.main`), so joining twice reattaches to the same
 * session rather than starting a new one.
 */
export default function Console(): ReactElement {
    const { t } = useT();
    const params = useParams();
    const endpoint = params.endpoint ?? "";

    // One query for both calls: the terminal name is only meaningful when the host console is
    // enabled, so asking for it separately would just add a second loading state.
    const consoleQuery = useQuery({
        queryKey: [endpoint, ...qk.consoleEnabled()],
        queryFn: async (): Promise<{ enabled: boolean; terminal: string | null }> => {
            const gate = await request<{ enabled?: boolean }>(endpoint, "terminal.mainEnabled");
            if (gate.enabled !== true) return { enabled: false, terminal: null };
            const session = await request<{ terminal?: string }>(endpoint, "terminal.main");
            return { enabled: true, terminal: session.terminal ?? null };
        },
        staleTime: Infinity,
    });

    const loading = consoleQuery.isPending;
    const enabled = consoleQuery.data?.enabled === true && !consoleQuery.isError;
    const terminalName = consoleQuery.data?.terminal ?? null;

    return (
        <div className="page console-page">
            <div className="page-header">
                <h1 className="type-headline-small">{t("nav.console")}</h1>
            </div>

            {loading ? (
                <div className="console-status">
                    <mdui-circular-progress />
                    <span className="type-body-medium">{t("console.checking")}</span>
                </div>
            ) : !enabled ? (
                <mdui-card variant="outlined" className="console-status console-status--card">
                    <p className="type-body-medium">{t("console.disabled")}</p>
                    <mdui-button
                        variant="tonal"
                        href="/settings/general"
                        onClick={linkHandler("/settings/general")}
                    >
                        {t("nav.settings")}
                    </mdui-button>
                </mdui-card>
            ) : terminalName !== null ? (
                <div className="console-terminal">
                    <TerminalView endpoint={endpoint} terminal={terminalName} interactive rows={30} />
                </div>
            ) : null}
        </div>
    );
}
