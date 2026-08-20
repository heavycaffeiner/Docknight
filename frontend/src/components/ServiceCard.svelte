<script lang="ts">
    import { MediaQuery } from "svelte/reactivity";
    import type { ServiceInstance } from "../../../common/stack.ts";
    import { parsePort } from "../pages/compose/sync.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { settings } from "../lib/stores/settings.svelte.ts";
    import ArrayInput from "./ArrayInput.svelte";
    import StatusChip from "./StatusChip.svelte";
    import MenuButton from "./MenuButton.svelte";
    import ConfirmDialog from "./ConfirmDialog.svelte";
    import NetworkInput from "../pages/compose/NetworkInput.svelte";

    interface ComposeService {
        image?: string;
        container_name?: string;
        restart?: string;
        depends_on?: string[];
        ports?: string[];
        volumes?: string[];
        environment?: string[] | Record<string, string>;
        networks?: string[];
    }

    interface StatEntry {
        Name: string;
        CPUPerc?: string;
        MemUsage?: string;
    }

    interface Props {
        name: string;
        /** A live reference into the editor's config object: edits here flow through the sync. */
        service: ComposeService;
        editable: boolean;
        multiService: boolean;
        status?: ServiceInstance[];
        stats?: StatEntry[];
        expandedPorts?: string[];
        availableNetworks: string[];
        onstart?: (name: string) => void;
        onstop?: (name: string) => void;
        onrestart?: (name: string) => void;
        onremove?: (name: string) => void;
    }

    let {
        name,
        service = $bindable(),
        editable,
        multiService,
        status,
        stats,
        expandedPorts,
        availableNetworks,
        onstart,
        onstop,
        onrestart,
        onremove,
    }: Props = $props();

    let statsExpanded = $state(false);

    // Every array field is guaranteed to exist before ArrayInput binds to it directly, so an
    // edit mutates `service` in place rather than going through a separate local copy that
    // would need its own synchronisation back.
    service.ports ??= [];
    service.volumes ??= [];
    service.depends_on ??= [];
    service.networks ??= [];

    const isExpanded = new MediaQuery("width >= 600px");

    const primaryStatus = $derived(status?.[0]?.status ?? "unknown");
    const canShell = $derived(primaryStatus === "running" || primaryStatus === "healthy");

    const ports = $derived.by(() => {
        const hostname = settings.values?.primaryHostname || location.hostname;
        return (expandedPorts ?? service.ports ?? []).map((entry) => ({
            entry,
            parsed: parsePort(entry, hostname),
        }));
    });

    function setImage(value: string): void {
        service.image = value;
    }

    let removeConfirm = $state(false);

    const menuItems = $derived(
        [
            canShell
                ? { label: t("service.action.shell"), onSelect: () => location.assign(`/terminal/${name}`) }
                : null,
            multiService ? { label: t("service.action.start"), onSelect: () => onstart?.(name) } : null,
            multiService ? { label: t("service.action.stop"), onSelect: () => onstop?.(name) } : null,
            multiService ? { label: t("service.action.restart"), onSelect: () => onrestart?.(name) } : null,
        ].filter((item) => item !== null),
    );
</script>

<div class="card" data-audit-id="service-card-{name}" data-audit-column>
    <div class="header" data-audit-row="center">
        <span class="text-title">{name}</span>
        {#if status !== undefined}
            <StatusChip status={primaryStatus} />
        {/if}
        <div class="spacer"></div>
        {#if !editable}
            {#if isExpanded.current}
                {#if canShell}
                    <a class="text-button" href="/terminal/{name}/service/sh">{t("service.action.shell")}</a>
                {/if}
                {#if multiService}
                    <button type="button" class="text-button" onclick={() => onstart?.(name)}>
                        {t("service.action.start")}
                    </button>
                    <button type="button" class="text-button" onclick={() => onstop?.(name)}>
                        {t("service.action.stop")}
                    </button>
                    <button type="button" class="text-button" onclick={() => onrestart?.(name)}>
                        {t("service.action.restart")}
                    </button>
                {/if}
            {:else}
                <MenuButton items={menuItems} />
            {/if}
        {/if}
    </div>

    {#if !editable}
        <div class="body" data-audit-column>
            <span class="text-body-medium">{service.image}</span>
            {#if ports.length > 0}
                <div class="ports">
                    {#each ports as { entry, parsed } (entry)}
                        {#if parsed !== null}
                            <a class="port-chip" href={parsed.url} target="_blank" rel="noopener noreferrer">
                                {parsed.display}
                            </a>
                        {:else}
                            <span class="port-chip">{entry}</span>
                        {/if}
                    {/each}
                </div>
            {/if}
            {#if stats !== undefined && stats.length > 0}
                <div class="stats" data-audit-row="center">
                    <span class="stat text-label" data-audit-numeric>{stats[0]?.CPUPerc ?? "—"} CPU</span>
                    <span class="stat text-label" data-audit-numeric>{stats[0]?.MemUsage ?? "—"}</span>
                    {#if stats.length > 1}
                        <button
                            type="button"
                            class="stats-expander"
                            aria-expanded={statsExpanded}
                            onclick={() => (statsExpanded = !statsExpanded)}
                        >
                            {statsExpanded ? "−" : "+"}
                        </button>
                    {/if}
                </div>
                {#if statsExpanded}
                    {#each stats.slice(1) as stat (stat.Name)}
                        <div class="stats" data-audit-row="center">
                            <span class="stat text-label">{stat.Name}</span>
                            <span class="stat text-label" data-audit-numeric>{stat.CPUPerc ?? "—"}</span>
                            <span class="stat text-label" data-audit-numeric>{stat.MemUsage ?? "—"}</span>
                        </div>
                    {/each}
                {/if}
            {/if}
        </div>
    {:else}
        <div class="edit-body" data-audit-column>
            <label class="field">
                <span class="text-label">Image</span>
                <input
                    type="text"
                    value={service.image ?? ""}
                    oninput={(e) => setImage(e.currentTarget.value)}
                />
            </label>
            <ArrayInput bind:items={service.ports} label="Ports" placeholder="HOST:CONTAINER" />
            <ArrayInput bind:items={service.volumes} label="Volumes" placeholder="HOST:CONTAINER" />
            <ArrayInput bind:items={service.depends_on} label="Depends on" />
            <NetworkInput bind:networks={service.networks} available={availableNetworks} />
            <button type="button" class="remove-service" onclick={() => (removeConfirm = true)}>
                {t("service.action.remove")}
            </button>
        </div>
    {/if}
</div>

<ConfirmDialog
    open={removeConfirm}
    title={t("service.action.remove")}
    message={name}
    danger
    onconfirm={() => {
        removeConfirm = false;
        onremove?.(name);
    }}
    oncancel={() => (removeConfirm = false)}
/>

<style>
    .card {
        padding: var(--space-6);
        border-radius: var(--radius-md);
        background: var(--m3c-surface-container-low);
        gap: var(--space-4);
    }

    .header {
        display: flex;
        gap: var(--space-3);
        height: var(--size-control-md);
    }

    .spacer {
        flex: 1;
    }

    .text-button {
        height: var(--size-control-md);
        padding-inline: var(--space-3);
        border: none;
        border-radius: var(--radius-xs);
        background: transparent;
        color: var(--m3c-primary);
        cursor: pointer;
        text-decoration: none;
    }

    .body {
        gap: var(--space-2);
    }

    .ports {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
    }

    .port-chip {
        display: inline-flex;
        align-items: center;
        height: var(--size-control-sm);
        padding-inline: var(--space-3);
        border-radius: var(--radius-xl);
        background: var(--m3c-secondary-container);
        color: var(--m3c-on-secondary-container);
        text-decoration: none;
        font-size: 12px;
    }

    .stats {
        display: flex;
        gap: var(--space-3);
    }

    .stat {
        color: var(--m3c-on-surface-variant);
        font-variant-numeric: tabular-nums;
    }

    .stats-expander {
        width: var(--size-icon-lg);
        height: var(--size-icon-lg);
        border: none;
        border-radius: var(--radius-xs);
        background: transparent;
        color: var(--m3c-on-surface-variant);
        cursor: pointer;
    }

    .edit-body {
        gap: var(--space-4);
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .field input {
        height: var(--size-control-md);
        padding-inline: var(--space-3);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-lowest);
        color: var(--m3c-on-surface);
    }

    .remove-service {
        align-self: flex-start;
        height: var(--size-control-md);
        padding-inline: var(--space-4);
        border: none;
        border-radius: var(--radius-xl);
        background: var(--m3c-error-container);
        color: var(--m3c-on-error-container);
        cursor: pointer;
    }
</style>
