<script lang="ts">
    import { untrack } from "svelte";
    import type { StackSummary } from "../../../common/stack.ts";
    import { navigate, route } from "../router.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { agents } from "../lib/stores/agents.svelte.ts";
    import { stacks } from "../lib/stores/stacks.svelte.ts";
    import EmptyState from "./EmptyState.svelte";
    import StatusChip from "./StatusChip.svelte";

    interface Props {
        filter: string;
    }

    let { filter }: Props = $props();

    let query = $state(untrack(() => filter));
    let collapsed = $state<Record<string, boolean>>({});

    interface Row {
        name: string;
        endpoint: string;
        summary: StackSummary;
    }

    const rows = $derived.by((): Row[] => {
        const needle = query.trim().toLowerCase();
        const out: Row[] = [];
        for (const [key, summary] of Object.entries(stacks.byKey)) {
            const spaceIndex = key.lastIndexOf(" ");
            const name = key.slice(0, spaceIndex);
            const endpoint = key.slice(spaceIndex + 1);
            if (needle !== "" && !name.toLowerCase().includes(needle)) continue;
            out.push({ name, endpoint, summary });
        }
        return out.sort((a, b) => a.name.localeCompare(b.name));
    });

    const grouped = $derived.by((): [endpoint: string, rows: Row[]][] => {
        const groups: Record<string, Row[]> = {};
        for (const row of rows) {
            (groups[row.endpoint] ??= []).push(row);
        }
        return Object.entries(groups);
    });

    const showGroupHeaders = $derived(Object.keys(agents.byEndpoint).length > 1);

    function hostLabel(endpoint: string): string {
        if (endpoint === "") return "";
        return agents.byEndpoint[endpoint]?.name || endpoint;
    }

    function openStack(row: Row): void {
        void navigate(row.endpoint === "" ? `/compose/${row.name}` : `/compose/${row.name}/${row.endpoint}`);
    }

    function toggleGroup(endpoint: string): void {
        collapsed = { ...collapsed, [endpoint]: !collapsed[endpoint] };
    }
</script>

<div class="gcp-stack-list" data-audit-id="stack-list">
    <div class="gcp-search-row">
        <input
            type="search"
            class="gcp-search-input"
            placeholder={t("stack.list.search")}
            aria-label={t("stack.list.search")}
            bind:value={query}
        />
    </div>

    {#if rows.length === 0}
        <EmptyState message={t("stack.list.empty")}>
            {#snippet action()}
                <a
                    class="gcp-create-btn"
                    href="/compose"
                    onclick={(e) => {
                        e.preventDefault();
                        void navigate("/compose");
                    }}
                >
                    {t("stack.list.createFirst")}
                </a>
            {/snippet}
        </EmptyState>
    {:else}
        <div class="gcp-resource-tree" data-audit-column>
            {#each grouped as [endpoint, groupRows] (endpoint)}
                {#if showGroupHeaders}
                    <button
                        type="button"
                        class="gcp-group-header"
                        data-audit-heading
                        onclick={() => toggleGroup(endpoint)}
                    >
                        {hostLabel(endpoint) || t("app.name")}
                    </button>
                {/if}
                {#if !showGroupHeaders || !collapsed[endpoint]}
                    {#each groupRows as row (row.name + " " + row.endpoint)}
                        {@const active = route.path === `/compose/${row.name}` || (row.endpoint !== "" && route.path === `/compose/${row.name}/${row.endpoint}`)}
                        <a
                            href={row.endpoint === "" ? `/compose/${row.name}` : `/compose/${row.name}/${row.endpoint}`}
                            class="gcp-stack-row"
                            class:active
                            data-audit-row="center"
                            onclick={(e) => {
                                e.preventDefault();
                                openStack(row);
                            }}
                        >
                            <StatusChip status={statusWord(row.summary.status)} />
                            <span class="gcp-stack-name text-body-medium" data-audit-clip>{row.name}</span>
                            {#if showGroupHeaders}
                                <span class="gcp-host-badge text-label">{hostLabel(row.endpoint)}</span>
                            {/if}
                        </a>
                    {/each}
                {/if}
            {/each}
        </div>
    {/if}
</div>

<script module lang="ts">
    import { CREATED, DRAFT, EXITED, RUNNING } from "../../../common/stack.ts";

    function statusWord(status: number): string {
        if (status === RUNNING) return "running";
        if (status === EXITED) return "exited";
        if (status === CREATED) return "created";
        if (status === DRAFT) return "draft";
        return "unknown";
    }
</script>

<style>
    .gcp-stack-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .gcp-search-row {
        padding-block-end: var(--space-2);
    }

    .gcp-search-input {
        width: 100%;
        height: var(--size-control-md);
        padding-inline: var(--space-3);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-lowest);
        color: var(--m3c-on-surface);
        font-size: 13px;
    }

    .gcp-search-input:focus {
        border-color: var(--m3c-primary);
    }

    .gcp-create-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: var(--size-control-lg);
        padding-inline: var(--space-4);
        border-radius: var(--radius-xl);
        background: var(--m3c-primary);
        color: var(--m3c-on-primary);
        font-weight: 600;
        font-size: 13px;
        text-decoration: none;
    }

    .gcp-create-btn:hover {
        background: var(--m3c-primary-dim);
    }

    .gcp-resource-tree {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
    }

    .gcp-group-header {
        display: block;
        width: 100%;
        height: var(--size-control-sm);
        padding-inline: var(--space-2);
        border: none;
        background: transparent;
        color: var(--m3c-primary);
        text-align: start;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        cursor: pointer;
    }

    @media (pointer: coarse) {
        .gcp-group-header {
            height: var(--size-control-lg);
        }
    }

    .gcp-stack-row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        height: var(--size-control-lg);
        padding-inline: var(--space-2);
        border-radius: var(--radius-xs);
        color: var(--m3c-on-surface);
        text-decoration: none;
    }

    .gcp-stack-row:hover {
        background: var(--m3c-surface-container-high);
    }

    .gcp-stack-row.active {
        background: var(--m3c-secondary-container);
        box-shadow: inset 3px 0 0 var(--m3c-primary);
        color: var(--m3c-on-secondary-container);
        font-weight: 600;
    }

    .gcp-stack-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
    }

    .gcp-host-badge {
        padding-inline: var(--space-1);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-highest);
        color: var(--m3c-on-surface-variant);
        font-size: 11px;
    }
</style>
