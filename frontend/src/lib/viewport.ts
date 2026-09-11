const KEYBOARD_THRESHOLD = 120;

/**
 * Publishes the visual viewport to CSS. `--viewport-block` is the real usable height and
 * `--keyboard-inset` is what the virtual keyboard took, so bottom-anchored chrome can sit on
 * the keyboard rather than behind it.
 */
export function trackViewport(): () => void {
    if (typeof window === "undefined" || !window.visualViewport) {
        return () => {};
    }

    const vv = window.visualViewport;

    function update(): void {
        const v = window.visualViewport;
        if (!v) return;
        const inset = Math.max(0, document.documentElement.clientHeight - v.height - v.offsetTop);
        document.documentElement.style.setProperty("--viewport-block", `${v.height}px`);
        document.documentElement.style.setProperty("--keyboard-inset", `${inset}px`);
        document.documentElement.dataset.keyboard = inset > KEYBOARD_THRESHOLD ? "open" : "closed";
    }

    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();

    return () => {
        vv.removeEventListener("resize", update);
        vv.removeEventListener("scroll", update);
    };
}
