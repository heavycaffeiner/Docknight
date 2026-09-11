import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { useT } from "../../lib/i18n.ts";
import "./resources.css";

interface Props {
    query: UseQueryResult<unknown, unknown>;
    empty: boolean;
    emptyLabel: string;
    toolbar?: ReactNode;
    children: ReactNode;
}

/**
 * Loading, error, and empty states for a resource listing, so the four tables state them once
 * and identically. An empty result and a failed fetch are different messages, deliberately:
 * "no images" and "cannot reach docker" call for different actions.
 */
export default function ResourceFrame({
    query,
    empty,
    emptyLabel,
    toolbar,
    children,
}: Props): ReactElement {
    const { t } = useT();

    return (
        <mdui-card className="resource-frame">
            {toolbar !== undefined ? (
                <div className="row">
                    <div className="row-end">
                        {query.isFetching ? (
                            <mdui-circular-progress className="resource-toolbar-progress" />
                        ) : null}
                        {toolbar}
                    </div>
                </div>
            ) : null}

            {query.isError ? (
                <div className="banner type-body-medium" role="alert">
                    <mdui-icon name="error--outlined" />
                    {query.error instanceof Error ? query.error.message : t("error.internal")}
                </div>
            ) : null}

            {query.isPending ? (
                <div className="resource-loading">
                    <mdui-circular-progress />
                </div>
            ) : null}

            {!query.isPending && !query.isError && empty ? (
                <p className="resource-empty type-body-medium text-muted">{emptyLabel}</p>
            ) : (
                children
            )}
        </mdui-card>
    );
}
