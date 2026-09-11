import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { AppError } from "../../../common/errors.ts";
import TerminalView from "../components/TerminalView.tsx";
import { useT } from "../lib/i18n.ts";
import { linkHandler } from "../lib/router.ts";
import { request } from "../lib/transport.ts";
import { useParams } from "../routes.ts";
import "./ContainerTerminal.css";

function backUrl(stack: string, endpoint: string): string {
    return endpoint === "" ? `/compose/${stack}` : `/compose/${stack}/${encodeURIComponent(endpoint)}`;
}

/**
 * An interactive shell inside one service's container, launched fresh on every visit
 * (`terminal.exec`) rather than reattaching to a shared session the way the host console does.
 */
export default function ContainerTerminal(): ReactElement {
    const { t } = useT();
    const params = useParams();
    const stack = params.stack ?? "";
    const service = params.service ?? "";
    const shellType = params.type ?? "sh";
    const endpoint = params.endpoint ?? "";

    // A fresh exec session per visit, so the query is keyed by every parameter that selects
    // one and is never reused from cache.
    const execQuery = useQuery({
        queryKey: [endpoint, "terminal.exec", stack, service, shellType],
        queryFn: () =>
            request<{ terminal?: string }>(endpoint, "terminal.exec", {
                stack,
                service,
                shell: shellType,
            }),
        gcTime: 0,
        staleTime: 0,
    });

    const loading = execQuery.isPending;
    const terminalName = execQuery.data?.terminal ?? null;
    const error = execQuery.error;
    const errorMessage =
        error === null
            ? null
            : error instanceof AppError && error.i18n !== undefined
              ? t(error.i18n, error.values)
              : error.message;

    const back = backUrl(stack, endpoint);

    return (
        <div className="page terminal-page">
            <div className="page-header terminal-page-header">
                <a className="terminal-back" href={back} onClick={linkHandler(back)}>
                    <mdui-icon name="arrow_back" />
                    {stack}
                </a>
                <h1 className="type-headline-small">
                    {service} ({shellType})
                </h1>
            </div>

            {loading ? (
                <div className="terminal-status">
                    <mdui-circular-progress />
                    <span className="type-body-medium">{t("terminal.connecting")}</span>
                </div>
            ) : errorMessage !== null ? (
                <div className="terminal-status terminal-status--error" role="alert">
                    <span className="type-body-medium">{errorMessage}</span>
                </div>
            ) : terminalName !== null ? (
                <div className="terminal-content">
                    <TerminalView endpoint={endpoint} terminal={terminalName} interactive rows={28} />
                </div>
            ) : null}
        </div>
    );
}
