import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactElement, useState } from "react";
import type { NetworkSummary, PruneResult } from "../../../../common/docker.ts";
import { useT } from "../../lib/i18n.ts";
import { qk } from "../../lib/query.ts";
import { toastError, toastSuccess } from "../../lib/toast.ts";
import { request } from "../../lib/transport.ts";
import ConfirmDialog from "../ConfirmDialog.tsx";
import RowActions from "../RowActions.tsx";
import ResourceFrame from "./ResourceFrame.tsx";

export default function NetworksTable({ endpoint }: { endpoint: string }): ReactElement {
    const { t } = useT();
    const client = useQueryClient();
    const [removeTarget, setRemoveTarget] = useState<NetworkSummary | null>(null);
    const [pruneOpen, setPruneOpen] = useState(false);

    const query = useQuery({
        queryKey: qk.networks(endpoint),
        queryFn: () =>
            request<{ networks: NetworkSummary[] }>(endpoint, "docker.networkList", undefined),
    });

    const remove = useMutation({
        mutationFn: (name: string) =>
            request<{ ok: true }>(endpoint, "docker.networkRemove", { name }),
        onSuccess: () => {
            toastSuccess(t("resources.networks.removed"));
            void client.invalidateQueries({ queryKey: qk.networks(endpoint) });
        },
        onError: toastError,
    });

    const prune = useMutation({
        mutationFn: () => request<PruneResult>(endpoint, "docker.networkPrune", undefined),
        onSuccess: (result) => {
            toastSuccess(t("resources.networks.pruned", { count: result.deleted }));
            void client.invalidateQueries({ queryKey: qk.networks(endpoint) });
        },
        onError: toastError,
    });

    const networks = query.data?.networks ?? [];
    const removable = networks.filter((network) => !network.inUse && !network.builtin);

    return (
        <ResourceFrame
            query={query}
            empty={networks.length === 0}
            emptyLabel={t("resources.networks.empty")}
            toolbar={
                <mdui-button
                    variant="tonal"
                    icon="cleaning_services--outlined"
                    disabled={removable.length === 0 || prune.isPending}
                    loading={prune.isPending}
                    onClick={() => setPruneOpen(true)}
                >
                    {t("resources.networks.prune", { count: removable.length })}
                </mdui-button>
            }
        >
            <mdui-list>
                {networks.map((network) => (
                    <mdui-list-item
                        key={network.id || network.name}
                        headline={network.name}
                        description={`${network.driver} | ${network.scope}`}
                        nonclickable
                    >
                        <div slot="end-icon" className="list-end">
                            {network.builtin ? (
                                <span className="status-chip status-chip--info type-label-medium">
                                    {t("resources.networks.builtin")}
                                </span>
                            ) : (
                                <span
                                    className={`status-chip type-label-medium ${
                                        network.inUse ? "status-chip--running" : ""
                                    }`}
                                >
                                    {network.inUse ? t("resources.inUse") : t("resources.unused")}
                                </span>
                            )}
                            <RowActions
                                title={network.name}
                                actions={[
                                    {
                                        label: t("action.remove"),
                                        icon: "delete--outlined",
                                        danger: true,
                                        disabled: network.builtin || network.inUse || remove.isPending,
                                        onSelect: () => setRemoveTarget(network),
                                    },
                                ]}
                            />
                        </div>
                    </mdui-list-item>
                ))}
            </mdui-list>

            <ConfirmDialog
                open={removeTarget !== null}
                danger
                title={t("resources.networks.removeTitle")}
                message={
                    removeTarget === null
                        ? ""
                        : t("resources.networks.removeConfirm", { name: removeTarget.name })
                }
                confirmLabel={t("action.remove")}
                onConfirm={() => {
                    const target = removeTarget;
                    setRemoveTarget(null);
                    if (target !== null) remove.mutate(target.name);
                }}
                onCancel={() => setRemoveTarget(null)}
            />

            <ConfirmDialog
                open={pruneOpen}
                danger
                title={t("resources.networks.pruneTitle")}
                message={t("resources.networks.pruneConfirm", { count: removable.length })}
                confirmLabel={t("action.remove")}
                onConfirm={() => {
                    setPruneOpen(false);
                    prune.mutate();
                }}
                onCancel={() => setPruneOpen(false)}
            >
                <ul className="type-body-small mono resource-list-preview">
                    {removable.map((network) => (
                        <li key={network.name}>{network.name}</li>
                    ))}
                </ul>
            </ConfirmDialog>
        </ResourceFrame>
    );
}
