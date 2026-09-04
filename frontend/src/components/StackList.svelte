<script lang="ts">
    import { SvelteMap, SvelteSet } from "svelte/reactivity";
    import { stacks } from "../lib/stores/stacks.svelte.ts";
    import { agents } from "../lib/stores/agents.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { navigate, route } from "../router.svelte.ts";
    import StatusChip from "./StatusChip.svelte";
    import EmptyState from "./EmptyState.svelte";
    import { RUNNING, EXITED, CREATED, DRAFT, type StackSummary } from "../../../common/stack.ts";

    interface Props {
        filter?: string;
        showSearch?: boolean;
    }

    let { filter = "", showSearch = false }: Props = $props();

    let searchInput = $state("");
    const effectiveFilter = $derived((filter || searchInput).trim().toLowerCase());

    const agentList = $derived(Object.values(agents.byEndpoint));
    const multiHost = $derived(agentList.length > 1);

    interface GroupedStacks {
        endpoint: string;
        hostName: string;
        items: Array<{ key: string; stack: StackSummary; endpoint: string }>;
    }

    const groups = $derived.by((): GroupedStacks[] => {
        const map = new SvelteMap<string, GroupedStacks>();

        // Ensure all known endpoints exist
        const allEndpoints = new SvelteSet(["", ...Object.keys(agents.byEndpoint)]);
        for (const [key] of Object.entries(stacks.byKey)) {
            const sepIdx = key.lastIndexOf(" ");
            const ep = sepIdx !== -1 ? key.slice(sepIdx + 1) : "";
            allEndpoints.add(ep);
        }

        for (const ep of allEndpoints) {
            const hostName = ep === "" ? t("nav.home") : agents.byEndpoint[ep]?.name || ep;
            map.set(ep, { endpoint: ep, hostName, items: [] });
        }

        for (const [key, stack] of Object.entries(stacks.byKey)) {
            const sepIdx = key.lastIndexOf(" ");
            const ep = sepIdx !== -1 ? key.slice(sepIdx + 1) : "";
            if (effectiveFilter !== "" && !stack.name.toLowerCase().includes(effectiveFilter)) {
                continue;
            }
            const g = map.get(ep);
            if (g !== undefined) {
                g.items.push({ key, stack, endpoint: ep });
            }
        }

        return Array.from(map.values()).filter((g) => g.items.length > 0 || effectiveFilter === "");
    });

    const totalCount = $derived(groups.reduce((acc, g) => acc + g.items.length, 0));

    function statusWord(status: number): string {
        if (status === RUNNING) return "running";
        if (status === EXITED) return "exited";
        if (status === CREATED) return "created";
        if (status === DRAFT) return "draft";
        return "unknown";
    }

    function stackUrl(name: string, endpoint: string): string {
        return endpoint === "" ? `/compose/${name}` : `/compose/${name}/${encodeURIComponent(endpoint)}`;
    }

    function isSelected(name: string, endpoint: string): boolean {
        return (
            (route.params.name === name || route.path === `/compose/${name}`) &&
            (route.params.endpoint ?? "") === endpoint
        );
    }
</script>

<div class="gcp-stack-list" data-audit-column>
    {#if showSearch}
        <div class="gcp-list-search" data-audit-row="center">
            <input
                type="text"
                class="gcp-search-input text-label"
                placeholder={t("stack.list.search")}
                aria-label={t("stack.list.search")}
                bind:value={searchInput}
            />
        </div>
    {/if}

    {#if totalCount === 0}
        <EmptyState
            message={t("stack.list.empty")}
            actionLabel={t("stack.list.createFirst")}
            actionHref="/compose"
            onaction={() => void navigate("/compose")}
        />
    {:else}
        <div class="gcp-list-items" data-audit-column>
            {#each groups as group (group.endpoint)}
                {#if multiHost}
                    <div class="gcp-group-header" data-audit-row="center">
                        <span class="text-label gcp-group-title">{group.hostName}</span>
                        <span class="text-label gcp-group-count">({group.items.length})</span>
                    </div>
                {/if}

                {#each group.items as item (item.key)}
                    <a
                        href={stackUrl(item.stack.name, item.endpoint)}
                        class="gcp-stack-row"
                        class:selected={isSelected(item.stack.name, item.endpoint)}
                        data-audit-row="center"
                        onclick={(e) => {
                            e.preventDefault();
                            void navigate(stackUrl(item.stack.name, item.endpoint));
                        }}
                    >
                        <div class="gcp-chip-wrapper" data-audit-opaque>
                            <StatusChip status={statusWord(item.stack.status)} />
                        </div>
                        <span class="gcp-stack-name text-body-medium" data-audit-clip>{item.stack.name}</span>
                    </a>
                {/each}
            {/each}
        </div>
    {/if}
</div>

<style>
    .gcp-stack-list {
        display: flex;
        flex-direction: column;
        width: 100%;
        gap: var(--space-2);
    }

    .gcp-list-search {
        display: flex;
        padding-inline: var(--space-3);
        padding-block: var(--space-2);
    }

    .gcp-search-input {
        width: 100%;
        block-size: var(--size-control-md);
        padding-block: 0;
        padding-inline: var(--space-4);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-sm);
        background: var(--m3c-surface-container-low);
        color: var(--m3c-on-surface);
        font-family: inherit;
        transition: border-color var(--duration-fast) var(--ease-standard);
    }

    .gcp-search-input:focus-visible {
        border-color: var(--m3c-primary);
    }

    .gcp-list-items {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
    }

    .gcp-group-header {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding-inline: var(--space-3);
        padding-block: var(--space-3) var(--space-1);
        color: var(--m3c-on-surface-variant);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .gcp-group-count {
        font-weight: 500;
    }

    .gcp-stack-row {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        block-size: var(--size-control-lg);
        padding-block: 0;
        padding-inline: var(--space-3);
        border-radius: var(--radius-sm);
        text-decoration: none;
        color: var(--m3c-on-surface);
        background: transparent;
        transition: background var(--duration-fast) var(--ease-standard);
    }

    .gcp-stack-row:hover {
        background: var(--m3c-surface-container-high);
    }

    .gcp-stack-row.selected {
        background: var(--m3c-secondary-container);
        color: var(--m3c-on-secondary-container);
    }

    .gcp-chip-wrapper {
        display: flex;
        align-items: center;
        flex-shrink: 0;
    }

    .gcp-stack-name {
        flex: 1;
        min-width: 0;
        font-weight: 500;
    }
</style>
