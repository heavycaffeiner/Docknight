<script lang="ts">
    import { MediaQuery } from "svelte/reactivity";
    import qrcode from "qrcode";
    import { request } from "../lib/connection.svelte.ts";
    import { theme } from "../lib/stores/theme.svelte.ts";
    import { t, setLocale, listLocales, i18n } from "../lib/stores/i18n.svelte.ts";
    import { session, logout } from "../lib/stores/session.svelte.ts";
    import { settings } from "../lib/stores/settings.svelte.ts";
    import { route, navigate } from "../router.svelte.ts";
    import { toastError, toastResult } from "../lib/stores/toast.svelte.ts";
    import ConfirmDialog from "../components/ConfirmDialog.svelte";
    import HiddenInput from "../components/HiddenInput.svelte";
    import TerminalView from "../components/TerminalView.svelte";

    const isMedium = new MediaQuery("width >= 600px");

    const SECTIONS = ["general", "updates", "appearance", "security"] as const;
    type Section = (typeof SECTIONS)[number];

    const section = $derived<Section>(
        SECTIONS.includes(route.params.section as Section)
            ? (route.params.section as Section)
            : "general",
    );

    let primaryHostname = $state("");
    let trustProxy = $state(false);

    $effect(() => {
        if (settings.values != null) {
            primaryHostname = settings.values.primaryHostname ?? "";
            trustProxy = settings.values.trustProxy ?? false;
        }
    });

    async function saveGeneral(): Promise<void> {
        try {
            await request("", "settings.setGroup", {
                group: "general",
                values: { primaryHostname, trustProxy },
            });
            toastResult(t("settings.saved"));
        } catch (error) {
            toastError(error);
        }
    }

    let checkUpdate = $state(true);
    let checkBeta = $state(false);
    let autoUpgrade = $state(false);
    let upgradeStatus = $state<{ supported: boolean; image?: string; reason?: string; lastError?: string } | null>(null);
    let upgrading = $state(false);
    let upgradeConfirm = $state(false);

    $effect(() => {
        if (settings.values != null) {
            checkUpdate = settings.values.checkUpdate ?? true;
            checkBeta = settings.values.checkBeta ?? false;
            autoUpgrade = settings.values.autoUpgrade ?? false;
        }
    });

    $effect(() => {
        void request("", "upgrade.status", undefined)
            .then((res) => {
                upgradeStatus = res;
            })
            .catch(() => {
                upgradeStatus = null;
            });
    });

    async function saveUpdates(): Promise<void> {
        try {
            await request("", "settings.setGroup", {
                group: "updates",
                values: { checkUpdate, checkBeta, autoUpgrade },
            });
            toastResult(t("settings.saved"));
        } catch (error) {
            toastError(error);
        }
    }

    async function startUpgrade(): Promise<void> {
        upgradeConfirm = false;
        upgrading = true;
        try {
            await request("", "upgrade.start", undefined);
        } catch (error) {
            toastError(error);
            upgrading = false;
        }
    }

    let currentPassword = $state("");
    let newPassword = $state("");
    let changingPassword = $state(false);

    async function changePassword(): Promise<void> {
        changingPassword = true;
        try {
            const result = await request("", "auth.changePassword", {
                currentPassword,
                newPassword,
            });
            currentPassword = "";
            newPassword = "";
            session.token = result.token;
            toastResult(t("settings.saved"));
        } catch (error) {
            toastError(error);
        } finally {
            changingPassword = false;
        }
    }

    let totpQr = $state<string | null>(null);
    let totpSecret = $state<string | null>(null);
    let totpCode = $state("");
    let totpBeginPassword = $state("");
    let totpDisablePassword = $state("");
    let totpDisableCode = $state("");

    async function beginTotp(): Promise<void> {
        try {
            const result = await request("", "auth.totpBegin", {
                password: totpBeginPassword,
            });
            totpSecret = result.secret;
            totpQr = await qrcode.toString(result.uri, { type: "svg", margin: 1 });
            totpBeginPassword = "";
        } catch (error) {
            toastError(error);
        }
    }

    async function enableTotp(): Promise<void> {
        try {
            await request("", "auth.totpEnable", { code: totpCode });
            totpQr = null;
            totpSecret = null;
            totpCode = "";
            toastResult(t("settings.saved"));
        } catch (error) {
            toastError(error);
        }
    }

    async function disableTotp(): Promise<void> {
        try {
            await request("", "auth.totpDisable", {
                password: totpDisablePassword,
                code: totpDisableCode,
            });
            totpDisablePassword = "";
            totpDisableCode = "";
            toastResult(t("settings.saved"));
        } catch (error) {
            toastError(error);
        }
    }

    let disableAuthConfirm = $state(false);
    let disableAuthPassword = $state("");

    async function enableAuth(): Promise<void> {
        try {
            await request("", "auth.disableAuth", { disable: false });
            toastResult(t("settings.saved"));
        } catch (error) {
            toastError(error);
        }
    }

    async function confirmDisableAuth(): Promise<void> {
        try {
            await request("", "auth.disableAuth", {
                disable: true,
                password: disableAuthPassword,
            });
            disableAuthPassword = "";
            disableAuthConfirm = false;
            toastResult(t("settings.saved"));
        } catch (error) {
            toastError(error);
        }
    }

    async function disconnectOthers(): Promise<void> {
        try {
            await request("", "auth.revokeOtherSessions", undefined);
            toastResult(t("settings.saved"));
        } catch (error) {
            toastError(error);
        }
    }

    function goToSection(s: Section): void {
        void navigate(`/settings/${s}`);
    }
</script>

<div class="gcp-settings-page" data-audit-root data-grid-origin>
    {#if isMedium.current}
        <h1 class="text-headline">{t("nav.settings")}</h1>
        <div class="gcp-settings-tabs" data-audit-row="center">
            {#each SECTIONS as s (s)}
                <button
                    type="button"
                    class="gcp-settings-tab"
                    class:active={section === s}
                    onclick={() => goToSection(s)}
                >
                    {t(`settings.section.${s}`)}
                </button>
            {/each}
        </div>
        <div class="gcp-settings-content">
            {@render sectionContent()}
        </div>
    {:else if route.params.section === undefined}
        <h1 class="text-headline">{t("nav.settings")}</h1>
        <div class="gcp-settings-index" data-audit-column>
            {#each SECTIONS as s (s)}
                <button type="button" class="gcp-index-row" onclick={() => goToSection(s)}>
                    {t(`settings.section.${s}`)}
                </button>
            {/each}
        </div>
    {:else}
        <div class="gcp-settings-bar" data-audit-row="center">
            <a
                href="/settings"
                class="gcp-back-btn"
                aria-label={t("action.back")}
                onclick={(e) => {
                    e.preventDefault();
                    void navigate("/settings");
                }}
            >
                ←
            </a>
            <h1 class="text-title gcp-bar-title">{t(`settings.section.${section}`)}</h1>
        </div>
        <div class="gcp-settings-content">
            {@render sectionContent()}
        </div>
    {/if}
</div>

{#snippet sectionContent()}
    {#if section === "general"}
        <div class="gcp-pref-card" data-audit-column data-grid-origin>
            <label class="gcp-field">
                <span class="text-label">{t("settings.general.primaryHostname")}</span>
                <div class="gcp-inline-row" data-audit-row="center">
                    <input type="text" bind:value={primaryHostname} />
                    <button
                        type="button"
                        class="gcp-btn-secondary"
                        onclick={() => (primaryHostname = location.hostname)}
                    >
                        {t("settings.general.useCurrentHost")}
                    </button>
                </div>
            </label>
            <label class="gcp-toggle-row" data-audit-row="center">
                <input type="checkbox" bind:checked={trustProxy} />
                <span class="text-body-medium">{t("settings.general.trustProxy")}</span>
            </label>
            <button type="button" class="gcp-btn-primary" onclick={saveGeneral}>{t("action.save")}</button>
        </div>
    {:else if section === "updates"}
        <div class="gcp-pref-card" data-audit-column data-grid-origin>
            <p class="text-body-medium">
                {settings.info?.version ?? "…"}
                {#if settings.info?.latestVersion !== undefined && settings.info.latestVersion !== settings.info.version}
                    → {settings.info.latestVersion}
                {/if}
            </p>
            <label class="gcp-toggle-row" data-audit-row="center">
                <input type="checkbox" bind:checked={checkUpdate} />
                <span class="text-body-medium">{t("settings.updates.check")}</span>
            </label>
            <label class="gcp-toggle-row" data-audit-row="center">
                <input type="checkbox" bind:checked={checkBeta} />
                <span class="text-body-medium">{t("settings.updates.beta")}</span>
            </label>
            <label class="gcp-toggle-row" data-audit-row="center">
                <input type="checkbox" bind:checked={autoUpgrade} />
                <span class="text-body-medium">{t("settings.updates.auto")}</span>
            </label>
            <button type="button" class="gcp-btn-primary" onclick={saveUpdates}>{t("action.save")}</button>
            {#if upgradeStatus !== null}
                {#if upgradeStatus.supported}
                    <p class="text-body-medium">
                        {t("settings.updates.image", { image: upgradeStatus.image ?? "unknown" })}
                    </p>
                    <button
                        type="button"
                        class="gcp-btn-secondary"
                        disabled={upgrading}
                        onclick={() => (upgradeConfirm = true)}
                    >
                        {t("settings.updates.upgrade")}
                    </button>
                    {#if upgradeStatus.lastError !== undefined}
                        <p class="gcp-error text-label">{t("settings.updates.lastErrorFailed")}</p>
                    {/if}
                {:else}
                    <p class="text-body-medium">
                        {t(`settings.updates.reason.${upgradeStatus.reason ?? "unsupported"}`)}
                    </p>
                {/if}
            {/if}
            {#if upgrading}
                <div class="gcp-upgrade-terminal">
                    <TerminalView endpoint="" terminal="upgrade" interactive={false} rows={20} />
                </div>
            {/if}
        </div>
    {:else if section === "appearance"}
        <div class="gcp-pref-card" data-audit-column data-grid-origin>
            <label class="gcp-field">
                <span class="text-label">{t("settings.appearance.theme")}</span>
                <select bind:value={theme.preference}>
                    <option value="light">{t("theme.light")}</option>
                    <option value="dark">{t("theme.dark")}</option>
                    <option value="system">{t("theme.system")}</option>
                </select>
            </label>
            <label class="gcp-field">
                <span class="text-label">{t("settings.appearance.language")}</span>
                <select value={i18n.locale} onchange={(e) => void setLocale(e.currentTarget.value)}>
                    {#each listLocales() as locale (locale.tag)}
                        <option value={locale.tag}>{locale.name}</option>
                    {/each}
                </select>
            </label>
        </div>
    {:else if section === "security"}
        <div class="gcp-pref-card" data-audit-column data-grid-origin>
            <h2 class="text-title">{t("settings.security.changePassword")}</h2>
            <label class="gcp-field">
                <span class="text-label">{t("settings.security.currentPassword")}</span>
                <HiddenInput bind:value={currentPassword} autocomplete="current-password" />
            </label>
            <label class="gcp-field">
                <span class="text-label">{t("settings.security.newPassword")}</span>
                <HiddenInput bind:value={newPassword} autocomplete="new-password" />
            </label>
            <button type="button" class="gcp-btn-primary" disabled={changingPassword} onclick={changePassword}>
                {t("settings.security.changePassword")}
            </button>

            <h2 class="text-title">{t("settings.security.totp")}</h2>
            {#if totpQr === null}
                <label class="gcp-field">
                    <span class="text-label">{t("settings.security.currentPassword")}</span>
                    <HiddenInput bind:value={totpBeginPassword} autocomplete="current-password" />
                </label>
                <button type="button" class="gcp-btn-secondary" onclick={beginTotp}>
                    {t("settings.security.totpBegin")}
                </button>
            {:else}
                <!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted, locally generated SVG -->
                {@html totpQr}
                <p class="text-mono">{totpSecret}</p>
                <label class="gcp-field">
                    <span class="text-label">{t("settings.security.totpCode")}</span>
                    <input type="text" inputmode="numeric" bind:value={totpCode} />
                </label>
                <button type="button" class="gcp-btn-secondary" onclick={enableTotp}>
                    {t("settings.security.totpEnable")}
                </button>
            {/if}
            <label class="gcp-field">
                <span class="text-label">{t("settings.security.currentPassword")}</span>
                <HiddenInput bind:value={totpDisablePassword} autocomplete="current-password" />
            </label>
            <label class="gcp-field">
                <span class="text-label">{t("settings.security.totpCode")}</span>
                <input type="text" inputmode="numeric" bind:value={totpDisableCode} />
            </label>
            <button type="button" class="gcp-btn-secondary" onclick={disableTotp}>
                {t("settings.security.totpDisable")}
            </button>

            <h2 class="text-title">{t("settings.security.authentication")}</h2>
            {#if settings.values?.disableAuth === true}
                <button type="button" class="gcp-btn-secondary" onclick={enableAuth}>
                    {t("settings.security.enableAuth")}
                </button>
            {:else}
                <button type="button" class="gcp-btn-secondary" onclick={() => (disableAuthConfirm = true)}>
                    {t("settings.security.disableAuth")}
                </button>
            {/if}

            <button type="button" class="gcp-btn-secondary" onclick={() => void logout()}>
                {t("settings.security.logout")}
            </button>
            <button type="button" class="gcp-btn-secondary" onclick={disconnectOthers}>
                {t("settings.security.disconnectOthers")}
            </button>
        </div>
    {/if}
{/snippet}

<ConfirmDialog
    open={disableAuthConfirm}
    title={t("settings.security.disableAuth")}
    message={t("settings.security.disableAuthMessage")}
    requirePassword
    bind:password={disableAuthPassword}
    danger
    onconfirm={confirmDisableAuth}
    oncancel={() => {
        disableAuthConfirm = false;
        disableAuthPassword = "";
    }}
/>

<ConfirmDialog
    open={upgradeConfirm}
    title={t("settings.updates.upgradeTitle")}
    message={t("settings.updates.upgradeMessage")}
    onconfirm={startUpgrade}
    oncancel={() => (upgradeConfirm = false)}
/>

<style>
    .gcp-settings-page {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        padding: var(--space-4);
    }

    .gcp-settings-tabs {
        display: flex;
        gap: var(--space-2);
        flex-wrap: wrap;
    }

    .gcp-settings-tab {
        height: var(--size-control-md);
        padding-inline: var(--space-3);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-high);
        color: var(--m3c-on-surface);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
    }

    .gcp-settings-tab:hover {
        background: var(--m3c-surface-container-highest);
    }

    .gcp-settings-tab.active {
        border-color: transparent;
        background: var(--m3c-primary);
        color: var(--m3c-on-primary);
        font-weight: 600;
    }

    .gcp-settings-bar {
        align-items: center;
        gap: var(--space-3);
        height: var(--size-control-xl);
    }

    .gcp-bar-title {
        min-width: 0;
        overflow-wrap: anywhere;
    }

    .gcp-back-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: var(--size-control-lg);
        height: var(--size-control-lg);
        color: var(--m3c-on-surface);
        text-decoration: none;
        flex-shrink: 0;
    }

    .gcp-settings-index {
        display: flex;
        flex-direction: column;
    }

    .gcp-index-row {
        height: var(--size-control-lg);
        padding-inline: var(--space-3);
        border: none;
        border-block-end: 1px solid var(--m3c-outline-variant);
        background: transparent;
        color: var(--m3c-on-surface);
        text-align: start;
        cursor: pointer;
    }

    .gcp-settings-content {
        min-width: 0;
        max-width: var(--measure-settings);
    }

    .gcp-pref-card {
        display: flex;
        flex-direction: column;
        min-width: 0;
        gap: var(--space-3);
        padding: var(--space-4);
        border-radius: var(--radius-md);
        box-shadow: inset 0 0 0 1px var(--m3c-outline-variant);
        background: var(--m3c-surface-container-low);
    }

    .gcp-pref-card h2 {
        min-width: 0;
        overflow-wrap: anywhere;
    }

    .gcp-field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .gcp-inline-row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
    }

    .gcp-field input[type="text"],
    .gcp-field select {
        height: var(--size-control-md);
        padding-inline: var(--space-3);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-lowest);
        color: var(--m3c-on-surface);
    }

    .gcp-toggle-row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        min-height: var(--size-control-lg);
        cursor: pointer;
    }

    .gcp-btn-primary {
        align-self: flex-start;
        max-width: 100%;
        height: var(--size-control-md);
        padding-inline: var(--space-4);
        border: none;
        border-radius: var(--radius-xs);
        background: var(--m3c-primary);
        color: var(--m3c-on-primary);
        cursor: pointer;
        font-weight: 600;
        font-size: 13px;
        overflow-wrap: anywhere;
    }

    .gcp-btn-primary:hover {
        background: var(--m3c-primary-dim);
    }

    .gcp-btn-secondary {
        align-self: flex-start;
        max-width: 100%;
        height: var(--size-control-md);
        padding-inline: var(--space-4);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: transparent;
        color: var(--m3c-on-surface);
        cursor: pointer;
        font-weight: 500;
        font-size: 13px;
        overflow-wrap: anywhere;
    }

    .gcp-btn-secondary:hover {
        background: var(--m3c-surface-container-highest);
    }

    .gcp-error {
        color: var(--m3c-error);
    }

    .gcp-upgrade-terminal {
        display: flex;
        flex-direction: column;
    }
</style>
