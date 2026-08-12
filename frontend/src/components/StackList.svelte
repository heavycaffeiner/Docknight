<script lang="ts">
    import { ListItem } from "m3-svelte";
    import { stackKey } from "$common/stack.ts";
    import Badge from "./Badge.svelte";
    import Icon from "./Icon.svelte";
    import Loading from "./Loading.svelte";
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
        statusFilter?: number | ((status: number) => boolean) | null;
    }

    const { filter = "", statusFilter = null }: Props = $props();

    const collapsed = $state<Record<string, boolean>>({});

    const matches = $derived((status: number): boolean =>
        typeof statusFilter === "function" ? statusFilter(status) : statusFilter === status,
    );

    const grouped = $derived.by(() => {
        const needle = filter.trim().toLowerCase();
        const rows = stackList().filter((entry) => {
            if (needle !== "" && !entry.name.toLowerCase().includes(needle)) return false;
            if (statusFilter !== null && !matches(entry.status)) return false;
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

    /**
     * A list item renders a plain anchor, so the SPA hand-off is delegated rather than bound per
     * row. Modified and non-primary clicks are left to the browser, which is what makes
     * open-in-new-tab keep working. Attached imperatively because the listener belongs on a
     * container that is not itself a control.
     */
    function intercept(node: HTMLElement): () => void {
        const onclick = (event: MouseEvent): void => {
            if (event.defaultPrevented || event.button !== 0) return;
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            const anchor = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>("a[href]");
            if (anchor === null || anchor === undefined || !node.contains(anchor)) return;
            event.preventDefault();
            void navigate(anchor.getAttribute("href") ?? "/");
        };
        node.addEventListener("click", onclick);
        return () => node.removeEventListener("click", onclick);
    }

    let listNode = $state<HTMLElement | null>(null);

    $effect(() => (listNode === null ? undefined : intercept(listNode)));
</script>

<nav
    class="list"
    bind:this={listNode}
    aria-label={t("stackListLabel")}
    data-audit-id="stack-list"
    data-audit-column
>
    {#if !stacks.loaded}
        <div class="hint">
            <Loading size="sm" label={t("stackListLoading")} auditId="stack-list-loading" />
        </div>
    {:else if grouped.length === 0}
        <p class="hint type-body">
            {t("stackListEmpty")}
            <a href="/compose">{t("actionCreateStack")}</a>
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
                        <ListItem
                            headline={entry.name}
                            href={href(entry)}
                            aria-current={route.path === href(entry) ? "page" : undefined}
                            data-audit-id="stack-row"
                            data-audit-row="center"
                        >
                            <!-- The status trails, where a label of any length cannot push the
                                 names out of column. -->
                            {#snippet trailing()}
                                {#if !entry.managed}
                                    <Badge tone="neutral">{t("stackUnmanagedShort")}</Badge>
                                {/if}
                                <StatusChip status={entry.status} />
                            {/snippet}
                        </ListItem>
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

    /* A list item is 56 tall, so the rows carry only 4 of clear space; any more and a short list
       reads as separate cards rather than one column. Under a finger the four is what makes two
       rows read as one target, so the spacing that size is owed wins over the reading. */
    ul {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
    }

    @media (pointer: coarse) {
        ul {
            gap: var(--space-2);
        }
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

    /* The row is a pill so the selected one reads as the same shape as the rail indicator. */
    ul :global(a.m3-container) {
        border-radius: var(--radius-full);
        text-decoration: none;
        transition: background-color var(--m3-util-easing-fast);
    }

    /* A stack name is one long token, so the body has to be allowed to shrink below it. */
    ul :global(.m3-container .body) {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    ul :global(a.m3-container[aria-current="page"]) {
        background-color: rgb(var(--m3-scheme-secondary-container));
    }

    ul :global(a.m3-container[aria-current="page"] .headline) {
        color: rgb(var(--m3-scheme-on-secondary-container));
    }
</style>
