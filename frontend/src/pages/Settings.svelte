<script lang="ts">
    import { MediaQuery } from "svelte/reactivity";
    import QRCode from "qrcode";
    import { request } from "../lib/connection.svelte.ts";
    import { route, navigate } from "../router.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { load as loadSettings, save as saveSettings, settings } from "../lib/stores/settings.svelte.ts";
    import { i18n, listLocales, setLocale } from "../lib/stores/i18n.svelte.ts";
    import { theme } from "../lib/stores/theme.svelte.ts";
    import { logout } from "../lib/stores/session.svelte.ts";
    import { toastError, toastResult } from "../lib/stores/toast.svelte.ts";
    import ConfirmDialog from "../components/ConfirmDialog.svelte";
    import HiddenInput from "../components/HiddenInput.svelte";
    import CodeEditor from "../components/CodeEditor.svelte";
    import TerminalView from "../components/TerminalView.svelte";

    const SECTIONS = ["general", "updates", "appearance", "security", "globalEnv", "about"] as const;
    type Section = (typeof SECTIONS)[number];

    const section = $derived((route.params.section as Section | undefined) ?? "general");
    const isMedium = new MediaQuery("width >= 600px");

    $effect(() => {
        void loadSettings().catch((error: unknown) => toastError(error));
    });

    let primaryHostname = $state("");
    let trustProxy = $state(false);
    $effect(() => {
        if (settings.values !== null) {
            primaryHostname = settings.values.primaryHostname;
            trustProxy = settings.values.trustProxy;
        }
    });

    async function saveGeneral(): Promise<void> {
        try {
            await saveSettings({ primaryHostname, trustProxy });
            toastResult(t("toast.saved"));
        } catch (error) {
            toastError(error);
        }
    }

    let checkUpdate = $state(true);
    let checkBeta = $state(false);
    let autoUpgrade = $state(false);
    $effect(() => {
        if (settings.values !== null) {
            checkUpdate = settings.values.checkUpdate;
            checkBeta = settings.values.checkBeta;
            autoUpgrade = settings.values.autoUpgrade;
        }
    });

    async function saveUpdates(): Promise<void> {
        try {
            await saveSettings({ checkUpdate, checkBeta, autoUpgrade });
            toastResult(t("toast.saved"));
        } catch (error) {
            toastError(error);
        }
    }

    let upgradeConfirm = $state(false);
    let upgrading = $state(false);

    async function startUpgrade(): Promise<void> {
        upgradeConfirm = false;
        upgrading = true;
    }

    const locales = $derived(listLocales());

    let currentPassword = $state("");
    let newPassword = $state("");
    let changingPassword = $state(false);

    async function changePassword(): Promise<void> {
        changingPassword = true;
        try {
            await request("", "auth.changePassword", { currentPassword, newPassword });
            currentPassword = "";
            newPassword = "";
            toastResult(t("toast.saved"));
        } catch (error) {
            toastError(error);
        } finally {
            changingPassword = false;
        }
    }

    let totpSecret = $state<string | null>(null);
    let totpQr = $state<string | null>(null);
    let totpCode = $state("");
    let totpBeginPassword = $state("");
    let totpDisablePassword = $state("");
    let totpDisableCode = $state("");

    async function beginTotp(): Promise<void> {
        try {
            const result = await request("", "auth.totp.begin", { currentPassword: totpBeginPassword });
            totpSecret = result.secret;
            totpQr = await QRCode.toString(result.uri, { type: "svg" });
        } catch (error) {
            toastError(error);
        }
    }

    async function enableTotp(): Promise<void> {
        try {
            await request("", "auth.totp.enable", { totp: totpCode });
            totpSecret = null;
            totpQr = null;
            totpCode = "";
            toastResult(t("toast.saved"));
        } catch (error) {
            toastError(error);
        }
    }

    async function disableTotp(): Promise<void> {
        try {
            await request("", "auth.totp.disable", {
                currentPassword: totpDisablePassword,
                totp: totpDisableCode,
            });
            totpDisablePassword = "";
            totpDisableCode = "";
            toastResult(t("toast.saved"));
        } catch (error) {
            toastError(error);
        }
    }

    let disableAuthConfirm = $state(false);
    let disableAuthPassword = $state("");

    async function confirmDisableAuth(): Promise<void> {
        try {
            await saveSettings({ disableAuth: true }, undefined, disableAuthPassword);
            disableAuthConfirm = false;
            disableAuthPassword = "";
            location.reload();
        } catch (error) {
            toastError(error);
        }
    }

    async function enableAuth(): Promise<void> {
        try {
            await saveSettings({ disableAuth: false });
            location.reload();
        } catch (error) {
            toastError(error);
        }
    }

    let globalEnvText = $state("");
    $effect(() => {
        if (settings.values !== null) globalEnvText = settings.values.globalENV;
    });

    async function saveGlobalEnv(): Promise<void> {
        try {
            await saveSettings({}, globalEnvText);
            toastResult(t("toast.saved"));
        } catch (error) {
            toastError(error);
        }
    }

    async function disconnectOthers(): Promise<void> {
        try {
            await request("", "auth.disconnectOthers", undefined);
            toastResult(t("toast.saved"));
        } catch (error) {
            toastError(error);
        }
    }

    function goToSection(next: Section): void {
        void navigate(`/settings/${next}`);
    }
</script>

<div class="page" data-audit-root data-grid-origin>
    {#if isMedium.current}
        <div class="tabs" data-audit-row="center">
            {#each SECTIONS as s (s)}
                <button type="button" class:active={section === s} onclick={() => goToSection(s)}>
                    {t(`settings.section.${s}`)}
                </button>
            {/each}
        </div>
        <div class="content">
            {@render sectionContent()}
        </div>
    {:else if route.params.section === undefined}
        <div class="index" data-audit-column>
            {#each SECTIONS as s (s)}
                <button type="button" class="index-row" onclick={() => goToSection(s)}>
                    {t(`settings.section.${s}`)}
                </button>
            {/each}
        </div>
    {:else}
        <div class="bar" data-audit-row="center">
            <a
                href="/settings"
                class="back"
                onclick={(e) => {
                    e.preventDefault();
                    void navigate("/settings");
                }}
            >
                ←
            </a>
            <span class="text-title">{t(`settings.section.${section}`)}</span>
        </div>
        <div class="content">
            {@render sectionContent()}
        </div>
    {/if}
</div>

{#snippet sectionContent()}
    {#if section === "general"}
        <div class="column" data-audit-column>
            <label class="field">
                <span class="text-label">{t("settings.general.primaryHostname")}</span>
                <div class="row-inline">
                    <input type="text" bind:value={primaryHostname} />
                    <button type="button" onclick={() => (primaryHostname = location.hostname)}>
                        {t("settings.general.useCurrentHost")}
                    </button>
                </div>
            </label>
            <label class="toggle-row">
                <input type="checkbox" bind:checked={trustProxy} />
                <span class="text-body-medium">{t("settings.general.trustProxy")}</span>
            </label>
            <button type="button" class="primary" onclick={saveGeneral}>{t("toast.saved")}</button>
        </div>
    {:else if section === "updates"}
        <div class="column" data-audit-column>
            <p class="text-body-medium">
                {settings.info?.version ?? "…"}
                {#if settings.info?.latestVersion !== undefined && settings.info.latestVersion !== settings.info.version}
                    → {settings.info.latestVersion}
                {/if}
            </p>
            <label class="toggle-row">
                <input type="checkbox" bind:checked={checkUpdate} />
                <span class="text-body-medium">Check for updates</span>
            </label>
            <label class="toggle-row">
                <input type="checkbox" bind:checked={checkBeta} />
                <span class="text-body-medium">Check beta releases</span>
            </label>
            <label class="toggle-row">
                <input type="checkbox" bind:checked={autoUpgrade} />
                <span class="text-body-medium">Automatic upgrade</span>
            </label>
            <button type="button" class="primary" onclick={saveUpdates}>{t("toast.saved")}</button>
            <button type="button" onclick={() => (upgradeConfirm = true)}>Upgrade</button>
            {#if upgrading}
                <div class="upgrade-terminal">
                    <TerminalView endpoint="" terminal="upgrade" interactive={false} rows={20} />
                </div>
            {/if}
        </div>
    {:else if section === "appearance"}
        <div class="column" data-audit-column>
            <label class="field">
                <span class="text-label">{t("settings.appearance.theme")}</span>
                <select bind:value={theme.preference}>
                    <option value="light">{t("theme.light")}</option>
                    <option value="dark">{t("theme.dark")}</option>
                    <option value="system">{t("theme.system")}</option>
                </select>
            </label>
            <label class="field">
                <span class="text-label">{t("settings.appearance.language")}</span>
                <select value={i18n.locale} onchange={(e) => void setLocale(e.currentTarget.value)}>
                    {#each locales as locale (locale.tag)}
                        <option value={locale.tag}>{locale.name}</option>
                    {/each}
                </select>
            </label>
        </div>
    {:else if section === "security"}
        <div class="column" data-audit-column>
            <h2 class="text-title">{t("settings.security.changePassword")}</h2>
            <label class="field">
                <span class="text-label">{t("settings.security.currentPassword")}</span>
                <HiddenInput bind:value={currentPassword} autocomplete="current-password" />
            </label>
            <label class="field">
                <span class="text-label">{t("settings.security.newPassword")}</span>
                <HiddenInput bind:value={newPassword} autocomplete="new-password" />
            </label>
            <button type="button" class="primary" disabled={changingPassword} onclick={changePassword}>
                {t("settings.security.changePassword")}
            </button>

            <h2 class="text-title">TOTP</h2>
            {#if totpQr === null}
                <label class="field">
                    <span class="text-label">{t("settings.security.currentPassword")}</span>
                    <HiddenInput bind:value={totpBeginPassword} autocomplete="current-password" />
                </label>
                <button type="button" onclick={beginTotp}>Begin</button>
            {:else}
                <!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted, locally generated SVG -->
                {@html totpQr}
                <p class="text-mono">{totpSecret}</p>
                <label class="field">
                    <span class="text-label">Code</span>
                    <input type="text" inputmode="numeric" bind:value={totpCode} />
                </label>
                <button type="button" onclick={enableTotp}>Enable</button>
            {/if}
            <label class="field">
                <span class="text-label">{t("settings.security.currentPassword")}</span>
                <HiddenInput bind:value={totpDisablePassword} autocomplete="current-password" />
            </label>
            <label class="field">
                <span class="text-label">Code</span>
                <input type="text" inputmode="numeric" bind:value={totpDisableCode} />
            </label>
            <button type="button" onclick={disableTotp}>Disable TOTP</button>

            <h2 class="text-title">Authentication</h2>
            {#if settings.values?.disableAuth === true}
                <button type="button" onclick={enableAuth}>Enable authentication</button>
            {:else}
                <button type="button" onclick={() => (disableAuthConfirm = true)}>Disable authentication</button>
            {/if}

            <button type="button" onclick={() => void logout()}>{t("settings.security.logout")}</button>
            <button type="button" onclick={disconnectOthers}>{t("settings.security.disconnectOthers")}</button>
        </div>
    {:else if section === "globalEnv"}
        <div class="column" data-audit-column>
            <div class="env-editor">
                <CodeEditor
                    value={globalEnvText}
                    oninput={(v) => (globalEnvText = v)}
                    ariaLabel={t("settings.section.globalEnv")}
                />
            </div>
            <button type="button" class="primary" onclick={saveGlobalEnv}>{t("toast.saved")}</button>
        </div>
    {:else if section === "about"}
        <div class="column" data-audit-column>
            <p class="text-body-medium">Version: {settings.info?.version}</p>
            <p class="text-body-medium">Latest: {settings.info?.latestVersion ?? "—"}</p>
            <p class="text-body-medium">Protocol: {settings.info?.protocolVersion}</p>
            <p class="text-body-medium">Container: {settings.info?.isContainer ? "yes" : "no"}</p>
            <p class="text-label">
                Removing the agent key file makes stored host credentials unrecoverable.
            </p>
        </div>
    {/if}
{/snippet}

<ConfirmDialog
    open={disableAuthConfirm}
    title="Disable authentication"
    message="Anyone who can reach this server will have full control, with no login required."
    requirePassword
    bind:password={disableAuthPassword}
    danger
    onconfirm={confirmDisableAuth}
    oncancel={() => (disableAuthConfirm = false)}
/>

<ConfirmDialog
    open={upgradeConfirm}
    title="Upgrade"
    message="Docknight will be unreachable for a few seconds. The browser reconnects on its own."
    onconfirm={startUpgrade}
    oncancel={() => (upgradeConfirm = false)}
/>

<style>
    .page {
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
        padding: var(--space-4);
    }

    @media (width >= 600px) {
        .page {
            padding: var(--space-8);
        }
    }

    .tabs {
        display: flex;
        gap: var(--space-2);
        flex-wrap: wrap;
    }

    .tabs button {
        height: var(--size-control-md);
        padding-inline: var(--space-4);
        border: none;
        border-radius: var(--radius-xl);
        background: var(--m3c-surface-container-high);
        color: var(--m3c-on-surface);
        cursor: pointer;
    }

    .tabs button.active {
        background: var(--m3c-primary);
        color: var(--m3c-on-primary);
    }

    .bar {
        display: flex;
        gap: var(--space-3);
        height: var(--size-control-xl);
    }

    .back {
        color: var(--m3c-on-surface);
        text-decoration: none;
    }

    .index {
        display: flex;
        flex-direction: column;
    }

    .index-row {
        height: var(--size-control-lg);
        padding-inline: var(--space-3);
        border: none;
        border-block-end: 1px solid var(--m3c-outline-variant);
        background: transparent;
        color: var(--m3c-on-surface);
        text-align: start;
        cursor: pointer;
    }

    .content {
        max-width: var(--measure-settings);
    }

    .column {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .row-inline {
        display: flex;
        gap: var(--space-2);
    }

    .field input[type="text"],
    .field select {
        height: var(--size-control-md);
        padding-inline: var(--space-3);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-lowest);
        color: var(--m3c-on-surface);
    }

    .toggle-row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
    }

    .primary {
        align-self: flex-start;
        height: var(--size-control-md);
        padding-inline: var(--space-4);
        border: none;
        border-radius: var(--radius-xl);
        background: var(--m3c-primary);
        color: var(--m3c-on-primary);
        cursor: pointer;
    }

    .env-editor {
        min-height: var(--measure-editor-md);
        display: flex;
        flex-direction: column;
    }

    .upgrade-terminal {
        min-height: var(--measure-editor-sm);
    }
</style>
