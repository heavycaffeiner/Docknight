import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import type { ServiceInstance, StackDetail } from "../../../common/stack.ts";
import { CREATED, DRAFT, EXITED, RUNNING } from "../../../common/stack.ts";
import { composeTerminalName, logsTerminalName } from "../../../common/terminal.ts";
import BottomSheet from "../components/BottomSheet.tsx";
import CodeEditor from "../components/CodeEditor.tsx";
import ConfirmDialog from "../components/ConfirmDialog.tsx";
import ServiceCard from "../components/ServiceCard.tsx";
import StatusChip from "../components/StatusChip.tsx";
import TerminalView from "../components/TerminalView.tsx";
import { elementValue, useElementEvent } from "../lib/dom-events.ts";
import { useT } from "../lib/i18n.ts";
import { useSizeClass } from "../lib/media.ts";
import { qk } from "../lib/query.ts";
import { agents, stackKey as makeStackKey, stacks } from "../lib/push.ts";
import { linkHandler, navigate, registerBeforeLeave, useRoute } from "../lib/router.ts";
import { useStore } from "../lib/store.ts";
import { toastError, toastSuccess } from "../lib/toast.ts";
import { request } from "../lib/transport.ts";
import { useParams } from "../routes.ts";
import {
    type ComposeConfig,
    expandForDisplay,
    parseCompose,
    parseEnv,
    serialiseWithComments,
} from "./compose/sync.ts";

interface ContainerStats {
    Name?: string;
    CPUPerc?: string;
    MemUsage?: string;
}

const STATUS_WORD: Record<number, string> = {
    [RUNNING]: "running",
    [EXITED]: "exited",
    [CREATED]: "created",
    [DRAFT]: "draft",
};

const DRAFT_KEY = "docknight-compose-draft";
const STATUS_POLL_MS = 3000;

export default function Stack(): ReactElement {
    const { t } = useT();
    const sizeClass = useSizeClass();
    const params = useParams();
    const { path } = useRoute();
    const { byKey } = useStore(stacks);
    const { byEndpoint, statuses } = useStore(agents);

    const stackName = params.name ?? "";
    const endpoint = params.endpoint ?? "";
    const isCreate = stackName === "" && path === "/compose";

    const hostLabel = endpoint === "" ? "" : byEndpoint[endpoint]?.name || endpoint;
    const hostOffline = endpoint !== "" && statuses[endpoint]?.status !== "online";
    const summary = byKey[makeStackKey(stackName, endpoint)];

    const [mode, setMode] = useState<"view" | "edit">(isCreate ? "edit" : "view");
    const [activeTab, setActiveTab] = useState<"compose" | "env">("compose");
    const [newName, setNewName] = useState("");
    const newNameRef = useRef<HTMLElement>(null);
    useElementEvent(newNameRef, "input", () => setNewName(elementValue(newNameRef)));

    // A converted `docker run` command arrives through session storage from the dashboard and
    // is consumed once, during the first render of the create screen.
    const [yamlText, setYamlText] = useState(() => {
        if (!isCreate) return "";
        const draft = sessionStorage.getItem(DRAFT_KEY);
        if (draft === null) return "";
        sessionStorage.removeItem(DRAFT_KEY);
        return draft;
    });
    const [initialYaml, setInitialYaml] = useState("");
    const [envText, setEnvText] = useState("");
    const [initialEnv, setInitialEnv] = useState("");
    const [config, setConfig] = useState<ComposeConfig>(() => parseCompose(yamlText).config);
    const [yamlError, setYamlError] = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState(false);
    const [overflowOpen, setOverflowOpen] = useState(false);

    const composeDirty = yamlText !== initialYaml;
    const envDirty = envText !== initialEnv;
    const dirty = composeDirty || envDirty;

    const settingsQuery = useQuery({
        queryKey: qk.settings(),
        queryFn: () => request<{ globalENV?: string }>("", "settings.get", undefined),
        staleTime: 60_000,
    });
    const globalEnv = settingsQuery.data?.globalENV ?? "";

    const stackQuery = useQuery({
        queryKey: qk.stack(endpoint, stackName),
        queryFn: () => request<{ stack: StackDetail }>(endpoint, "stack.get", { name: stackName }),
        enabled: !isCreate && stackName !== "",
    });

    // The editors are local state seeded from the fetched document. Every refetch hands back a
    // fresh object, so the seed compares content. While the user has unsaved edits nothing is
    // adopted and nothing is recorded as seen, so the pending server copy lands once they settle.
    const loaded = stackQuery.data?.stack;
    // StackDetail owns editability. The push summary only identifies an external stack.
    const stackIsManaged = loaded?.managed === true;
    const stackIsExternal = !stackIsManaged && summary?.managed === false;
    const editing = mode === "edit" && (isCreate || stackIsManaged);
    const [seenStack, setSeenStack] = useState<{ yaml: string; env: string } | null>(null);
    if (
        loaded !== undefined &&
        !dirty &&
        (seenStack === null ||
            seenStack.yaml !== loaded.composeYAML ||
            seenStack.env !== loaded.composeENV)
    ) {
        setSeenStack({ yaml: loaded.composeYAML, env: loaded.composeENV });
        setYamlText(loaded.composeYAML);
        setInitialYaml(loaded.composeYAML);
        setEnvText(loaded.composeENV);
        setInitialEnv(loaded.composeENV);
        setConfig(parseCompose(loaded.composeYAML).config);
        setYamlError(null);
    }

    // The variable-expanded view is a pure function of the two documents and the global env.
    const expanded = useMemo((): ComposeConfig => {
        const merged = { ...parseEnv(globalEnv), ...parseEnv(envText) };
        return expandForDisplay(yamlText, merged).config;
    }, [yamlText, envText, globalEnv]);

    const networksQuery = useQuery({
        queryKey: qk.networks(endpoint),
        queryFn: () => request<{ networks: string[] }>(endpoint, "docker.networks", undefined),
    });
    const availableNetworks = networksQuery.data?.networks ?? [];

    const statusQuery = useQuery({
        queryKey: qk.serviceStatus(endpoint, stackName),
        queryFn: () =>
            request<{ services?: Record<string, ServiceInstance[]> }>(endpoint, "stack.serviceStatus", {
                name: stackName,
            }),
        enabled: !isCreate && stackName !== "",
        refetchInterval: STATUS_POLL_MS,
    });
    const serviceStatus = statusQuery.data?.services ?? {};

    const statsQuery = useQuery({
        queryKey: qk.dockerStats(endpoint),
        queryFn: () =>
            request<{ stats?: Record<string, ContainerStats> }>(endpoint, "docker.stats", undefined),
        enabled: !isCreate,
        refetchInterval: STATUS_POLL_MS,
    });
    const stats = statsQuery.data?.stats ?? {};

    useEffect(
        () =>
            registerBeforeLeave(() => (dirty ? confirm(t("stack.unsavedChanges")) : true)),
        [dirty, t],
    );

    const saveMutation = useMutation({
        mutationFn: (target: string) =>
            request(endpoint, "stack.save", {
                name: target,
                composeYAML: yamlText,
                composeENV: envText,
                isCreate,
            }),
        onError: toastError,
    });

    const deployMutation = useMutation({
        mutationFn: (target: string) =>
            request(endpoint, "stack.deploy", { name: target }, { timeout: 0 }),
        onError: toastError,
    });

    const lifecycleMutation = useMutation({
        mutationFn: (action: string) => request(endpoint, action, { name: stackName }),
        onSuccess: () => toastSuccess(t("toast.saved")),
        onError: toastError,
    });

    const serviceMutation = useMutation({
        mutationFn: (vars: { action: string; service: string }) =>
            request(endpoint, vars.action, { stack: stackName, service: vars.service }),
        onError: toastError,
    });

    const submitting =
        saveMutation.isPending || deployMutation.isPending || lifecycleMutation.isPending;

    const targetName = isCreate ? newName.trim() : stackName;

    async function saveDraft(): Promise<void> {
        if (targetName === "") return;
        await saveMutation.mutateAsync(targetName);
        setInitialYaml(yamlText);
        setInitialEnv(envText);
        toastSuccess(t("toast.saved"));
        if (isCreate) await navigate(`/compose/${targetName}`);
    }

    async function deploy(): Promise<void> {
        if (targetName === "") return;
        await saveMutation.mutateAsync(targetName);
        await deployMutation.mutateAsync(targetName);
        setInitialYaml(yamlText);
        setInitialEnv(envText);
        setMode("view");
        toastSuccess(t("toast.saved"));
        if (isCreate) await navigate(`/compose/${targetName}`);
    }

    function discard(): void {
        setYamlText(initialYaml);
        setEnvText(initialEnv);
        setConfig(parseCompose(initialYaml).config);
        setYamlError(null);
        setMode("view");
    }

    function onComposeInput(value: string): void {
        setYamlText(value);
        const parsed = parseCompose(value);
        if (parsed.error !== null) {
            setYamlError(parsed.error);
            return;
        }
        setConfig(parsed.config);
        setYamlError(null);
    }

    function applyServicePatch(name: string, patch: Record<string, unknown>): void {
        const services = { ...(config.services ?? {}) };
        const current = services[name];
        if (current === undefined) return;
        services[name] = { ...current, ...patch };
        const next: ComposeConfig = { ...config, services };
        setConfig(next);
        setYamlText(serialiseWithComments(next, null).text);
    }

    function removeService(name: string): void {
        const services = { ...(config.services ?? {}) };
        delete services[name];
        const next: ComposeConfig = { ...config, services };
        setConfig(next);
        setYamlText(serialiseWithComments(next, null).text);
    }

    function statsForService(name: string): ContainerStats[] {
        const containerNames = new Set((serviceStatus[name] ?? []).map((instance) => instance.name));
        return Object.values(stats).filter(
            (entry) => entry.Name !== undefined && containerNames.has(entry.Name),
        );
    }

    function expandedPortsFor(name: string): string[] | undefined {
        const services = expanded.services ?? {};
        const service = services[name];
        if (service === undefined) return undefined;
        const ports = service.ports;
        return Array.isArray(ports) ? ports.filter((port) => typeof port === "string") : undefined;
    }

    const serviceNames = Object.keys(config.services ?? {});

    const editorPane = (
        <mdui-card>
            <div className="section">
                <mdui-tabs
                    value={activeTab}
                    full-width
                    onClick={(event) => {
                        // The tab strip is two controls; reading the clicked tab's own value keeps
                        // this independent of the component's change event timing.
                        const target = event.target;
                        if (!(target instanceof HTMLElement)) return;
                        const tab = target.closest("mdui-tab");
                        const value = tab?.getAttribute("value");
                        if (value === "compose" || value === "env") setActiveTab(value);
                    }}
                >
                    <mdui-tab value="compose">
                        {t("stack.tab.compose")}
                        {composeDirty ? <mdui-badge slot="badge" /> : null}
                    </mdui-tab>
                    <mdui-tab value="env">
                        {t("stack.tab.env")}
                        {envDirty ? <mdui-badge slot="badge" /> : null}
                    </mdui-tab>
                </mdui-tabs>

                {activeTab === "compose" ? (
                    <>
                        <CodeEditor
                            value={yamlText}
                            onChange={onComposeInput}
                            ariaLabel={t("stack.tab.compose")}
                        />
                        {yamlError !== null ? (
                            <p className="type-body-small danger-text" role="alert">
                                {yamlError}
                            </p>
                        ) : null}
                    </>
                ) : (
                    <CodeEditor
                        value={envText}
                        onChange={setEnvText}
                        ariaLabel={t("stack.tab.env")}
                    />
                )}
            </div>
        </mdui-card>
    );

    if (isCreate) {
        return (
            <div className="page stack-page">
                <div className="page-header stack-page__header">
                    <h1 className="type-headline-small">{t("stack.list.createFirst")}</h1>
                </div>

                <form
                    className="form-column"
                    onSubmit={(event: FormEvent<HTMLFormElement>) => {
                        event.preventDefault();
                        void saveDraft();
                    }}
                >
                    <mdui-text-field
                        ref={newNameRef}
                        variant="outlined"
                        label={t("stack.create.name")}
                        required
                        autocapitalize="none"
                        autocorrect="off"
                        spellcheck={false}
                    />
                </form>

                {editorPane}

                <div className="row">
                    <mdui-button
                        variant="filled"
                        disabled={submitting || targetName === ""}
                        loading={submitting}
                        onClick={() => void deploy()}
                    >
                        {t("stack.action.deploy")}
                    </mdui-button>
                    <mdui-button
                        variant="tonal"
                        disabled={submitting || targetName === ""}
                        onClick={() => void saveDraft()}
                    >
                        {t("stack.action.save")}
                    </mdui-button>
                </div>
            </div>
        );
    }

    const viewActions = [
        { label: t("stack.action.start"), action: "stack.start", icon: "play_arrow--outlined" },
        { label: t("stack.action.restart"), action: "stack.restart", icon: "restart_alt--outlined" },
        { label: t("stack.action.stop"), action: "stack.stop", icon: "stop--outlined" },
        { label: t("stack.action.update"), action: "stack.update", icon: "system_update_alt--outlined" },
        { label: t("stack.action.down"), action: "stack.down", icon: "arrow_downward--outlined" },
    ];

    return (
        <div className="page stack-page">
            <div className="page-header stack-page__header">
                <h1 className="type-headline-small">{stackName}</h1>
                {endpoint !== "" ? (
                    <span className="status-chip status-chip--info type-label-medium">{hostLabel}</span>
                ) : null}
                <StatusChip status={STATUS_WORD[summary?.status ?? 0] ?? "unknown"} />

                {sizeClass !== "compact" ? (
                    <div className="page-header__actions stack-page__actions">
                        {editing ? (
                            <>
                                <mdui-button
                                    variant="filled"
                                    disabled={submitting}
                                    loading={submitting}
                                    onClick={() => void deploy()}
                                >
                                    {t("stack.action.deploy")}
                                </mdui-button>
                                <mdui-button
                                    variant="tonal"
                                    disabled={submitting}
                                    onClick={() => void saveDraft()}
                                >
                                    {t("stack.action.save")}
                                </mdui-button>
                                <mdui-button variant="text" disabled={submitting} onClick={discard}>
                                    {t("stack.action.discard")}
                                </mdui-button>
                            </>
                        ) : (
                            <>
                                {stackIsManaged ? (
                                    <mdui-button variant="tonal" onClick={() => setMode("edit")}>
                                        {t("stack.action.edit")}
                                    </mdui-button>
                                ) : null}
                                {viewActions.map((entry) => (
                                    <mdui-button
                                        key={entry.action}
                                        variant="text"
                                        disabled={submitting}
                                        onClick={() => lifecycleMutation.mutate(entry.action)}
                                    >
                                        {entry.label}
                                    </mdui-button>
                                ))}
                                <mdui-button
                                    variant="text"
                                    className="danger-action"
                                    onClick={() => setDeleteConfirm(true)}
                                >
                                    {t("stack.action.delete")}
                                </mdui-button>
                            </>
                        )}
                    </div>
                ) : null}
            </div>

            {hostOffline ? (
                <div className="banner type-body-medium" role="status">
                    <mdui-icon name="cloud_off--outlined" />
                    {t("stack.hostOffline")}
                </div>
            ) : null}

            {stackIsExternal ? (
                <div className="banner banner--info type-body-medium" role="status">
                    <mdui-icon name="info--outlined" />
                    {t("stack.notManaged")}
                </div>
            ) : null}

            {stackIsManaged ? editorPane : null}

            <div className="section">
                {serviceNames.map((name) => (
                    <ServiceCard
                        key={name}
                        name={name}
                        stackName={stackName}
                        service={config.services?.[name]}
                        editable={editing}
                        multiService={serviceNames.length > 1}
                        status={serviceStatus[name]}
                        stats={statsForService(name)}
                        expandedPorts={expandedPortsFor(name)}
                        availableNetworks={availableNetworks}
                        onStart={(service) => serviceMutation.mutate({ action: "service.start", service })}
                        onStop={(service) => serviceMutation.mutate({ action: "service.stop", service })}
                        onRestart={(service) =>
                            serviceMutation.mutate({ action: "service.restart", service })
                        }
                        onRemove={removeService}
                        onServiceChange={applyServicePatch}
                    />
                ))}
            </div>

            <mdui-card>
                <div className="card-title">
                    <h2 className="type-title-medium">{t("stack.terminal.progress")}</h2>
                </div>
                <TerminalView
                    endpoint={endpoint}
                    terminal={composeTerminalName(endpoint, stackName)}
                    interactive={false}
                    rows={8}
                />
            </mdui-card>
            <mdui-card>
                <div className="card-title">
                    <h2 className="type-title-medium">{t("terminal.output")}</h2>
                </div>
                <TerminalView
                    endpoint={endpoint}
                    terminal={logsTerminalName(endpoint, stackName)}
                    interactive={false}
                    rows={20}
                />
            </mdui-card>

            {/*
              Compact carries one primary action plus an overflow sheet, so the thumb zone holds
              the action a user actually came for instead of a row of equal-weight buttons.
            */}
            {sizeClass === "compact" ? (
                <div className="stack-bottom-bar">
                    <mdui-button-icon
                        href="/"
                        icon="arrow_back"
                        aria-label={t("action.back")}
                        onClick={linkHandler("/")}
                    />
                    {editing ? (
                        <mdui-button
                            variant="filled"
                            disabled={submitting}
                            loading={submitting}
                            onClick={() => void deploy()}
                        >
                            {t("stack.action.deploy")}
                        </mdui-button>
                    ) : stackIsExternal ? (
                        <mdui-button variant="filled" onClick={() => setOverflowOpen(true)}>
                            {t("action.actions")}
                        </mdui-button>
                    ) : stackIsManaged ? (
                        <mdui-button variant="filled" onClick={() => setMode("edit")}>
                            {t("stack.action.edit")}
                        </mdui-button>
                    ) : null}
                    {stackIsManaged ? (
                        <mdui-button-icon
                            icon="more_vert"
                            aria-label={t("action.more")}
                            onClick={() => setOverflowOpen(true)}
                        />
                    ) : null}
                </div>
            ) : null}

            <BottomSheet
                open={overflowOpen}
                title={stackName}
                onClose={() => setOverflowOpen(false)}
            >
                <mdui-list>
                    {editing ? (
                        <>
                            <mdui-list-item
                                icon="save--outlined"
                                onClick={() => {
                                    setOverflowOpen(false);
                                    void saveDraft();
                                }}
                            >
                                {t("stack.action.save")}
                            </mdui-list-item>
                            <mdui-list-item
                                icon="undo"
                                onClick={() => {
                                    setOverflowOpen(false);
                                    discard();
                                }}
                            >
                                {t("stack.action.discard")}
                            </mdui-list-item>
                        </>
                    ) : (
                        viewActions.map((entry) => (
                            <mdui-list-item
                                key={entry.action}
                                icon={entry.icon}
                                disabled={submitting}
                                onClick={() => {
                                    setOverflowOpen(false);
                                    lifecycleMutation.mutate(entry.action);
                                }}
                            >
                                {entry.label}
                            </mdui-list-item>
                        ))
                    )}
                    <mdui-list-item
                        icon="delete--outlined"
                        className="danger-text"
                        onClick={() => {
                            setOverflowOpen(false);
                            setDeleteConfirm(true);
                        }}
                    >
                        {t("stack.action.delete")}
                    </mdui-list-item>
                </mdui-list>
            </BottomSheet>

            <ConfirmDialog
                open={deleteConfirm}
                danger
                title={t("stack.action.delete")}
                message={t("stack.action.deleteConfirm", { name: stackName })}
                confirmLabel={t("stack.action.delete")}
                onConfirm={() => {
                    setDeleteConfirm(false);
                    lifecycleMutation.mutate("stack.delete", {
                        onSuccess: () => void navigate("/"),
                    });
                }}
                onCancel={() => setDeleteConfirm(false)}
            />
        </div>
    );
}
