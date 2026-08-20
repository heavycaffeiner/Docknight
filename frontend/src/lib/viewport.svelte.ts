/** Not a token: this is a heuristic threshold for keyboard detection, not a spatial value. */
const KEYBOARD_THRESHOLD_PX = 120;

const state = $state({ keyboardOpen: false });

export const keyboardOpen: { readonly value: boolean } = {
    get value() {
        return state.keyboardOpen;
    },
};

/**
 * Track `visualViewport` and publish `--viewport-block`, `--keyboard-inset`, and
 * `data-keyboard` on the document element. Returns an unsubscribe function. A no-op on a
 * browser without `visualViewport` (Safari has it; every supported engine does): the
 * `--viewport-block` property simply stays unset and the `100dvh` fallback in Layout applies.
 */
export function trackViewport(): () => void {
    const visualViewport = window.visualViewport;
    if (visualViewport === null || visualViewport === undefined) {
        return () => undefined;
    }

    const root = document.documentElement;

    function update(): void {
        const vv = window.visualViewport;
        if (vv === null || vv === undefined) return;
        // A transient negative reading happens while the layout and visual viewports briefly
        // disagree during a resize; clamping to 0 keeps the inset meaningful at every frame.
        const inset = Math.max(0, root.clientHeight - vv.height - vv.offsetTop);
        root.style.setProperty("--viewport-block", `${vv.height}px`);
        root.style.setProperty("--keyboard-inset", `${inset}px`);
        const open = inset > KEYBOARD_THRESHOLD_PX;
        root.dataset.keyboard = open ? "open" : "closed";
        state.keyboardOpen = open;
    }

    visualViewport.addEventListener("resize", update);
    visualViewport.addEventListener("scroll", update);
    update();

    return () => {
        visualViewport.removeEventListener("resize", update);
        visualViewport.removeEventListener("scroll", update);
    };
}
