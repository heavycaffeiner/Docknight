import { snackbar } from "mdui/functions/snackbar.js";
import { AppError } from "../../../common/errors.ts";
import { t } from "./i18n.ts";

/**
 * One queue, so a burst of results does not stack snackbars over the bottom navigation bar.
 * Errors stay until dismissed; everything else self-closes.
 */
const QUEUE = "docknight";

export function toastSuccess(message: string): void {
    snackbar({ message, queue: QUEUE, autoCloseDelay: 5000 });
}

export function toastInfo(message: string): void {
    snackbar({ message, queue: QUEUE, autoCloseDelay: 5000 });
}

export function toastError(error: unknown): void {
    let message = t("error.internal");
    if (error instanceof AppError) {
        message = error.i18n !== undefined ? t(error.i18n, error.values) : error.message;
    } else if (error instanceof Error) {
        message = error.message;
    } else if (typeof error === "string") {
        message = error;
    }
    snackbar({ message, queue: QUEUE, autoCloseDelay: 0, closeable: true, messageLine: 2 });
}
