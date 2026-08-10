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
