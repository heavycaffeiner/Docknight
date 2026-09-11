import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactElement, useState } from "react";
import type { ImageSummary, PruneResult } from "../../../../common/docker.ts";
import { useT } from "../../lib/i18n.ts";
import { qk } from "../../lib/query.ts";
import { toastError, toastSuccess } from "../../lib/toast.ts";
import { request } from "../../lib/transport.ts";
import ConfirmDialog from "../ConfirmDialog.tsx";
import RowActions from "../RowActions.tsx";
import ResourceSelection from "./ResourceSelection.tsx";
import ResourceFrame from "./ResourceFrame.tsx";

function imageSelectionKey(image: ImageSummary): string {
    return `${image.id}:${image.reference}`;
}

function imageRemovalTarget(image: ImageSummary): string {
    return image.dangling ? image.id : image.reference;
}

export default function ImagesTable({ endpoint }: { endpoint: string }): ReactElement {
    const { t } = useT();
    const client = useQueryClient();
    const [removeTargets, setRemoveTargets] = useState<ImageSummary[]>([]);
    const [selected, setSelected] = useState<Set<string>>(() => new Set());
    const [pruneOpen, setPruneOpen] = useState(false);

    const query = useQuery({
        queryKey: qk.images(endpoint),
        queryFn: () => request<{ images: ImageSummary[] }>(endpoint, "docker.images", undefined),
    });

    const remove = useMutation({
        mutationFn: async (images: ImageSummary[]) => {
            for (const image of images) {
                await request<{ ok: true }>(endpoint, "docker.imageRemove", {
                    target: imageRemovalTarget(image),
                    force: false,
                });
            }
        },
        onSuccess: (_data, images) => {
            setSelected(new Set());
            toastSuccess(t("resources.images.removed", { count: images.length }));
            void client.invalidateQueries({ queryKey: qk.images(endpoint) });
        },
        onError: (error) => {
            toastError(error);
            void client.invalidateQueries({ queryKey: qk.images(endpoint) });
        },
    });

    const prune = useMutation({
        mutationFn: () => request<PruneResult>(endpoint, "docker.imagePrune", undefined),
        onSuccess: (result) => {
            setSelected(new Set());
            toastSuccess(t("resources.pruned", { size: result.reclaimed, count: result.deleted }));
            void client.invalidateQueries({ queryKey: qk.images(endpoint) });
        },
        onError: toastError,
    });

    const images = query.data?.images ?? [];
    const selectable = images.filter((image) => !image.inUse);
    const selectedImages = selectable.filter((image) => selected.has(imageSelectionKey(image)));
    const danglingCount = images.filter((image) => image.dangling).length;
    const singleTarget = removeTargets.length === 1 ? removeTargets[0] : undefined;

    function toggle(key: string): void {
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }

    function toggleAll(): void {
        setSelected(
            selectedImages.length === selectable.length
                ? new Set()
                : new Set(selectable.map(imageSelectionKey)),
        );
    }

    return (
        <ResourceFrame
            query={query}
            empty={images.length === 0}
            emptyLabel={t("resources.images.empty")}
            toolbar={
                <>
                    <ResourceSelection
                        eligibleCount={selectable.length}
                        selectedCount={selectedImages.length}
                        pending={remove.isPending}
                        onToggleAll={toggleAll}
                        onRemove={() => setRemoveTargets(selectedImages)}
                    />
                    <mdui-button
                        variant="tonal"
                        icon="cleaning_services--outlined"
                        disabled={danglingCount === 0 || prune.isPending || remove.isPending}
                        loading={prune.isPending}
                        onClick={() => setPruneOpen(true)}
                    >
                        {t("resources.images.prune", { count: danglingCount })}
                    </mdui-button>
                </>
            }
        >
            <mdui-list>
                {images.map((image) => (
                    <mdui-list-item key={`${image.id}:${image.reference}`} headline={image.reference} nonclickable>
                        <mdui-checkbox
                            slot="icon"
                            checked={!image.inUse && selected.has(imageSelectionKey(image))}
                            disabled={image.inUse || remove.isPending}
                            aria-label={t("resources.select", { name: image.reference })}
                            onClick={(event) => event.stopPropagation()}
                            onChange={() => {
                                if (!image.inUse && !remove.isPending) toggle(imageSelectionKey(image));
                            }}
                        />
                        <span slot="description">
                            <span className="mono">{image.size}</span> |{" "}
                            <span className="mono">{image.created}</span>
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
                                        onSelect: () => setRemoveTargets([image]),
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
                        ? t("resources.images.removeSelectedTitle")
                        : t("resources.images.removeTitle")
                }
                message={
                    singleTarget === undefined
                        ? t("resources.images.removeSelectedConfirm", { count: removeTargets.length })
                        : t("resources.images.removeConfirm", { name: singleTarget.reference })
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
                        {removeTargets.map((image) => (
                            <li key={`${image.id}:${image.reference}`}>{image.reference}</li>
                        ))}
                    </ul>
                ) : null}
            </ConfirmDialog>

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
