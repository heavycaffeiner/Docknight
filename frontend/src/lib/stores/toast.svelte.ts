import { describeError } from "../connection.svelte.ts";
import { t } from "./i18n.svelte.ts";

export interface Toast {
    id: number;
    variant: "success" | "error";
    text: string;
    /** Error toasts are sticky until dismissed. */
    sticky: boolean;
}

const MAX_VISIBLE = 5;
const SUCCESS_MS = 6_000;

export const toasts = $state<{ items: Toast[] }>({ items: [] });

let nextId = 1;

function push(toast: Omit<Toast, "id">): number {
    const id = nextId++;
    toasts.items = [...toasts.items, { ...toast, id }].slice(-MAX_VISIBLE);
    if (!toast.sticky) window.setTimeout(() => dismiss(id), SUCCESS_MS);
    return id;
}

export function dismiss(id: number): void {
    toasts.items = toasts.items.filter((item) => item.id !== id);
}

export function toastResult(messageKey: string, values?: Record<string, string | number>): void {
    push({ variant: "success", text: t(messageKey, values), sticky: false });
}

/**
 * Resolve the text from the protocol error: the i18n key when present, otherwise the English
 * message. This makes the server's i18n keys the single place a message is worded.
 */
export function toastError(error: unknown): void {
    const described = describeError(error);
    const text = described.i18n === undefined ? described.message : t(described.i18n);
    push({ variant: "error", text, sticky: true });
}

export function clearToasts(): void {
    toasts.items = [];
}
