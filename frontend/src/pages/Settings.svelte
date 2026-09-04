<script lang="ts">
    import { MediaQuery } from "svelte/reactivity";
    import { onMount } from "svelte";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { theme, type ThemePreference } from "../lib/stores/theme.svelte.ts";
    import { i18n, setLocale, getAvailableLocales } from "../lib/stores/i18n.svelte.ts";
    import { settings, loadSettings, saveSettings } from "../lib/stores/settings.svelte.ts";
    import { session, logout } from "../lib/stores/session.svelte.ts";
    import { toastError, toastResult } from "../lib/stores/toast.svelte.ts";
    import { route, navigate } from "../router.svelte.ts";
    import { request } from "../lib/connection.svelte.ts";
    import ConfirmDialog from "../components/ConfirmDialog.svelte";
    import HiddenInput from "../components/HiddenInput.svelte";
    import CodeEditor from "../components/CodeEditor.svelte";
    import TerminalView from "../components/TerminalView.svelte";

    const isMedium = new MediaQuery("width >= 600px");

    type SectionName = "general" | "updates" | "appearance" | "security" | "globalEnv" | "about";
    const SECTIONS: SectionName[] = ["general", "updates", "appearance", "security", "globalEnv", "about"];

    const activeSection = $derived<SectionName>(
        (route.params.section as SectionName) || "general",
    );

    let locales = $state<Array<{ tag: string; name: string }>>([]);

    // General state
    let primaryHostname = $state("");
    let trustProxy = $state(false);

    // Updates state
    let checkUpdate = $state(true);
    let checkBeta = $state(false);
    let autoUpgrade = $state(false);
    let upgradeConfirm = $state(false);
    let upgrading = $state(false);
    let upgradeStatus = $state<{ supported: boolean; image?: string; reason?: string; lastError?: string } | null>(null);

    // Security state
    let currentPassword = $state("");
    let newPassword = $state("");
    let repeatPassword = $state("");
    let changingPassword = $state(false);

    let disableAuthDialog = $state(false);
    let disableAuthPassword = $state("");
    let disablingAuth = $state(false);

    let totpSetupOpen = $state(false);
    let totpSecret = $state("");
    let totpVerifyCode = $state("");

    let totpDisableOpen = $state(false);
    let totpDisablePassword = $state("");
    let totpDisableCode = $state("");

    // Global ENV state
    let globalEnvText = $state("");
    let savingEnv = $state(false);

    $effect(() => {
        if (settings.values !== null) {
            primaryHostname = settings.values.primaryHostname ?? "";
            trustProxy = settings.values.trustProxy ?? false;
            checkUpdate = settings.values.checkUpdate ?? true;
            checkBeta = settings.values.checkBeta ?? false;
            autoUpgrade = settings.values.autoUpgrade ?? false;
            globalEnvText = settings.values.globalENV ?? "";
        }
    });

    onMount(() => {
        void loadSettings();
        void getAvailableLocales().then((list) => {
            locales = list;
        });
        void request<{ supported: boolean; image?: string; reason?: string }>("", "upgrade.status", undefined)
            .then((res) => {
                upgradeStatus = res;
            })
            .catch(() => {});
    });

    async function saveGeneral(): Promise<void> {
        try {
            await saveSettings({ primaryHostname, trustProxy });
            toastResult(t("toast.saved"));
        } catch (err) {
            toastError(err);
        }
    }

    async function saveUpdates(): Promise<void> {
        try {
            await saveSettings({ checkUpdate, checkBeta, autoUpgrade });
            toastResult(t("toast.saved"));
        } catch (err) {
            toastError(err);
        }
    }

    async function saveGlobalEnv(): Promise<void> {
        savingEnv = true;
        try {
            await saveSettings({ globalENV: globalEnvText });
            toastResult(t("toast.saved"));
        } catch (err) {
            toastError(err);
        } finally {
            savingEnv = false;
        }
    }

    async function startUpgrade(): Promise<void> {
        upgradeConfirm = false;
        upgrading = true;
        try {
            await request("", "upgrade.start", undefined);
        } catch (err) {
            toastError(err);
        }
    }

    async function handleChangePassword(e: SubmitEvent): Promise<void> {
        e.preventDefault();
        if (newPassword !== repeatPassword) {
            toastError(t("auth.setup.passwordMismatch"));
            return;
        }
        changingPassword = true;
        try {
            await request("", "auth.changePassword", {
                currentPassword,
                newPassword,
            });
            currentPassword = "";
            newPassword = "";
            repeatPassword = "";
            toastResult(t("toast.saved"));
        } catch (err) {
            toastError(err);
        } finally {
            changingPassword = false;
        }
    }

    async function confirmDisableAuth(): Promise<void> {
        disablingAuth = true;
        try {
            await request("", "auth.disableAuth", { password: disableAuthPassword });
            disableAuthDialog = false;
            disableAuthPassword = "";
            toastResult(t("settings.saved"));
            location.reload();
        } catch (err) {
            toastError(err);
        } finally {
            disablingAuth = false;
        }
    }

    async function beginTotp(): Promise<void> {
        try {
            const res = await request<{ secret?: string }>("", "auth.totpBegin", undefined);
            totpSecret = res.secret ?? "";
            totpSetupOpen = true;
        } catch (err) {
            toastError(err);
        }
    }

    async function confirmEnableTotp(): Promise<void> {
        try {
            await request("", "auth.totpEnable", { code: totpVerifyCode });
            totpSetupOpen = false;
            totpVerifyCode = "";
            toastResult(t("settings.saved"));
            void loadSettings();
        } catch (err) {
            toastError(err);
        }
    }

    async function confirmDisableTotp(): Promise<void> {
        try {
            await request("", "auth.totpDisable", {
                password: totpDisablePassword,
                code: totpDisableCode,
            });
            totpDisableOpen = false;
            totpDisablePassword = "";
            totpDisableCode = "";
            toastResult(t("settings.saved"));
            void loadSettings();
        } catch (err) {
            toastError(err);
        }
    }

    async function disconnectOthers(): Promise<void> {
        try {
            await request("", "auth.revokeOtherSessions", undefined);
            toastResult(t("settings.saved"));
        } catch (err) {
            toastError(err);
        }
    }

    function goToSection(s: SectionName): void {
        void navigate(`/settings/${s}`);
    }
</script>

<div class="gcp-settings-page" data-audit-root data-grid-origin>
    <div class="gcp-settings-header" data-audit-row="center">
        {#if !isMedium.current && route.params.section}
            <a
                href="/settings/general"
                class="gcp-back-btn text-label"
                aria-label={t("action.back")}
                onclick={(e) => {
                    e.preventDefault();
                    void navigate("/settings/general");
                }}
            >
                ←
            </a>
        {/if}
        <h1 class="text-headline">{t("nav.settings")}</h1>
    </div>

    {#if isMedium.current}
        <div class="gcp-settings-tabs" data-audit-row="center">
            {#each SECTIONS as s (s)}
                <button
                    type="button"
                    class="gcp-tab-btn text-label"
                    class:active={activeSection === s}
                    onclick={() => goToSection(s)}
                >
                    {t(`settings.section.${s}`)}
                </button>
            {/each}
        </div>
    {:else if !route.params.section}
        <div class="gcp-settings-index" data-audit-column>
            {#each SECTIONS as s (s)}
                <button
                    type="button"
                    class="gcp-index-row"
                    data-audit-row="center"
                    onclick={() => goToSection(s)}
                >
                    <span class="text-body-medium">{t(`settings.section.${s}`)}</span>
                    <svg
                        class="gcp-chevron"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                        data-audit-opaque
                    >
                        <polyline points="9 18 15 12 9 6" />
                    </svg>
                </button>
            {/each}
        </div>
    {/if}

    {#if isMedium.current || route.params.section !== undefined}
        <div class="gcp-settings-content" data-audit-column>
            {#if activeSection === "general"}
                <section class="gcp-settings-section" data-grid-origin data-audit-column>
                    <div class="gcp-field" data-audit-column>
                        <label for="set-hostname" class="text-label gcp-field-label" data-audit-heading>{t("settings.general.primaryHostname")}</label>
                        <div class="gcp-field-inline" data-audit-row="center">
                            <input
                                id="set-hostname"
                                type="text"
                                class="gcp-input"
                                bind:value={primaryHostname}
                                onchange={saveGeneral}
                            />
                            <button
                                type="button"
                                class="gcp-btn-secondary"
                                onclick={() => {
                                    primaryHostname = location.hostname;
                                    void saveGeneral();
                                }}
                            >
                                {t("settings.general.useCurrentHost")}
                            </button>
                        </div>
                    </div>

                    <div class="gcp-field" data-audit-column>
                        <label class="gcp-toggle-row" data-audit-row="center">
                            <input
                                type="checkbox"
                                class="gcp-checkbox"
                                bind:checked={trustProxy}
                                onchange={saveGeneral}
                            />
                            <span class="text-body-medium">{t("settings.general.trustProxy")}</span>
                        </label>
                    </div>
                </section>
            {:else if activeSection === "updates"}
                <section class="gcp-settings-section" data-grid-origin data-audit-column>
                    <div class="gcp-info-group" data-audit-column>
                        <div class="gcp-info-row" data-audit-row="center">
                            <span class="text-label gcp-info-label">{t("settings.about.version")}</span>
                            <span class="text-body-medium text-mono">{settings.values?.version ?? "-"}</span>
                        </div>
                        <div class="gcp-info-row" data-audit-row="center">
                            <span class="text-label gcp-info-label">{t("settings.about.latest")}</span>
                            <span class="text-body-medium text-mono">{settings.values?.latestVersion ?? "-"}</span>
                        </div>
                    </div>

                    <div class="gcp-field" data-audit-column>
                        <label class="gcp-toggle-row" data-audit-row="center">
                            <input
                                type="checkbox"
                                class="gcp-checkbox"
                                bind:checked={checkUpdate}
                                onchange={saveUpdates}
                            />
                            <span class="text-body-medium">{t("settings.updates.check")}</span>
                        </label>
                    </div>

                    <div class="gcp-field" data-audit-column>
                        <label class="gcp-toggle-row" data-audit-row="center">
                            <input
                                type="checkbox"
                                class="gcp-checkbox"
                                bind:checked={checkBeta}
                                onchange={saveUpdates}
                            />
                            <span class="text-body-medium">{t("settings.updates.beta")}</span>
                        </label>
                    </div>

                    <div class="gcp-field" data-audit-column>
                        <label class="gcp-toggle-row" data-audit-row="center">
                            <input
                                type="checkbox"
                                class="gcp-checkbox"
                                bind:checked={autoUpgrade}
                                onchange={saveUpdates}
                            />
                            <span class="text-body-medium">{t("settings.updates.auto")}</span>
                        </label>
                    </div>

                    {#if upgradeStatus !== null}
                        <div class="gcp-upgrade-box" data-audit-column>
                            {#if upgradeStatus.supported}
                                <button
                                    type="button"
                                    class="gcp-btn-primary"
                                    onclick={() => (upgradeConfirm = true)}
                                >
                                    {t("settings.updates.upgrade")}
                                </button>
                            {:else}
                                <span class="text-label gcp-unsupported-reason">
                                    {upgradeStatus.reason ? t(`settings.updates.reason.${upgradeStatus.reason}`) : t("settings.updates.reason.unsupported")}
                                </span>
                            {/if}
                        </div>
                    {/if}

                    {#if upgrading}
                        <div class="gcp-upgrade-terminal" data-audit-column>
                            <TerminalView terminal="upgrade" interactive={false} rows={16} />
                        </div>
                    {/if}
                </section>
            {:else if activeSection === "appearance"}
                <section class="gcp-settings-section" data-grid-origin data-audit-column>
                    <div class="gcp-field" data-audit-column>
                        <label for="app-lang" class="text-label gcp-field-label" data-audit-heading>{t("settings.appearance.language")}</label>
                        <select
                            id="app-lang"
                            class="gcp-select"
                            value={i18n.locale}
                            onchange={(e) => void setLocale(e.currentTarget.value)}
                        >
                            {#each locales as loc (loc.tag)}
                                <option value={loc.tag}>{loc.name}</option>
                            {/each}
                        </select>
                    </div>

                    <div class="gcp-field" data-audit-column>
                        <span class="text-label gcp-field-label" data-audit-heading>{t("settings.appearance.theme")}</span>
                        <select
                            class="gcp-select"
                            value={theme.preference}
                            onchange={(e) => (theme.preference = e.currentTarget.value as ThemePreference)}
                        >
                            <option value="system">{t("theme.system")}</option>
                            <option value="light">{t("theme.light")}</option>
                            <option value="dark">{t("theme.dark")}</option>
                        </select>
                    </div>
                </section>
            {:else if activeSection === "security"}
                <section class="gcp-settings-section" data-grid-origin data-audit-column>
                    <div class="gcp-info-row" data-audit-row="center">
                        <span class="text-label gcp-info-label">{t("auth.login.username")}</span>
                        <span class="text-body-medium">{session.username ?? "-"}</span>
                    </div>

                    <!-- Change password form -->
                    <form class="gcp-security-form" onsubmit={handleChangePassword} data-audit-column>
                        <h2 class="text-title">{t("settings.security.changePassword")}</h2>
                        <div class="gcp-field" data-audit-column>
                            <label for="sec-current-pw" class="text-label gcp-field-label" data-audit-heading>{t("settings.security.currentPassword")}</label>
                            <HiddenInput id="sec-current-pw" bind:value={currentPassword} />
                        </div>
                        <div class="gcp-field" data-audit-column>
                            <label for="sec-new-pw" class="text-label gcp-field-label" data-audit-heading>{t("settings.security.newPassword")}</label>
                            <HiddenInput id="sec-new-pw" bind:value={newPassword} />
                        </div>
                        <div class="gcp-field" data-audit-column>
                            <label for="sec-repeat-pw" class="text-label gcp-field-label" data-audit-heading>{t("auth.setup.repeat")}</label>
                            <HiddenInput id="sec-repeat-pw" bind:value={repeatPassword} />
                        </div>
                        <div class="gcp-form-actions" data-audit-row="center">
                            <button
                                type="submit"
                                class="gcp-btn-primary"
                                disabled={changingPassword || currentPassword === "" || newPassword === "" || repeatPassword === ""}
                            >
                                {t("action.save")}
                            </button>
                        </div>
                    </form>

                    <!-- TOTP section -->
                    <div class="gcp-totp-group" data-audit-column>
                        <h2 class="text-title">{t("settings.security.totp")}</h2>
                        <div class="gcp-field-inline" data-audit-row="center">
                            <button type="button" class="gcp-btn-secondary" onclick={beginTotp}>
                                {t("settings.security.totpBegin")}
                            </button>
                            <button type="button" class="gcp-btn-secondary danger" onclick={() => (totpDisableOpen = true)}>
                                {t("settings.security.totpDisable")}
                            </button>
                        </div>
                    </div>

                    <!-- Disable auth section -->
                    <div class="gcp-auth-toggle-group" data-audit-column>
                        <h2 class="text-title">{t("settings.security.authentication")}</h2>
                        <button
                            type="button"
                            class="gcp-btn-secondary danger"
                            onclick={() => (disableAuthDialog = true)}
                        >
                            {t("settings.security.disableAuth")}
                        </button>
                    </div>

                    <!-- Session controls -->
                    <div class="gcp-session-actions" data-audit-row="center">
                        <button type="button" class="gcp-btn-secondary" onclick={disconnectOthers}>
                            {t("settings.security.disconnectOthers")}
                        </button>
                        <button
                            type="button"
                            class="gcp-btn-secondary danger"
                            onclick={() => void logout().then(() => void navigate("/"))}
                        >
                            {t("settings.security.logout")}
                        </button>
                    </div>
                </section>
            {:else if activeSection === "globalEnv"}
                <section class="gcp-settings-section" data-grid-origin data-audit-column>
                    <div class="gcp-env-editor-wrapper" data-audit-column>
                        <CodeEditor
                            value={globalEnvText}
                            oninput={(v) => (globalEnvText = v)}
                            ariaLabel={t("settings.section.globalEnv")}
                        />
                    </div>
                    <div class="gcp-form-actions" data-audit-row="center">
                        <button
                            type="button"
                            class="gcp-btn-primary"
                            disabled={savingEnv}
                            onclick={saveGlobalEnv}
                        >
                            {t("action.save")}
                        </button>
                    </div>
                </section>
            {:else if activeSection === "about"}
                <section class="gcp-settings-section" data-grid-origin data-audit-column>
                    <div class="gcp-info-group" data-audit-column>
                        <div class="gcp-info-row" data-audit-row="center">
                            <span class="text-label gcp-info-label">{t("settings.about.version")}</span>
                            <span class="text-body-medium text-mono">{settings.values?.version ?? "-"}</span>
                        </div>
                        <div class="gcp-info-row" data-audit-row="center">
                            <span class="text-label gcp-info-label">{t("settings.about.latest")}</span>
                            <span class="text-body-medium text-mono">{settings.values?.latestVersion ?? "-"}</span>
                        </div>
                        <div class="gcp-info-row" data-audit-row="center">
                            <span class="text-label gcp-info-label">{t("settings.about.protocol")}</span>
                            <span class="text-body-medium text-mono">{settings.values?.protocolVersion ?? 1}</span>
                        </div>
                        <div class="gcp-info-row" data-audit-row="center">
                            <span class="text-label gcp-info-label">{t("settings.about.container")}</span>
                            <span class="text-body-medium">{settings.values?.isContainer ? "Yes" : "No"}</span>
                        </div>
                    </div>
                    <div class="gcp-warning-box text-body-medium" data-audit-column>
                        {t("settings.about.agentKeyWarning")}
                    </div>
                </section>
            {/if}
        </div>
    {/if}
</div>

<!-- Upgrade dialog -->
<ConfirmDialog
    open={upgradeConfirm}
    title={t("settings.updates.upgradeTitle")}
    message={t("settings.updates.upgradeMessage")}
    onconfirm={startUpgrade}
    oncancel={() => (upgradeConfirm = false)}
/>

<!-- Disable auth dialog -->
<ConfirmDialog
    open={disableAuthDialog}
    title={t("settings.security.disableAuth")}
    message={t("settings.security.disableAuthMessage")}
    danger
    onconfirm={confirmDisableAuth}
    oncancel={() => (disableAuthDialog = false)}
>
    <div class="gcp-field" data-audit-column>
        <label for="dis-auth-pw" class="text-label">{t("auth.login.password")}</label>
        <HiddenInput id="dis-auth-pw" bind:value={disableAuthPassword} disabled={disablingAuth} />
    </div>
</ConfirmDialog>

<!-- TOTP Setup Dialog -->
<ConfirmDialog
    open={totpSetupOpen}
    title={t("settings.security.totp")}
    confirmLabel={t("settings.security.totpEnable")}
    onconfirm={confirmEnableTotp}
    oncancel={() => (totpSetupOpen = false)}
>
    <div class="gcp-field" data-audit-column>
        <span class="text-label">{t("settings.security.totpBegin")}</span>
        <span class="text-mono gcp-totp-secret">{totpSecret}</span>
        <label for="totp-v-code" class="text-label">{t("settings.security.totpCode")}</label>
        <input
            id="totp-v-code"
            type="text"
            inputmode="numeric"
            class="gcp-input text-mono"
            bind:value={totpVerifyCode}
        />
    </div>
</ConfirmDialog>

<!-- TOTP Disable Dialog -->
<ConfirmDialog
    open={totpDisableOpen}
    title={t("settings.security.totpDisable")}
    danger
    onconfirm={confirmDisableTotp}
    oncancel={() => (totpDisableOpen = false)}
>
    <div class="gcp-field" data-audit-column>
        <label for="totp-d-pw" class="text-label">{t("auth.login.password")}</label>
        <HiddenInput id="totp-d-pw" bind:value={totpDisablePassword} />
        <label for="totp-d-code" class="text-label">{t("settings.security.totpCode")}</label>
        <input
            id="totp-d-code"
            type="text"
            inputmode="numeric"
            class="gcp-input text-mono"
            bind:value={totpDisableCode}
        />
    </div>
</ConfirmDialog>

<style>
    .gcp-settings-page {
        display: flex;
        flex-direction: column;
        padding: var(--space-6);
        gap: var(--space-6);
        max-width: var(--measure-settings);
        min-width: 0;
        width: 100%;
    }

    @media (width < 600px) {
        .gcp-settings-page {
            padding: var(--space-4);
            gap: var(--space-4);
        }
    }

    .gcp-settings-header {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        min-height: var(--size-control-md);
    }

    .gcp-back-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--size-control-md);
        height: var(--size-control-md);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-high);
        color: var(--m3c-on-surface);
        text-decoration: none;
    }

    .gcp-settings-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
        box-shadow: inset 0 -1px 0 0 var(--m3c-outline-variant);
        border: none;
        width: 100%;
    }

    .gcp-tab-btn {
        display: inline-flex;
        align-items: center;
        block-size: var(--size-control-md);
        padding-block: 0;
        padding-inline: var(--space-4);
        border: none;
        background: transparent;
        color: var(--m3c-on-surface-variant);
        font-weight: 500;
        cursor: pointer;
        border-block-end: 2px solid transparent;
    }

    .gcp-tab-btn:hover {
        background: var(--m3c-surface-container-high);
    }

    .gcp-tab-btn.active {
        color: var(--m3c-primary);
        border-block-end-color: var(--m3c-primary);
        font-weight: 600;
    }

    .gcp-settings-index {
        display: flex;
        flex-direction: column;
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-sm);
        background: var(--m3c-surface-container-low);
        overflow: hidden;
    }

    .gcp-index-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: var(--size-control-lg);
        padding-inline: var(--space-4);
        border: none;
        border-block-end: 1px solid var(--m3c-outline-variant);
        background: transparent;
        color: var(--m3c-on-surface);
        cursor: pointer;
        text-align: start;
    }

    .gcp-index-row:last-child {
        border-block-end: none;
    }

    .gcp-index-row:hover {
        background: var(--m3c-surface-container-high);
    }

    .gcp-chevron {
        height: var(--size-icon-sm);
        color: var(--m3c-on-surface-variant);
    }

    .gcp-settings-content {
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
    }

    .gcp-settings-section {
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
        border: none;
        box-shadow: inset 0 0 0 1px var(--m3c-outline-variant);
        border-radius: var(--radius-sm);
        background: var(--m3c-surface-container-low);
        padding: var(--space-6);
    }

    .gcp-field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .gcp-field-label {
        color: var(--m3c-on-surface-variant);
        font-weight: 500;
    }

    .gcp-field-inline {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
    }

    .gcp-input,
    .gcp-select {
        flex: 1;
        block-size: var(--size-control-md);
        padding-block: 0;
        padding-inline: var(--space-3);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-lowest);
        color: var(--m3c-on-surface);
        font-family: inherit;
    }

    .gcp-toggle-row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        min-block-size: var(--size-control-md);
        cursor: pointer;
        user-select: none;
    }

    .gcp-checkbox {
        width: var(--size-icon-sm);
        height: var(--size-icon-sm);
        accent-color: var(--m3c-primary);
    }

    .gcp-info-group {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        padding: var(--space-4);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container);
    }

    .gcp-info-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .gcp-info-label {
        color: var(--m3c-on-surface-variant);
        font-weight: 500;
    }

    .gcp-btn-primary {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        block-size: var(--size-control-md);
        padding-block: 0;
        padding-inline: var(--space-4);
        border-radius: var(--radius-xs);
        border: none;
        background: var(--m3c-primary);
        color: var(--m3c-on-primary);
        font-weight: 500;
        font-size: 13px;
        cursor: pointer;
    }

    .gcp-btn-primary:hover {
        background: var(--m3c-primary-dim);
    }

    .gcp-btn-secondary {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        block-size: var(--size-control-md);
        padding-block: 0;
        padding-inline: var(--space-3);
        border-radius: var(--radius-xs);
        border: 1px solid var(--m3c-outline-variant);
        background: var(--m3c-surface-container-high);
        color: var(--m3c-on-surface);
        font-size: 13px;
        cursor: pointer;
    }

    .gcp-btn-secondary:hover {
        background: var(--m3c-surface-container-highest);
    }

    .gcp-btn-secondary.danger {
        color: var(--m3c-error);
    }

    .gcp-security-form {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        padding-block-start: var(--space-4);
        border: none;
        box-shadow: inset 0 1px 0 0 var(--m3c-outline-variant);
    }

    .gcp-totp-group,
    .gcp-auth-toggle-group {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        padding-block-start: var(--space-4);
        border: none;
        box-shadow: inset 0 1px 0 0 var(--m3c-outline-variant);
    }

    .gcp-session-actions {
        display: flex;
        justify-content: space-between;
        padding-block-start: var(--space-4);
        border: none;
        box-shadow: inset 0 1px 0 0 var(--m3c-outline-variant);
    }

    .gcp-env-editor-wrapper {
        block-size: var(--measure-editor-lg);
        display: flex;
        flex-direction: column;
    }

    .gcp-warning-box {
        padding: var(--space-4);
        border-radius: var(--radius-xs);
        background: var(--m3c-error-container);
        color: var(--m3c-on-error-container);
    }

    .gcp-totp-secret {
        padding: var(--space-2);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-highest);
        user-select: all;
    }
</style>
