<script lang="ts">
    import { Button } from "m3-svelte";
    import type { DockerStat, ServiceInstance } from "$common/stack.ts";
    import ArrayInput from "../../components/ArrayInput.svelte";
    import Icon from "../../components/Icon.svelte";
    import StatusChip from "../../components/StatusChip.svelte";
    import { i18n, t } from "../../lib/stores/i18n.svelte.ts";
    import {
        environmentAsList,
        listAsStringArray,
        parsePort,
        pruneList,
        type ComposeService,
    } from "./sync.ts";

    /**
     * One compose service. `service` is a live reference into the editor's config object, so edits
     * flow through the YAML sync. `status` and `stats` come from the stack page's pollers.
     */
    interface Props {
        name: string;
        service: ComposeService;
        expanded: ComposeService | undefined;
        editable: boolean;
        hostname: string;
        multiService: boolean;
        status?: ServiceInstance[];
        stats?: DockerStat[];
        onchange: (next: ComposeService) => void;
        onstart: (name: string) => void;
        onstop: (name: string) => void;
        onrestart: (name: string) => void;
        onremove: (name: string) => void;
        onshell: (name: string) => void;
    }

    const {
        name,
        service,
        expanded,
        editable,
        hostname,
        multiService,
        status,
        stats,
        onchange,
        onstart,
        onstop,
        onrestart,
        onremove,
        onshell,
    }: Props = $props();

    let countersOpen = $state(false);

    const RESTART_POLICIES = ["", "no", "always", "unless-stopped", "on-failure"];

    const displayPorts = $derived(listAsStringArray((expanded ?? service).ports));
    const running = $derived(
        (status ?? []).some((instance) => ["running", "healthy"].includes(instance.status.toLowerCase())),
    );

    function patch(changes: Partial<ComposeService>): void {
        onchange({ ...service, ...changes });
    }

    function cpuValue(stat: DockerStat): string {
        return stat.CPUPerc ?? "-";
    }
</script>

<section class="card" data-audit-id="service-card" data-audit-column>
    <header class="head" data-audit-row="center">
        <h3 class="title type-title text-name">{name}</h3>
        {#if status !== undefined}
            {#each status as instance (instance.name)}
                <StatusChip service={instance.status} />
            {/each}
        {/if}
        <div class="spacer"></div>
        {#if editable}
            <Button variant="text" onclick={() => onremove(name)}>{t("actionRemove")}</Button>
        {:else}
            {#if running}
                <Button variant="text" iconType="left" onclick={() => onshell(name)}>
                    <Icon name="shell" size="md" />
                    {t("actionShell")}
                </Button>
            {/if}
            {#if multiService}
                <Button variant="text" onclick={() => onstart(name)}>{t("actionStart")}</Button>
                <Button variant="text" onclick={() => onstop(name)}>{t("actionStop")}</Button>
                <Button variant="text" onclick={() => onrestart(name)}>{t("actionRestart")}</Button>
            {/if}
        {/if}
    </header>

    {#if editable}
        <label class="field" data-audit-column>
            <span class="label type-label">{t("serviceImage")}</span>
            <input
                class="input type-mono"
                type="text"
                value={service.image ?? ""}
                oninput={(event) => patch({ image: event.currentTarget.value })}
            />
        </label>

        <label class="field" data-audit-column>
            <span class="label type-label">{t("serviceContainerName")}</span>
            <input
                class="input type-mono"
                type="text"
                value={service.container_name ?? ""}
                oninput={(event) =>
                    patch({
                        container_name:
                            event.currentTarget.value === "" ? undefined : event.currentTarget.value,
                    })}
            />
        </label>

        <label class="field" data-audit-column>
            <span class="label type-label">{t("serviceRestartPolicy")}</span>
            <select
                class="input"
                value={service.restart ?? ""}
                onchange={(event) =>
                    patch({
                        restart: event.currentTarget.value === "" ? undefined : event.currentTarget.value,
                    })}
            >
                {#each RESTART_POLICIES as policy (policy)}
                    <option value={policy}>{policy === "" ? "-" : policy}</option>
                {/each}
            </select>
        </label>

        <ArrayInput
            label={t("servicePorts")}
            placeholder={t("portsPlaceholder")}
            values={listAsStringArray(service.ports)}
            auditId="service-ports"
            onchange={(next) => patch({ ports: pruneList(next) })}
        />
        <ArrayInput
            label={t("serviceVolumes")}
            placeholder={t("volumesPlaceholder")}
            values={listAsStringArray(service.volumes)}
            auditId="service-volumes"
            onchange={(next) => patch({ volumes: pruneList(next) })}
        />
        <ArrayInput
            label={t("serviceEnvironment")}
            placeholder={t("environmentPlaceholder")}
            values={environmentAsList(service.environment)}
            auditId="service-environment"
            onchange={(next) => patch({ environment: pruneList(next) })}
        />
        <ArrayInput
            label={t("serviceDependsOn")}
            placeholder={t("dependsPlaceholder")}
            values={listAsStringArray(service.depends_on)}
            auditId="service-depends"
            onchange={(next) => patch({ depends_on: pruneList(next) })}
        />
        <ArrayInput
            label={t("serviceNetworks")}
            placeholder={t("networksPlaceholder")}
            values={listAsStringArray(service.networks)}
            auditId="service-networks"
            onchange={(next) => patch({ networks: pruneList(next) })}
        />
    {:else}
        <p class="image type-mono">{(expanded ?? service).image ?? "-"}</p>

        {#if displayPorts.length > 0}
            <ul class="chips" data-audit-row="center">
                {#each displayPorts as entry (entry)}
                    {@const link = parsePort(entry, hostname)}
                    <li>
                        {#if link !== null}
                            <a class="chip" href={link.url} target="_blank" rel="noreferrer noopener">
                                <span class="type-mono">{link.display}</span>
                                <Icon name="external" size="sm" />
                            </a>
                        {:else}
                            <span class="chip type-mono">{entry}</span>
                        {/if}
                    </li>
                {/each}
            </ul>
        {/if}

        {#if stats !== undefined && stats.length > 0}
            <div class="stats" data-audit-column>
                {#each stats as stat (stat.Name)}
                    <div class="stat-row" data-audit-row="center">
                        <span class="stat-name type-mono text-name">{stat.Name}</span>
                        <span class="stat-value type-body" data-audit-numeric>{cpuValue(stat)}</span>
                        <span class="stat-value type-body" data-audit-numeric>{stat.MemPerc ?? "-"}</span>
                    </div>
                {/each}
                <div class="expander">
                    <Button variant="text" onclick={() => (countersOpen = !countersOpen)}>
                        {countersOpen ? t("serviceStatsCollapse") : t("serviceStatsExpand")}
                    </Button>
                </div>
                {#if countersOpen}
                    <dl class="counters" data-audit-column>
                        {#each stats as stat (stat.Name)}
                            <div class="counter" data-audit-row="baseline">
                                <dt class="type-label">{t("serviceMemory")}</dt>
                                <dd class="type-body" data-audit-numeric>{stat.MemUsage ?? "-"}</dd>
                            </div>
                            <div class="counter" data-audit-row="baseline">
                                <dt class="type-label">{t("serviceNetIO")}</dt>
                                <dd class="type-body" data-audit-numeric>{stat.NetIO ?? "-"}</dd>
                            </div>
                            <div class="counter" data-audit-row="baseline">
                                <dt class="type-label">{t("serviceBlockIO")}</dt>
                                <dd class="type-body" data-audit-numeric>{stat.BlockIO ?? "-"}</dd>
                            </div>
                            <div class="counter" data-audit-row="baseline">
                                <dt class="type-label">{t("serviceProcesses")}</dt>
                                <dd class="type-body" data-audit-numeric>{stat.PIDs ?? "-"}</dd>
                            </div>
                        {/each}
                    </dl>
                {/if}
            </div>
        {/if}
    {/if}
    <span class="visually-hidden">{i18n.locale}</span>
</section>

<style>
    .card {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        padding: var(--space-4);
        border-radius: var(--radius-lg);
        background-color: rgb(var(--m3-scheme-surface-container-low));
        color: rgb(var(--m3-scheme-on-surface));
    }

    .head {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        flex-wrap: wrap;
    }

    .title {
        margin: 0;
    }

    .spacer {
        flex: 1;
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
    }

    .label {
        color: rgb(var(--m3-scheme-on-surface-variant));
    }

    .input {
        block-size: var(--size-control-md);
        padding-inline: var(--space-4);
        border: 0;
        border-radius: var(--radius-md);
        box-shadow: inset 0 0 0 var(--hairline) rgb(var(--m3-scheme-outline));
        background-color: rgb(var(--m3-scheme-surface));
        color: rgb(var(--m3-scheme-on-surface));
    }

    .image {
        margin: 0;
        color: rgb(var(--m3-scheme-on-surface-variant));
    }

    .chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
    }

    .chip {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        block-size: var(--size-control-sm);
        padding-inline: var(--space-3);
        border: 0;
        border-radius: var(--radius-full);
        box-shadow: inset 0 0 0 var(--hairline) rgb(var(--m3-scheme-outline));
        background-color: rgb(var(--m3-scheme-surface-container));
        color: rgb(var(--m3-scheme-on-surface));
        text-decoration: none;
    }

    .stats {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
    }

    .stat-row {
        display: grid;
        grid-template-columns: 1fr auto auto;
        gap: var(--space-3);
        align-items: center;
        min-block-size: var(--size-line-body);
    }

    .stat-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .stat-value {
        min-inline-size: var(--space-16);
    }

    .expander {
        display: flex;
        justify-content: flex-start;
    }

    .counters {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        margin: 0;
    }

    .counter {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: var(--space-3);
    }

    dt {
        color: rgb(var(--m3-scheme-on-surface-variant));
    }

    dd {
        margin: 0;
    }
</style>
