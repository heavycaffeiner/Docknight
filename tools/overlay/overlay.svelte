<script lang="ts">
    import { audit, type AuditOptions, type Violation } from "../audit/index.ts";
    import { setLocale, i18n } from "../../frontend/src/lib/stores/i18n.svelte.ts";

    let gridVisible = $state(false);
    let auditVisible = $state(false);
    let violations = $state<Violation[]>([]);
    let auditError = $state<string | null>(null);
    let pseudo = $state(false);
    let selectedIndex = $state<number | null>(null);

    // focus-visible always reports every interactive element as unfocused-looking here: the
    // overlay runs after real mouse interaction turned the page's page.tab-based focus signal
    // off, which is not the false negative the CI matrix's own Tab keypress works around. The
    // rule is exact against a real keyboard session; it is just not this session.
    const AUDIT_OPTIONS: AuditOptions = {
        unit: 4,
        tolerance: 0.5,
        get coarsePointer() {
            return matchMedia("(pointer: coarse)").matches;
        },
        exemptions: [],
        skip: ["focus-visible"],
    };

    async function runLiveAudit(): Promise<void> {
        try {
            violations = await audit(AUDIT_OPTIONS);
            auditError = null;
        } catch (error) {
            auditError = error instanceof Error ? error.message : String(error);
        }
    }

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    function scheduleAudit(): void {
        if (debounceTimer !== null) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => void runLiveAudit(), 500);
    }

    let observer: MutationObserver | null = null;

    $effect(() => {
        if (!auditVisible) {
            observer?.disconnect();
            observer = null;
            violations = [];
            return;
        }
        void runLiveAudit();
        observer = new MutationObserver(scheduleAudit);
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        return () => observer?.disconnect();
    });

    function toggleGrid(): void {
        gridVisible = !gridVisible;
    }

    function toggleAudit(): void {
        auditVisible = !auditVisible;
    }

    async function togglePseudo(): Promise<void> {
        pseudo = !pseudo;
        await setLocale(pseudo ? "en-XA" : "en");
    }

    function onKeydown(event: KeyboardEvent): void {
        if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "g") {
            event.preventDefault();
            toggleGrid();
        }
        if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "a") {
            event.preventDefault();
            toggleAudit();
        }
    }
</script>

<svelte:window onkeydown={onKeydown} />

{#if gridVisible}
    <div class="grid-layer" aria-hidden="true"></div>
{/if}

{#if auditVisible}
    <div class="outline-layer" aria-hidden="true">
        {#each violations as violation, i (i)}
            <div
                class="outline"
                class:selected={selectedIndex === i}
                style:left="{violation.highlight.x}px"
                style:top="{violation.highlight.y}px"
                style:width="{violation.highlight.width}px"
                style:height="{violation.highlight.height}px"
            ></div>
        {/each}
    </div>

    <div class="panel">
        <div class="panel-header">
            <strong>Design audit</strong>
            <span>{violations.length} violation(s)</span>
        </div>
        {#if auditError !== null}
            <p class="error">{auditError}</p>
        {/if}
        <ul>
            {#each violations as violation, i (i)}
                <li>
                    <button
                        type="button"
                        onclick={() => {
                            selectedIndex = i;
                            console.log("docknight audit violation", violation);
                        }}
                    >
                        <span class="rule">{violation.rule}</span>
                        <span class="path">{violation.path}</span>
                        <span class="delta">{violation.message}</span>
                    </button>
                </li>
            {/each}
        </ul>
    </div>
{/if}

<div class="toolbar">
    <button type="button" onclick={toggleGrid} aria-pressed={gridVisible}>Grid (Ctrl+Shift+G)</button>
    <button type="button" onclick={toggleAudit} aria-pressed={auditVisible}>Audit (Ctrl+Shift+A)</button>
    <button type="button" onclick={() => void togglePseudo()} aria-pressed={pseudo}>
        Pseudo-locale ({i18n.locale})
    </button>
</div>

<style>
    .grid-layer {
        position: fixed;
        inset: 0;
        z-index: 100000;
        pointer-events: none;
        background-image: repeating-linear-gradient(
                to right,
                rgb(255 0 0 / 15%) 0,
                rgb(255 0 0 / 15%) 1px,
                transparent 1px,
                transparent 4px
            ),
            repeating-linear-gradient(
                to right,
                rgb(255 0 0 / 40%) 0,
                rgb(255 0 0 / 40%) 1px,
                transparent 1px,
                transparent 16px
            ),
            repeating-linear-gradient(
                to bottom,
                rgb(255 0 0 / 15%) 0,
                rgb(255 0 0 / 15%) 1px,
                transparent 1px,
                transparent 4px
            ),
            repeating-linear-gradient(
                to bottom,
                rgb(255 0 0 / 40%) 0,
                rgb(255 0 0 / 40%) 1px,
                transparent 1px,
                transparent 16px
            );
    }

    .outline-layer {
        position: fixed;
        inset: 0;
        z-index: 100001;
        pointer-events: none;
    }

    .outline {
        position: absolute;
        border: 2px solid rgb(220 20 20 / 90%);
        background: rgb(220 20 20 / 10%);
    }

    .outline.selected {
        border-color: rgb(20 120 220 / 95%);
        background: rgb(20 120 220 / 15%);
    }

    .panel {
        position: fixed;
        inset-block-start: 0;
        inset-inline-end: 0;
        z-index: 100002;
        overflow-y: auto;
        width: 320px;
        max-height: 60vh;
        background: rgb(20 20 20 / 95%);
        color: white;
        font: 12px ui-monospace, monospace;
    }

    .panel-header {
        display: flex;
        justify-content: space-between;
        padding: 8px 12px;
        border-bottom: 1px solid rgb(255 255 255 / 20%);
    }

    .error {
        padding: 8px 12px;
        color: rgb(255 140 140);
    }

    .panel ul {
        list-style: none;
        margin: 0;
        padding: 0;
    }

    .panel button {
        display: flex;
        flex-direction: column;
        width: 100%;
        padding: 6px 12px;
        border: none;
        border-bottom: 1px solid rgb(255 255 255 / 10%);
        background: none;
        color: inherit;
        text-align: start;
        cursor: pointer;
    }

    .panel button:hover {
        background: rgb(255 255 255 / 10%);
    }

    .rule {
        font-weight: 600;
        color: rgb(255 160 100);
    }

    .path {
        color: rgb(160 200 255);
    }

    .toolbar {
        position: fixed;
        inset-block-end: 0;
        inset-inline-start: 0;
        z-index: 100002;
        display: flex;
        gap: 4px;
        padding: 4px;
        background: rgb(20 20 20 / 90%);
    }

    .toolbar button {
        padding: 4px 8px;
        border: 1px solid rgb(255 255 255 / 30%);
        border-radius: 4px;
        background: rgb(255 255 255 / 10%);
        color: white;
        font: 11px ui-monospace, monospace;
        cursor: pointer;
    }

    .toolbar button[aria-pressed="true"] {
        background: rgb(20 140 220 / 60%);
    }
</style>
