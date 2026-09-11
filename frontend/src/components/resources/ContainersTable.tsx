import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { ContainerSummary } from "../../../../common/docker.ts";
import { useT } from "../../lib/i18n.ts";
import { qk } from "../../lib/query.ts";
import { linkHandler } from "../../lib/router.ts";
import { request } from "../../lib/transport.ts";
import StatusChip from "../StatusChip.tsx";
import ResourceFrame from "./ResourceFrame.tsx";

function stackHref(stack: string, endpoint: string): string {
    return endpoint === "" ? `/compose/${stack}` : `/compose/${stack}/${encodeURIComponent(endpoint)}`;
}

/**
 * Read only on purpose. Compose owns container lifecycle in Docknight; this view exists so a
 * user can see what else is running on the host rather than being blind to it.
 */
export default function ContainersTable({ endpoint }: { endpoint: string }): ReactElement {
    const { t } = useT();

    const query = useQuery({
        queryKey: qk.containers(endpoint),
        queryFn: () =>
            request<{ containers: ContainerSummary[] }>(endpoint, "docker.containers", undefined),
        refetchInterval: 10_000,
    });

    const containers = query.data?.containers ?? [];

    return (
        <ResourceFrame
            query={query}
            empty={containers.length === 0}
            emptyLabel={t("resources.containers.empty")}
        >
            <mdui-list>
                {containers.map((container) => {
                    const href = container.stack === null ? null : stackHref(container.stack, endpoint);
                    const subtitle = [container.image, container.status].filter(Boolean).join(" | ");
                    return (
                        <mdui-list-item
                            key={container.id}
                            headline={container.name}
                            description={subtitle}
                            rounded
                            href={href ?? undefined}
                            nonclickable={href === null}
                            onClick={href === null ? undefined : linkHandler(href)}
                        >
                            <div slot="end-icon" className="list-end">
                                {container.stack !== null ? (
                                    <span className="status-chip status-chip--info type-label-medium">
                                        {container.stack}
                                    </span>
                                ) : (
                                    <span className="status-chip type-label-medium">
                                        {t("resources.containers.unmanaged")}
                                    </span>
                                )}
                                <StatusChip status={container.state} />
                            </div>
                        </mdui-list-item>
                    );
                })}
            </mdui-list>
        </ResourceFrame>
    );
}
