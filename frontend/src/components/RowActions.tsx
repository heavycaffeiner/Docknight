import { type ReactElement, useState } from "react";
import { useSizeClass } from "../lib/media.ts";
import BottomSheet from "./BottomSheet.tsx";

export interface RowAction {
    label: string;
    icon: string;
    danger?: boolean;
    disabled?: boolean;
    onSelect: () => void;
}

interface Props {
    /** Names the row the actions belong to, for the sheet title and the trigger's label. */
    title: string;
    actions: RowAction[];
}

/**
 * One action set, two containers: an anchored menu where there is room for one, and a bottom
 * sheet on a phone, where a menu anchored inside a scrolling list gets clipped and lands out
 * of thumb reach.
 */
export default function RowActions({ title, actions }: Props): ReactElement {
    const sizeClass = useSizeClass();
    const [sheetOpen, setSheetOpen] = useState(false);

    if (sizeClass === "compact") {
        return (
            <>
                <mdui-button-icon
                    icon="more_vert"
                    aria-label={title}
                    onClick={() => setSheetOpen(true)}
                />
                <BottomSheet open={sheetOpen} title={title} onClose={() => setSheetOpen(false)}>
                    <mdui-list>
                        {actions.map((action) => (
                            <mdui-list-item
                                key={action.label}
                                icon={action.icon}
                                disabled={action.disabled}
                                style={
                                    action.danger === true
                                        ? { color: "rgb(var(--mdui-color-error))" }
                                        : undefined
                                }
                                onClick={() => {
                                    if (action.disabled === true) return;
                                    setSheetOpen(false);
                                    action.onSelect();
                                }}
                            >
                                {action.label}
                            </mdui-list-item>
                        ))}
                    </mdui-list>
                </BottomSheet>
            </>
        );
    }

    return (
        <mdui-dropdown placement="auto">
            <mdui-button-icon slot="trigger" icon="more_vert" aria-label={title} />
            <mdui-menu>
                {actions.map((action) => (
                    <mdui-menu-item
                        key={action.label}
                        icon={action.icon}
                        disabled={action.disabled}
                        style={
                            action.danger === true
                                ? { color: "rgb(var(--mdui-color-error))" }
                                : undefined
                        }
                        onClick={() => {
                            if (action.disabled === true) return;
                            action.onSelect();
                        }}
                    >
                        {action.label}
                    </mdui-menu-item>
                ))}
            </mdui-menu>
        </mdui-dropdown>
    );
}
