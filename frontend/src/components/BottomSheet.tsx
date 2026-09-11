import { type ReactElement, type ReactNode, useEffect, useId, useRef } from "react";
import { useT } from "../lib/i18n.ts";
import { useSizeClass } from "../lib/media.ts";
import "./BottomSheet.css";

interface Props {
    open: boolean;
    title: string;
    onClose: () => void;
    children: ReactNode;
}

/**
 * A sheet that arrives from the bottom edge on a phone and from the inline end on anything
 * wider. One component, one set of contents; only the container adapts. Dismissal is always
 * available by Escape and by the close button, never only by a gesture.
 */
export default function BottomSheet({ open, title, onClose, children }: Props): ReactElement {
    const { t } = useT();
    const sizeClass = useSizeClass();
    const dialogRef = useRef<HTMLDialogElement>(null);
    const titleId = useId();

    useEffect(() => {
        const dialog = dialogRef.current;
        if (dialog === null) return;
        if (open && !dialog.open) {
            dialog.showModal();
        } else if (!open && dialog.open) {
            dialog.close();
        }
    }, [open]);

    return (
        <dialog
            ref={dialogRef}
            className={`sheet ${sizeClass === "compact" ? "sheet--bottom" : "sheet--side"}`}
            aria-labelledby={titleId}
            onClose={onClose}
            onClick={(event) => {
                // A click that lands on the dialog box itself is the backdrop: the panel fills
                // the element, so any direct hit is outside the content.
                if (event.target === dialogRef.current) onClose();
            }}
        >
            <div className="sheet__panel">
                {sizeClass === "compact" ? <div className="sheet__handle" aria-hidden="true" /> : null}
                <div className="sheet__header">
                    <h2 id={titleId} className="sheet__title type-title-large">
                        {title}
                    </h2>
                    <div className="spacer" />
                    <mdui-button-icon icon="close" aria-label={t("action.close")} onClick={onClose} />
                </div>
                <div className="sheet__body">{children}</div>
            </div>
        </dialog>
    );
}
