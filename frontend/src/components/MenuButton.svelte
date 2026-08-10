<script lang="ts">
    import type { Snippet } from "svelte";
    import { Button, Menu } from "m3-svelte";
    import { scale } from "svelte/transition";
    import { arrive } from "../lib/motion.ts";

    /**
     * A trigger that drops an m3-svelte Menu beneath it. It is a disclosure rather than an ARIA
     * menu: the items are ordinary buttons, so Tab walks them and no roving focus is owed.
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

    let open = $state(false);
    let root = $state<HTMLElement | null>(null);

    function close(): void {
        open = false;
        root?.querySelector<HTMLElement>(":scope > button")?.focus();
    }

    function onPointerDown(event: PointerEvent): void {
        if (!open || root === null) return;
        if (!root.contains(event.target as Node)) open = false;
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
        <div
            id={popId}
            class="pop align-{align}"
            data-audit-id={auditId}
            data-audit-column
            transition:scale={{ ...arrive(), start: 0.9 }}
        >
            <Menu>
                {@render children(close)}
            </Menu>
        </div>
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

    .align-end {
        inset-inline-end: 0;
    }

    .align-start {
        inset-inline-start: 0;
    }
</style>
