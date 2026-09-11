import { type ReactElement, type ReactNode, useRef } from "react";
import { useElementEvent } from "../lib/dom-events.ts";
import { useT } from "../lib/i18n.ts";

interface Props {
    open: boolean;
    title: string;
    message?: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    children?: ReactNode;
}

/**
 * mdui's dialog supplies the scrim, the focus trap, Escape, and overlay-click dismissal, so
 * this only owns the copy and the two buttons.
 */
export default function ConfirmDialog({
    open,
    title,
    message,
    confirmLabel,
    danger = false,
    onConfirm,
    onCancel,
    children,
}: Props): ReactElement {
    const { t } = useT();
    const dialogRef = useRef<HTMLElement>(null);

    useElementEvent(dialogRef, "close", () => {
        if (open) onCancel();
    });

    return (
        <mdui-dialog
            ref={dialogRef}
            open={open}
            headline={title}
            description={message}
            close-on-esc
            close-on-overlay-click
        >
            {children}
            <mdui-button slot="action" variant="text" onClick={onCancel}>
                {t("action.cancel")}
            </mdui-button>
            <mdui-button
                slot="action"
                variant={danger ? "filled" : "tonal"}
                className={danger ? "danger-action" : undefined}
                onClick={onConfirm}
            >
                {confirmLabel ?? t("action.confirm")}
            </mdui-button>
        </mdui-dialog>
    );
}
