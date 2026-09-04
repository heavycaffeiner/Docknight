export interface Toast {
    id: number;
    kind: "success" | "error" | "info";
    message: string;
    sticky?: boolean;
}

let nextId = 1;
export const toasts = $state<Toast[]>([]);

export function dismissToast(id: number): void {
    const idx = toasts.findIndex((t) => t.id === id);
    if (idx !== -1) {
        toasts.splice(idx, 1);
    }
}

function addToast(item: Omit<Toast, "id">): void {
    const id = nextId++;
    const t: Toast = { ...item, id };
    toasts.push(t);
    if (toasts.length > 5) {
        toasts.shift();
    }
    if (!item.sticky) {
        setTimeout(() => {
            dismissToast(id);
        }, 6000);
    }
}

export function toastSuccess(message: string): void {
    addToast({ kind: "success", message, sticky: false });
}

export function toastResult(message: string): void {
    toastSuccess(message);
}

export function toastError(error: unknown): void {
    let msg = "An error occurred";
    if (error instanceof Error) {
        msg = error.message;
    } else if (typeof error === "string") {
        msg = error;
    }
    addToast({ kind: "error", message: msg, sticky: true });
}

export function toastInfo(message: string): void {
    addToast({ kind: "info", message, sticky: false });
}
