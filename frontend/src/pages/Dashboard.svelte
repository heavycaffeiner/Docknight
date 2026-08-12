<script lang="ts">
    import { Button, TextFieldOutlined, TextFieldOutlinedMultiline } from "m3-svelte";
    import { DRAFT, EXITED, RUNNING, UNKNOWN } from "$common/stack.ts";
    import Badge from "../components/Badge.svelte";
    import ConfirmDialog from "../components/ConfirmDialog.svelte";
    import Icon from "../components/Icon.svelte";
    import StackList from "../components/StackList.svelte";
    import { request } from "../lib/connection.svelte.ts";
    import { EXPANDED, media } from "../lib/media.svelte.ts";
    import { agents, remoteAgents } from "../lib/stores/agents.svelte.ts";
    import { i18n, t } from "../lib/stores/i18n.svelte.ts";
    import { stackList } from "../lib/stores/stacks.svelte.ts";
    import { toastError, toastResult } from "../lib/stores/toast.svelte.ts";
    import { handoff, navigate } from "../router.svelte.ts";
    import { formatNumber } from "../lib/format.ts";

    let statusFilter = $state<number | ((status: number) => boolean) | null>(null);

    /** The inactive bucket is a group, so the filter carries the same predicate the count uses. */
    const isInactive = (status: number): boolean => status === DRAFT || status === UNKNOWN;

    /** The shell pins the stack list beside the outlet only when it is expanded, so below that the
        list is this screen's own first card rather than a feature with no route to it. */
    const expanded = media(EXPANDED);
    let search = $state("");

    let command = $state("");
    let convertError = $state<string | null>(null);
    let converting = $state(false);

    let hostUrl = $state("");
    let hostUsername = $state("");
    let hostPassword = $state("");
    let hostName = $state("");
    let hostError = $state<string | null>(null);
    let adding = $state(false);
    let removeTarget = $state<string | null>(null);
    let renaming = $state<string | null>(null);
    let renameValue = $state("");

    const counts = $derived.by(() => {
        const rows = stackList();
        return {
            running: rows.filter((row) => row.status === RUNNING).length,
            exited: rows.filter((row) => row.status === EXITED).length,
            inactive: rows.filter((row) => isInactive(row.status)).length,
            all: rows.length,
        };
    });

    async function convert(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (converting) return;
        converting = true;
        convertError = null;
        try {
            const result = await request("", "docker.composerize", { command });
            handoff.composeYAML = result.yaml;
            await navigate("/compose");
        } catch (error) {
            // Reported inline under the textarea, not as a toast.
            convertError = error instanceof Error ? error.message : String(error);
        } finally {
            converting = false;
        }
    }

    async function addHost(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (adding) return;
        adding = true;
        hostError = null;
        try {
            await request("", "agent.add", {
                url: hostUrl,
                username: hostUsername,
                password: hostPassword,
                ...(hostName === "" ? {} : { name: hostName }),
            });
            hostUrl = "";
            hostUsername = "";
            hostPassword = "";
            hostName = "";
            toastResult("settingsSaved");
        } catch (error) {
            // The credential test's result belongs in the form, not in a toast.
            hostError = error instanceof Error ? error.message : String(error);
        } finally {
            adding = false;
        }
    }

    async function removeHost(url: string): Promise<void> {
        removeTarget = null;
        try {
            await request("", "agent.remove", { url });
            toastResult("settingsSaved");
        } catch (error) {
            toastError(error);
        }
    }

    async function commitRename(url: string): Promise<void> {
        renaming = null;
        try {
            await request("", "agent.rename", { url, name: renameValue });
        } catch (error) {
            toastError(error);
        }
    }

    function statusKeyFor(status: string): string {
        return status === "online"
            ? "hostStatusOnline"
            : status === "connecting"
              ? "hostStatusConnecting"
              : "hostStatusOffline";
    }

    function hostTone(status: string): "good" | "wait" | "bad" {
        return status === "online" ? "good" : status === "connecting" ? "wait" : "bad";
    }
</script>

<h1 class="type-headline" data-route-heading>{t("dashboardTitle")}</h1>

{#if !expanded.value}
    <section class="card" data-audit-id="dashboard-stacks" data-audit-column>
        <!-- On the search field's own inset: its icon is the first ink in the card below this. -->
        <div class="stacks-head optical-inset" data-audit-row="center">
            <h2 class="type-title">{t("stackListLabel")}</h2>
            <Button
                variant="tonal"
                iconType="left"
                onclick={() => void navigate("/compose")}
                aria-label={t("actionCreateStack")}
            >
                <Icon name="add" size="md" />
                {t("actionNew")}
            </Button>
        </div>
        <label class="search">
            <span class="visually-hidden">{t("stackSearchLabel")}</span>
            <Icon name="search" size="sm" />
            <input
                type="search"
                bind:value={search}
                placeholder={t("stackSearchPlaceholder")}
                autocomplete="off"
            />
        </label>
        <StackList filter={search} />
    </section>
{/if}

<section class="card" data-audit-id="dashboard-counts" data-audit-column>
    <h2 class="type-title">{t("dashboardCounts")}</h2>
    <div class="counts" data-audit-row="center">
        <button
            type="button"
            class="count"
            class:selected={statusFilter === RUNNING}
            onclick={() => (statusFilter = statusFilter === RUNNING ? null : RUNNING)}
        >
            <span class="count-value type-display" data-audit-numeric>
                {formatNumber(counts.running, i18n.locale)}
            </span>
            <span class="count-label type-label">{t("dashboardActive")}</span>
        </button>
        <button
            type="button"
            class="count"
            class:selected={statusFilter === EXITED}
            onclick={() => (statusFilter = statusFilter === EXITED ? null : EXITED)}
        >
            <span class="count-value type-display" data-audit-numeric>
                {formatNumber(counts.exited, i18n.locale)}
            </span>
            <span class="count-label type-label">{t("dashboardExited")}</span>
        </button>
        <button
            type="button"
            class="count"
            class:selected={statusFilter === isInactive}
            onclick={() => (statusFilter = statusFilter === isInactive ? null : isInactive)}
        >
            <span class="count-value type-display" data-audit-numeric>
                {formatNumber(counts.inactive, i18n.locale)}
            </span>
            <span class="count-label type-label">{t("dashboardInactive")}</span>
        </button>
        <button type="button" class="count" class:selected={statusFilter === null} onclick={() => (statusFilter = null)}>
            <span class="count-value type-display" data-audit-numeric>
                {formatNumber(counts.all, i18n.locale)}
            </span>
            <span class="count-label type-label">{t("dashboardAll")}</span>
        </button>
    </div>
    {#if statusFilter !== null}
        <StackList {statusFilter} />
    {/if}
</section>

<section class="card" data-audit-id="dashboard-convert" data-audit-column>
    <!-- The field below sets this card's text column, and its label starts inside the field's own
         inset, so the heading and the body take the same one. -->
    <h2 class="type-title optical-inset">{t("dashboardConvertTitle")}</h2>
    <p class="body type-body optical-inset">{t("dashboardConvertBody")}</p>
    <form onsubmit={convert}>
        <TextFieldOutlinedMultiline label={t("dashboardConvertLabel")} bind:value={command} rows={4} />
        {#if convertError !== null}
            <p class="error type-label" role="alert">{convertError}</p>
        {/if}
        <div class="submit">
            <Button variant="tonal" type="submit" disabled={converting || command.trim() === ""}>
                {t("dashboardConvertSubmit")}
            </Button>
        </div>
    </form>
</section>

<section class="card" data-audit-id="dashboard-hosts" data-audit-column>
    <h2 class="type-title">{t("dashboardHostsTitle")}</h2>
    <p class="body type-body">{t("dashboardHostsBody")}</p>

    {#if remoteAgents().length === 0}
        <p class="body type-body">{t("dashboardHostsEmpty")}</p>
    {:else}
        <ul class="hosts" data-audit-column>
            {#each remoteAgents() as host (host.url)}
                <li class="host-row" data-audit-row="center">
                    <span class="host-id" data-audit-row="center">
                        {#if renaming === host.url}
                            <input
                                class="input type-body"
                                type="text"
                                bind:value={renameValue}
                                aria-label={t("dashboardHostName")}
                            />
                        {:else}
                            <span class="host-name type-body text-name">
                                {host.name === "" ? host.endpoint : host.name}
                            </span>
                            <span class="host-endpoint type-mono">{host.endpoint}</span>
                        {/if}
                    </span>
                    <span class="host-actions" data-audit-row="center">
                        <span class="badge-cell" data-audit-boundary data-audit-id="host-badge">
                            <Badge tone={hostTone(host.status)} dot>{t(statusKeyFor(host.status))}</Badge>
                        </span>
                        {#if renaming === host.url}
                            <Button variant="text" onclick={() => void commitRename(host.url)}>
                                {t("actionSave")}
                            </Button>
                        {:else}
                            <Button
                                variant="text"
                                onclick={() => {
                                    renaming = host.url;
                                    renameValue = host.name;
                                }}
                            >
                                {t("dashboardHostRename")}
                            </Button>
                        {/if}
                        <Button variant="text" onclick={() => (removeTarget = host.url)}>
                            {t("dashboardHostRemove")}
                        </Button>
                    </span>
                </li>
            {/each}
        </ul>
    {/if}

    <form class="host-form" onsubmit={addHost} data-audit-column>
        <h3 class="type-title optical-inset">{t("dashboardHostAdd")}</h3>
        <TextFieldOutlined label={t("dashboardHostUrl")} bind:value={hostUrl} required />
        <TextFieldOutlined label={t("dashboardHostUsername")} bind:value={hostUsername} autocomplete="off" required />
        <TextFieldOutlined
            label={t("dashboardHostPassword")}
            type="password"
            bind:value={hostPassword}
            autocomplete="off"
            required
        />
        <TextFieldOutlined label={t("dashboardHostName")} bind:value={hostName} />
        {#if hostError !== null}
            <p class="error type-label" role="alert">{hostError}</p>
        {/if}
        <div class="submit">
            <Button variant="filled" type="submit" iconType="left" disabled={adding}>
                <Icon name="add" size="md" />
                {t("dashboardHostSubmit")}
            </Button>
        </div>
    </form>
</section>

<ConfirmDialog
    open={removeTarget !== null}
    destructive
    title={t("dashboardHostRemoveTitle")}
    body={t("dashboardHostRemoveBody", { url: removeTarget ?? "" })}
    confirmLabel={t("dashboardHostRemove")}
    onconfirm={() => void removeHost(removeTarget ?? "")}
    oncancel={() => (removeTarget = null)}
/>

<span class="visually-hidden">{Object.keys(agents.byEndpoint).length}</span>

<style>
    h1 {
        margin: 0;
    }

    h2,
    h3 {
        margin: 0;
    }

    .body {
        margin: 0;
        color: rgb(var(--m3-scheme-on-surface-variant));
    }

    .stacks-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
    }

    /* The same field the pinned panel carries at expanded widths, so the list is filtered the same
       way wherever it is rendered. */
    .search {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        min-inline-size: 0;
        block-size: var(--size-control-md);
        padding-inline: var(--space-3);
        border-radius: var(--radius-full);
        background-color: rgb(var(--m3-scheme-surface-container-high));
        color: rgb(var(--m3-scheme-on-surface-variant));
    }

    .search input {
        flex: 1;
        align-self: stretch;
        min-inline-size: 0;
        border: 0;
        background: none;
        outline-offset: var(--space-1);
    }

    .counts {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: var(--space-2);
    }

    .count {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-1);
        padding-block: var(--space-3);
        padding-inline: var(--space-2);
        border: 0;
        border-radius: var(--radius-lg);
        background-color: rgb(var(--m3-scheme-surface-container));
        color: rgb(var(--m3-scheme-on-surface));
        cursor: pointer;
        transition:
            background-color var(--m3-util-easing),
            color var(--m3-util-easing);
    }

    .count:hover {
        background-color: rgb(var(--m3-scheme-surface-container-high));
    }

    /* Selection is a tonal fill rather than a ring: a hairline around a large tile reads as a
       disabled input, and the fill is what Material uses to mark a chosen filter. */
    .count.selected {
        background-color: rgb(var(--m3-scheme-secondary-container));
        color: rgb(var(--m3-scheme-on-secondary-container));
    }

    .count.selected .count-label {
        color: inherit;
    }

    .count-value {
        inline-size: 100%;
        text-align: center;
    }

    .count-label {
        color: rgb(var(--m3-scheme-on-surface-variant));
    }

    .hosts {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    /* The identity and the actions are two groups rather than five siblings, so a narrow viewport
       breaks between them instead of stranding a lone button under a truncated name. */
    .host-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-2);
        min-block-size: var(--size-control-md);
    }

    .host-id {
        display: flex;
        flex: 1;
        align-items: center;
        gap: var(--space-2);
        min-inline-size: 0;
        min-block-size: var(--size-control-md);
    }

    .host-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-2);
        min-block-size: var(--size-control-md);
    }

    /* A floor under the badge, not on it, so the two hosts' actions start on one column however
       long the state's word turns out to be in the current language. */
    .badge-cell {
        display: inline-flex;
        min-inline-size: var(--space-16);
    }

    .host-name {
        flex: 1;
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .host-endpoint {
        min-inline-size: 0;
        overflow: hidden;
        color: rgb(var(--m3-scheme-on-surface-variant));
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .input {
        flex: 1;
        min-inline-size: 0;
        block-size: var(--size-control-md);
        padding-inline: var(--space-4);
        border: 0;
        border-radius: var(--radius-md);
        box-shadow: inset 0 0 0 var(--hairline) rgb(var(--m3-scheme-outline));
        background-color: rgb(var(--m3-scheme-surface));
        color: rgb(var(--m3-scheme-on-surface));
    }

    .host-form {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        max-inline-size: var(--measure-form);
        margin-block-start: var(--space-2);
    }

    form {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
    }

    .error {
        margin: 0;
        color: rgb(var(--m3-scheme-error));
    }

    .submit {
        display: flex;
        justify-content: flex-start;
    }

    @media (width < 840px) {
        .counts {
            grid-template-columns: repeat(2, 1fr);
        }
    }
</style>
