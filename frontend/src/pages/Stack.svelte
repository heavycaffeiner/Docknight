<script lang="ts">
    import { MediaQuery } from "svelte/reactivity";
    import { untrack } from "svelte";
    import type { Document } from "yaml";
    import { CREATED, DRAFT, EXITED, RUNNING } from "../../../common/stack.ts";
    import { logsTerminalName, composeTerminalName } from "../../../common/terminal.ts";
    import { request } from "../lib/connection.svelte.ts";
    import { route, navigate, onBeforeLeave } from "../router.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { settings } from "../lib/stores/settings.svelte.ts";
    import { agents } from "../lib/stores/agents.svelte.ts";
    import { stacks } from "../lib/stores/stacks.svelte.ts";
    import { toastError, toastResult } from "../lib/stores/toast.svelte.ts";
    import {
        expandForDisplay,
        parseCompose,
        parseEnv,
        serialiseWithComments,
        type ComposeConfig,
    } from "./compose/sync.ts";
    import CodeEditor from "../components/CodeEditor.svelte";
    import ServiceCard from "../components/ServiceCard.svelte";
    import EmptyState from "../components/EmptyState.svelte";
    import ConfirmDialog from "../components/ConfirmDialog.svelte";
    import MenuButton from "../components/MenuButton.svelte";
    import StatusChip from "../components/StatusChip.svelte";
    import TerminalView from "../components/TerminalView.svelte";

    const stackName = $derived(route.params.name ?? "");
    const endpoint = $derived(route.params.endpoint ?? "");
    const isCreate = $derived(stackName === "");

    const isMedium = new MediaQuery("width >= 600px");
    const isExpanded = new MediaQuery("width >= 840px");

    type Mode = "view" | "edit";
    // Reset by load() below on every route change, not just captured once at mount.
    let mode = $state<Mode>(untrack(() => (isCreate ? "edit" : "view")));
    let notFound = $state(false);
    let managed = $state(true);

    let yamlText = $state("");
    let envText = $state("");
    let doc = $state<Document | null>(null);
    let config = $state<ComposeConfig>({});
    let expanded = $state<ComposeConfig>({});
    let yamlError = $state<string | null>(null);
    let dirty = $state(false);
    let submitting = $state(false);
    let activeTab = $state<"compose" | "env">("compose");

    let writer: "text" | "form" | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;

    const stackStatus = $derived(stacks.byKey[`${stackName} ${endpoint}`]?.status ?? 0);

    function statusWord(value: number): string {
        if (value === RUNNING) return "running";
        if (value === EXITED) return "exited";
        if (value === CREATED) return "created";
        if (value === DRAFT) return "draft";
        return "unknown";
    }

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

    function onEditorInput(next: string): void {
        yamlText = next;
        dirty = true;
    }

    function onEditorFocus(): void {
        writer = "text";
    }

    function onEditorBlur(): void {
        // Blur does not flush; the last keystroke has already applied to yamlText.
        writer = null;
    }

    $effect(() => {
        if (writer !== "text") return;
        const text = yamlText;
        if (graceTimer !== null) clearTimeout(graceTimer);
        const debounce = setTimeout(() => {
            const result = parseCompose(text);
            if (result.error !== null) {
                if (graceTimer !== null) clearTimeout(graceTimer);
                graceTimer = setTimeout(() => {
                    yamlError = result.error;
                }, 3000);
                return;
            }
            if (graceTimer !== null) clearTimeout(graceTimer);
            graceTimer = null;
            doc = result.doc;
            config = result.config;
            yamlError = null;
            refreshExpanded();
        }, 250);
        return () => clearTimeout(debounce);
    });

    function onFormInput(): void {
        if (writer === "text") return;
        writer = "form";
        const { text, doc: nextDoc } = serialiseWithComments(config, doc);
        doc = nextDoc;
        yamlText = text;
        dirty = true;
        refreshExpanded();
        writer = null;
    }

    async function load(): Promise<void> {
        notFound = false;
        mode = isCreate ? "edit" : "view";
        if (isCreate) {
            yamlText = sessionStorage.getItem("docknight-compose-draft") ?? "services: {}\n";
            sessionStorage.removeItem("docknight-compose-draft");
            envText = "";
            const result = parseCompose(yamlText);
            doc = result.doc;
            config = result.config;
            refreshExpanded();
            return;
        }
        try {
            const result = await request(endpoint, "stack.get", { name: stackName });
            yamlText = result.stack.composeYAML;
            envText = result.stack.composeENV;
            managed = result.stack.managed;
            const parsed = parseCompose(yamlText);
            doc = parsed.doc;
            config = parsed.config;
            refreshExpanded();
            dirty = false;
        } catch (error) {
            if (error instanceof Error && "code" in error && (error as { code?: string }).code === "notFound") {
                notFound = true;
                return;
            }
            toastError(error);
        }
    }

    $effect(() => {
        void stackName;
        void endpoint;
        untrack(() => void load());
    });

    onBeforeLeave(() => {
        if (mode === "edit" && dirty) {
            return confirm("Discard unsaved changes?");
        }
        return true;
    });

    $effect(() => {
        function onBeforeUnload(event: BeforeUnloadEvent): void {
            if (mode === "edit" && dirty) event.preventDefault();
        }
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    });

    async function withSubmitting(action: () => Promise<void>): Promise<void> {
        submitting = true;
        try {
            await action();
        } catch (error) {
            toastError(error);
        } finally {
            submitting = false;
        }
    }

    async function deploy(): Promise<void> {
        await withSubmitting(async () => {
            const name = stackName;
            await request(endpoint, "stack.deploy", {
                name,
                composeYAML: yamlText,
                composeENV: envText,
                isCreate,
            });
            mode = "view";
            dirty = false;
            toastResult(t("toast.saved"));
            if (isCreate) await navigate(`/compose/${name}`);
        });
    }

    async function saveDraft(): Promise<void> {
        await withSubmitting(async () => {
            await request(endpoint, "stack.save", {
                name: stackName,
                composeYAML: yamlText,
                composeENV: envText,
                isCreate,
            });
            dirty = false;
            toastResult(t("toast.saved"));
        });
    }

    async function discard(): Promise<void> {
        mode = "view";
        await load();
    }

    let deleteConfirm = $state(false);

    async function stackAction(
        method: "stack.start" | "stack.restart" | "stack.stop" | "stack.update" | "stack.down",
    ): Promise<void> {
        await withSubmitting(async () => {
            await request(endpoint, method, { name: stackName });
        });
    }

    async function deleteStack(): Promise<void> {
        deleteConfirm = false;
        await withSubmitting(async () => {
            await request(endpoint, "stack.delete", { name: stackName });
            await navigate("/");
        });
    }

    async function serviceAction(
        method: "service.start" | "service.stop" | "service.restart",
        service: string,
    ): Promise<void> {
        try {
            await request(endpoint, method, { stack: stackName, service });
        } catch (error) {
            toastError(error);
        }
    }

    function removeService(name: string): void {
        const services = { ...(config.services as Record<string, unknown> | undefined) };
        delete services[name];
        config = { ...config, services };
        onFormInput();
    }

    const serviceNames = $derived(
        Object.keys((config.services as Record<string, unknown> | undefined) ?? {}),
    );

    interface StatEntry {
        Name: string;
        CPUPerc?: string;
        MemUsage?: string;
    }

    let serviceStatus = $state<Record<string, { name: string; status: string }[]>>({});
    let stats = $state<Record<string, StatEntry>>({});
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    /** docker.stats is keyed by container name; match every container belonging to one service. */
    function statsForService(serviceName: string): StatEntry[] {
        const containerNames = new Set((serviceStatus[serviceName] ?? []).map((s) => s.name));
        return Object.values(stats).filter((entry) => containerNames.has(entry.Name));
    }

    async function poll(): Promise<void> {
        if (isCreate || mode === "edit") return;
        try {
            const [statusResult, statsResult] = await Promise.all([
                request(endpoint, "stack.serviceStatus", { name: stackName }),
                request(endpoint, "docker.stats", undefined),
            ]);
            serviceStatus = statusResult.services;
            stats = statsResult.stats as Record<string, StatEntry>;
        } catch {
            // keep the last known values; retry next tick
        }
    }

    $effect(() => {
        if (isCreate) return;
        void poll();
        pollTimer = setInterval(() => void poll(), 5000);
        return () => {
            if (pollTimer !== null) clearInterval(pollTimer);
        };
    });

    const hostOffline = $derived(endpoint !== "" && agents.statuses[endpoint]?.status === "offline");

    const availableNetworks = $state<string[]>([]);
    $effect(() => {
        request(endpoint, "docker.networks", undefined)
            .then((result) => {
                availableNetworks.length = 0;
                availableNetworks.push(...result.networks);
            })
            .catch(() => undefined);
    });
</script>

<div class="page" data-audit-root data-grid-origin>
    {#if notFound}
        <EmptyState message={t("stack.list.empty")}>
            {#snippet action()}
                <a
                    class="back-link"
                    href="/"
                    onclick={(e) => {
                        e.preventDefault();
                        void navigate("/");
                    }}
                >
                    {t("action.back")}
                </a>
            {/snippet}
        </EmptyState>
    {:else if !managed && !isCreate}
        <EmptyState message={t("stack.notManaged")} />
    {:else}
        <div class="header" data-audit-row="center">
            <h1 class="text-headline">{stackName || t("stack.action.deploy")}</h1>
            {#if endpoint !== ""}
                <span class="badge text-label">{agents.byEndpoint[endpoint]?.name || endpoint}</span>
            {/if}
            {#if !isCreate}
                <StatusChip status={statusWord(stackStatus)} />
            {/if}
        </div>

        {#if hostOffline}
            <div class="offline-banner text-body-medium">{t("stack.hostOffline")}</div>
        {/if}

        {#if isMedium.current}
            <div class="action-bar" data-audit-row="center">
                {#if mode === "edit"}
                    <button type="button" class="primary" disabled={submitting} onclick={deploy}>
                        {t("stack.action.deploy")}
                    </button>
                    <button type="button" disabled={submitting} onclick={saveDraft}>
                        {t("stack.action.save")}
                    </button>
                    {#if !isCreate}
                        <button type="button" disabled={submitting} onclick={discard}>
                            {t("stack.action.discard")}
                        </button>
                    {/if}
                {:else}
                    <button type="button" onclick={() => (mode = "edit")}>{t("stack.action.edit")}</button>
                    <button type="button" disabled={submitting} onclick={() => void stackAction("stack.start")}>
                        {t("stack.action.start")}
                    </button>
                    <button type="button" disabled={submitting} onclick={() => void stackAction("stack.restart")}>
                        {t("stack.action.restart")}
                    </button>
                    <button type="button" disabled={submitting} onclick={() => void stackAction("stack.stop")}>
                        {t("stack.action.stop")}
                    </button>
                    <button type="button" disabled={submitting} onclick={() => void stackAction("stack.update")}>
                        {t("stack.action.update")}
                    </button>
                    <MenuButton
                        items={[
                            { label: t("stack.action.down"), onSelect: () => void stackAction("stack.down") },
                            { label: t("stack.action.delete"), danger: true, onSelect: () => (deleteConfirm = true) },
                        ]}
                    />
                {/if}
            </div>
        {/if}

        <div class="editors" class:stacked={!isExpanded.current}>
            {#if !isExpanded.current}
                <div class="tabs" data-audit-row="center">
                    <button
                        type="button"
                        class:active={activeTab === "compose"}
                        onclick={() => (activeTab = "compose")}
                    >
                        {t("stack.tab.compose")}
                    </button>
                    <button type="button" class:active={activeTab === "env"} onclick={() => (activeTab = "env")}>
                        {t("stack.tab.env")}{dirty && activeTab !== "env"
                            ? ` (${t("stack.unsavedChanges")})`
                            : ""}
                    </button>
                </div>
            {/if}
            {#if isExpanded.current || activeTab === "compose"}
                <div class="editor-pane">
                    <CodeEditor
                        value={yamlText}
                        oninput={onEditorInput}
                        onfocus={onEditorFocus}
                        onblur={onEditorBlur}
                        ariaLabel={t("stack.tab.compose")}
                    />
                    {#if yamlError !== null}
                        <p class="yaml-error text-label">{yamlError}</p>
                    {/if}
                </div>
            {/if}
            {#if isExpanded.current || activeTab === "env"}
                <div class="editor-pane">
                    <CodeEditor
                        value={envText}
                        oninput={(v) => {
                            envText = v;
                            dirty = true;
                            refreshExpanded();
                        }}
                        ariaLabel={t("stack.tab.env")}
                    />
                </div>
            {/if}
        </div>

        <div class="services" data-audit-column>
            {#each serviceNames as serviceName (serviceName)}
                {@const services = config.services as Record<string, Record<string, unknown>>}
                <ServiceCard
                    name={serviceName}
                    bind:service={services[serviceName] as never}
                    editable={mode === "edit"}
                    multiService={serviceNames.length > 1}
                    status={serviceStatus[serviceName]}
                    stats={statsForService(serviceName)}
                    expandedPorts={(expanded.services as Record<string, { ports?: string[] }> | undefined)?.[serviceName]?.ports}
                    {availableNetworks}
                    onstart={(n) => void serviceAction("service.start", n)}
                    onstop={(n) => void serviceAction("service.stop", n)}
                    onrestart={(n) => void serviceAction("service.restart", n)}
                    onremove={removeService}
                />
            {/each}
        </div>

        {#if !isCreate}
            <div class="terminals" data-audit-column>
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
        {/if}

        {#if !isMedium.current}
            <div class="bottom-app-bar" data-audit-row="center">
                <a
                    href="/"
                    class="back"
                    aria-label={t("action.back")}
                    onclick={(e) => {
                        e.preventDefault();
                        void navigate("/");
                    }}
                >
                    ←
                </a>
                {#if mode === "edit"}
                    <button type="button" class="primary" disabled={submitting} onclick={deploy}>
                        {t("stack.action.deploy")}
                    </button>
                {:else}
                    <button
                        type="button"
                        class="primary"
                        disabled={submitting}
                        onclick={() => void stackAction("stack.start")}
                    >
                        {t("stack.action.start")}
                    </button>
                {/if}
                <MenuButton
                    items={mode === "edit"
                        ? [
                              { label: t("stack.action.save"), onSelect: () => void saveDraft() },
                              { label: t("stack.action.discard"), onSelect: () => void discard() },
                          ]
                        : [
                              { label: t("stack.action.edit"), onSelect: () => (mode = "edit") },
                              { label: t("stack.action.restart"), onSelect: () => void stackAction("stack.restart") },
                              { label: t("stack.action.stop"), onSelect: () => void stackAction("stack.stop") },
                              { label: t("stack.action.update"), onSelect: () => void stackAction("stack.update") },
                              { label: t("stack.action.down"), onSelect: () => void stackAction("stack.down") },
                              {
                                  label: t("stack.action.delete"),
                                  danger: true,
                                  onSelect: () => (deleteConfirm = true),
                              },
                          ]}
                />
            </div>
        {/if}
    {/if}
</div>

<ConfirmDialog
    open={deleteConfirm}
    title={t("stack.action.delete")}
    message={t("stack.action.deleteConfirm", { name: stackName })}
    danger
    onconfirm={deleteStack}
    oncancel={() => (deleteConfirm = false)}
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
            padding: var(--space-6);
        }
    }

    @media (width >= 840px) {
        .page {
            padding: var(--space-8);
        }
    }

    .back-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: var(--size-control-lg);
        padding-inline: var(--space-4);
        border-radius: var(--radius-xl);
        background: var(--m3c-primary);
        color: var(--m3c-on-primary);
        text-decoration: none;
    }

    .header {
        display: flex;
        align-items: center;
        gap: var(--space-3);
    }

    .badge {
        padding-inline: var(--space-2);
        border-radius: var(--radius-xs);
        background: var(--m3c-secondary-container);
        color: var(--m3c-on-secondary-container);
    }

    .offline-banner {
        padding: var(--space-3);
        border-radius: var(--radius-sm);
        background: var(--m3c-error-container);
        color: var(--m3c-on-error-container);
    }

    .action-bar {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
    }

    .action-bar button,
    .tabs button {
        height: var(--size-control-md);
        padding-inline: var(--space-4);
        border: none;
        border-radius: var(--radius-xl);
        background: var(--m3c-surface-container-high);
        color: var(--m3c-on-surface);
        cursor: pointer;
    }

    .action-bar .primary {
        background: var(--m3c-primary);
        color: var(--m3c-on-primary);
    }

    .editors {
        display: grid;
        grid-template-columns: 2fr 1fr;
        gap: var(--space-4);
        min-height: var(--measure-editor-lg);
    }

    .editors.stacked {
        grid-template-columns: 1fr;
    }

    .tabs {
        grid-column: 1 / -1;
        display: flex;
        gap: var(--space-2);
    }

    .tabs button.active {
        background: var(--m3c-primary);
        color: var(--m3c-on-primary);
    }

    .editor-pane {
        min-width: 0;
        min-height: var(--measure-editor-md);
        display: flex;
        flex-direction: column;
    }

    .yaml-error {
        margin-block-start: var(--space-2);
        color: var(--m3c-error);
    }

    .services {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
    }

    .terminals {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
    }

    .bottom-app-bar {
        position: sticky;
        inset-block-end: 0;
        display: flex;
        align-items: center;
        gap: var(--space-2);
        height: var(--size-bottom-bar);
        padding-inline: var(--space-4);
        background: var(--m3c-surface-container);
    }

    .back {
        display: flex;
        align-items: center;
        justify-content: center;
        width: var(--size-control-lg);
        height: var(--size-control-lg);
        color: var(--m3c-on-surface);
        text-decoration: none;
        flex-shrink: 0;
    }

    .bottom-app-bar .primary {
        flex: 1;
        height: var(--size-control-md);
        border: none;
        border-radius: var(--radius-xl);
        background: var(--m3c-primary);
        color: var(--m3c-on-primary);
        cursor: pointer;
    }
</style>
