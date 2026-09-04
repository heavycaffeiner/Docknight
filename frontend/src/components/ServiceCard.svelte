<script lang="ts">
    import { MediaQuery } from "svelte/reactivity";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import ArrayInput from "./ArrayInput.svelte";
    import ConfirmDialog from "./ConfirmDialog.svelte";
    import MenuButton, { type MenuItemSpec } from "./MenuButton.svelte";
    import StatusChip from "./StatusChip.svelte";
    import NetworkInput from "../pages/compose/NetworkInput.svelte";
    import { parsePort } from "../pages/compose/sync.ts";

    interface Props {
        name: string;
        service: {
            image?: string;
            ports?: string[];
            volumes?: string[];
            depends_on?: string[];
            networks?: string[];
        };
        editable: boolean;
        multiService: boolean;
        status?: Array<{ state?: string; health?: string; status?: string; shellAvailable?: boolean }>;
        stats?: Array<{ Name: string; CPUPerc?: string; MemUsage?: string }>;
        expandedPorts?: string[];
        availableNetworks: string[];
        onstart?: (name: string) => void;
        onstop?: (name: string) => void;
        onrestart?: (name: string) => void;
        onremove?: (name: string) => void;
    }

    let {
        name,
        service,
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

    const isMedium = new MediaQuery("width >= 600px");

    let removeConfirm = $state(false);
    let statsExpanded = $state(false);

    const primaryStatus = $derived.by(() => {
        if (status === undefined || status.length === 0) return "unknown";
        const first = status[0];
        if (first === undefined) return "unknown";
        return first.health || first.state || first.status || "unknown";
    });

    const canShell = $derived(status?.some((s) => s.shellAvailable === true) ?? false);

    const ports = $derived.by(() => {
        const raw = expandedPorts ?? service?.ports ?? [];
        return raw.map((entry) => {
            const parsed = parsePort(entry, location.hostname);
            return { entry, parsed };
        });
    });

    const menuItems = $derived.by((): MenuItemSpec[] => {
        const items: MenuItemSpec[] = [];
        if (canShell) {
            items.push({
                label: t("service.action.shell"),
                onSelect: () => {
                    location.href = `/terminal/${name}/service/sh`;
                },
            });
        }
        if (multiService) {
            items.push(
                { label: t("service.action.start"), onSelect: () => onstart?.(name) },
                { label: t("service.action.stop"), onSelect: () => onstop?.(name) },
                { label: t("service.action.restart"), onSelect: () => onrestart?.(name) },
            );
        }
        return items;
    });

    function setImage(val: string): void {
        if (service !== undefined) {
            service.image = val;
        }
    }
</script>

<div class="gcp-service-card" data-audit-id="service-card-{name}" data-audit-column>
    <div class="gcp-service-header" data-audit-row="center">
        <span class="text-title gcp-service-name" data-audit-clip>{name}</span>
        {#if status !== undefined}
            <StatusChip status={primaryStatus} />
        {/if}
        <div class="gcp-service-spacer"></div>

        {#if !editable}
            {#if isMedium.current}
                {#if canShell}
                    <a class="gcp-service-btn" href="/terminal/{name}/service/sh">{t("service.action.shell")}</a>
                {/if}
                {#if multiService}
                    <button type="button" class="gcp-service-btn" onclick={() => onstart?.(name)}>
                        {t("service.action.start")}
                    </button>
                    <button type="button" class="gcp-service-btn" onclick={() => onstop?.(name)}>
                        {t("service.action.stop")}
                    </button>
                    <button type="button" class="gcp-service-btn" onclick={() => onrestart?.(name)}>
                        {t("service.action.restart")}
                    </button>
                {/if}
            {:else}
                <MenuButton items={menuItems} />
            {/if}
        {/if}
    </div>

    {#if !editable}
        <div class="gcp-service-body" data-audit-column>
            <span class="text-body-medium gcp-service-image">{service?.image ?? ""}</span>

            {#if ports.length > 0}
                <div class="gcp-service-ports">
                    {#each ports as { entry, parsed } (entry)}
                        {#if parsed !== null}
                            <a class="gcp-port-chip" href={parsed.url} target="_blank" rel="noopener noreferrer">
                                {parsed.display}
                            </a>
                        {:else}
                            <span class="gcp-port-chip">{entry}</span>
                        {/if}
                    {/each}
                </div>
            {/if}

            {#if stats !== undefined && stats.length > 0}
                <div class="gcp-service-stats" data-audit-row="center">
                    <span class="gcp-stat-item text-label">{stats[0]?.CPUPerc ?? "-"} CPU</span>
                    <span class="gcp-stat-item text-label">{stats[0]?.MemUsage ?? "-"}</span>
                    {#if stats.length > 1}
                        <button
                            type="button"
                            class="gcp-stats-expander"
                            aria-expanded={statsExpanded}
                            onclick={() => (statsExpanded = !statsExpanded)}
                        >
                            {statsExpanded ? "−" : "+"}
                        </button>
                    {/if}
                </div>
                {#if statsExpanded}
                    {#each stats.slice(1) as stat (stat.Name)}
                        <div class="gcp-service-stats" data-audit-row="center">
                            <span class="gcp-stat-item text-label">{stat.Name}</span>
                            <span class="gcp-stat-item text-label" data-audit-numeric>{stat.CPUPerc ?? "-"}</span>
                            <span class="gcp-stat-item text-label" data-audit-numeric>{stat.MemUsage ?? "-"}</span>
                        </div>
                    {/each}
                {/if}
            {/if}
        </div>
    {:else if service !== undefined}
        <div class="gcp-service-edit" data-audit-column>
            <label class="gcp-service-field" data-audit-heading>
                <span class="text-label">Image</span>
                <input
                    type="text"
                    class="gcp-service-input"
                    value={service.image ?? ""}
                    oninput={(e) => setImage(e.currentTarget.value)}
                />
            </label>
            <ArrayInput bind:items={service.ports} label="Ports" placeholder="HOST:CONTAINER" />
            <ArrayInput bind:items={service.volumes} label="Volumes" placeholder="HOST:CONTAINER" />
            <ArrayInput bind:items={service.depends_on} label="Depends on" />
            <NetworkInput bind:networks={service.networks} available={availableNetworks} />
            <button type="button" class="gcp-service-remove-btn" onclick={() => (removeConfirm = true)}>
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
    .gcp-service-card {
        display: flex;
        flex-direction: column;
        padding: var(--space-4);
        border-radius: var(--radius-md);
        box-shadow: inset 0 0 0 1px var(--m3c-outline-variant);
        background: var(--m3c-surface-container-low);
        gap: var(--space-3);
    }

    .gcp-service-header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-2);
        min-height: var(--size-control-md);
    }

    .gcp-service-name {
        overflow: hidden;
        flex-shrink: 1;
        min-width: 0;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 600;
    }

    .gcp-service-spacer {
        flex: 1;
        min-width: 0;
    }

    .gcp-service-btn {
        display: inline-flex;
        align-items: center;
        flex-shrink: 0;
        block-size: var(--size-control-sm);
        padding-block: 0;
        padding-inline: var(--space-3);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-high);
        color: var(--m3c-on-surface);
        cursor: pointer;
        text-decoration: none;
        white-space: nowrap;
        font-size: 12px;
        font-weight: 500;
    }

    .gcp-service-btn:hover {
        background: var(--m3c-surface-container-highest);
    }

    @media (pointer: coarse) {
        .gcp-service-btn {
            block-size: var(--size-control-lg);
        }
    }

    .gcp-service-body {
        display: flex;
        flex-direction: column;
        min-width: 0;
        gap: var(--space-2);
    }

    .gcp-service-image {
        font-family: "JetBrains Mono", monospace;
        font-size: 12px;
        color: var(--m3c-on-surface-variant);
        overflow-wrap: anywhere;
    }

    .gcp-service-ports {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
    }

    .gcp-port-chip {
        display: inline-flex;
        align-items: center;
        min-height: var(--size-control-sm);
        padding-block: var(--space-2);
        padding-inline: var(--space-3);
        border-radius: var(--radius-xl);
        background: var(--m3c-secondary-container);
        color: var(--m3c-on-secondary-container);
        text-decoration: none;
        line-height: var(--space-4);
        font-size: 12px;
    }

    @media (pointer: coarse) {
        .gcp-port-chip {
            min-height: var(--size-control-lg);
        }
    }

    .gcp-service-stats {
        display: flex;
        align-items: center;
        gap: var(--space-3);
    }

    .gcp-stat-item {
        color: var(--m3c-on-surface-variant);
        font-variant-numeric: tabular-nums;
    }

    .gcp-stats-expander {
        width: var(--size-icon-lg);
        height: var(--size-icon-lg);
        border: none;
        background: transparent;
        color: var(--m3c-primary);
        font-size: 16px;
        font-weight: bold;
        cursor: pointer;
    }

    .gcp-service-edit {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
    }

    .gcp-service-field {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
    }

    .gcp-service-input {
        min-width: 0;
        block-size: var(--size-control-md);
        padding-block: 0;
        padding-inline: var(--space-3);
        border: 1px solid var(--m3c-outline-variant);
        background: var(--m3c-surface-container-lowest);
        color: var(--m3c-on-surface);
        font-family: inherit;
    }

    .gcp-service-remove-btn {
        align-self: flex-start;
        block-size: var(--size-control-md);
        padding-block: 0;
        padding-inline: var(--space-3);
        border: none;
        border-radius: var(--radius-xs);
        background: var(--m3c-error);
        color: var(--m3c-on-error);
        font-weight: 500;
        font-size: 13px;
        cursor: pointer;
    }
</style>
