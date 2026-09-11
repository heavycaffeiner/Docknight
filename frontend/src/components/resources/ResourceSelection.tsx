import type { ReactElement } from "react";
import { useT } from "../../lib/i18n.ts";

interface Props {
    eligibleCount: number;
    selectedCount: number;
    pending: boolean;
    onToggleAll: () => void;
    onRemove: () => void;
}

/** Shared selection controls for removable Docker resources. */
export default function ResourceSelection({
    eligibleCount,
    selectedCount,
    pending,
    onToggleAll,
    onRemove,
}: Props): ReactElement {
    const { t } = useT();
    return (
        <div className="resource-selection">
            <mdui-checkbox
                checked={eligibleCount > 0 && selectedCount === eligibleCount}
                indeterminate={selectedCount > 0 && selectedCount < eligibleCount}
                disabled={eligibleCount === 0 || pending}
                onChange={onToggleAll}
            >
                {t("resources.selectAll")}
            </mdui-checkbox>
            <mdui-button
                variant="tonal"
                className="danger-action"
                icon="delete--outlined"
                disabled={selectedCount === 0 || pending}
                loading={pending}
                onClick={onRemove}
            >
                {t("resources.removeSelected", { count: selectedCount })}
            </mdui-button>
        </div>
    );
}
