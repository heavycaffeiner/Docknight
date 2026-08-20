const FOCUSABLE_SELECTOR = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableWithin(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null,
    );
}

/**
 * Trap Tab and Shift+Tab focus inside `container` and restore focus to whatever had it when
 * the trap started, once released. Returns a release function. Used by dialogs and sheets.
 */
export function trapFocus(container: HTMLElement): () => void {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusables = focusableWithin(container);
    (focusables[0] ?? container).focus();

    function onKeydown(event: KeyboardEvent): void {
        if (event.key !== "Tab") return;
        const current = focusableWithin(container);
        if (current.length === 0) {
            event.preventDefault();
            return;
        }
        const first = current[0] as HTMLElement;
        const last = current[current.length - 1] as HTMLElement;
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    container.addEventListener("keydown", onKeydown);

    return () => {
        container.removeEventListener("keydown", onKeydown);
        previouslyFocused?.focus();
    };
}

let liveRegion: HTMLElement | null = null;

/** Announce text through a shared aria-live=polite region, for route changes and similar. */
export function announce(text: string): void {
    if (liveRegion === null) {
        liveRegion = document.getElementById("route-announcer");
    }
    if (liveRegion !== null) liveRegion.textContent = text;
}
