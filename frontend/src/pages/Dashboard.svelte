<script lang="ts">
    import { MediaQuery } from "svelte/reactivity";
    import { request } from "../lib/connection.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { agents } from "../lib/stores/agents.svelte.ts";
    import { stacks } from "../lib/stores/stacks.svelte.ts";
    import { toastError } from "../lib/stores/toast.svelte.ts";
    import { navigate } from "../router.svelte.ts";
    import { RUNNING, EXITED } from "../../../common/stack.ts";
    import StackList from "../components/StackList.svelte";
    import ConfirmDialog from "../components/ConfirmDialog.svelte";
    import MenuButton from "../components/MenuButton.svelte";

    const isExpanded = new MediaQuery("width >= 840px");

    const counts = $derived.by(() => {
        let active = 0;
        let exited = 0;
        let inactive = 0;
        for (const summary of Object.values(stacks.byKey)) {
            if (summary.status === RUNNING) active += 1;
            else if (summary.status === EXITED) exited += 1;
            else inactive += 1;
        }
        return { active, exited, inactive };
    });

    let command = $state("");
    let convertError = $state<string | null>(null);
    let converting = $state(false);

    async function convert(): Promise<void> {
        convertError = null;
        converting = true;
        try {
            const result = await request("", "docker.composerize", { command });
            sessionStorage.setItem("docknight-compose-draft", result.yaml);
            await navigate("/compose");
        } catch (error) {
            convertError = error instanceof Error ? error.message : String(error);
        } finally {
            converting = false;
        }
    }

    let addUrl = $state("");
    let addUsername = $state("admin");
    let addPassword = $state("");
    let addName = $state("");
    let addError = $state<string | null>(null);
    let adding = $state(false);

    async function addHost(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        addError = null;
        adding = true;
        try {
            await request("", "agent.add", {
                url: addUrl,
                username: addUsername,
                password: addPassword,
                name: addName === "" ? undefined : addName,
            });
            addUrl = "";
            addPassword = "";
            addName = "";
        } catch (error) {
            addError = error instanceof Error ? error.message : String(error);
        } finally {
            adding = false;
        }
    }

    let removeTarget = $state<string | null>(null);

    async function confirmRemove(): Promise<void> {
        if (removeTarget === null) return;
        try {
            await request("", "agent.remove", { url: removeTarget });
        } catch (error) {
            toastError(error);
        } finally {
            removeTarget = null;
        }
    }

    async function renameHost(url: string): Promise<void> {
        const current = agents.byEndpoint[Object.keys(agents.byEndpoint).find((e) => agents.byEndpoint[e]?.url === url) ?? ""];
        const next = prompt(t("dashboard.hosts.rename"), current?.name ?? "");
        if (next === null) return;
        try {
            await request("", "agent.rename", { url, name: next });
        } catch (error) {
            toastError(error);
        }
    }
</script>

<div class="dashboard" data-audit-root data-grid-origin>
    <div class="header-row" data-audit-row="center">
        <h1 class="text-headline">{t("dashboard.title")}</h1>
    </div>

    {#if !isExpanded.current}
        <div class="card" data-grid-origin>
            <StackList filter="" />
        </div>
    {/if}

    <div class="card counts" data-audit-row="center" data-grid-origin>
        <a class="count count-active" href="/?filter=running" onclick={(e) => e.preventDefault()}>
            <span class="count-dot active-dot" aria-hidden="true"></span>
            <span class="count-value text-headline" data-audit-numeric>{counts.active}</span>
            <span class="count-label text-label">{t("dashboard.stacks.active")}</span>
        </a>
        <a class="count count-exited" href="/?filter=exited" onclick={(e) => e.preventDefault()}>
            <span class="count-dot exited-dot" aria-hidden="true"></span>
            <span class="count-value text-headline" data-audit-numeric>{counts.exited}</span>
            <span class="count-label text-label">{t("dashboard.stacks.exited")}</span>
        </a>
        <a class="count count-inactive" href="/?filter=inactive" onclick={(e) => e.preventDefault()}>
            <span class="count-dot inactive-dot" aria-hidden="true"></span>
            <span class="count-value text-headline" data-audit-numeric>{counts.inactive}</span>
            <span class="count-label text-label">{t("dashboard.stacks.inactive")}</span>
        </a>
    </div>

    <div class="grid">
        <div class="card" data-audit-column data-grid-origin>
            <div class="card-title-row" data-audit-row="center">
                <svg class="card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-audit-opaque>
                    <polyline points="4 17 10 11 4 5"/>
                    <line x1="12" y1="19" x2="20" y2="19"/>
                </svg>
                <h2 class="text-title">{t("dashboard.converter.title")}</h2>
            </div>
            <textarea
                class="command"
                placeholder={t("dashboard.converter.placeholder")}
                bind:value={command}
            ></textarea>
            {#if convertError !== null}
                <p class="error text-label">{convertError}</p>
            {/if}
            <button type="button" class="primary" disabled={converting || command.trim() === ""} onclick={convert}>
                {t("dashboard.converter.submit")}
            </button>
        </div>

        <div class="card" data-grid-origin>
            <div class="card-title-row" data-audit-row="center">
                <svg class="card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-audit-opaque>
                    <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
                    <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
                    <line x1="6" y1="6" x2="6.01" y2="6"/>
                    <line x1="6" y1="18" x2="6.01" y2="18"/>
                </svg>
                <h2 class="text-title">{t("dashboard.hosts.title")}</h2>
            </div>
        {#each Object.entries(agents.byEndpoint).filter(([e]) => e !== "") as [endpoint, agent] (endpoint)}
            {@const online = agents.statuses[endpoint]?.status === "online"}
            <div class="host-row" data-audit-row="center">
                <span
                    class="status-dot"
                    class:online
                    role="img"
                    aria-label={online ? t("host.online") : t("host.offline")}
                ></span>
                <span class="text-body-medium host-name">{agent.name || agent.endpoint}</span>
                {#if isExpanded.current}
                    <div class="host-actions">
                        <button type="button" onclick={() => void renameHost(agent.url)}>
                            {t("dashboard.hosts.rename")}
                        </button>
                        <button type="button" onclick={() => (removeTarget = agent.url)}>
                            {t("dashboard.hosts.remove")}
                        </button>
                    </div>
                {:else}
                    <MenuButton
                        items={[
                            { label: t("dashboard.hosts.rename"), onSelect: () => void renameHost(agent.url) },
                            {
                                label: t("dashboard.hosts.remove"),
                                danger: true,
                                onSelect: () => (removeTarget = agent.url),
                            },
                        ]}
                    />
                {/if}
            </div>
        {/each}

        <form class="add-form" onsubmit={addHost} data-audit-column>
            <input
                type="url"
                placeholder="https://host:5001"
                aria-label={t("host.url")}
                required
                bind:value={addUrl}
            />
            <input
                type="text"
                placeholder={t("host.username")}
                aria-label={t("host.username")}
                autocomplete="username"
                required
                bind:value={addUsername}
            />
            <input
                type="password"
                placeholder={t("host.password")}
                aria-label={t("host.password")}
                autocomplete="new-password"
                required
                bind:value={addPassword}
            />
            <input
                type="text"
                placeholder={t("host.name")}
                aria-label={t("host.name")}
                bind:value={addName}
            />
            {#if addError !== null}
                <p class="error text-label">{addError}</p>
            {/if}
            <button type="submit" class="primary" disabled={adding}>{t("dashboard.hosts.add")}</button>
        </form>
        </div>
    </div>
</div>

<ConfirmDialog
    open={removeTarget !== null}
    title={t("dashboard.hosts.remove")}
    message={removeTarget !== null ? t("dashboard.hosts.removeConfirm", { url: removeTarget }) : ""}
    danger
    onconfirm={confirmRemove}
    oncancel={() => (removeTarget = null)}
/>

<style>
    .dashboard {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        padding: var(--space-4);
        max-width: 100%;
    }

    .header-row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        height: var(--size-control-lg);
    }

    .grid {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
    }

    @media (width >= 1200px) {
        .grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
        }
    }

    .card {
        padding: var(--space-4);
        border-radius: var(--radius-md);
        box-shadow: inset 0 0 0 1px var(--m3c-outline-variant);
        background: var(--m3c-surface-container-low);
    }

    .card-title-row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        margin-block-end: var(--space-2);
    }

    .card-icon {
        width: var(--size-icon-md);
        height: var(--size-icon-md);
        color: var(--m3c-primary);
        flex-shrink: 0;
    }

    .counts {
        display: flex;
        gap: var(--space-3);
        padding: var(--space-3);
    }

    .count {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--space-1);
        padding: var(--space-3);
        border-radius: var(--radius-sm);
        background: var(--m3c-surface-container);
        box-shadow: inset 0 0 0 1px var(--m3c-outline-variant);
        color: var(--m3c-on-surface);
        text-decoration: none;
        flex: 1;
    }

    .count:hover {
        background: var(--m3c-surface-container-high);
    }

    .count-dot {
        width: var(--space-2);
        height: var(--space-2);
        border-radius: 50%;
        flex-shrink: 0;
    }

    .active-dot {
        background: var(--m3c-tertiary);
    }

    .exited-dot {
        background: var(--m3c-error);
    }

    .inactive-dot {
        background: var(--m3c-outline);
    }

    .count-value {
        font-variant-numeric: tabular-nums;
        font-weight: 700;
    }

    .count-label {
        color: var(--m3c-on-surface-variant);
        font-weight: 500;
    }

    .command {
        display: block;
        width: 100%;
        min-height: var(--space-12);
        margin-block: var(--space-2);
        padding: var(--space-3);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-lowest);
        color: var(--m3c-on-surface);
        font-family: "JetBrains Mono", monospace;
        font-size: 13px;
        resize: vertical;
    }

    .command:focus {
        border-color: var(--m3c-primary);
    }

    .error {
        color: var(--m3c-error);
        margin-block-end: var(--space-2);
    }

    .primary {
        align-self: flex-start;
        height: var(--size-control-md);
        padding-inline: var(--space-4);
        border: 1px solid transparent;
        border-radius: var(--radius-xl);
        background: var(--m3c-primary);
        color: var(--m3c-on-primary);
        font-weight: 600;
        font-size: 13px;
        cursor: pointer;
    }

    .primary:disabled {
        opacity: 0.5;
        cursor: default;
    }

    .host-row {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        height: var(--size-control-lg);
        padding-inline: var(--space-3);
        border-radius: var(--radius-sm);
        background: var(--m3c-surface-container);
        box-shadow: inset 0 0 0 1px var(--m3c-outline-variant);
        margin-block-end: var(--space-2);
    }

    .host-row:hover {
        background: var(--m3c-surface-container-high);
    }

    .status-dot {
        width: var(--space-2);
        height: var(--space-2);
        border-radius: 50%;
        background: var(--m3c-error);
        flex-shrink: 0;
    }

    .status-dot.online {
        background: var(--m3c-tertiary);
    }

    .host-name {
        flex: 1;
        font-weight: 500;
    }

    .host-actions {
        display: flex;
        gap: var(--space-2);
    }

    .host-actions button {
        height: var(--size-control-sm);
        padding-inline: var(--space-3);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-high);
        color: var(--m3c-on-surface);
        font-size: 12px;
        cursor: pointer;
    }

    .host-actions button:hover {
        background: var(--m3c-surface-container-highest);
    }

    @media (pointer: coarse) {
        .host-actions button {
            height: var(--size-control-lg);
        }
    }

    .add-form {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        margin-block-start: var(--space-3);
        padding-block-start: var(--space-3);
        box-shadow: inset 0 1px 0 var(--m3c-outline-variant);
    }

    .add-form input {
        height: var(--size-control-md);
        padding-inline: var(--space-3);
        padding-block: 0;
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-lowest);
        color: var(--m3c-on-surface);
        font-size: 13px;
    }

    .add-form input:focus {
        border-color: var(--m3c-primary);
    }
</style>
