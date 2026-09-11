import { useMutation } from "@tanstack/react-query";
import {
    type CSSProperties,
    type FormEvent,
    type ReactElement,
    type ReactNode,
    type RefObject,
    useMemo,
    useRef,
    useState,
} from "react";
import { EXITED, RUNNING } from "../../../common/stack.ts";
import ConfirmDialog from "../components/ConfirmDialog.tsx";
import RowActions from "../components/RowActions.tsx";
import BottomSheet from "../components/BottomSheet.tsx";
import { elementValue, setElementValue, useElementEvent } from "../lib/dom-events.ts";
import { useT } from "../lib/i18n.ts";
import { useSizeClass } from "../lib/media.ts";
import { type AgentStatusValue, agents, stacks } from "../lib/push.ts";
import { navigate } from "../lib/router.ts";
import { useStore } from "../lib/store.ts";
import { request } from "../lib/transport.ts";
import "./Dashboard.css";

const HOST_DOT_COLOR: Record<AgentStatusValue, string> = {
    online: "rgb(var(--mdui-color-success))",
    offline: "rgb(var(--mdui-color-error))",
    unreachable: "rgb(var(--mdui-color-outline))",
    connecting: "rgb(var(--mdui-color-outline))",
};

interface DotStyle extends CSSProperties {
    "--host-dot-color": string;
}

function dotStyle(color: string): DotStyle {
    return { "--host-dot-color": color };
}

function errorText(error: Error | null, fallback: string): string | null {
    if (error === null) return null;
    return error.message !== "" ? error.message : fallback;
}

interface AddHostFields {
    urlRef: RefObject<HTMLElement | null>;
    usernameRef: RefObject<HTMLElement | null>;
    passwordRef: RefObject<HTMLElement | null>;
    nameRef: RefObject<HTMLElement | null>;
    url: string;
    error: string | null;
    pending: boolean;
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function AddHostForm({
    urlRef,
    usernameRef,
    passwordRef,
    nameRef,
    url,
    error,
    pending,
    onSubmit,
}: AddHostFields): ReactElement {
    const { t } = useT();
    return (
        <form className="form-column" onSubmit={onSubmit}>
            {error !== null ? (
                <span className="type-label-medium danger-text" role="alert">
                    {error}
                </span>
            ) : null}
            <mdui-text-field ref={urlRef} variant="outlined" label={t("host.url")} required />
            <mdui-text-field ref={usernameRef} variant="outlined" label={t("host.username")} required />
            <mdui-text-field
                ref={passwordRef}
                variant="outlined"
                type="password"
                toggle-password
                label={t("host.password")}
            />
            <mdui-text-field ref={nameRef} variant="outlined" label={t("host.name")} />
            <mdui-button type="submit" variant="filled" disabled={pending || url.trim() === ""}>
                {t("dashboard.hosts.add")}
            </mdui-button>
        </form>
    );
}

export default function Dashboard(): ReactElement {
    const { t } = useT();
    const sizeClass = useSizeClass();
    const { byKey } = useStore(stacks);
    const { byEndpoint, statuses } = useStore(agents);

    const counts = useMemo(() => {
        let active = 0;
        let exited = 0;
        let inactive = 0;
        for (const summary of Object.values(byKey)) {
            if (summary.status === RUNNING) active++;
            else if (summary.status === EXITED) exited++;
            else inactive++;
        }
        return { active, exited, inactive };
    }, [byKey]);

    // Composerize converter
    const [dockerRunCommand, setDockerRunCommand] = useState("");
    const commandRef = useRef<HTMLElement>(null);
    useElementEvent(commandRef, "input", () => setDockerRunCommand(elementValue(commandRef)));

    const convertMutation = useMutation({
        mutationFn: (command: string) =>
            request<{ composeYAML?: string }>("", "docker.composerize", { command }),
    });
    const converterError = errorText(convertMutation.error, t("error.invalidCompose"));

    async function handleConvert(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        const cmd = dockerRunCommand.trim();
        if (cmd === "" || convertMutation.isPending) return;
        try {
            const res = await convertMutation.mutateAsync(cmd);
            if (res.composeYAML !== undefined) {
                sessionStorage.setItem("docknight-compose-draft", res.composeYAML);
                await navigate("/compose");
            }
        } catch {
            // surfaced via convertMutation.error above
        }
    }

    // Host management
    const addUrlRef = useRef<HTMLElement>(null);
    const addUsernameRef = useRef<HTMLElement>(null);
    const addPasswordRef = useRef<HTMLElement>(null);
    const addNameRef = useRef<HTMLElement>(null);
    const [addUrl, setAddUrl] = useState("");
    const [addSheetOpen, setAddSheetOpen] = useState(false);
    useElementEvent(addUrlRef, "input", () => setAddUrl(elementValue(addUrlRef)));

    const addHostMutation = useMutation({
        mutationFn: (vars: { url: string; username: string; password: string; name?: string }) =>
            request("", "agent.add", vars),
    });
    const addHostError = errorText(addHostMutation.error, t("error.agentUnreachable"));

    const [removeTargetUrl, setRemoveTargetUrl] = useState<string | null>(null);
    const [renameTargetEndpoint, setRenameTargetEndpoint] = useState<string | null>(null);
    const [renameNewName, setRenameNewName] = useState("");
    const renameNameRef = useRef<HTMLElement>(null);
    useElementEvent(renameNameRef, "input", () => setRenameNewName(elementValue(renameNameRef)));

    const removeHostMutation = useMutation({
        mutationFn: (url: string) => request("", "agent.remove", { url }),
    });
    const renameHostMutation = useMutation({
        mutationFn: (vars: { endpoint: string; name: string }) => request("", "agent.rename", vars),
    });

    async function handleAddHost(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        const url = addUrl.trim();
        if (url === "" || addHostMutation.isPending) return;
        const username = elementValue(addUsernameRef).trim();
        const password = elementValue(addPasswordRef);
        const name = elementValue(addNameRef).trim();
        try {
            await addHostMutation.mutateAsync({ url, username, password, name: name || undefined });
            setAddUrl("");
            setElementValue(addUrlRef, "");
            setElementValue(addUsernameRef, "");
            setElementValue(addPasswordRef, "");
            setElementValue(addNameRef, "");
            setAddSheetOpen(false);
        } catch {
            // surfaced via addHostMutation.error above
        }
    }

    async function confirmRemoveHost(): Promise<void> {
        if (removeTargetUrl === null) return;
        const target = removeTargetUrl;
        setRemoveTargetUrl(null);
        try {
            await removeHostMutation.mutateAsync(target);
        } catch {
            // The old dashboard did not surface remove failures either.
        }
    }

    async function confirmRenameHost(): Promise<void> {
        if (renameTargetEndpoint === null) return;
        const endpoint = renameTargetEndpoint;
        const name = renameNewName.trim();
        setRenameTargetEndpoint(null);
        try {
            await renameHostMutation.mutateAsync({ endpoint, name });
        } catch {
            // The old dashboard did not surface rename failures either.
        }
    }

    const remoteAgents = Object.values(byEndpoint).filter((agent) => agent.endpoint !== "");

    const addHostForm: ReactNode = (
        <AddHostForm
            urlRef={addUrlRef}
            usernameRef={addUsernameRef}
            passwordRef={addPasswordRef}
            nameRef={addNameRef}
            url={addUrl}
            error={addHostError}
            pending={addHostMutation.isPending}
            onSubmit={(event) => void handleAddHost(event)}
        />
    );

    return (
        <div className="page dashboard-page">
            <div className="page-header">
                <h1 className="type-headline-small">{t("dashboard.title")}</h1>
            </div>

            <mdui-card variant="filled" className="dashboard-overview">
                <div className="card-title">
                    <h2 className="type-title-medium">{t("dashboard.stacks.title")}</h2>
                </div>
                <div className="dashboard-metrics">
                    <div className="metric-card metric-card--active">
                        <div className="metric-card__label type-label-medium">
                            <mdui-icon name="play_circle--outlined" aria-hidden="true" />
                            <span>{t("dashboard.stacks.active")}</span>
                        </div>
                        <strong className="metric-card__value type-display-small">{counts.active}</strong>
                    </div>
                    <div className="metric-card metric-card--exited">
                        <div className="metric-card__label type-label-medium">
                            <mdui-icon name="error--outlined" aria-hidden="true" />
                            <span>{t("dashboard.stacks.exited")}</span>
                        </div>
                        <strong className="metric-card__value type-display-small">{counts.exited}</strong>
                    </div>
                    <div className="metric-card metric-card--inactive">
                        <div className="metric-card__label type-label-medium">
                            <mdui-icon name="pause_circle--outlined" aria-hidden="true" />
                            <span>{t("dashboard.stacks.inactive")}</span>
                        </div>
                        <strong className="metric-card__value type-display-small">{counts.inactive}</strong>
                    </div>
                </div>
            </mdui-card>

            <mdui-card variant="filled" className="dashboard-converter">
                <div className="card-title">
                    <h2 className="type-title-medium">{t("dashboard.converter.title")}</h2>
                </div>
                <form className="form-column" onSubmit={(event) => void handleConvert(event)}>
                    <mdui-text-field
                        ref={commandRef}
                        variant="outlined"
                        rows={3}
                        autosize
                        className="mono"
                        placeholder={t("dashboard.converter.placeholder")}
                        label={t("dashboard.converter.title")}
                    />
                    {converterError !== null ? (
                        <span className="type-label-medium danger-text" role="alert">
                            {converterError}
                        </span>
                    ) : null}
                    <div className="form-actions form-actions--end">
                        <mdui-button
                            type="submit"
                            variant="filled"
                            disabled={convertMutation.isPending || dockerRunCommand.trim() === ""}
                        >
                            {t("dashboard.converter.submit")}
                        </mdui-button>
                    </div>
                </form>
            </mdui-card>

            <mdui-card variant="filled" className="dashboard-hosts">
                <div className="card-title">
                    <h2 className="type-title-medium">{t("dashboard.hosts.title")}</h2>
                </div>

                <mdui-list>
                    <mdui-list-item headline={`${t("nav.home")} (Local)`} rounded nonclickable>
                        <span
                            slot="icon"
                            className="host-dot"
                            style={dotStyle(HOST_DOT_COLOR.online)}
                            aria-hidden="true"
                        />
                    </mdui-list-item>

                    {remoteAgents.map((agent) => {
                        const status = statuses[agent.endpoint]?.status ?? "connecting";
                        const displayName = agent.name !== undefined && agent.name !== "" ? agent.name : agent.endpoint;
                        return (
                            <mdui-list-item
                                key={agent.endpoint}
                                headline={displayName}
                                description={agent.url}
                                rounded
                                nonclickable
                            >
                                <span
                                    slot="icon"
                                    className="host-dot"
                                    style={dotStyle(HOST_DOT_COLOR[status])}
                                    aria-hidden="true"
                                />
                                <div slot="end-icon">
                                    <RowActions
                                        title={displayName}
                                        actions={[
                                            {
                                                label: t("dashboard.hosts.rename"),
                                                icon: "edit--outlined",
                                                onSelect: () => {
                                                    setRenameTargetEndpoint(agent.endpoint);
                                                    const initial = agent.name ?? "";
                                                    setRenameNewName(initial);
                                                    setElementValue(renameNameRef, initial);
                                                },
                                            },
                                            {
                                                label: t("dashboard.hosts.remove"),
                                                icon: "delete--outlined",
                                                danger: true,
                                                onSelect: () => setRemoveTargetUrl(agent.url),
                                            },
                                        ]}
                                    />
                                </div>
                            </mdui-list-item>
                        );
                    })}
                </mdui-list>

                {sizeClass === "compact" ? (
                    <>
                        <mdui-button
                            variant="tonal"
                            icon="add"
                            onClick={() => setAddSheetOpen(true)}
                        >
                            {t("dashboard.hosts.add")}
                        </mdui-button>
                        <BottomSheet
                            open={addSheetOpen}
                            title={t("dashboard.hosts.add")}
                            onClose={() => setAddSheetOpen(false)}
                        >
                            {addHostForm}
                        </BottomSheet>
                    </>
                ) : (
                    <>
                        <mdui-divider />
                        <div className="card-title">
                            <span className="type-title-medium">{t("dashboard.hosts.add")}</span>
                        </div>
                        {addHostForm}
                    </>
                )}
            </mdui-card>

            <ConfirmDialog
                open={removeTargetUrl !== null}
                title={t("dashboard.hosts.remove")}
                message={t("dashboard.hosts.removeConfirm", { url: removeTargetUrl ?? "" })}
                danger
                onConfirm={() => void confirmRemoveHost()}
                onCancel={() => setRemoveTargetUrl(null)}
            />

            <ConfirmDialog
                open={renameTargetEndpoint !== null}
                title={t("dashboard.hosts.rename")}
                confirmLabel={t("action.save")}
                onConfirm={() => void confirmRenameHost()}
                onCancel={() => setRenameTargetEndpoint(null)}
            >
                <mdui-text-field ref={renameNameRef} variant="outlined" label={t("host.name")} />
            </ConfirmDialog>
        </div>
    );
}
