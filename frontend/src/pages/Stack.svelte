<script lang="ts">
    import { MediaQuery } from "svelte/reactivity";
    import { on, request } from "../lib/connection.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { agents } from "../lib/stores/agents.svelte.ts";
    import { stacks } from "../lib/stores/stacks.svelte.ts";
    import { settings } from "../lib/stores/settings.svelte.ts";
    import { toastError, toastResult } from "../lib/stores/toast.svelte.ts";
    import { route, navigate } from "../router.svelte.ts";
    import { CREATED, DRAFT, EXITED, RUNNING, type StackSummary } from "../../../common/stack.ts";
    import CodeEditor from "../components/CodeEditor.svelte";
    import ConfirmDialog from "../components/ConfirmDialog.svelte";
    import MenuButton, { type MenuItemSpec } from "../components/MenuButton.svelte";
    import ServiceCard from "../components/ServiceCard.svelte";
    import StatusChip from "../components/StatusChip.svelte";
    import TerminalView from "../components/TerminalView.svelte";
    import { composeTerminalName, logsTerminalName } from "../../../common/terminal.ts";
    import { parseCompose, serialiseWithComments, expandForDisplay, parseEnv } from "./compose/sync.ts";

    const isMedium = new MediaQuery("width >= 600px");
    const isExpanded = new MediaQuery("width >= 840px");

    const stackName = $derived(route.params.name ?? "");
    const endpoint = $derived(route.params.endpoint ?? "");
    const isCreate = $derived(stackName === "" && route.path === "/compose");

    const hostLabel = $derived(endpoint === "" ? "" : agents.byEndpoint[endpoint]?.name || endpoint);
    const hostOffline = $derived(endpoint !== "" && agents.statuses[endpoint]?.status !== "online");

    const stackKey = $derived(`${stackName} ${endpoint}`);
    const summary = $derived<StackSummary | undefined>(stacks.byKey[stackKey]);
    const stackStatus = $derived(summary?.status ?? 0);

    let mode = $state<"view" | "edit">("view");
    let activeTab = $state<"compose" | "env">("compose");

    let yamlText = $state("");
    let envText = $state("");
    let initialYaml = "";
    let initialEnv = "";
    let dirty = $state(false);

    let yamlError = $state<string | null>(null);
    let submitting = $state(false);
    let deleteConfirm = $state(false);

    let config = $state<{ services?: Record<string, unknown>; networks?: Record<string, unknown> }>({ services: {} });
    let serviceNames = $derived(Object.keys(config.services ?? {}));
    let availableNetworks = $state<string[]>([]);
    let serviceStatus = $state<Record<string, { state?: string; health?: string; status?: string; shellAvailable?: boolean }[]>>({});
    let stats = $state<Record<string, { Name: string; CPUPerc?: string; MemUsage?: string }[]>>({});
    let expanded = $state<{ services?: Record<string, { ports?: string[] }> }>({});

    $effect(() => {
        if (isCreate) {
            mode = "edit";
            const draft = sessionStorage.getItem("docknight-compose-draft");
            if (draft !== null) {
                yamlText = draft;
                initialYaml = draft;
                sessionStorage.removeItem("docknight-compose-draft");
            } else {
                yamlText = "services:\n  app:\n    image: nginx\n";
                initialYaml = yamlText;
            }
            envText = "";
            initialEnv = "";
            const parsed = parseCompose(yamlText);
            config = parsed.config;
        } else if (stackName !== "") {
            void loadStack();
        }
    });

    function globalEnvText(): string {
        return settings.values?.globalENV ?? "";
    }

    function mergedEnv(): Record<string, string> {
        return { ...parseEnv(globalEnvText()), ...parseEnv(envText) };
    }

    function refreshExpanded(): void {
        const result = expandForDisplay(yamlText, mergedEnv());
        expanded = result.config;
    }

    async function loadStack(): Promise<void> {
        try {
            const result = await request(endpoint, "stack.get", { name: stackName });
            yamlText = result.stack.composeYAML;
            initialYaml = result.stack.composeYAML;
            envText = result.stack.composeENV;
            initialEnv = result.stack.composeENV;
            const parsed = parseCompose(yamlText);
            config = parsed.config;
            refreshExpanded();
            dirty = false;
        } catch (error) {
            toastError(error);
        }
    }

    $effect(() => {
        if (endpoint !== undefined) {
            void request(endpoint, "docker.networks", undefined)
                .then((nets) => {
                    availableNetworks = nets.map((n: { Name: string }) => n.Name);
                })
                .catch(() => {
                    availableNetworks = [];
                });
        }
    });

    $effect(() => {
        if (stackName === "") return;
        const unsub = on("stats", (payload: { endpoint: string; stats: Record<string, { Name: string; CPUPerc?: string; MemUsage?: string }[]> }) => {
            if (payload.endpoint === endpoint) {
                stats = payload.stats;
            }
        });
        return unsub;
    });

    $effect(() => {
        if (stackName === "" || isCreate) return;
        let cancelled = false;
        async function poll(): Promise<void> {
            try {
                const [statusResult, statsResult] = await Promise.all([
                    request(endpoint, "stack.serviceStatus", { name: stackName }),
                    request(endpoint, "docker.stats", undefined),
                ]);
                if (cancelled) return;
                serviceStatus = (statusResult?.services ?? {}) as Record<string, { state?: string; health?: string; status?: string; shellAvailable?: boolean }[]>;
                if (statsResult?.stats) {
                    stats = statsResult.stats as Record<string, { Name: string; CPUPerc?: string; MemUsage?: string }[]>;
                }
            } catch {
                // keep last known values
            }
        }
        void poll();
        const timer = setInterval(() => void poll(), 3000);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    });

    function onEditorInput(val: string): void {
        yamlText = val;
        dirty = yamlText !== initialYaml || envText !== initialEnv;
        const parsed = parseCompose(val);
        if (parsed.error !== null) {
            yamlError = parsed.error;
        } else {
            config = parsed.config;
            yamlError = null;
            refreshExpanded();
        }
    }

    function onEditorFocus(): void {}
    function onEditorBlur(): void {}

    async function saveDraft(): Promise<void> {
        submitting = true;
        try {
            await request(endpoint, "stack.save", {
                name: stackName,
                compose: yamlText,
                env: envText,
                isCreate,
            });
            initialYaml = yamlText;
            initialEnv = envText;
            dirty = false;
            toastResult(t("stack.action.save"));
            if (isCreate) {
                await navigate(endpoint === "" ? `/compose/${stackName}` : `/compose/${stackName}/${endpoint}`);
            }
        } catch (error) {
            toastError(error);
        } finally {
            submitting = false;
        }
    }

    async function deploy(): Promise<void> {
        submitting = true;
        try {
            await request(endpoint, "stack.save", {
                name: stackName,
                compose: yamlText,
                env: envText,
                isCreate,
            });
            initialYaml = yamlText;
            initialEnv = envText;
            dirty = false;
            await request(endpoint, "stack.deploy", { name: stackName });
            toastResult(t("stack.action.deploy"));
            mode = "view";
        } catch (error) {
            toastError(error);
        } finally {
            submitting = false;
        }
    }

    function discard(): void {
        yamlText = initialYaml;
        envText = initialEnv;
        const parsed = parseCompose(initialYaml);
        config = parsed.config;
        dirty = false;
        mode = "view";
    }

    async function stackAction(method: string): Promise<void> {
        submitting = true;
        try {
            await request(endpoint, method, { name: stackName });
            toastResult(t(method));
        } catch (error) {
            toastError(error);
        } finally {
            submitting = false;
        }
    }

    async function confirmDelete(): Promise<void> {
        deleteConfirm = false;
        submitting = true;
        try {
            await request(endpoint, "stack.delete", { name: stackName });
            await navigate("/");
        } catch (error) {
            toastError(error);
        } finally {
            submitting = false;
        }
    }

    async function serviceAction(action: string, service: string): Promise<void> {
        try {
            await request(endpoint, action, { stack: stackName, service });
        } catch (error) {
            toastError(error);
        }
    }

    function removeService(serviceName: string): void {
        const next = { ...config };
        if (next.services) {
            delete next.services[serviceName];
            config = next;
            const res = serialiseWithComments(next, null);
            yamlText = res.text;
            dirty = true;
        }
    }

    function statsForService(serviceName: string) {
        const containerNames = new Set(((serviceStatus ?? {})[serviceName] ?? []).map((s: { name?: string }) => s.name));
        return Object.values(stats ?? {}).filter((entry: { Name?: string }) => containerNames.has(entry.Name));
    }

    function getServiceStatus(serviceName: string) {
        return (serviceStatus ?? {})[serviceName];
    }
    function getExpandedPorts(service: string): string[] | undefined {
        const s = (expanded?.services ?? {}) as Record<string, { ports?: string[] }>;
        return s[service]?.ports;
    }
    function statusWord(status: number): string {
        if (status === RUNNING) return "running";
        if (status === EXITED) return "exited";
        if (status === CREATED) return "created";
        if (status === DRAFT) return "draft";
        return "unknown";
    }

    const moreMenuItems = $derived.by((): MenuItemSpec[] => [
        { label: t("stack.action.down"), onSelect: () => void stackAction("stack.down") },
        { label: t("stack.action.delete"), danger: true, onSelect: () => (deleteConfirm = true) },
    ]);

    const editMenuItems = $derived.by((): MenuItemSpec[] => [
        { label: t("stack.action.save"), onSelect: () => void saveDraft() },
        { label: t("stack.action.discard"), onSelect: () => void discard() },
    ]);
</script>

<div class="gcp-stack-page" data-audit-root data-grid-origin>
    {#if isCreate}
        <div class="gcp-stack-header" data-audit-row="center">
            <h1 class="text-headline">{t("stack.list.createFirst")}</h1>
        </div>
    {:else}
        <div class="gcp-stack-header" data-audit-row="center">
            <h1 class="text-headline">{stackName}</h1>
            {#if endpoint !== ""}
                <span class="gcp-host-badge text-label">{hostLabel}</span>
            {/if}
            <StatusChip status={statusWord(stackStatus)} />
        </div>

        {#if hostOffline}
            <div class="gcp-offline-banner text-body-medium">{t("stack.hostOffline")}</div>
        {/if}

        {#if isMedium.current}
            <div class="gcp-action-bar action-bar" data-audit-row="center">
                {#if mode === "edit"}
                    <button type="button" class="gcp-btn-primary" disabled={submitting} onclick={deploy}>
                        {t("stack.action.deploy")}
                    </button>
                    <button type="button" class="gcp-btn-action" disabled={submitting} onclick={saveDraft}>
                        {t("stack.action.save")}
                    </button>
                    <button type="button" class="gcp-btn-action" disabled={submitting} onclick={discard}>
                        {t("stack.action.discard")}
                    </button>
                {:else}
                    <button type="button" class="gcp-btn-action" onclick={() => (mode = "edit")}>
                        {t("stack.action.edit")}
                    </button>
                    <button type="button" class="gcp-btn-action" disabled={submitting} onclick={() => void stackAction("stack.start")}>
                        {t("stack.action.start")}
                    </button>
                    <button type="button" class="gcp-btn-action" disabled={submitting} onclick={() => void stackAction("stack.restart")}>
                        {t("stack.action.restart")}
                    </button>
                    <button type="button" class="gcp-btn-action" disabled={submitting} onclick={() => void stackAction("stack.stop")}>
                        {t("stack.action.stop")}
                    </button>
                    <button type="button" class="gcp-btn-action" disabled={submitting} onclick={() => void stackAction("stack.update")}>
                        {t("stack.action.update")}
                    </button>
                    <MenuButton items={moreMenuItems} />
                {/if}
            </div>
        {/if}

        <div class="gcp-editors" class:stacked={!isExpanded.current}>
            {#if !isExpanded.current}
                <div class="gcp-tabs" data-audit-row="center">
                    <button
                        type="button"
                        class:active={activeTab === "compose"}
                        onclick={() => (activeTab = "compose")}
                    >
                        {t("stack.tab.compose")}
                    </button>
                    <button type="button" class:active={activeTab === "env"} onclick={() => (activeTab = "env")}>
                        {t("stack.tab.env")}{dirty && activeTab !== "env" ? ` (${t("stack.unsavedChanges")})` : ""}
                    </button>
                </div>
            {/if}
            {#if isExpanded.current || activeTab === "compose"}
                <div class="gcp-editor-pane">
                    <CodeEditor
                        value={yamlText}
                        oninput={onEditorInput}
                        onfocus={onEditorFocus}
                        onblur={onEditorBlur}
                        ariaLabel={t("stack.tab.compose")}
                    />
                    {#if yamlError !== null}
                        <p class="gcp-yaml-error text-label">{yamlError}</p>
                    {/if}
                </div>
            {/if}
            {#if isExpanded.current || activeTab === "env"}
                <div class="gcp-editor-pane">
                    <CodeEditor
                        value={envText}
                        oninput={(v) => {
                            envText = v;
                            dirty = yamlText !== initialYaml || envText !== initialEnv;
                        }}
                        onfocus={onEditorFocus}
                        onblur={onEditorBlur}
                        ariaLabel={t("stack.tab.env")}
                    />
                </div>
            {/if}
        </div>

        <div class="gcp-services" data-audit-column>
            {#each serviceNames as serviceName (serviceName)}
                {@const currentService = (config.services ?? {})[serviceName]}
                {#if currentService}
                    <ServiceCard
                        name={serviceName}
                        service={currentService as never}
                        editable={mode === "edit"}
                        multiService={serviceNames.length > 1}
                        status={getServiceStatus(serviceName)}
                        stats={statsForService(serviceName)}
                        expandedPorts={getExpandedPorts(serviceName)}
                        {availableNetworks}
                        onstart={(n) => void serviceAction("service.start", n)}
                        onstop={(n) => void serviceAction("service.stop", n)}
                        onrestart={(n) => void serviceAction("service.restart", n)}
                        onremove={removeService}
                    />
                {/if}
            {/each}
        </div>

        <div class="gcp-terminals" data-audit-column>
            <TerminalView
                {endpoint}
                terminal={composeTerminalName(endpoint, stackName)}
                interactive={false}
                rows={8}
            />
            <TerminalView
                {endpoint}
                terminal={logsTerminalName(endpoint, stackName)}
                interactive={false}
                rows={20}
            />
        </div>

        {#if !isMedium.current}
            <div class="gcp-bottom-bar bottom-app-bar action-bar" data-audit-row="center">
                <a
                    href="/"
                    class="gcp-back-action"
                    aria-label={t("action.back")}
                    onclick={(e) => {
                        e.preventDefault();
                        void navigate("/");
                    }}
                >
                    ←
                </a>
                {#if mode === "edit"}
                    <button type="button" class="gcp-btn-primary" disabled={submitting} onclick={deploy}>
                        {t("stack.action.deploy")}
                    </button>
                    <MenuButton items={editMenuItems} />
                {:else}
                    <button type="button" class="gcp-btn-primary" onclick={() => (mode = "edit")}>
                        {t("stack.action.edit")}
                    </button>
                    <button type="button" class="gcp-btn-action" disabled={submitting} onclick={() => void stackAction("stack.start")}>
                        {t("stack.action.start")}
                    </button>
                    <MenuButton items={moreMenuItems} />
                {/if}
            </div>
        {/if}
    {/if}
</div>

<ConfirmDialog
    open={deleteConfirm}
    title={t("stack.action.delete")}
    message={t("stack.action.deleteConfirm", { name: stackName })}
    danger
    onconfirm={confirmDelete}
    oncancel={() => (deleteConfirm = false)}
/>

<style>
    .gcp-stack-page {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        padding: var(--space-4);
        min-width: 0;
    }

    .gcp-stack-header {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--space-2);
    }

    .gcp-stack-header h1 {
        min-width: 0;
        overflow-wrap: anywhere;
        font-weight: 600;
        font-size: 20px;
    }

    .gcp-host-badge {
        padding-inline: var(--space-2);
        border-radius: var(--radius-xs);
        background: var(--m3c-secondary-container);
        color: var(--m3c-on-secondary-container);
        font-size: 11px;
        font-weight: 600;
    }

    .gcp-offline-banner {
        padding: var(--space-3);
        border-radius: var(--radius-sm);
        background: var(--m3c-error-container);
        color: var(--m3c-on-error-container);
    }

    .gcp-action-bar {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
    }

    .gcp-btn-action,
    .gcp-tabs button {
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

    .gcp-btn-primary {
        height: var(--size-control-md);
        padding-inline: var(--space-4);
        border: none;
        border-radius: var(--radius-xs);
        background: var(--m3c-primary);
        color: var(--m3c-on-primary);
        font-weight: 600;
        font-size: 13px;
        cursor: pointer;
    }

    .gcp-btn-action:hover,
    .gcp-tabs button:hover {
        background: var(--m3c-surface-container-highest);
    }

    .gcp-btn-primary:hover {
        background: var(--m3c-primary-dim);
    }

    .gcp-tabs button.active {
        border-color: transparent;
        background: var(--m3c-primary);
        color: var(--m3c-on-primary);
        font-weight: 600;
    }

    .gcp-editors {
        display: grid;
        grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
        gap: var(--space-4);
        block-size: var(--measure-editor-lg);
    }

    .gcp-editors.stacked {
        grid-template-columns: minmax(0, 1fr);
        block-size: auto;
    }

    .gcp-tabs {
        display: flex;
        gap: var(--space-2);
    }

    .gcp-editor-pane {
        min-width: 0;
        block-size: var(--measure-editor-lg);
        display: flex;
        flex-direction: column;
    }

    .gcp-yaml-error {
        color: var(--m3c-error);
        margin-block-start: var(--space-2);
    }

    .gcp-services {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
    }

    .gcp-terminals {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
    }

    .gcp-bottom-bar {
        position: sticky;
        inset-block-end: 0;
        height: var(--size-bottom-bar);
        padding-inline: var(--space-4);
        background: var(--m3c-surface-container);
        border-block-start: 1px solid var(--m3c-outline-variant);
        display: flex;
        align-items: center;
        gap: var(--space-2);
        z-index: 10;
    }

    .gcp-bottom-bar .gcp-btn-primary {
        flex: 1;
    }

    .gcp-back-action {
        display: flex;
        align-items: center;
        justify-content: center;
        width: var(--size-control-lg);
        height: var(--size-control-lg);
        color: var(--m3c-on-surface);
        text-decoration: none;
        flex-shrink: 0;
    }
</style>
