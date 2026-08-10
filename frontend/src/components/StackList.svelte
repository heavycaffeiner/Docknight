<script lang="ts">
    import { stackKey } from "$common/stack.ts";
    import Icon from "./Icon.svelte";
    import StatusChip from "./StatusChip.svelte";
    import { endpointLabel, hasMultipleHosts } from "../lib/stores/agents.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { stackList, stacks, type StackEntry } from "../lib/stores/stacks.svelte.ts";
    import { navigate, route } from "../router.svelte.ts";

    /**
     * Renders every stack from the merged store, grouped by host when more than one is
     * configured. Rows navigate directly and update in place from stackList events.
     */
    interface Props {
        filter?: string;
        statusFilter?: number | null;
    }

    const { filter = "", statusFilter = null }: Props = $props();

    const collapsed = $state<Record<string, boolean>>({});

    const grouped = $derived.by(() => {
        const needle = filter.trim().toLowerCase();
        const rows = stackList().filter((entry) => {
            if (needle !== "" && !entry.name.toLowerCase().includes(needle)) return false;
            if (statusFilter !== null && entry.status !== statusFilter) return false;
            return true;
        });
        const groups = new Map<string, StackEntry[]>();
        for (const row of rows) {
            const list = groups.get(row.endpoint) ?? [];
            list.push(row);
            groups.set(row.endpoint, list);
        }
        return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    });

    const showGroups = $derived(hasMultipleHosts());

    function href(entry: StackEntry): string {
        return entry.endpoint === ""
            ? `/compose/${encodeURIComponent(entry.name)}`
            : `/compose/${encodeURIComponent(entry.name)}/${encodeURIComponent(entry.endpoint)}`;
    }

    function open(event: MouseEvent, entry: StackEntry): void {
        event.preventDefault();
        void navigate(href(entry));
    }
</script>

<nav class="list" aria-label={t("stackListLabel")} data-audit-id="stack-list" data-audit-column>
    {#if !stacks.loaded}
        <p class="hint type-body">{t("stackListLoading")}</p>
    {:else if grouped.length === 0}
        <p class="hint type-body">
            {t("stackListEmpty")}
            <a href="/compose" onclick={(event) => { event.preventDefault(); void navigate("/compose"); }}>
                {t("actionCreateStack")}
            </a>
        </p>
    {:else}
        {#each grouped as [endpoint, rows] (endpoint)}
            {#if showGroups}
                <button
                    type="button"
                    class="group"
                    aria-expanded={collapsed[endpoint] !== true}
                    onclick={() => (collapsed[endpoint] = collapsed[endpoint] !== true)}
                    data-audit-id="stack-group"
                    data-audit-row="center"
                >
                    <Icon name={collapsed[endpoint] === true ? "chevron-right" : "chevron-down"} size="sm" />
                    <span class="group-name type-label">
                        {endpoint === "" ? t("hostLocal") : endpointLabel(endpoint)}
                    </span>
                    <span class="group-count type-label" data-audit-numeric>{rows.length}</span>
                </button>
            {/if}
            {#if collapsed[endpoint] !== true}
                <ul>
                    {#each rows as entry (stackKey(entry.name, entry.endpoint))}
                        <li>
                            <a
                                class="row"
                                class:current={route.path === href(entry)}
                                href={href(entry)}
                                onclick={(event) => open(event, entry)}
                                data-audit-id="stack-row"
                                data-audit-row="center"
                            >
                                <span class="name type-body text-name">{entry.name}</span>
                                {#if !entry.managed}
                                    <span class="tag pill type-label">{t("stackUnmanagedShort")}</span>
                                {/if}
                                <StatusChip status={entry.status} />
                            </a>
                        </li>
                    {/each}
                </ul>
            {/if}
        {/each}
    {/if}
</nav>

<style>
    .list {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .hint {
        margin: 0;
        padding-inline: var(--space-3);
        color: rgb(var(--m3-scheme-on-surface-variant));
    }

    /* A 40 row with 8 of clear space repeats every 48, which is tighter than a 48 row would repeat
       even with the rows touching. */
    ul {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .group {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        inline-size: 100%;
        block-size: var(--size-control-md);
        padding-inline: var(--space-3);
        border: 0;
        border-radius: var(--radius-full);
        background: none;
        color: rgb(var(--m3-scheme-on-surface-variant));
        cursor: pointer;
        text-align: start;
    }

    .group:hover {
        background-color: rgb(var(--m3-scheme-surface-container));
    }

    .group-name {
        flex: 1;
    }

    .group-count {
        min-inline-size: var(--space-6);
    }

    /* The name leads so that every row in the list starts on one edge; the status trails, where a
       label of any length cannot push the names out of column. */
    .row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        block-size: var(--size-control-md);
        padding-inline: var(--space-3);
        border-radius: var(--radius-full);
        color: rgb(var(--m3-scheme-on-surface));
        text-decoration: none;
    }

    .row:hover {
        background-color: rgb(var(--m3-scheme-surface-container));
        text-decoration: none;
    }

    .row.current {
        background-color: rgb(var(--m3-scheme-secondary-container));
        color: rgb(var(--m3-scheme-on-secondary-container));
    }

    .name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .tag {
        background-color: rgb(var(--m3-scheme-surface-container-high));
        color: rgb(var(--m3-scheme-on-surface-variant));
    }
</style>
