import { isProtocolError } from "../../../../common/protocol.ts";
import { t } from "./i18n.svelte.ts";

export type ToastVariant = "success" | "error";

export interface Toast {
    id: number;
    message: string;
    variant: ToastVariant;
    sticky: boolean;
}

const MAX_TOASTS = 5;
const SUCCESS_DURATION_MS = 6_000;

let nextId = 1;
const state = $state<{ toasts: Toast[] }>({ toasts: [] });

export const toasts: { readonly list: Toast[] } = {
    get list() {
        return state.toasts;
    },
};

function push(message: string, variant: ToastVariant, sticky: boolean): void {
    const toast: Toast = { id: nextId, message, variant, sticky };
    nextId += 1;
    const next = [...state.toasts, toast];
    // At most five toasts are visible; older ones drop from the top.
    state.toasts = next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
    if (!sticky) {
        setTimeout(() => dismiss(toast.id), SUCCESS_DURATION_MS);
    }
}

export function dismiss(id: number): void {
    state.toasts = state.toasts.filter((toast) => toast.id !== id);
}

export function toastResult(message: string): void {
    push(message, "success", false);
}

/** Resolves text from the protocol error: err.i18n through t() when present, else err.message. */
export function toastError(error: unknown): void {
    if (isProtocolError(error)) {
        const message = error.i18n !== undefined ? t(error.i18n, error.values) : error.message;
        push(message, "error", true);
        return;
    }
    if (error instanceof Error) {
        push(error.message, "error", true);
        return;
    }
    push(String(error), "error", true);
}
