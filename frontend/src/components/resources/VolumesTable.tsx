import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactElement, useState } from "react";
import type { VolumeSummary } from "../../../../common/docker.ts";
import { useT } from "../../lib/i18n.ts";
import { qk } from "../../lib/query.ts";
import { toastError, toastSuccess } from "../../lib/toast.ts";
import { request } from "../../lib/transport.ts";
import ConfirmDialog from "../ConfirmDialog.tsx";
import RowActions from "../RowActions.tsx";
import ResourceSelection from "./ResourceSelection.tsx";
import ResourceFrame from "./ResourceFrame.tsx";

export default function VolumesTable({ endpoint }: { endpoint: string }): ReactElement {
    const { t } = useT();
    const client = useQueryClient();
    const [removeTargets, setRemoveTargets] = useState<VolumeSummary[]>([]);
    const [selected, setSelected] = useState<Set<string>>(() => new Set());
    const [cleanupOpen, setCleanupOpen] = useState(false);

    const query = useQuery({
        queryKey: qk.volumes(endpoint),
        queryFn: () => request<{ volumes: VolumeSummary[] }>(endpoint, "docker.volumes", undefined),
    });

    const remove = useMutation({
        mutationFn: async (volumes: VolumeSummary[]) => {
            for (const volume of volumes) {
                await request<{ ok: true }>(endpoint, "docker.volumeRemove", { name: volume.name });
            }
        },
        onSuccess: (_data, volumes) => {
            setSelected(new Set());
            toastSuccess(t("resources.volumes.removed", { count: volumes.length }));
            void client.invalidateQueries({ queryKey: qk.volumes(endpoint) });
        },
        onError: (error) => {
            toastError(error);
            void client.invalidateQueries({ queryKey: qk.volumes(endpoint) });
        },
    });

    const volumes = query.data?.volumes ?? [];
    const selectable = volumes.filter((volume) => !volume.inUse);
    const selectedVolumes = selectable.filter((volume) => selected.has(volume.name));
    // A stopped stack's volume is unreferenced but not an orphan. Automatic cleanup only ever
    // offers volumes no stack claims; explicit selection can still remove a named stopped volume.
    const orphans = selectable.filter((volume) => volume.stack === null);
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
            selectedVolumes.length === selectable.length
                ? new Set()
                : new Set(selectable.map((volume) => volume.name)),
        );
    }

    return (
        <ResourceFrame
            query={query}
            empty={volumes.length === 0}
            emptyLabel={t("resources.volumes.empty")}
            toolbar={
                <>
                    <ResourceSelection
                        eligibleCount={selectable.length}
                        selectedCount={selectedVolumes.length}
                        pending={remove.isPending}
                        onToggleAll={toggleAll}
                        onRemove={() => setRemoveTargets(selectedVolumes)}
                    />
                    <mdui-button
                        variant="tonal"
                        icon="cleaning_services--outlined"
                        disabled={orphans.length === 0 || remove.isPending}
                        loading={remove.isPending}
                        onClick={() => setCleanupOpen(true)}
                    >
                        {t("resources.volumes.cleanup", { count: orphans.length })}
                    </mdui-button>
                </>
            }
        >
            <mdui-list>
                {volumes.map((volume) => (
                    <mdui-list-item
                        key={volume.name}
                        headline={volume.name}
                        description={volume.mountpoint || volume.driver}
                        nonclickable
                    >
                        <mdui-checkbox
                            slot="icon"
                            checked={!volume.inUse && selected.has(volume.name)}
                            disabled={volume.inUse || remove.isPending}
                            aria-label={t("resources.select", { name: volume.name })}
                            onClick={(event) => event.stopPropagation()}
                            onChange={() => {
                                if (!volume.inUse && !remove.isPending) toggle(volume.name);
                            }}
                        />
                        <div slot="end-icon" className="list-end">
                            {volume.stack !== null ? (
                                <span className="status-chip status-chip--info type-label-medium">
                                    {volume.stack}
                                </span>
                            ) : null}
                            <span
                                className={`status-chip type-label-medium ${
                                    volume.inUse ? "status-chip--running" : ""
                                }`}
                            >
                                {volume.inUse ? t("resources.inUse") : t("resources.detached")}
                            </span>
                            <RowActions
                                title={volume.name}
                                actions={[
                                    {
                                        label: t("action.remove"),
                                        icon: "delete--outlined",
                                        danger: true,
                                        disabled: volume.inUse || remove.isPending,
                                        onSelect: () => setRemoveTargets([volume]),
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
                        ? t("resources.volumes.removeSelectedTitle")
                        : t("resources.volumes.removeTitle")
                }
                message={
                    singleTarget === undefined
                        ? t("resources.volumes.removeSelectedConfirm", { count: removeTargets.length })
                        : t("resources.volumes.removeConfirm", { name: singleTarget.name })
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
                        {removeTargets.map((volume) => (
                            <li key={volume.name}>{volume.name}</li>
                        ))}
                    </ul>
                ) : null}
            </ConfirmDialog>

            {/*
              A volume holds data, so automatic cleanup names every target on screen before it
              runs rather than handing the decision to `docker volume prune`.
            */}
            <ConfirmDialog
                open={cleanupOpen}
                danger
                title={t("resources.volumes.cleanupTitle")}
                message={t("resources.volumes.cleanupConfirm", { count: orphans.length })}
                confirmLabel={t("action.remove")}
                onConfirm={() => {
                    setCleanupOpen(false);
                    remove.mutate(orphans);
                }}
                onCancel={() => setCleanupOpen(false)}
            >
                <ul className="type-body-small mono resource-list-preview">
                    {orphans.map((volume) => (
                        <li key={volume.name}>{volume.name}</li>
                    ))}
                </ul>
            </ConfirmDialog>
        </ResourceFrame>
    );
}
