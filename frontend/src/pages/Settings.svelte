<script lang="ts">
    import { Button, Switch, TextFieldOutlined } from "m3-svelte";
    import QRCode from "qrcode";
    import { PROTOCOL_VERSION, type MethodMap } from "$common/protocol.ts";
    import CodeEditor from "../components/CodeEditor.svelte";
    import ConfirmDialog from "../components/ConfirmDialog.svelte";
    import Loading from "../components/Loading.svelte";
    import TerminalView from "../components/TerminalView.svelte";
    import { request } from "../lib/connection.svelte.ts";
    import { i18n, languageName, loadLanguageNames, locales, setLocale, t } from "../lib/stores/i18n.svelte.ts";
    import { changePassword, logout, session } from "../lib/stores/session.svelte.ts";
    import { loadSettings, saveSettings, serverInfo, settings } from "../lib/stores/settings.svelte.ts";
    import { setPreference, theme, type ThemePreference } from "../lib/stores/theme.svelte.ts";
    import { toastError, toastResult } from "../lib/stores/toast.svelte.ts";
    import { navigate, route } from "../router.svelte.ts";

    const SECTIONS = ["general", "updates", "appearance", "security", "globalenv", "about"] as const;
    type Section = (typeof SECTIONS)[number];

    const section = $derived.by<Section>(() => {
        const candidate = route.params.section ?? "general";
        return (SECTIONS as readonly string[]).includes(candidate) ? (candidate as Section) : "general";
    });

    const SECTION_KEYS: Record<Section, string> = {
        general: "settingsGeneral",
        updates: "settingsUpdates",
        appearance: "settingsAppearance",
        security: "settingsSecurity",
        globalenv: "settingsGlobalEnv",
        about: "settingsAbout",
    };

    type UpgradeStatus = MethodMap["upgrade.status"]["result"];

    let primaryHostname = $state("");
    let checkUpdate = $state(true);
    let checkBeta = $state(false);
    let trustProxy = $state(false);
    let autoUpgrade = $state(false);
    let globalEnv = $state("");
    let loaded = $state(false);

    let upgrade = $state<UpgradeStatus | null>(null);
    let upgradeDialog = $state(false);
    /** Set once the upgrade has been started here, so the terminal stays mounted after it ends. */
    let upgradeTerminal = $state<string | null>(null);

    let currentPassword = $state("");
    let newPassword = $state("");
    let repeatPassword = $state("");

    let totpSecret = $state<string | null>(null);
    let totpUri = $state<string | null>(null);
    let totpQr = $state<string | null>(null);
    let totpCode = $state("");
    let totpEnabled = $state(false);
    let totpPassword = $state("");

    let disableAuthDialog = $state(false);

    $effect(() => {
        if (settings.value === null) {
            void loadSettings().catch((error: unknown) => toastError(error));
            return;
        }
        if (loaded) return;
        primaryHostname = settings.value.primaryHostname;
        checkUpdate = settings.value.checkUpdate;
        checkBeta = settings.value.checkBeta;
        trustProxy = settings.value.trustProxy;
        autoUpgrade = settings.value.autoUpgrade;
        globalEnv = settings.value.globalENV;
        totpEnabled = settings.value.totpEnabled;
        loaded = true;
    });

    $effect(() => {
        void loadLanguageNames();
    });

    $effect(() => {
        if (section !== "updates") return;
        void refreshUpgrade();
    });

    async function refreshUpgrade(): Promise<void> {
        try {
            const status = await request("", "upgrade.status", undefined);
            upgrade = status;
            if (status.running) upgradeTerminal = status.terminal;
        } catch (error) {
            toastError(error);
        }
    }

    async function saveGeneral(): Promise<void> {
        try {
            await saveSettings({ primaryHostname, checkUpdate, checkBeta, trustProxy, autoUpgrade });
            toastResult("settingsSaved");
        } catch (error) {
            toastError(error);
        }
    }

    async function confirmUpgrade(): Promise<void> {
        upgradeDialog = false;
        try {
            const result = await request("", "upgrade.start", undefined);
            upgradeTerminal = result.terminal;
            await refreshUpgrade();
        } catch (error) {
            toastError(error);
        }
    }

    async function saveGlobalEnv(): Promise<void> {
        try {
            await saveSettings({}, { globalENV: globalEnv });
            toastResult("settingsSaved");
        } catch (error) {
            toastError(error);
        }
    }

    async function submitPassword(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (newPassword !== repeatPassword) return;
        try {
            await changePassword(currentPassword, newPassword);
            currentPassword = "";
            newPassword = "";
            repeatPassword = "";
            toastResult("settingsPasswordChanged");
        } catch (error) {
            toastError(error);
        }
    }

    async function beginTotp(): Promise<void> {
        try {
            const result = await request("", "auth.totp.begin", { currentPassword: totpPassword });
            totpSecret = result.secret;
            totpUri = result.uri;
            totpQr = await QRCode.toDataURL(result.uri, { margin: 0, width: 192 });
        } catch (error) {
            toastError(error);
        }
    }

    async function enableTotp(): Promise<void> {
        try {
            await request("", "auth.totp.enable", { totp: totpCode });
            totpEnabled = true;
            totpSecret = null;
            totpUri = null;
            totpQr = null;
            totpCode = "";
            totpPassword = "";
            toastResult("settingsTotpEnabled");
        } catch (error) {
            toastError(error);
        }
    }

    async function disableTotp(): Promise<void> {
        try {
            await request("", "auth.totp.disable", {
                currentPassword: totpPassword,
                totp: totpCode,
            });
            totpEnabled = false;
            totpCode = "";
            totpPassword = "";
            toastResult("settingsTotpDisabled");
        } catch (error) {
            toastError(error);
        }
    }

    async function confirmDisableAuth(password: string): Promise<void> {
        disableAuthDialog = false;
        try {
            await saveSettings({ disableAuth: true }, { currentPassword: password });
            toastResult("settingsSaved");
        } catch (error) {
            toastError(error);
        }
    }

    async function enableAuth(): Promise<void> {
        try {
            // Re-enabling asks for nothing, because it only increases restriction.
            await saveSettings({ disableAuth: false });
            location.reload();
        } catch (error) {
            toastError(error);
        }
    }

    async function disconnectOthers(): Promise<void> {
        try {
            await request("", "auth.disconnectOthers", undefined);
            toastResult("settingsSaved");
        } catch (error) {
            toastError(error);
        }
    }

    async function pickLocale(tag: string): Promise<void> {
        try {
            await setLocale(tag);
        } catch (error) {
            toastError(error);
        }
    }
</script>

<h1 class="type-headline" data-route-heading>{t("pageSettings")}</h1>

<nav class="tabs" aria-label={t("pageSettings")} data-audit-id="settings-tabs" data-audit-row="center">
    {#each SECTIONS as candidate (candidate)}
        <a
            class="tab"
            class:active={section === candidate}
            href="/settings/{candidate}"
            aria-current={section === candidate ? "page" : undefined}
            onclick={(event) => {
                event.preventDefault();
                void navigate(`/settings/${candidate}`);
            }}
        >
            {t(SECTION_KEYS[candidate])}
        </a>
    {/each}
</nav>

<div class="column" data-audit-id="settings-column" data-audit-column>
    {#if section === "general"}
        <div class="field" data-audit-column>
            <TextFieldOutlined
                label={t("settingsPrimaryHostname")}
                bind:value={primaryHostname}
                aria-describedby="primary-hostname-hint"
            />
            <span class="hint type-label" id="primary-hostname-hint">{t("settingsPrimaryHostnameHint")}</span>
        </div>
        <div class="row">
            <Button variant="text" onclick={() => (primaryHostname = location.hostname)}>
                {t("settingsAutofill")}
            </Button>
        </div>

        <label class="toggle" data-audit-row="center">
            <Switch bind:checked={trustProxy} />
            <span class="type-body">{t("settingsTrustProxy")}</span>
        </label>
        <p class="hint type-label">{t("settingsTrustProxyHint")}</p>

        <div class="row">
            <Button variant="filled" onclick={() => void saveGeneral()}>{t("actionSave")}</Button>
        </div>
    {:else if section === "updates"}
        <dl class="about" data-audit-column>
            <div class="about-row" data-audit-row="baseline">
                <dt class="type-label">{t("settingsAboutVersion")}</dt>
                <dd class="type-mono" data-audit-numeric>{serverInfo.value?.version ?? "-"}</dd>
            </div>
            <div class="about-row" data-audit-row="baseline">
                <dt class="type-label">{t("settingsAboutLatest")}</dt>
                <dd class="type-mono" data-audit-numeric>{serverInfo.value?.latestVersion ?? "-"}</dd>
            </div>
        </dl>

        <label class="toggle" data-audit-row="center">
            <Switch bind:checked={checkUpdate} />
            <span class="type-body">{t("settingsCheckUpdate")}</span>
        </label>
        <label class="toggle" data-audit-row="center">
            <Switch bind:checked={checkBeta} />
            <span class="type-body">{t("settingsCheckBeta")}</span>
        </label>
        <label class="toggle" data-audit-row="center">
            <Switch bind:checked={autoUpgrade} />
            <span class="type-body">{t("settingsAutoUpgrade")}</span>
        </label>
        <p class="hint type-label">{t("settingsAutoUpgradeHint")}</p>

        <div class="row">
            <Button variant="filled" onclick={() => void saveGeneral()}>{t("actionSave")}</Button>
        </div>

        <section class="group" data-audit-column>
            <h2 class="type-title">{t("settingsUpgradeNow")}</h2>
            {#if upgrade === null}
                <Loading size="sm" auditId="upgrade-loading" />
            {:else if !upgrade.supported}
                <p class="hint type-label">{t(upgrade.reason ?? "upgradeUnavailable")}</p>
            {:else}
                <p class="hint type-label">{t("settingsUpgradeHint")}</p>
                {#if upgrade.image !== undefined}
                    <p class="image type-mono">{upgrade.image}</p>
                {/if}
                {#if upgrade.lastError !== undefined}
                    <p class="error type-body">{t(upgrade.lastError)}</p>
                {/if}
                <div class="row">
                    <Button
                        variant="tonal"
                        disabled={upgrade.running}
                        onclick={() => (upgradeDialog = true)}
                    >
                        {t("settingsUpgradeNow")}
                    </Button>
                </div>
            {/if}
            {#if upgradeTerminal !== null}
                <TerminalView
                    endpoint=""
                    terminal={upgradeTerminal}
                    rows={8}
                    label={t("settingsUpgradeNow")}
                />
            {/if}
        </section>
    {:else if section === "appearance"}
        <fieldset class="group" data-audit-column>
            <legend class="label type-label">{t("settingsLanguage")}</legend>
            {#each locales as tag (tag)}
                <label class="toggle" data-audit-row="center">
                    <input
                        type="radio"
                        name="locale"
                        value={tag}
                        checked={i18n.locale === tag}
                        onchange={() => void pickLocale(tag)}
                    />
                    <span class="type-body">{languageName(tag)}</span>
                </label>
            {/each}
        </fieldset>

        <fieldset class="group" data-audit-column>
            <legend class="label type-label">{t("settingsTheme")}</legend>
            {#each [["light", "settingsThemeLight"], ["dark", "settingsThemeDark"], ["system", "settingsThemeSystem"]] as [value, key] (value)}
                <label class="toggle" data-audit-row="center">
                    <input
                        type="radio"
                        name="theme"
                        value={value}
                        checked={theme.preference === value}
                        onchange={() => setPreference(value as ThemePreference)}
                    />
                    <span class="type-body">{t(key as string)}</span>
                </label>
            {/each}
        </fieldset>
    {:else if section === "security"}
        <p class="type-body">
            {t("settingsCurrentUser")}: <strong>{session.username ?? "-"}</strong>
        </p>

        <form class="group" onsubmit={submitPassword} data-audit-column>
            <h2 class="type-title">{t("settingsChangePassword")}</h2>
            <TextFieldOutlined
                label={t("settingsCurrentPassword")}
                type="password"
                bind:value={currentPassword}
                autocomplete="current-password"
                required
            />
            <TextFieldOutlined
                label={t("settingsNewPassword")}
                type="password"
                bind:value={newPassword}
                autocomplete="new-password"
                required
            />
            <TextFieldOutlined
                label={t("settingsRepeatPassword")}
                type="password"
                bind:value={repeatPassword}
                autocomplete="new-password"
                error={repeatPassword !== "" && repeatPassword !== newPassword}
                required
            />
            <div class="row">
                <Button variant="filled" type="submit" disabled={newPassword !== repeatPassword}>
                    {t("actionSave")}
                </Button>
            </div>
        </form>

        <section class="group" data-audit-column>
            <h2 class="type-title">{t("settingsTotp")}</h2>
            <p class="type-body">{totpEnabled ? t("settingsTotpOn") : t("settingsTotpOff")}</p>

            {#if !totpEnabled && totpSecret === null}
                <TextFieldOutlined
                    label={t("settingsCurrentPassword")}
                    type="password"
                    bind:value={totpPassword}
                    autocomplete="current-password"
                />
                <div class="row">
                    <Button variant="tonal" onclick={() => void beginTotp()}>{t("settingsTotpBegin")}</Button>
                </div>
            {:else if totpSecret !== null}
                <p class="type-body">{t("settingsTotpScan")}</p>
                {#if totpQr !== null}
                    <img class="qr" src={totpQr} alt={t("settingsTotp")} />
                {/if}
                <p class="secret type-mono">{totpSecret}</p>
                {#if totpUri !== null}<p class="visually-hidden">{totpUri}</p>{/if}
                <TextFieldOutlined
                    label={t("settingsTotpConfirm")}
                    bind:value={totpCode}
                    inputmode="numeric"
                    autocomplete="one-time-code"
                    maxlength={6}
                />
                <div class="row">
                    <Button variant="filled" onclick={() => void enableTotp()}>{t("settingsTotpEnable")}</Button>
                </div>
            {:else}
                <TextFieldOutlined
                    label={t("settingsCurrentPassword")}
                    type="password"
                    bind:value={totpPassword}
                    autocomplete="current-password"
                />
                <TextFieldOutlined
                    label={t("loginTotpCode")}
                    bind:value={totpCode}
                    inputmode="numeric"
                    maxlength={6}
                />
                <div class="row">
                    <Button variant="text" onclick={() => void disableTotp()}>{t("settingsTotpDisable")}</Button>
                </div>
            {/if}
        </section>

        <section class="group" data-audit-column>
            <h2 class="type-title">{t("settingsDisableAuth")}</h2>
            <p class="hint type-label">{t("settingsDisableAuthHint")}</p>
            <div class="row">
                {#if settings.value?.disableAuth === true}
                    <Button variant="filled" onclick={() => void enableAuth()}>{t("actionApply")}</Button>
                {:else}
                    <Button variant="text" onclick={() => (disableAuthDialog = true)}>
                        {t("settingsDisableAuth")}
                    </Button>
                {/if}
            </div>
        </section>

        <section class="group" data-audit-column>
            <div class="row">
                <Button variant="text" onclick={() => void disconnectOthers()}>
                    {t("settingsDisconnectOthers")}
                </Button>
                <Button variant="text" onclick={() => void logout()}>{t("actionLogout")}</Button>
            </div>
        </section>
    {:else if section === "globalenv"}
        <p class="type-body">{t("settingsGlobalEnvBody")}</p>
        <CodeEditor
            value={globalEnv}
            language="plain"
            ariaLabel={t("settingsGlobalEnv")}
            auditId="global-env-editor"
            onchange={(next) => (globalEnv = next)}
        />
        <div class="row">
            <Button variant="filled" onclick={() => void saveGlobalEnv()}>{t("actionSave")}</Button>
        </div>
    {:else}
        <dl class="about" data-audit-column>
            <div class="about-row" data-audit-row="baseline">
                <dt class="type-label">{t("settingsAboutVersion")}</dt>
                <dd class="type-mono" data-audit-numeric>{serverInfo.value?.version ?? "-"}</dd>
            </div>
            {#if serverInfo.value?.latestVersion !== undefined}
                <div class="about-row" data-audit-row="baseline">
                    <dt class="type-label">{t("settingsAboutLatest")}</dt>
                    <dd class="type-mono" data-audit-numeric>{serverInfo.value.latestVersion}</dd>
                </div>
            {/if}
            <div class="about-row" data-audit-row="baseline">
                <dt class="type-label">{t("settingsAboutProtocol")}</dt>
                <dd class="type-mono" data-audit-numeric>{PROTOCOL_VERSION}</dd>
            </div>
            <div class="about-row" data-audit-row="baseline">
                <dt class="type-label">{t("settingsAboutContainer")}</dt>
                <dd class="type-body">{serverInfo.value?.isContainer === true ? t("yes") : t("no")}</dd>
            </div>
            <div class="about-row" data-audit-row="baseline">
                <dt class="type-label">{t("settingsAboutRepository")}</dt>
                <dd class="type-body">
                    <a href="https://github.com/heavycaffeiner/docknight" target="_blank" rel="noreferrer noopener">
                        github.com/heavycaffeiner/docknight
                    </a>
                </dd>
            </div>
        </dl>
        <p class="hint type-label">{t("settingsAboutKeyWarning")}</p>
    {/if}
</div>

<ConfirmDialog
    open={disableAuthDialog}
    destructive
    title={t("settingsDisableAuthTitle")}
    body={t("settingsDisableAuthBody")}
    confirmLabel={t("settingsDisableAuth")}
    passwordLabel={t("settingsCurrentPassword")}
    onconfirm={(password) => void confirmDisableAuth(password)}
    oncancel={() => (disableAuthDialog = false)}
/>

<ConfirmDialog
    open={upgradeDialog}
    title={t("settingsUpgradeTitle")}
    body={t("settingsUpgradeBody")}
    confirmLabel={t("settingsUpgradeNow")}
    onconfirm={() => void confirmUpgrade()}
    oncancel={() => (upgradeDialog = false)}
/>

<style>
    h1,
    h2 {
        margin: 0;
    }

    .tabs {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
    }

    .tab {
        display: inline-flex;
        align-items: center;
        block-size: var(--size-control-md);
        padding-inline: var(--space-4);
        border-radius: var(--radius-full);
        background-color: rgb(var(--m3-scheme-surface-container));
        color: rgb(var(--m3-scheme-on-surface-variant));
        text-decoration: none;
    }

    .tab:hover {
        text-decoration: none;
    }

    .tab.active {
        background-color: rgb(var(--m3-scheme-secondary-container));
        color: rgb(var(--m3-scheme-on-secondary-container));
    }

    .column {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        max-inline-size: var(--measure-settings);
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
    }

    .group {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        margin-block: var(--space-3) 0;
        margin-inline: 0;
        padding: 0;
        border: 0;
    }

    legend {
        padding: 0;
    }

    .label {
        color: rgb(var(--m3-scheme-on-surface-variant));
    }

    .hint {
        margin: 0;
        color: rgb(var(--m3-scheme-on-surface-variant));
    }

    .error {
        margin: 0;
        color: rgb(var(--m3-scheme-error));
    }

    .image {
        margin: 0;
        overflow-wrap: anywhere;
        color: rgb(var(--m3-scheme-on-surface));
    }

    .toggle {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        min-block-size: var(--size-control-md);
    }

    /* A native radio carries asymmetric UA margins, which tilt the row off its centre axis. */
    .toggle input[type="radio"] {
        inline-size: var(--space-5);
        block-size: var(--space-5);
        margin: 0;
        accent-color: rgb(var(--m3-scheme-primary));
    }

    .row {
        display: flex;
        gap: var(--space-2);
    }

    .qr {
        inline-size: var(--measure-list);
        max-inline-size: 100%;
        block-size: auto;
        border-radius: var(--radius-md);
        background-color: rgb(var(--m3-scheme-surface));
        padding: var(--space-3);
    }

    .secret {
        margin: 0;
        user-select: all;
        color: rgb(var(--m3-scheme-on-surface));
    }

    .about {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        margin: 0;
    }

    .about-row {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: baseline;
        gap: var(--space-3);
    }

    .about-row a {
        display: inline-flex;
        align-items: center;
        min-block-size: var(--size-control-sm);
    }

    dt {
        color: rgb(var(--m3-scheme-on-surface-variant));
    }

    dd {
        margin: 0;
    }
</style>
