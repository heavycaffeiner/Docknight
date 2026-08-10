const FOCUSABLE = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Trap focus inside `container`, restoring it to the invoking element on release. Used by every
 * dialog, together with Escape handling and aria-modal.
 */
export function trapFocus(container: HTMLElement): () => void {
    const previous = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] =>
        [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
            (element) => element.offsetParent !== null || element === document.activeElement,
        );

    const onKeydown = (event: KeyboardEvent): void => {
        if (event.key !== "Tab") return;
        const items = focusables();
        if (items.length === 0) {
            event.preventDefault();
            return;
        }
        const first = items[0] as HTMLElement;
        const last = items[items.length - 1] as HTMLElement;
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };

    container.addEventListener("keydown", onKeydown);
    queueMicrotask(() => focusables()[0]?.focus());

    return () => {
        container.removeEventListener("keydown", onKeydown);
        previous?.focus();
    };
}

let announcer: HTMLElement | null = null;

/**
 * Announce a message through a polite live region. A client-side navigation is silent otherwise,
 * so route changes call this with the new view's title.
 */
export function announce(message: string): void {
    if (announcer === null) {
        announcer = document.createElement("div");
        announcer.setAttribute("role", "status");
        announcer.setAttribute("aria-live", "polite");
        announcer.className = "visually-hidden";
        document.body.append(announcer);
    }
    // Clearing first makes a repeated message announce again.
    announcer.textContent = "";
    window.setTimeout(() => {
        if (announcer !== null) announcer.textContent = message;
    }, 50);
}

/** Move focus to the routed view's heading, so keyboard and screen reader users land in it. */
export function focusHeading(root: HTMLElement | null): void {
    const heading = root?.querySelector<HTMLElement>("h1, h2, [data-route-heading]");
    if (heading === null || heading === undefined) return;
    if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: false });
}
