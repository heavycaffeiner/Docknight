import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactElement, useState } from "react";
import type { VolumeSummary } from "../../../../common/docker.ts";
import { useT } from "../../lib/i18n.ts";
import { qk } from "../../lib/query.ts";
import { toastError, toastSuccess } from "../../lib/toast.ts";
import { request } from "../../lib/transport.ts";
import ConfirmDialog from "../ConfirmDialog.tsx";
import RowActions from "../RowActions.tsx";
import ResourceFrame from "./ResourceFrame.tsx";

export default function VolumesTable({ endpoint }: { endpoint: string }): ReactElement {
    const { t } = useT();
    const client = useQueryClient();
    const [removeTarget, setRemoveTarget] = useState<VolumeSummary | null>(null);
    const [cleanupOpen, setCleanupOpen] = useState(false);

    const query = useQuery({
        queryKey: qk.volumes(endpoint),
        queryFn: () => request<{ volumes: VolumeSummary[] }>(endpoint, "docker.volumes", undefined),
    });

    const remove = useMutation({
        mutationFn: (name: string) =>
            request<{ ok: true }>(endpoint, "docker.volumeRemove", { name }),
        onError: toastError,
    });

    async function removeAll(names: string[]): Promise<void> {
        for (const name of names) {
            await remove.mutateAsync(name);
        }
        toastSuccess(t("resources.volumes.removed", { count: names.length }));
        await client.invalidateQueries({ queryKey: qk.volumes(endpoint) });
    }

    const volumes = query.data?.volumes ?? [];
    // A stopped stack's volume is unreferenced but not an orphan. Bulk cleanup only ever
    // offers volumes no stack claims; a stack's own volume needs the named single removal.
    const orphans = volumes.filter((volume) => !volume.inUse && volume.stack === null);

    return (
        <ResourceFrame
            query={query}
            empty={volumes.length === 0}
            emptyLabel={t("resources.volumes.empty")}
            toolbar={
                <mdui-button
                    variant="tonal"
                    icon="cleaning_services--outlined"
                    disabled={orphans.length === 0 || remove.isPending}
                    loading={remove.isPending}
                    onClick={() => setCleanupOpen(true)}
                >
                    {t("resources.volumes.cleanup", { count: orphans.length })}
                </mdui-button>
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
                                        onSelect: () => setRemoveTarget(volume),
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
                title={t("resources.volumes.removeTitle")}
                message={
                    removeTarget === null
                        ? ""
                        : t("resources.volumes.removeConfirm", { name: removeTarget.name })
                }
                confirmLabel={t("action.remove")}
                onConfirm={() => {
                    const target = removeTarget;
                    setRemoveTarget(null);
                    if (target !== null) void removeAll([target.name]);
                }}
                onCancel={() => setRemoveTarget(null)}
            />

            {/*
              A volume holds data, so bulk removal names every target on screen before it runs
              rather than handing the decision to `docker volume prune`.
            */}
            <ConfirmDialog
                open={cleanupOpen}
                danger
                title={t("resources.volumes.cleanupTitle")}
                message={t("resources.volumes.cleanupConfirm", { count: orphans.length })}
                confirmLabel={t("action.remove")}
                onConfirm={() => {
                    setCleanupOpen(false);
                    void removeAll(orphans.map((volume) => volume.name));
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
