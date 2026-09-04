<script lang="ts">
    import { MediaQuery } from "svelte/reactivity";
    import { stacks } from "../lib/stores/stacks.svelte.ts";
    import { agents } from "../lib/stores/agents.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { request } from "../lib/connection.svelte.ts";
    import { navigate } from "../router.svelte.ts";
    import StackList from "../components/StackList.svelte";
    import ConfirmDialog from "../components/ConfirmDialog.svelte";
    import MenuButton, { type MenuItemSpec } from "../components/MenuButton.svelte";
    import HiddenInput from "../components/HiddenInput.svelte";
    import { RUNNING, EXITED } from "../../../common/stack.ts";

    const isMedium = new MediaQuery("width >= 600px");
    const isExpanded = new MediaQuery("width >= 840px");

    // Status counts
    const stackValues = $derived(Object.values(stacks.byKey));
    const activeCount = $derived(stackValues.filter((s) => s.status === RUNNING).length);
    const exitedCount = $derived(stackValues.filter((s) => s.status === EXITED).length);
    const inactiveCount = $derived(stackValues.filter((s) => s.status !== RUNNING && s.status !== EXITED).length);

    // Composerize converter
    let dockerRunCommand = $state("");
    let converting = $state(false);
    let converterError = $state<string | null>(null);

    async function handleConvert(e: SubmitEvent): Promise<void> {
        e.preventDefault();
        const cmd = dockerRunCommand.trim();
        if (cmd === "" || converting) return;

        converting = true;
        converterError = null;

        try {
            const res = await request<{ composeYAML?: string }>("", "docker.composerize", { command: cmd });
            if (res.composeYAML) {
                sessionStorage.setItem("docknight-compose-draft", res.composeYAML);
                await navigate("/compose");
            }
        } catch (err: unknown) {
            converterError = err && typeof err === "object" && "message" in err
                ? String(err.message)
                : t("error.invalidCompose");
        } finally {
            converting = false;
        }
    }

    // Host Management
    let addUrl = $state("");
    let addUsername = $state("");
    let addPassword = $state("");
    let addName = $state("");
    let addingHost = $state(false);
    let addHostError = $state<string | null>(null);

    let removeTargetUrl = $state<string | null>(null);
    let renameTargetEndpoint = $state<string | null>(null);
    let renameNewName = $state("");

    async function handleAddHost(e: SubmitEvent): Promise<void> {
        e.preventDefault();
        if (addingHost || addUrl.trim() === "") return;

        addingHost = true;
        addHostError = null;

        try {
            await request("", "agent.add", {
                url: addUrl.trim(),
                username: addUsername.trim(),
                password: addPassword,
                name: addName.trim() || undefined,
            });
            addUrl = "";
            addUsername = "";
            addPassword = "";
            addName = "";
        } catch (err: unknown) {
            addHostError = err && typeof err === "object" && "message" in err
                ? String(err.message)
                : t("error.agentUnreachable");
        } finally {
            addingHost = false;
        }
    }

    async function confirmRemoveHost(): Promise<void> {
        if (removeTargetUrl === null) return;
        const target = removeTargetUrl;
        removeTargetUrl = null;
        try {
            await request("", "agent.remove", { url: target });
        } catch {
            // handled
        }
    }

    async function confirmRenameHost(): Promise<void> {
        if (renameTargetEndpoint === null) return;
        const ep = renameTargetEndpoint;
        const name = renameNewName.trim();
        renameTargetEndpoint = null;
        try {
            await request("", "agent.rename", { endpoint: ep, name });
        } catch {
            // handled
        }
    }

    function hostMenuItems(url: string, endpoint: string, currentName: string): MenuItemSpec[] {
        return [
            {
                label: t("dashboard.hosts.rename"),
                onSelect: () => {
                    renameTargetEndpoint = endpoint;
                    renameNewName = currentName;
                },
            },
            {
                label: t("dashboard.hosts.remove"),
                danger: true,
                onSelect: () => {
                    removeTargetUrl = url;
                },
            },
        ];
    }
</script>

<div class="gcp-dashboard-page" data-audit-root>
    <div class="gcp-dashboard-header" data-audit-row="center">
        <h1 class="text-headline">{t("dashboard.title")}</h1>
    </div>

    <div class="gcp-dashboard-grid">
        <!-- Compact StackList card: replaces absent left panel on compact -->
        {#if !isExpanded.current}
            <section class="gcp-card gcp-mobile-stacks" data-audit-column>
                <div class="gcp-card-header" data-audit-row="center">
                    <h2 class="text-title">{t("stack.list.search")}</h2>
                </div>
                <div class="gcp-card-body" data-audit-column>
                    <StackList showSearch={true} />
                </div>
            </section>
        {/if}

        <!-- Status Counts Card -->
        <section class="gcp-card gcp-counts-card" data-audit-column>
            <div class="gcp-card-header" data-audit-row="center">
                <h2 class="text-title">Stack Status</h2>
            </div>
            <div class="gcp-card-body gcp-counts-grid" data-audit-row="center">
                <div class="gcp-count-col" data-audit-column>
                    <span class="text-label gcp-count-label">{t("dashboard.stacks.active")}</span>
                    <span class="text-display gcp-count-val active" data-audit-numeric>{activeCount}</span>
                </div>
                <div class="gcp-count-col" data-audit-column>
                    <span class="text-label gcp-count-label">{t("dashboard.stacks.exited")}</span>
                    <span class="text-display gcp-count-val exited" data-audit-numeric>{exitedCount}</span>
                </div>
                <div class="gcp-count-col" data-audit-column>
                    <span class="text-label gcp-count-label">{t("dashboard.stacks.inactive")}</span>
                    <span class="text-display gcp-count-val inactive" data-audit-numeric>{inactiveCount}</span>
                </div>
            </div>
        </section>

        <!-- Composerize Converter Card -->
        <section class="gcp-card gcp-converter-card" data-audit-column>
            <div class="gcp-card-header" data-audit-row="center">
                <h2 class="text-title">{t("dashboard.converter.title")}</h2>
            </div>
            <div class="gcp-card-body" data-audit-column>
                <form class="gcp-converter-form" onsubmit={handleConvert} data-audit-column>
                    <textarea
                        class="gcp-textarea text-mono"
                        rows="3"
                        placeholder={t("dashboard.converter.placeholder")}
                        aria-label={t("dashboard.converter.title")}
                        bind:value={dockerRunCommand}
                    ></textarea>

                    {#if converterError !== null}
                        <span class="text-label gcp-converter-error" role="alert">{converterError}</span>
                    {/if}

                    <div class="gcp-form-actions" data-audit-row="center">
                        <button
                            type="submit"
                            class="gcp-btn-primary"
                            disabled={converting || dockerRunCommand.trim() === ""}
                        >
                            {t("dashboard.converter.submit")}
                        </button>
                    </div>
                </form>
            </div>
        </section>

        <!-- Managed Hosts Card -->
        <section class="gcp-card gcp-hosts-card" data-audit-column>
            <div class="gcp-card-header" data-audit-row="center">
                <h2 class="text-title">{t("dashboard.hosts.title")}</h2>
            </div>
            <div class="gcp-card-body" data-audit-column>
                <!-- Host list -->
                <div class="gcp-hosts-list" data-audit-column>
                    <div class="gcp-host-row local" data-audit-row="center">
                        <div class="gcp-host-status" data-audit-row="center">
                            <span class="gcp-dot online" aria-hidden="true"></span>
                            <span class="text-body-medium gcp-host-name">{t("nav.home")} (Local)</span>
                        </div>
                    </div>

                    {#each Object.values(agents.byEndpoint) as agent (agent.endpoint)}
                        {@const st = agents.statuses[agent.endpoint]?.status ?? "connecting"}
                        <div class="gcp-host-row" data-audit-row="center">
                            <div class="gcp-host-status" data-audit-row="center">
                                <span class="gcp-dot {st}" aria-hidden="true"></span>
                                <span class="text-body-medium gcp-host-name" data-audit-clip>{agent.name || agent.endpoint}</span>
                                <span class="text-label gcp-host-url text-mono" data-audit-clip>{agent.url}</span>
                            </div>
                            <div class="gcp-host-actions" data-audit-row="center">
                                {#if isMedium.current}
                                    <button
                                        type="button"
                                        class="gcp-btn-secondary"
                                        onclick={() => {
                                            renameTargetEndpoint = agent.endpoint;
                                            renameNewName = agent.name || "";
                                        }}
                                    >
                                        {t("dashboard.hosts.rename")}
                                    </button>
                                    <button
                                        type="button"
                                        class="gcp-btn-secondary danger"
                                        onclick={() => (removeTargetUrl = agent.url)}
                                    >
                                        {t("dashboard.hosts.remove")}
                                    </button>
                                {:else}
                                    <MenuButton items={hostMenuItems(agent.url, agent.endpoint, agent.name || "")} />
                                {/if}
                            </div>
                        </div>
                    {/each}
                </div>

                <!-- Add Host Form -->
                <form class="gcp-add-host-form" onsubmit={handleAddHost} data-audit-column>
                    <span class="text-label gcp-form-heading" data-audit-heading>{t("dashboard.hosts.add")}</span>

                    {#if addHostError !== null}
                        <span class="text-label gcp-converter-error" role="alert">{addHostError}</span>
                    {/if}

                    <div class="gcp-add-host-fields" data-audit-column>
                        <input
                            type="text"
                            class="gcp-input"
                            placeholder={t("host.url")}
                            aria-label={t("host.url")}
                            required
                            bind:value={addUrl}
                        />
                        <div class="gcp-add-host-row" data-audit-row="center">
                            <input
                                type="text"
                                class="gcp-input"
                                placeholder={t("host.username")}
                                aria-label={t("host.username")}
                                required
                                bind:value={addUsername}
                            />
                            <HiddenInput
                                placeholder={t("host.password")}
                                bind:value={addPassword}
                            />
                        </div>
                        <input
                            type="text"
                            class="gcp-input"
                            placeholder={t("host.name")}
                            aria-label={t("host.name")}
                            bind:value={addName}
                        />
                    </div>

                    <div class="gcp-form-actions" data-audit-row="center">
                        <button
                            type="submit"
                            class="gcp-btn-primary"
                            disabled={addingHost || addUrl.trim() === ""}
                        >
                            {t("dashboard.hosts.add")}
                        </button>
                    </div>
                </form>
            </div>
        </section>
    </div>
</div>

<!-- Confirm remove host dialog -->
<ConfirmDialog
    open={removeTargetUrl !== null}
    title={t("dashboard.hosts.remove")}
    message={t("dashboard.hosts.removeConfirm", { url: removeTargetUrl ?? "" })}
    danger
    onconfirm={confirmRemoveHost}
    oncancel={() => (removeTargetUrl = null)}
/>

<!-- Rename host dialog -->
<ConfirmDialog
    open={renameTargetEndpoint !== null}
    title={t("dashboard.hosts.rename")}
    confirmLabel={t("action.save")}
    onconfirm={confirmRenameHost}
    oncancel={() => (renameTargetEndpoint = null)}
>
    <div class="gcp-field" data-audit-column>
        <label for="host-new-name" class="text-label">{t("host.name")}</label>
        <input
            id="host-new-name"
            type="text"
            class="gcp-input"
            bind:value={renameNewName}
        />
    </div>
</ConfirmDialog>

<style>
    .gcp-dashboard-page {
        display: flex;
        flex-direction: column;
        padding: var(--space-6);
        gap: var(--space-6);
    }

    @media (width < 600px) {
        .gcp-dashboard-page {
            padding: var(--space-4);
            gap: var(--space-4);
        }
    }

    .gcp-dashboard-header {
        display: flex;
        align-items: center;
        min-height: var(--size-control-md);
    }

    .gcp-dashboard-grid {
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
    }

    .gcp-card {
        display: flex;
        flex-direction: column;
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-md);
        background: var(--m3c-surface-container-low);
        overflow: hidden;
        transition: border-color var(--duration-medium) var(--ease-standard);
    }

    .gcp-card:hover {
        border-color: var(--m3c-outline);
    }

    .gcp-card-header {
        display: flex;
        align-items: center;
        height: var(--size-control-xl);
        padding-inline: var(--space-5);
        border-block-end: 1px solid var(--m3c-outline-variant);
    }

    .gcp-card-header h2 {
        font-size: 15px;
        font-weight: 500;
        line-height: var(--space-5);
    }

    .gcp-card-body {
        display: flex;
        flex-direction: column;
        padding: var(--space-5);
        gap: var(--space-4);
    }

    .gcp-counts-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: var(--space-4);
        text-align: center;
    }

    .gcp-count-col {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-1);
    }

    .gcp-count-label {
        color: var(--m3c-on-surface-variant);
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .gcp-count-val {
        font-weight: 600;
        font-size: 32px;
        line-height: var(--space-10);
    }

    .gcp-count-val.active {
        color: #137333;
    }

    .gcp-count-val.exited {
        color: #c5221f;
    }

    .gcp-count-val.inactive {
        color: var(--m3c-on-surface-variant);
    }

    :global([data-theme="dark"]) .gcp-count-val.active {
        color: #81c995;
    }

    :global([data-theme="dark"]) .gcp-count-val.exited {
        color: #f28b82;
    }

    .gcp-converter-form {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
    }

    .gcp-textarea {
        width: 100%;
        block-size: calc(var(--size-control-md) * 2);
        padding-block: var(--space-3);
        padding-inline: var(--space-4);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-sm);
        background: var(--m3c-surface);
        color: var(--m3c-on-surface);
        resize: vertical;
        font-size: 13px;
        line-height: var(--space-5);
        transition: border-color var(--duration-fast) var(--ease-standard);
    }

    .gcp-textarea:focus {
        border-color: var(--m3c-primary);
    }

    .gcp-converter-error {
        color: var(--m3c-error);
    }

    .gcp-form-actions {
        display: flex;
        justify-content: flex-end;
    }

    .gcp-hosts-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .gcp-host-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-inline: var(--space-3);
        height: var(--size-control-lg);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-lowest);
        border: 1px solid var(--m3c-outline-variant);
    }

    .gcp-host-status {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        min-width: 0;
    }

    .gcp-dot {
        width: var(--space-2);
        height: var(--space-2);
        border-radius: var(--radius-round);
        background: #9aa0a6;
        flex-shrink: 0;
    }

    .gcp-dot.online {
        background: #137333;
    }

    .gcp-dot.offline {
        background: #c5221f;
    }

    :global([data-theme="dark"]) .gcp-dot.online {
        background: #81c995;
    }

    :global([data-theme="dark"]) .gcp-dot.offline {
        background: #f28b82;
    }

    .gcp-host-name {
        font-weight: 500;
    }

    .gcp-host-url {
        color: var(--m3c-on-surface-variant);
        font-size: 12px;
    }

    .gcp-host-actions {
        display: flex;
        align-items: center;
        gap: var(--space-2);
    }

    .gcp-add-host-form {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        padding-block-start: var(--space-4);
        border: none;
        box-shadow: inset 0 1px 0 0 var(--m3c-outline-variant);
    }

    .gcp-form-heading {
        color: var(--m3c-on-surface-variant);
        font-weight: 600;
    }

    .gcp-add-host-fields {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .gcp-add-host-row {
        display: flex;
        gap: var(--space-2);
        width: 100%;
    }

    .gcp-add-host-row > :global(*) {
        flex: 1;
        min-width: 0;
    }

    .gcp-input {
        width: 100%;
        block-size: var(--size-control-md);
        padding-block: 0;
        padding-inline: var(--space-4);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-sm);
        background: var(--m3c-surface);
        color: var(--m3c-on-surface);
        font-family: inherit;
        transition: border-color var(--duration-fast) var(--ease-standard);
    }

    .gcp-input:focus {
        border-color: var(--m3c-primary);
    }

    .gcp-btn-primary {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        block-size: var(--size-control-md);
        padding-block: 0;
        padding-inline: var(--space-5);
        border-radius: var(--radius-sm);
        border: none;
        background: var(--m3c-primary);
        color: var(--m3c-on-primary);
        font-weight: 500;
        font-size: 14px;
        cursor: pointer;
        transition: background var(--duration-fast) var(--ease-standard);
    }

    .gcp-btn-primary:hover {
        background: var(--m3c-primary-dim);
    }

    .gcp-btn-primary:disabled {
        opacity: 0.38;
        cursor: not-allowed;
    }

    .gcp-btn-secondary {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        block-size: var(--size-control-sm);
        padding-block: 0;
        padding-inline: var(--space-4);
        border-radius: var(--radius-sm);
        border: 1px solid var(--m3c-outline-variant);
        background: transparent;
        color: var(--m3c-on-surface);
        font-size: 13px;
        cursor: pointer;
        transition: background var(--duration-fast) var(--ease-standard);
    }

    .gcp-btn-secondary:hover {
        background: var(--m3c-surface-container-high);
    }

    .gcp-btn-secondary.danger {
        color: var(--m3c-error);
    }

    @media (pointer: coarse) {
        .gcp-btn-secondary {
            block-size: var(--size-control-lg);
        }
    }
</style>
