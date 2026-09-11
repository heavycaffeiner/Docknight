import { useMutation, useQuery } from "@tanstack/react-query";
import { toDataURL } from "qrcode";
import { type FormEvent, type ReactElement, useRef, useState } from "react";
import CodeEditor from "../components/CodeEditor.tsx";
import ConfirmDialog from "../components/ConfirmDialog.tsx";
import TerminalView from "../components/TerminalView.tsx";
import { elementChecked, elementValue, setElementValue, useElementEvent } from "../lib/dom-events.ts";
import { LOCALES, setLocale, useT } from "../lib/i18n.ts";
import { useSizeClass } from "../lib/media.ts";
import { serverInfo } from "../lib/push.ts";
import { qk, queryClient } from "../lib/query.ts";
import { navigate } from "../lib/router.ts";
import { logout, session } from "../lib/session.ts";
import { useStore } from "../lib/store.ts";
import { applyThemePreference, themePreference, type ThemePreference } from "../lib/theme.ts";
import { toastError, toastSuccess } from "../lib/toast.ts";
import { request } from "../lib/transport.ts";
import { useParams } from "../routes.ts";
import "./Settings.css";

const SECTIONS = ["general", "updates", "appearance", "security", "globalEnv", "about"] as const;
type SectionName = (typeof SECTIONS)[number];

function isSectionName(value: string | undefined): value is SectionName {
    return value !== undefined && (SECTIONS as readonly string[]).includes(value);
}

function isThemePreference(value: string): value is ThemePreference {
    return value === "auto" || value === "light" || value === "dark";
}

interface SettingsValues {
    disableAuth: boolean;
    primaryHostname: string;
    checkUpdate: boolean;
    checkBeta: boolean;
    autoUpgrade: boolean;
    trustProxy: boolean;
    globalENV: string;
}

interface SettingsPatch {
    disableAuth?: boolean;
    primaryHostname?: string;
    checkUpdate?: boolean;
    checkBeta?: boolean;
    autoUpgrade?: boolean;
    trustProxy?: boolean;
}

interface SettingsSetParams {
    settings: SettingsPatch;
    globalENV?: string;
    currentPassword?: string;
}

interface UpgradeStatus {
    supported: boolean;
    reason?: string;
    image?: string;
    running: boolean;
    terminal: string;
    lastError?: string;
}

/**
 * The session token can live in either storage depending on the "remember me" choice made at
 * login; `session.ts` owns that constant privately, so a password change writes the fresh
 * token back to whichever storage already holds one.
 */
const TOKEN_KEY = "docknight-token";

function persistToken(token: string): void {
    if (typeof localStorage !== "undefined" && localStorage.getItem(TOKEN_KEY) !== null) {
        localStorage.setItem(TOKEN_KEY, token);
    } else if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(TOKEN_KEY) !== null) {
        sessionStorage.setItem(TOKEN_KEY, token);
    }
}

function useSettingsQuery() {
    return useQuery({
        queryKey: qk.settings(),
        queryFn: () => request<SettingsValues>("", "settings.get"),
    });
}

function useSettingsMutation() {
    return useMutation({
        mutationFn: (params: SettingsSetParams) => request<{ ok: true }>("", "settings.set", params),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: qk.settings() });
        },
    });
}

export default function Settings(): ReactElement {
    const { t } = useT();
    const sizeClass = useSizeClass();
    const params = useParams();
    const isCompact = sizeClass === "compact";
    const sectionParam = params.section;
    const activeSection: SectionName = isSectionName(sectionParam) ? sectionParam : "general";

    const showList = !isCompact || sectionParam === undefined;
    const showContent = !isCompact || sectionParam !== undefined;

    const list = showList ? (
        <mdui-list className="settings-nav-list">
            {SECTIONS.map((section) => (
                <mdui-list-item
                    key={section}
                    headline={t(`settings.section.${section}`)}
                    rounded
                    active={!isCompact && activeSection === section}
                    end-icon={isCompact ? "chevron_right" : undefined}
                    onClick={() => void navigate(`/settings/${section}`)}
                />
            ))}
        </mdui-list>
    ) : null;

    const nav = isCompact ? list : <mdui-card className="settings-nav-card">{list}</mdui-card>;

    const body = showContent ? (
        <div className="settings-content">
            {activeSection === "general" ? <GeneralSection /> : null}
            {activeSection === "updates" ? <UpdatesSection /> : null}
            {activeSection === "appearance" ? <AppearanceSection /> : null}
            {activeSection === "security" ? <SecuritySection /> : null}
            {activeSection === "globalEnv" ? <GlobalEnvSection /> : null}
            {activeSection === "about" ? <AboutSection /> : null}
        </div>
    ) : null;

    return (
        <div className="page">
            <div className="page-header">
                {isCompact && sectionParam !== undefined ? (
                    <mdui-button-icon
                        icon="arrow_back"
                        aria-label={t("action.back")}
                        onClick={() => void navigate("/settings")}
                    />
                ) : null}
                <h1 className="type-headline-small">{t("nav.settings")}</h1>
            </div>
            {isCompact ? (
                <>
                    {nav}
                    {body}
                </>
            ) : (
                <div className="settings-layout">
                    {nav}
                    {body}
                </div>
            )}
        </div>
    );
}

function GeneralSection(): ReactElement {
    const { t } = useT();
    const query = useSettingsQuery();
    const mutation = useSettingsMutation();
    const [hostname, setHostname] = useState("");
    // Seed the editable copy from the server's. Every refetch hands back a fresh object, so
    // the comparison is on the value, not the identity.
    const served = query.data?.primaryHostname;
    const [seenHostname, setSeenHostname] = useState(served);
    if (served !== seenHostname) {
        setSeenHostname(served);
        if (served !== undefined) setHostname(served);
    }
    const hostRef = useRef<HTMLElement>(null);
    const trustRef = useRef<HTMLElement>(null);

    function saveHostname(): void {
        const value = elementValue(hostRef);
        setHostname(value);
        mutation.mutate(
            { settings: { primaryHostname: value } },
            { onSuccess: () => toastSuccess(t("toast.saved")), onError: (err) => toastError(err) },
        );
    }

    function useCurrentHost(): void {
        const host = location.hostname;
        setHostname(host);
        setElementValue(hostRef, host);
        mutation.mutate(
            { settings: { primaryHostname: host } },
            { onSuccess: () => toastSuccess(t("toast.saved")), onError: (err) => toastError(err) },
        );
    }

    useElementEvent(hostRef, "change", saveHostname);
    useElementEvent(trustRef, "change", () => {
        mutation.mutate(
            { settings: { trustProxy: elementChecked(trustRef) } },
            { onSuccess: () => toastSuccess(t("toast.saved")), onError: (err) => toastError(err) },
        );
    });

    return (
        <mdui-card>
            <div className="card-title">
                <h2 className="type-title-medium">{t("settings.section.general")}</h2>
            </div>
            <div className="section">
                <div className="form-column">
                    <mdui-text-field
                        ref={hostRef}
                        variant="outlined"
                        label={t("settings.general.primaryHostname")}
                        value={hostname}
                    />
                    <div className="form-actions">
                        <mdui-button variant="text" onClick={useCurrentHost}>
                            {t("settings.general.useCurrentHost")}
                        </mdui-button>
                    </div>
                </div>
                <div className="switch-row">
                    <div className="switch-row__text">
                        <span className="type-body-medium">{t("settings.general.trustProxy")}</span>
                    </div>
                    <mdui-switch
                        ref={trustRef}
                        checked={query.data?.trustProxy ?? false}
                        aria-label={t("settings.general.trustProxy")}
                    />
                </div>
            </div>
        </mdui-card>
    );
}

function UpdatesSection(): ReactElement {
    const { t } = useT();
    const settingsQuery = useSettingsQuery();
    const settingsMutation = useSettingsMutation();
    const info = useStore(serverInfo);
    const [upgradeConfirmOpen, setUpgradeConfirmOpen] = useState(false);
    const [upgrading, setUpgrading] = useState(false);
    const checkUpdateRef = useRef<HTMLElement>(null);
    const checkBetaRef = useRef<HTMLElement>(null);
    const autoUpgradeRef = useRef<HTMLElement>(null);

    const statusQuery = useQuery({
        queryKey: qk.upgradeStatus(),
        queryFn: () => request<UpgradeStatus>("", "upgrade.status"),
    });

    const startUpgradeMutation = useMutation({
        mutationFn: () => request<{ terminal: string }>("", "upgrade.start"),
        onSuccess: () => setUpgrading(true),
        onError: (err: unknown) => toastError(err),
    });

    function saveToggle(patch: SettingsPatch): void {
        settingsMutation.mutate(
            { settings: patch },
            { onSuccess: () => toastSuccess(t("toast.saved")), onError: (err) => toastError(err) },
        );
    }

    useElementEvent(checkUpdateRef, "change", () => saveToggle({ checkUpdate: elementChecked(checkUpdateRef) }));
    useElementEvent(checkBetaRef, "change", () => saveToggle({ checkBeta: elementChecked(checkBetaRef) }));
    useElementEvent(autoUpgradeRef, "change", () => saveToggle({ autoUpgrade: elementChecked(autoUpgradeRef) }));

    const status = statusQuery.data;

    return (
        <mdui-card>
            <div className="card-title">
                <h2 className="type-title-medium">{t("settings.section.updates")}</h2>
            </div>
            <div className="section">
                <div className="settings-info-group">
                    <div className="settings-info-row">
                        <span className="type-label-medium text-muted">{t("settings.about.version")}</span>
                        <span className="type-body-medium mono">{info.version ?? "-"}</span>
                    </div>
                    <div className="settings-info-row">
                        <span className="type-label-medium text-muted">{t("settings.about.latest")}</span>
                        <span className="type-body-medium mono">{info.latestVersion ?? "-"}</span>
                    </div>
                </div>

                <div className="switch-row">
                    <div className="switch-row__text">
                        <span className="type-body-medium">{t("settings.updates.check")}</span>
                    </div>
                    <mdui-switch
                        ref={checkUpdateRef}
                        checked={settingsQuery.data?.checkUpdate ?? true}
                        aria-label={t("settings.updates.check")}
                    />
                </div>
                <div className="switch-row">
                    <div className="switch-row__text">
                        <span className="type-body-medium">{t("settings.updates.beta")}</span>
                    </div>
                    <mdui-switch
                        ref={checkBetaRef}
                        checked={settingsQuery.data?.checkBeta ?? false}
                        aria-label={t("settings.updates.beta")}
                    />
                </div>
                <div className="switch-row">
                    <div className="switch-row__text">
                        <span className="type-body-medium">{t("settings.updates.auto")}</span>
                    </div>
                    <mdui-switch
                        ref={autoUpgradeRef}
                        checked={settingsQuery.data?.autoUpgrade ?? false}
                        aria-label={t("settings.updates.auto")}
                    />
                </div>

                {status !== undefined ? (
                    <div className="section">
                        {status.image !== undefined ? (
                            <span className="type-body-small text-muted mono">
                                {t("settings.updates.image", { image: status.image })}
                            </span>
                        ) : null}
                        {status.supported ? (
                            <div className="form-actions">
                                <mdui-button variant="filled" onClick={() => setUpgradeConfirmOpen(true)}>
                                    {t("settings.updates.upgrade")}
                                </mdui-button>
                            </div>
                        ) : (
                            <span className="type-label-medium text-muted">
                                {status.reason !== undefined
                                    ? t(`settings.updates.reason.${status.reason}`)
                                    : t("settings.updates.reason.unsupported")}
                            </span>
                        )}
                        {status.lastError !== undefined ? (
                            <span className="type-label-medium danger-text">
                                {t("settings.updates.lastErrorFailed")}
                            </span>
                        ) : null}
                    </div>
                ) : null}

                {upgrading ? <TerminalView terminal="upgrade" interactive={false} rows={16} /> : null}
            </div>

            <ConfirmDialog
                open={upgradeConfirmOpen}
                title={t("settings.updates.upgradeTitle")}
                message={t("settings.updates.upgradeMessage")}
                onConfirm={() => {
                    setUpgradeConfirmOpen(false);
                    startUpgradeMutation.mutate();
                }}
                onCancel={() => setUpgradeConfirmOpen(false)}
            />
        </mdui-card>
    );
}

function AppearanceSection(): ReactElement {
    const { t, locale } = useT();
    const preference = useStore(themePreference);
    const themeRef = useRef<HTMLElement>(null);
    const langRef = useRef<HTMLElement>(null);

    useElementEvent(themeRef, "change", () => {
        const value = elementValue(themeRef);
        if (isThemePreference(value)) applyThemePreference(value);
    });

    useElementEvent(langRef, "change", () => {
        const value = elementValue(langRef);
        if (value !== "") void setLocale(value);
    });

    return (
        <mdui-card>
            <div className="card-title">
                <h2 className="type-title-medium">{t("settings.section.appearance")}</h2>
            </div>
            <div className="section">
                <div className="form-column">
                    <mdui-select ref={langRef} variant="outlined" label={t("settings.appearance.language")} value={locale}>
                        {Object.entries(LOCALES).map(([tag, name]) => (
                            <mdui-menu-item key={tag} value={tag}>
                                {name}
                            </mdui-menu-item>
                        ))}
                    </mdui-select>
                </div>
                <div className="form-column">
                    <span className="type-label-medium text-muted">{t("settings.appearance.theme")}</span>
                    <mdui-segmented-button-group
                        ref={themeRef}
                        selects="single"
                        value={preference}
                        aria-label={t("settings.appearance.theme")}
                    >
                        <mdui-segmented-button value="auto">{t("theme.system")}</mdui-segmented-button>
                        <mdui-segmented-button value="light">{t("theme.light")}</mdui-segmented-button>
                        <mdui-segmented-button value="dark">{t("theme.dark")}</mdui-segmented-button>
                    </mdui-segmented-button-group>
                </div>
            </div>
        </mdui-card>
    );
}

function SecuritySection(): ReactElement {
    const { t } = useT();
    const { username } = useStore(session);
    const settingsQuery = useSettingsQuery();
    const settingsMutation = useSettingsMutation();

    // Change password
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [repeatPassword, setRepeatPassword] = useState("");
    const currentPwRef = useRef<HTMLElement>(null);
    const newPwRef = useRef<HTMLElement>(null);
    const repeatPwRef = useRef<HTMLElement>(null);

    useElementEvent(currentPwRef, "input", () => setCurrentPassword(elementValue(currentPwRef)));
    useElementEvent(newPwRef, "input", () => setNewPassword(elementValue(newPwRef)));
    useElementEvent(repeatPwRef, "input", () => setRepeatPassword(elementValue(repeatPwRef)));

    const changePasswordMutation = useMutation({
        mutationFn: (params: { currentPassword: string; newPassword: string }) =>
            request<{ token: string }>("", "auth.changePassword", params),
    });

    function handleChangePassword(e: FormEvent<HTMLFormElement>): void {
        e.preventDefault();
        if (newPassword !== repeatPassword) {
            toastError(t("auth.setup.passwordMismatch"));
            return;
        }
        changePasswordMutation.mutate(
            { currentPassword, newPassword },
            {
                onSuccess: (res) => {
                    persistToken(res.token);
                    setCurrentPassword("");
                    setNewPassword("");
                    setRepeatPassword("");
                    setElementValue(currentPwRef, "");
                    setElementValue(newPwRef, "");
                    setElementValue(repeatPwRef, "");
                    toastSuccess(t("toast.saved"));
                },
                onError: (err) => toastError(err),
            },
        );
    }

    // Sessions
    const disconnectMutation = useMutation({
        mutationFn: () => request<{ ok: true }>("", "auth.disconnectOthers"),
    });

    // Authentication enable/disable
    const [disableAuthOpen, setDisableAuthOpen] = useState(false);
    const disableAuthPwRef = useRef<HTMLElement>(null);
    const disableAuth = settingsQuery.data?.disableAuth ?? false;

    function confirmDisableAuth(): void {
        const password = elementValue(disableAuthPwRef);
        settingsMutation.mutate(
            { settings: { disableAuth: true }, currentPassword: password },
            {
                onSuccess: () => {
                    setDisableAuthOpen(false);
                    setElementValue(disableAuthPwRef, "");
                    toastSuccess(t("toast.saved"));
                    location.reload();
                },
                onError: (err) => toastError(err),
            },
        );
    }

    function enableAuth(): void {
        settingsMutation.mutate(
            { settings: { disableAuth: false } },
            {
                onSuccess: () => {
                    toastSuccess(t("toast.saved"));
                    location.reload();
                },
                onError: (err) => toastError(err),
            },
        );
    }

    // TOTP enrolment: a current-password step, then the QR/secret/code step.
    const [totpPasswordOpen, setTotpPasswordOpen] = useState(false);
    const totpPasswordRef = useRef<HTMLElement>(null);
    const [totpSetupOpen, setTotpSetupOpen] = useState(false);
    const [totpSecret, setTotpSecret] = useState("");
    const [totpUri, setTotpUri] = useState("");
    const totpCodeRef = useRef<HTMLElement>(null);

    const totpBeginMutation = useMutation({
        mutationFn: (currentPassword: string) =>
            request<{ secret: string; uri: string }>("", "auth.totp.begin", { currentPassword }),
    });
    const totpEnableMutation = useMutation({
        mutationFn: (totp: string) => request<{ ok: true }>("", "auth.totp.enable", { totp }),
    });

    // The QR is a pure function of the URI, so it is a query rather than state mirrored by an
    // effect. The URI carries the shared secret, so nothing about it outlives the dialog.
    const totpQrQuery = useQuery({
        queryKey: ["totp-qr", totpUri],
        queryFn: () => toDataURL(totpUri),
        enabled: totpUri !== "",
        staleTime: Infinity,
        gcTime: 0,
    });
    const totpQr = totpUri === "" ? "" : (totpQrQuery.data ?? "");

    function confirmTotpPassword(): void {
        const password = elementValue(totpPasswordRef);
        totpBeginMutation.mutate(password, {
            onSuccess: (res) => {
                setTotpSecret(res.secret);
                setTotpUri(res.uri);
                setTotpPasswordOpen(false);
                setElementValue(totpPasswordRef, "");
                setTotpSetupOpen(true);
            },
            onError: (err) => toastError(err),
        });
    }

    function confirmTotpEnable(): void {
        const code = elementValue(totpCodeRef);
        totpEnableMutation.mutate(code, {
            onSuccess: () => {
                setTotpSetupOpen(false);
                setTotpSecret("");
                setTotpUri("");
                setElementValue(totpCodeRef, "");
                toastSuccess(t("toast.saved"));
            },
            onError: (err) => toastError(err),
        });
    }

    // TOTP disable
    const [totpDisableOpen, setTotpDisableOpen] = useState(false);
    const totpDisablePwRef = useRef<HTMLElement>(null);
    const totpDisableCodeRef = useRef<HTMLElement>(null);

    const totpDisableMutation = useMutation({
        mutationFn: (params: { currentPassword: string; totp: string }) =>
            request<{ ok: true }>("", "auth.totp.disable", params),
    });

    function confirmTotpDisable(): void {
        const password = elementValue(totpDisablePwRef);
        const code = elementValue(totpDisableCodeRef);
        totpDisableMutation.mutate(
            { currentPassword: password, totp: code },
            {
                onSuccess: () => {
                    setTotpDisableOpen(false);
                    setElementValue(totpDisablePwRef, "");
                    setElementValue(totpDisableCodeRef, "");
                    toastSuccess(t("toast.saved"));
                },
                onError: (err) => toastError(err),
            },
        );
    }

    const changePasswordDisabled =
        changePasswordMutation.isPending || currentPassword === "" || newPassword === "" || repeatPassword === "";

    return (
        <div className="section">
            <mdui-card>
                <div className="card-title">
                    <h2 className="type-title-medium">{t("settings.security.changePassword")}</h2>
                </div>
                <form className="form-column" onSubmit={handleChangePassword}>
                    <mdui-text-field
                        ref={currentPwRef}
                        variant="outlined"
                        type="password"
                        toggle-password
                        label={t("settings.security.currentPassword")}
                    />
                    <mdui-text-field
                        ref={newPwRef}
                        variant="outlined"
                        type="password"
                        toggle-password
                        label={t("settings.security.newPassword")}
                    />
                    <mdui-text-field
                        ref={repeatPwRef}
                        variant="outlined"
                        type="password"
                        toggle-password
                        label={t("auth.setup.repeat")}
                    />
                    <div className="form-actions form-actions--end">
                        <mdui-button type="submit" variant="filled" disabled={changePasswordDisabled}>
                            {t("action.save")}
                        </mdui-button>
                    </div>
                </form>
            </mdui-card>

            <mdui-card>
                <div className="card-title">
                    <h2 className="type-title-medium">{t("settings.security.totp")}</h2>
                </div>
                <div className="row">
                    <mdui-button variant="tonal" onClick={() => setTotpPasswordOpen(true)}>
                        {t("settings.security.totpBegin")}
                    </mdui-button>
                    <mdui-button
                        variant="text"
                        className="danger-action"
                        onClick={() => setTotpDisableOpen(true)}
                    >
                        {t("settings.security.totpDisable")}
                    </mdui-button>
                </div>
            </mdui-card>

            <mdui-card>
                <div className="card-title">
                    <h2 className="type-title-medium">{t("settings.security.authentication")}</h2>
                </div>
                <div className="section">
                    <div className="settings-info-row">
                        <span className="type-label-medium text-muted">{t("auth.login.username")}</span>
                        <span className="type-body-medium">{username ?? "-"}</span>
                    </div>

                    {disableAuth ? (
                        <div className="form-actions">
                            <mdui-button variant="tonal" onClick={enableAuth}>
                                {t("settings.security.enableAuth")}
                            </mdui-button>
                        </div>
                    ) : (
                        <div className="form-actions">
                            <mdui-button
                                variant="text"
                                className="danger-action"
                                onClick={() => setDisableAuthOpen(true)}
                            >
                                {t("settings.security.disableAuth")}
                            </mdui-button>
                        </div>
                    )}

                    <div className="row">
                        <mdui-button
                            variant="text"
                            onClick={() =>
                                disconnectMutation.mutate(undefined, {
                                    onSuccess: () => toastSuccess(t("toast.saved")),
                                    onError: (err) => toastError(err),
                                })
                            }
                        >
                            {t("settings.security.disconnectOthers")}
                        </mdui-button>
                        <mdui-button
                            variant="text"
                            className="danger-action"
                            onClick={() => void logout().then(() => navigate("/"))}
                        >
                            {t("settings.security.logout")}
                        </mdui-button>
                    </div>
                </div>
            </mdui-card>

            <ConfirmDialog
                open={disableAuthOpen}
                title={t("settings.security.disableAuth")}
                message={t("settings.security.disableAuthMessage")}
                danger
                onConfirm={confirmDisableAuth}
                onCancel={() => setDisableAuthOpen(false)}
            >
                <mdui-text-field
                    ref={disableAuthPwRef}
                    variant="outlined"
                    type="password"
                    toggle-password
                    label={t("auth.login.password")}
                />
            </ConfirmDialog>

            <ConfirmDialog
                open={totpPasswordOpen}
                title={t("settings.security.totp")}
                onConfirm={confirmTotpPassword}
                onCancel={() => setTotpPasswordOpen(false)}
            >
                <mdui-text-field
                    ref={totpPasswordRef}
                    variant="outlined"
                    type="password"
                    toggle-password
                    label={t("auth.login.password")}
                />
            </ConfirmDialog>

            <ConfirmDialog
                open={totpSetupOpen}
                title={t("settings.security.totp")}
                confirmLabel={t("settings.security.totpEnable")}
                onConfirm={confirmTotpEnable}
                onCancel={() => {
                    setTotpSetupOpen(false);
                    setTotpSecret("");
                    setTotpUri("");
                    setElementValue(totpCodeRef, "");
                }}
            >
                <div className="form-column">
                    {totpQr !== "" ? (
                        <img className="settings-qr" src={totpQr} alt={t("settings.security.totp")} />
                    ) : null}
                    <span className="type-label-medium text-muted">{t("settings.security.totpBegin")}</span>
                    <span className="type-body-medium mono settings-secret">{totpSecret}</span>
                    <mdui-text-field
                        ref={totpCodeRef}
                        variant="outlined"
                        label={t("settings.security.totpCode")}
                        inputmode="numeric"
                    />
                </div>
            </ConfirmDialog>

            <ConfirmDialog
                open={totpDisableOpen}
                title={t("settings.security.totpDisable")}
                danger
                onConfirm={confirmTotpDisable}
                onCancel={() => setTotpDisableOpen(false)}
            >
                <div className="form-column">
                    <mdui-text-field
                        ref={totpDisablePwRef}
                        variant="outlined"
                        type="password"
                        toggle-password
                        label={t("auth.login.password")}
                    />
                    <mdui-text-field
                        ref={totpDisableCodeRef}
                        variant="outlined"
                        label={t("settings.security.totpCode")}
                        inputmode="numeric"
                    />
                </div>
            </ConfirmDialog>
        </div>
    );
}

function GlobalEnvSection(): ReactElement {
    const { t } = useT();
    const query = useSettingsQuery();
    const mutation = useSettingsMutation();
    const [text, setText] = useState("");
    // Adopt the server's copy only when it changes and the editor still holds the last one
    // unedited. Nothing is recorded while the text is dirty, so a skipped copy lands later.
    const served = query.data?.globalENV;
    const [seenEnv, setSeenEnv] = useState<string | undefined>(undefined);
    if (served !== undefined && served !== seenEnv && (seenEnv === undefined || text === seenEnv)) {
        setSeenEnv(served);
        setText(served);
    }

    return (
        <mdui-card>
            <div className="card-title">
                <h2 className="type-title-medium">{t("settings.section.globalEnv")}</h2>
            </div>
            <div className="section">
                <div className="global-env-editor">
                    <CodeEditor value={text} onChange={setText} ariaLabel={t("settings.section.globalEnv")} />
                </div>
                <div className="form-actions form-actions--end">
                    <mdui-button
                        variant="filled"
                        disabled={mutation.isPending}
                        onClick={() => {
                            const saved = text;
                            mutation.mutate(
                                { settings: {}, globalENV: saved },
                                {
                                    onSuccess: () => {
                                        // The editor now holds the server's copy again.
                                        setSeenEnv(saved);
                                        toastSuccess(t("toast.saved"));
                                    },
                                    onError: (err) => toastError(err),
                                },
                            );
                        }}
                    >
                        {t("action.save")}
                    </mdui-button>
                </div>
            </div>
        </mdui-card>
    );
}

function AboutSection(): ReactElement {
    const { t } = useT();
    const info = useStore(serverInfo);

    return (
        <mdui-card>
            <div className="card-title">
                <h2 className="type-title-medium">{t("settings.section.about")}</h2>
            </div>
            <div className="section">
                <div className="settings-info-group">
                    <div className="settings-info-row">
                        <span className="type-label-medium text-muted">{t("settings.about.version")}</span>
                        <span className="type-body-medium mono">{info.version ?? "-"}</span>
                    </div>
                    <div className="settings-info-row">
                        <span className="type-label-medium text-muted">{t("settings.about.latest")}</span>
                        <span className="type-body-medium mono">{info.latestVersion ?? "-"}</span>
                    </div>
                    <div className="settings-info-row">
                        <span className="type-label-medium text-muted">{t("settings.about.protocol")}</span>
                        <span className="type-body-medium mono">{info.protocolVersion ?? 1}</span>
                    </div>
                    <div className="settings-info-row">
                        <span className="type-label-medium text-muted">{t("settings.about.container")}</span>
                        <span className="type-body-medium">
                            {info.isContainer === true ? t("action.yes") : t("action.no")}
                        </span>
                    </div>
                </div>
                <div className="settings-warning type-body-medium">{t("settings.about.agentKeyWarning")}</div>
            </div>
        </mdui-card>
    );
}
