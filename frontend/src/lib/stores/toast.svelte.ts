import { isProtocolError } from "../../../../common/protocol.ts";
import { hasMessage, t } from "./i18n.svelte.ts";

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

/**
 * Pick the best text for an error: the specific per-code string, then the generic string for
 * the error class, then the server's English message.
 */
function errorText(
    code: string,
    i18nCode: string | undefined,
    message: string,
    values?: Record<string, string | number>,
): string {
    if (i18nCode !== undefined && hasMessage(`error.${i18nCode}`)) return t(`error.${i18nCode}`, values);
    if (hasMessage(`error.${code}`)) return t(`error.${code}`, values);
    return message;
}

/**
 * Resolve text from a protocol error. The server sends a bare code in `i18n` ("stackNotFound");
 * the catalogue namespaces those under "error.". A code with no entry falls back to the
 * server's English message rather than showing the raw code to the user.
 */
export function toastError(error: unknown): void {
    if (isProtocolError(error)) {
        push(errorText(error.code, error.i18n, error.message, error.values), "error", true);
        return;
    }
    if (error instanceof Error) {
        push(error.message, "error", true);
        return;
    }
    push(String(error), "error", true);
}
