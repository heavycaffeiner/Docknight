const KEYBOARD_THRESHOLD = 120;

const keyboardOpenState = $state({ value: false });

export const keyboardOpen = {
    get value(): boolean {
        return keyboardOpenState.value;
    },
};

export function trackViewport(): () => void {
    if (typeof window === "undefined" || !window.visualViewport) {
        return () => {};
    }

    const vv = window.visualViewport;

    function update(): void {
        if (!window.visualViewport) return;
        const v = window.visualViewport;
        const inset = Math.max(0, document.documentElement.clientHeight - v.height - v.offsetTop);
        document.documentElement.style.setProperty("--viewport-block", `${v.height}px`);
        document.documentElement.style.setProperty("--keyboard-inset", `${inset}px`);
        const open = inset > KEYBOARD_THRESHOLD;
        document.documentElement.dataset.keyboard = open ? "open" : "closed";
        keyboardOpenState.value = open;
    }

    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();

    return () => {
        vv.removeEventListener("resize", update);
        vv.removeEventListener("scroll", update);
    };
}
