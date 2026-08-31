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
    <h1 class="text-headline">{t("dashboard.title")}</h1>

    {#if !isExpanded.current}
        <div class="card">
            <StackList filter="" />
        </div>
    {/if}

    <div class="card counts" data-audit-row="center">
        <a class="count" href="/?filter=running" onclick={(e) => e.preventDefault()}>
            <span class="count-value text-headline" data-audit-numeric>{counts.active}</span>
            <span class="text-label">{t("dashboard.stacks.active")}</span>
        </a>
        <a class="count" href="/?filter=exited" onclick={(e) => e.preventDefault()}>
            <span class="count-value text-headline" data-audit-numeric>{counts.exited}</span>
            <span class="text-label">{t("dashboard.stacks.exited")}</span>
        </a>
        <a class="count" href="/?filter=inactive" onclick={(e) => e.preventDefault()}>
            <span class="count-value text-headline" data-audit-numeric>{counts.inactive}</span>
            <span class="text-label">{t("dashboard.stacks.inactive")}</span>
        </a>
    </div>

    <div class="card" data-audit-column>
        <h2 class="text-title">{t("dashboard.converter.title")}</h2>
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

    <div class="card">
        <h2 class="text-title">{t("dashboard.hosts.title")}</h2>
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
        gap: var(--space-6);
        padding: var(--space-4);
    }

    @media (width >= 600px) {
        .dashboard {
            padding: var(--space-6);
        }
    }

    @media (width >= 840px) {
        .dashboard {
            padding: var(--space-8);
        }
    }

    .card {
        padding: var(--space-4);
        border-radius: var(--radius-md);
        background: var(--m3c-surface-container-low);
    }

    .counts {
        display: flex;
        justify-content: space-around;
    }

    .count {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-1);
        color: var(--m3c-on-surface);
        text-decoration: none;
        flex: 1;
    }

    .count-value {
        font-variant-numeric: tabular-nums;
    }

    .command {
        display: block;
        width: 100%;
        min-height: var(--space-16);
        padding: var(--space-3);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-lowest);
        color: var(--m3c-on-surface);
        font-family: "JetBrains Mono", monospace;
        resize: vertical;
    }

    .error {
        color: var(--m3c-error);
    }

    .primary {
        align-self: flex-start;
        height: var(--size-control-md);
        padding-inline: var(--space-3);

        /*
         * A transparent 1px border, matching .command's real 1px outline border, so both
         * controls' ink starts from the same padding-plus-border distance (per glyph-edge).
         */
        border: 1px solid transparent;
        border-radius: var(--radius-xl);
        background: var(--m3c-primary);
        color: var(--m3c-on-primary);
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
    }

    .status-dot {
        width: var(--space-3);
        height: var(--space-3);
        border-radius: 50%;
        background: var(--m3c-error);
        flex-shrink: 0;
    }

    .status-dot.online {
        background: var(--m3c-tertiary);
    }

    .host-name {
        flex: 1;
    }

    .host-actions {
        display: flex;
        gap: var(--space-2);
    }

    .host-actions button {
        height: var(--size-control-sm);
        padding-inline: var(--space-3);
        border: none;
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-high);
        color: var(--m3c-on-surface);
        cursor: pointer;
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
        margin-block-start: var(--space-4);
    }

    .add-form input {
        height: var(--size-control-md);
        padding-inline: var(--space-3);
        padding-block: 0;
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-lowest);
        color: var(--m3c-on-surface);
    }
</style>
