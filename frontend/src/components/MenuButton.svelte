<script lang="ts">
    import type { Snippet } from "svelte";
    import { Button, Menu } from "m3-svelte";
    import { fade as fadeTransition, fly, scale } from "svelte/transition";
    import { COMPACT, media } from "../lib/media.svelte.ts";
    import { arrive, fade } from "../lib/motion.ts";

    /**
     * A trigger that drops an m3-svelte Menu beneath it, or raises it as a bottom sheet on a compact
     * screen. It is a disclosure rather than an ARIA menu: the items are ordinary buttons, so Tab
     * walks them and no roving focus is owed.
     *
     * Closes on Escape, on a pointer press outside, and whenever an item calls the `close` it is
     * handed. Escape and an item both return focus to the trigger.
     */
    interface Props {
        /** Accessible name of the trigger, whose visible content may be an icon alone. */
        label: string;
        /** Which edge of the trigger the menu hangs from. */
        align?: "start" | "end";
        /** `full` for a trigger whose content is an icon alone, so it stays square. */
        iconType?: "left" | "full";
        auditId?: string;
        trigger: Snippet;
        children: Snippet<[() => void]>;
    }

    const { label, align = "end", iconType = "left", auditId, trigger, children }: Props = $props();

    const popId = $props.id();

    const compact = media(COMPACT);

    let open = $state(false);
    let root = $state<HTMLElement | null>(null);
    let pop = $state<HTMLElement | null>(null);
    let flipped = $state(false);

    // An anchored popup opened in the lower half of a scroll pane is clipped by the pane, so it is
    // measured once it exists and hung from the trigger's other edge when it does not fit below.
    $effect(() => {
        if (!open || compact.value || pop === null) {
            flipped = false;
            return;
        }
        flipped = pop.getBoundingClientRect().bottom > window.innerHeight;
    });

    function close(): void {
        open = false;
        root?.querySelector<HTMLElement>(":scope > button")?.focus();
    }

    function onPointerDown(event: PointerEvent): void {
        if (!open || root === null) return;
        const target = event.target as HTMLElement | null;
        if (target === null) return;
        // The scrim is inside the anchor, so an outside press is not the only way out of a sheet.
        if (!root.contains(target) || target.dataset.scrim !== undefined) open = false;
    }

    function onKeyDown(event: KeyboardEvent): void {
        if (open && event.key === "Escape") close();
    }
</script>

<svelte:window onpointerdown={onPointerDown} onkeydown={onKeyDown} />

<div class="anchor" bind:this={root}>
    <Button
        variant="text"
        {iconType}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onclick={() => (open = !open)}
    >
        {@render trigger()}
    </Button>
    {#if open}
        {#if compact.value}
            <div class="scrim" data-scrim transition:fadeTransition={fade()}></div>
            <div
                id={popId}
                class="sheet"
                data-audit-id={auditId}
                data-audit-column
                transition:fly={{ ...arrive(), y: 32 }}
            >
                <Menu>
                    {@render children(close)}
                </Menu>
            </div>
        {:else}
            <div
                id={popId}
                class="pop align-{align}"
                class:flipped
                bind:this={pop}
                data-audit-id={auditId}
                data-audit-column
                transition:scale={{ ...arrive(), start: 0.9 }}
            >
                <Menu>
                    {@render children(close)}
                </Menu>
            </div>
        {/if}
    {/if}
</div>

<style>
    .anchor {
        position: relative;
        display: inline-flex;
    }

    .pop {
        position: absolute;
        inset-block-start: 100%;
        z-index: 30;
        margin-block-start: var(--space-1);
    }

    .pop.flipped {
        inset-block-start: auto;
        inset-block-end: 100%;
        margin-block: 0 var(--space-1);
    }

    .align-end {
        inset-inline-end: 0;
    }

    .align-start {
        inset-inline-start: 0;
    }

    /*
     * Material's compact form of a menu that carries more than a couple of items. A sheet is not
     * positioned inside the scroll pane, so the pane cannot clip it, and its items land in the band
     * a thumb reaches. The keyboard inset is what keeps it above a keyboard rather than behind one.
     */
    .scrim {
        position: fixed;
        inset: 0;
        z-index: 29;
        background-color: rgb(var(--m3-scheme-scrim) / 0.4);
    }

    .sheet {
        position: fixed;
        inset-inline: 0;
        inset-block-end: var(--keyboard-inset, 0);
        z-index: 30;
    }

    .sheet :global(.m3-container) {
        max-inline-size: none;
        padding-block: var(--space-2) var(--space-4);
        border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    }
</style>
