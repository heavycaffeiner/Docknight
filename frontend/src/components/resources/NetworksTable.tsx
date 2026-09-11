import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactElement, useState } from "react";
import type { NetworkSummary } from "../../../../common/docker.ts";
import { useT } from "../../lib/i18n.ts";
import { qk } from "../../lib/query.ts";
import { toastError, toastSuccess } from "../../lib/toast.ts";
import { request } from "../../lib/transport.ts";
import ConfirmDialog from "../ConfirmDialog.tsx";
import RowActions from "../RowActions.tsx";
import ResourceSelection from "./ResourceSelection.tsx";
import ResourceFrame from "./ResourceFrame.tsx";

export default function NetworksTable({ endpoint }: { endpoint: string }): ReactElement {
    const { t } = useT();
    const client = useQueryClient();
    const [removeTargets, setRemoveTargets] = useState<NetworkSummary[]>([]);
    const [selected, setSelected] = useState<Set<string>>(() => new Set());
    const [pruneOpen, setPruneOpen] = useState(false);
    function invalidateNetworkQueries(): void {
        void Promise.all([
            client.invalidateQueries({ queryKey: qk.networks(endpoint), exact: true }),
            client.invalidateQueries({ queryKey: qk.networkNames(endpoint), exact: true }),
        ]);
    }

    const query = useQuery({
        queryKey: qk.networks(endpoint),
        queryFn: () =>
            request<{ networks: NetworkSummary[] }>(endpoint, "docker.networkList", undefined),
    });

    const remove = useMutation({
        mutationFn: async (networks: NetworkSummary[]) => {
            for (const network of networks) {
                await request<{ ok: true }>(endpoint, "docker.networkRemove", { name: network.name });
            }
        },
        onSuccess: (_data, networks) => {
            setSelected(new Set());
            toastSuccess(t("resources.networks.removed", { count: networks.length }));
            invalidateNetworkQueries();
        },
        onError: (error) => {
            toastError(error);
            invalidateNetworkQueries();
        },
    });

    const networks = query.data?.networks ?? [];
    const removable = networks.filter((network) => !network.inUse && !network.builtin);
    const selectedNetworks = removable.filter((network) => selected.has(network.name));
    const singleTarget = removeTargets.length === 1 ? removeTargets[0] : undefined;

    function toggle(name: string): void {
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
        });
    }

    function toggleAll(): void {
        setSelected(
            selectedNetworks.length === removable.length
                ? new Set()
                : new Set(removable.map((network) => network.name)),
        );
    }

    return (
        <ResourceFrame
            query={query}
            empty={networks.length === 0}
            emptyLabel={t("resources.networks.empty")}
            toolbar={
                <>
                    <ResourceSelection
                        eligibleCount={removable.length}
                        selectedCount={selectedNetworks.length}
                        pending={remove.isPending}
                        onToggleAll={toggleAll}
                        onRemove={() => setRemoveTargets(selectedNetworks)}
                    />
                    <mdui-button
                        variant="tonal"
                        icon="cleaning_services--outlined"
                        disabled={removable.length === 0 || remove.isPending}
                        loading={remove.isPending}
                        onClick={() => setPruneOpen(true)}
                    >
                        {t("resources.networks.prune", { count: removable.length })}
                    </mdui-button>
                </>
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
                        <mdui-checkbox
                            slot="icon"
                            checked={!network.builtin && !network.inUse && selected.has(network.name)}
                            disabled={network.builtin || network.inUse || remove.isPending}
                            aria-label={t("resources.select", { name: network.name })}
                            onClick={(event) => event.stopPropagation()}
                            onChange={() => {
                                if (!network.builtin && !network.inUse && !remove.isPending) {
                                    toggle(network.name);
                                }
                            }}
                        />
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
                                        onSelect: () => setRemoveTargets([network]),
                                    },
                                ]}
                            />
                        </div>
                    </mdui-list-item>
                ))}
            </mdui-list>

            <ConfirmDialog
                open={removeTargets.length > 0}
                danger
                title={
                    singleTarget === undefined
                        ? t("resources.networks.removeSelectedTitle")
                        : t("resources.networks.removeTitle")
                }
                message={
                    singleTarget === undefined
                        ? t("resources.networks.removeSelectedConfirm", { count: removeTargets.length })
                        : t("resources.networks.removeConfirm", { name: singleTarget.name })
                }
                confirmLabel={t("action.remove")}
                onConfirm={() => {
                    const targets = removeTargets;
                    setRemoveTargets([]);
                    remove.mutate(targets);
                }}
                onCancel={() => setRemoveTargets([])}
            >
                {removeTargets.length > 1 ? (
                    <ul className="type-body-small mono resource-list-preview">
                        {removeTargets.map((network) => (
                            <li key={network.id || network.name}>{network.name}</li>
                        ))}
                    </ul>
                ) : null}
            </ConfirmDialog>

            <ConfirmDialog
                open={pruneOpen}
                danger
                title={t("resources.networks.pruneTitle")}
                message={t("resources.networks.pruneConfirm", { count: removable.length })}
                confirmLabel={t("action.remove")}
                onConfirm={() => {
                    setPruneOpen(false);
                    remove.mutate(removable);
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
