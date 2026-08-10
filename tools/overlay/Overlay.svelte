<script lang="ts">
    import { audit, type Exemption, type Violation } from "../audit/index.ts";
    import exemptionFile from "../../design/exemptions.json";

    /**
     * Mounted only in development builds. Ctrl+Shift+G draws a 4 pixel rule over the viewport and
     * runs the same rule modules the CI auditor uses, outlining what fails. Ctrl+Shift+L cycles the
     * pseudo-locales, which is the fastest way to see what a longer translation does to a layout.
     */
    const DEBOUNCE_MS = 500;
    const LOCALE_CYCLE = ["en", "en-XA", "ar-XB"];
    // Read from the same file CI reads, so a surface excluded there is excluded here.
    const EXEMPTIONS = exemptionFile.entries as Exemption[];

    let showGrid = $state(false);
    let showViolations = $state(false);
    let violations = $state<Violation[]>([]);
    let running = false;
    let timer: number | null = null;

    async function run(): Promise<void> {
        if (running) return;
        running = true;
        try {
            violations = await audit({ unit: 4, tolerance: 0.5, exemptions: EXEMPTIONS });
        } finally {
            running = false;
        }
    }

    function schedule(): void {
        if (timer !== null) clearTimeout(timer);
        timer = window.setTimeout(() => {
            timer = null;
            void run();
        }, DEBOUNCE_MS);
    }

    function cycleLocale(): void {
        const current = localStorage.getItem("locale") ?? LOCALE_CYCLE[0];
        const index = LOCALE_CYCLE.indexOf(current);
        localStorage.setItem(
            "locale",
            LOCALE_CYCLE[(index + 1) % LOCALE_CYCLE.length] as string,
        );
        location.reload();
    }

    function onKeydown(event: KeyboardEvent): void {
        if (!event.ctrlKey || !event.shiftKey) return;
        const key = event.key.toLowerCase();
        if (key === "g") {
            event.preventDefault();
            showGrid = !showGrid;
        }
        if (key === "a") {
            event.preventDefault();
            showViolations = !showViolations;
            if (showViolations) void run();
        }
        if (key === "l") {
            event.preventDefault();
            cycleLocale();
        }
    }

    $effect(() => {
        if (!showViolations) return undefined;
        const observer = new MutationObserver(schedule);
        observer.observe(document.body, { subtree: true, childList: true, attributes: true });
        window.addEventListener("resize", schedule);
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", schedule);
            if (timer !== null) clearTimeout(timer);
        };
    });
</script>

<svelte:window onkeydown={onKeydown} />

{#if showGrid}
    <div class="grid" aria-hidden="true"></div>
{/if}

{#if showViolations}
    {#each violations as violation, index (index)}
        <div
            class="outline"
            aria-hidden="true"
            style:--x="{violation.highlight.x}px"
            style:--y="{violation.highlight.y}px"
            style:--w="{violation.highlight.width}px"
            style:--h="{violation.highlight.height}px"
        ></div>
    {/each}

    <div class="panel">
        <p class="head">{violations.length} violations</p>
        <ul>
            {#each violations as violation, index (index)}
                <li>
                    <button type="button" onclick={() => console.log(violation)}>
                        <strong>{violation.rule}</strong>
                        {violation.path}
                        <span>{violation.message}</span>
                    </button>
                </li>
            {/each}
        </ul>
    </div>
{/if}

<style>
    .grid {
        position: fixed;
        inset: 0;
        z-index: 9998;
        pointer-events: none;
        background-image:
            repeating-linear-gradient(to bottom, rgb(255 0 128 / 0.28) 0 1px, transparent 1px 16px),
            repeating-linear-gradient(to right, rgb(255 0 128 / 0.28) 0 1px, transparent 1px 16px),
            repeating-linear-gradient(to bottom, rgb(0 128 255 / 0.16) 0 1px, transparent 1px 4px),
            repeating-linear-gradient(to right, rgb(0 128 255 / 0.16) 0 1px, transparent 1px 4px);
    }

    .outline {
        position: fixed;
        inset-block-start: var(--y);
        inset-inline-start: var(--x);
        inline-size: var(--w);
        block-size: var(--h);
        z-index: 9999;
        pointer-events: none;
        outline: 2px solid rgb(255 0 0 / 0.8);
        outline-offset: -2px;
    }

    .panel {
        position: fixed;
        inset-block-end: 0;
        inset-inline-start: 0;
        z-index: 10000;
        max-block-size: 40vh;
        max-inline-size: 480px;
        overflow: auto;
        padding: 8px;
        background: rgb(0 0 0 / 0.85);
        color: rgb(255 255 255);
        font-family: ui-monospace, monospace;
        font-size: 11px;
    }

    .head {
        margin: 0 0 4px;
        font-weight: 700;
    }

    ul {
        margin: 0;
        padding: 0;
        list-style: none;
    }

    button {
        display: block;
        inline-size: 100%;
        padding: 2px 0;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
    }

    button:hover {
        background: rgb(255 255 255 / 0.15);
    }

    span {
        display: block;
        opacity: 0.75;
    }
</style>
