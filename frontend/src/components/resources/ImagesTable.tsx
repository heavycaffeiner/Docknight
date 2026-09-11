import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactElement, useState } from "react";
import type { ImageSummary, PruneResult } from "../../../../common/docker.ts";
import { useT } from "../../lib/i18n.ts";
import { qk } from "../../lib/query.ts";
import { toastError, toastSuccess } from "../../lib/toast.ts";
import { request } from "../../lib/transport.ts";
import ConfirmDialog from "../ConfirmDialog.tsx";
import RowActions from "../RowActions.tsx";
import ResourceFrame from "./ResourceFrame.tsx";

export default function ImagesTable({ endpoint }: { endpoint: string }): ReactElement {
    const { t } = useT();
    const client = useQueryClient();
    const [removeTarget, setRemoveTarget] = useState<ImageSummary | null>(null);
    const [pruneOpen, setPruneOpen] = useState(false);

    const query = useQuery({
        queryKey: qk.images(endpoint),
        queryFn: () => request<{ images: ImageSummary[] }>(endpoint, "docker.images", undefined),
    });

    const remove = useMutation({
        mutationFn: (image: ImageSummary) =>
            request<{ ok: true }>(endpoint, "docker.imageRemove", { id: image.id, force: false }),
        onSuccess: () => {
            toastSuccess(t("resources.images.removed"));
            void client.invalidateQueries({ queryKey: qk.images(endpoint) });
        },
        onError: toastError,
    });

    const prune = useMutation({
        mutationFn: () => request<PruneResult>(endpoint, "docker.imagePrune", undefined),
        onSuccess: (result) => {
            toastSuccess(t("resources.pruned", { size: result.reclaimed, count: result.deleted }));
            void client.invalidateQueries({ queryKey: qk.images(endpoint) });
        },
        onError: toastError,
    });

    const images = query.data?.images ?? [];
    const danglingCount = images.filter((image) => image.dangling).length;

    return (
        <ResourceFrame
            query={query}
            empty={images.length === 0}
            emptyLabel={t("resources.images.empty")}
            toolbar={
                <mdui-button
                    variant="tonal"
                    icon="cleaning_services--outlined"
                    disabled={danglingCount === 0 || prune.isPending}
                    loading={prune.isPending}
                    onClick={() => setPruneOpen(true)}
                >
                    {t("resources.images.prune", { count: danglingCount })}
                </mdui-button>
            }
        >
            <mdui-list>
                {images.map((image) => (
                    <mdui-list-item key={image.id} headline={image.reference} nonclickable>
                        <span slot="description">
                            <span className="mono">{image.size}</span> | <span className="mono">{image.created}</span>
                        </span>
                        <div slot="end-icon" className="list-end">
                            {image.dangling ? (
                                <span className="status-chip status-chip--pending type-label-medium">
                                    {t("resources.images.dangling")}
                                </span>
                            ) : null}
                            {image.inUse ? (
                                <span className="status-chip status-chip--running type-label-medium">
                                    {t("resources.inUse")}
                                </span>
                            ) : null}
                            <RowActions
                                title={image.reference}
                                actions={[
                                    {
                                        label: t("action.remove"),
                                        icon: "delete--outlined",
                                        danger: true,
                                        disabled: image.inUse || remove.isPending,
                                        onSelect: () => setRemoveTarget(image),
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
                title={t("resources.images.removeTitle")}
                message={
                    removeTarget === null
                        ? ""
                        : t("resources.images.removeConfirm", { name: removeTarget.reference })
                }
                confirmLabel={t("action.remove")}
                onConfirm={() => {
                    if (removeTarget !== null) remove.mutate(removeTarget);
                    setRemoveTarget(null);
                }}
                onCancel={() => setRemoveTarget(null)}
            />

            <ConfirmDialog
                open={pruneOpen}
                danger
                title={t("resources.images.pruneTitle")}
                message={t("resources.images.pruneConfirm", { count: danglingCount })}
                confirmLabel={t("action.remove")}
                onConfirm={() => {
                    setPruneOpen(false);
                    prune.mutate();
                }}
                onCancel={() => setPruneOpen(false)}
            />
        </ResourceFrame>
    );
}
