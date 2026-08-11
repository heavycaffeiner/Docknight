/**
 * The block size actually available to the shell. `interactive-widget=resizes-content` already gives
 * this on Chromium and Firefox; Safari leaves the layout viewport at full height and only shrinks the
 * visual one, so it is read from visualViewport instead. Published as properties on the document
 * element rather than as a store, because the consumer is a stylesheet.
 */

/** Comfortably above the largest browser toolbar and below the smallest keyboard. */
const KEYBOARD_THRESHOLD = 120;

/**
 * Subscribe to the visual viewport and publish `--viewport-block`, `--keyboard-inset` and
 * `data-keyboard`. Returns the unsubscribe. Called once, from the application root.
 */
export function trackViewport(): () => void {
    const visual = window.visualViewport;
    // There is no error path here: a missing visualViewport leaves the property unset and the
    // `100dvh` fallback in the var() applies, so the shell always has a height.
    if (visual === null || visual === undefined) return () => undefined;

    const root = document.documentElement;

    const publish = (): void => {
        // Clamped because the inset goes briefly negative while the visual viewport has grown and
        // the layout viewport has not yet been reported, which would stretch the shell past the
        // screen for a frame.
        const inset = Math.max(0, root.clientHeight - visual.height - visual.offsetTop);
        root.style.setProperty("--viewport-block", `${visual.height}px`);
        root.style.setProperty("--keyboard-inset", `${inset}px`);
        if (inset > KEYBOARD_THRESHOLD) root.dataset.keyboard = "open";
        else delete root.dataset.keyboard;
    };

    publish();
    visual.addEventListener("resize", publish);
    visual.addEventListener("scroll", publish);

    return () => {
        visual.removeEventListener("resize", publish);
        visual.removeEventListener("scroll", publish);
        root.style.removeProperty("--viewport-block");
        root.style.removeProperty("--keyboard-inset");
        delete root.dataset.keyboard;
    };
}
