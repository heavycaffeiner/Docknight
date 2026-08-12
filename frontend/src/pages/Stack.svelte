<script lang="ts">
    import { Button, Chip, MenuItem, TextFieldOutlined } from "m3-svelte";
    import { slide } from "svelte/transition";
    import type { Document } from "yaml";
    import { DEFAULT_COMPOSE_FILE_NAME, RUNNING, type DockerStat, type ServiceInstance } from "$common/stack.ts";
    import { commandTerminalName, followTerminalName } from "$common/terminal.ts";
    import Badge from "../components/Badge.svelte";
    import CodeEditor from "../components/CodeEditor.svelte";
    import ConfirmDialog from "../components/ConfirmDialog.svelte";
    import EmptyState from "../components/EmptyState.svelte";
    import Icon from "../components/Icon.svelte";
    import Loading from "../components/Loading.svelte";
    import MenuButton from "../components/MenuButton.svelte";
    import StatusChip from "../components/StatusChip.svelte";
    import TerminalView from "../components/TerminalView.svelte";
    import NetworkInput from "./compose/NetworkInput.svelte";
    import ServiceCard from "./compose/ServiceCard.svelte";
    import { request } from "../lib/connection.svelte.ts";
    import { parseEnvText } from "../lib/format.ts";
    import { COMPACT, media } from "../lib/media.svelte.ts";
    import { arrive, scrollBehavior } from "../lib/motion.ts";
    import { agents, endpointLabel } from "../lib/stores/agents.svelte.ts";
    import { bottomBar } from "../lib/stores/chrome.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { general, serverInfo, settings } from "../lib/stores/settings.svelte.ts";
    import { findStack } from "../lib/stores/stacks.svelte.ts";
    import { toastError, toastResult } from "../lib/stores/toast.svelte.ts";
    import { handoff, navigate, onBeforeLeave, route } from "../router.svelte.ts";
    import {
        emptyConfig,
        expandForDisplay,
        firstParseError,
        parseConfig,
        serialiseWithComments,
        type ComposeConfig,
        type ComposeService,
    } from "./compose/sync.ts";

    const SYNC_DEBOUNCE_MS = 250;
    const ERROR_GRACE_MS = 3_000;
    const POLL_MS = 5_000;

    const name = $derived(route.params.name ?? "");
    const endpoint = $derived(route.params.endpoint ?? "");
    const isCreate = $derived(name === "");
    const summary = $derived(isCreate ? undefined : findStack(name, endpoint));

    let mode = $state<"view" | "edit">("edit");
    let yamlText = $state("");
    let envText = $state("");
    let doc = $state<Document | null>(null);
    let config = $state<ComposeConfig>(emptyConfig());
    let expanded = $state<ComposeConfig>(emptyConfig());
    let yamlError = $state<string | null>(null);
    let writer = $state<"text" | "form" | null>(null);
    let dirty = $state(false);
    let loading = $state(false);
    let missing = $state(false);
    let composeFileName = $state(DEFAULT_COMPOSE_FILE_NAME);
    let draftName = $state("");
    let barBusy = $state(false);
    let showProgress = $state(false);
    let progressPane = $state<HTMLElement | null>(null);

    const nameHintId = $props.id();

    let serviceStatus = $state<Record<string, ServiceInstance[]>>({});
    let stats = $state<Record<string, DockerStat>>({});
    let networks = $state<string[]>([]);

    let leaveDialog = $state(false);
    let deleteDialog = $state(false);
    let removeService = $state<string | null>(null);
    let pendingLeave: ((allowed: boolean) => void) | null = null;

    let debounceTimer: number | null = null;
    let graceTimer: number | null = null;
    let editorFocused = false;
    /** Bumped on every load, so a response that arrives after a newer load started is discarded
        instead of overwriting the current stack with one the reader has already left. */
    let loadSeq = 0;

    const stackName = $derived(isCreate ? draftName : name);
    const hostname = $derived(serverInfo.value?.primaryHostname ?? general().primaryHostname);
    /** Independent of the on-screen error, whose display is delayed so a half-typed line does not
        flicker. A deploy must not run while the buffer will not parse, however short the grace. */
    const yamlInvalid = $derived(parseConfig(yamlText) === null);
    const serviceNames = $derived(Object.keys(config.services));
    const hostOffline = $derived(
        endpoint !== "" && agents.byEndpoint[endpoint]?.status === "offline",
    );

    /** `x-docknight.urls` renders as link chips at the top of the page. */
    const extensionUrls = $derived.by(() => {
        const urls = (expanded["x-docknight"] ?? config["x-docknight"])?.urls;
        return Array.isArray(urls) ? urls.filter((url) => typeof url === "string") : [];
    });

    const progressTerminal = $derived(commandTerminalName(endpoint, stackName));
    const logTerminal = $derived(followTerminalName(endpoint, stackName));

    /** Load a stack, or start a blank draft when the route carries no name. */
    async function load(): Promise<void> {
        const seq = ++loadSeq;
        if (isCreate) {
            mode = "edit";
            missing = false;
            yamlText = handoff.composeYAML ?? "services:\n";
            handoff.composeYAML = null;
            envText = "";
            applyTextToForm(true);
            dirty = false;
            return;
        }

        loading = true;
        missing = false;
        try {
            const result = await request(endpoint, "stack.get", { name });
            if (seq !== loadSeq) return;
            yamlText = result.stack.composeYAML;
            envText = result.stack.composeENV;
            composeFileName = result.stack.composeFileName;
            applyTextToForm(true);
            mode = "view";
            dirty = false;
        } catch (error) {
            if (seq !== loadSeq) return;
            missing = true;
            toastError(error);
        } finally {
            if (seq === loadSeq) loading = false;
        }
    }

    /** The stack's own .env merged over the global file, matching the --env-file precedence. */
    function recomputeExpanded(): void {
        const merged = {
            ...parseEnvText(settings.value?.globalENV ?? ""),
            ...parseEnvText(envText),
        };
        expanded = expandForDisplay(yamlText, merged).config;
    }

    function applyTextToForm(immediate: boolean): void {
        const parsed = parseConfig(yamlText);
        if (parsed === null) {
            const message = firstParseError(yamlText);
            if (immediate) yamlError = message;
            else if (graceTimer === null) {
                // A half-typed line is invalid for a moment on nearly every keystroke, so an error
                // that flickers is worse than none.
                graceTimer = window.setTimeout(() => {
                    graceTimer = null;
                    yamlError = firstParseError(yamlText);
                }, ERROR_GRACE_MS);
            }
            return;
        }
        if (graceTimer !== null) {
            clearTimeout(graceTimer);
            graceTimer = null;
        }
        doc = parsed.doc;
        config = parsed.config;
        yamlError = null;
        recomputeExpanded();
    }

    function onEditorInput(next: string): void {
        // The form side has just rewritten the buffer, so this callback is the echo of that write.
        if (writer === "form") {
            writer = null;
            return;
        }
        yamlText = next;
        dirty = true;
        if (!editorFocused) return;
        writer = "text";
        if (debounceTimer !== null) clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(() => {
            debounceTimer = null;
            applyTextToForm(false);
        }, SYNC_DEBOUNCE_MS);
    }

    /**
     * A write from the form side reserialises immediately. The focus condition on the editor
     * handler is the loop breaker.
     */
    function onFormChange(next: ComposeConfig): void {
        writer = "form";
        config = next;
        const serialised = serialiseWithComments(next, doc);
        doc = serialised.doc;
        yamlText = serialised.text;
        yamlError = null;
        dirty = true;
        recomputeExpanded();
    }

    function patchService(serviceName: string, service: ComposeService): void {
        onFormChange({
            ...config,
            services: { ...config.services, [serviceName]: service },
        });
    }

    function addService(): void {
        let candidate = "app";
        let index = 1;
        while (config.services[candidate] !== undefined) {
            index += 1;
            candidate = `app-${index}`;
        }
        onFormChange({
            ...config,
            services: { ...config.services, [candidate]: { image: "" } },
        });
    }

    function dropService(serviceName: string): void {
        const services = { ...config.services };
        delete services[serviceName];
        onFormChange({ ...config, services });
    }

    async function poll(): Promise<void> {
        if (isCreate || missing || summary?.managed === false) return;
        try {
            const [statusResult, statsResult] = await Promise.all([
                request(endpoint, "stack.serviceStatus", { name }),
                request(endpoint, "docker.stats", undefined),
            ]);
            serviceStatus = statusResult.services;
            stats = statsResult.stats;
        } catch {
            // Silently retried on the next tick; the card shows the last known values.
        }
    }

    function statsFor(serviceName: string): DockerStat[] | undefined {
        const instances = serviceStatus[serviceName];
        if (instances === undefined) return undefined;
        const matched = instances
            .map((instance) => stats[instance.name])
            .filter((stat): stat is DockerStat => stat !== undefined);
        return matched.length === 0 ? undefined : matched;
    }

    async function runAction(
        action: "start" | "stop" | "restart" | "update" | "down",
    ): Promise<void> {
        barBusy = true;
        showProgress = true;
        try {
            await request(endpoint, `stack.${action}`, { name }, { timeout: 0 });
            toastResult("settingsSaved");
        } catch (error) {
            toastError(error);
        } finally {
            barBusy = false;
        }
    }

    async function save(deploy: boolean): Promise<void> {
        if (yamlInvalid) return;
        barBusy = true;
        if (deploy) showProgress = true;
        try {
            const params = {
                name: stackName,
                composeYAML: yamlText,
                composeENV: envText,
                isCreate,
            };
            if (deploy) {
                await request(endpoint, "stack.deploy", params, { timeout: 0 });
            } else {
                await request(endpoint, "stack.save", params);
            }
            dirty = false;
            if (isCreate) {
                await navigate(`/compose/${encodeURIComponent(stackName)}`);
            } else if (deploy) {
                mode = "view";
                await load();
            } else {
                toastResult("settingsSaved");
            }
        } catch (error) {
            toastError(error);
        } finally {
            barBusy = false;
        }
    }

    async function confirmDelete(): Promise<void> {
        deleteDialog = false;
        barBusy = true;
        showProgress = true;
        try {
            await request(endpoint, "stack.delete", { name }, { timeout: 0 });
            dirty = false;
            await navigate("/");
        } catch (error) {
            toastError(error);
        } finally {
            barBusy = false;
        }
    }

    async function serviceAction(
        action: "start" | "stop" | "restart",
        service: string,
    ): Promise<void> {
        try {
            await request(endpoint, `service.${action}`, { stack: name, service }, { timeout: 0 });
        } catch (error) {
            toastError(error);
        }
    }

    function openShell(service: string): void {
        const base = `/terminal/${encodeURIComponent(name)}/${encodeURIComponent(service)}/sh`;
        void navigate(endpoint === "" ? base : `${base}/${encodeURIComponent(endpoint)}`);
    }

    // Brought into view rather than sprung on: the pane opens below the fold on a phone, and output
    // arriving where nobody is looking is what makes it read as the page jumping.
    $effect(() => {
        const pane = progressPane;
        if (!showProgress || pane === null) return;
        pane.scrollIntoView({ behavior: scrollBehavior(), block: "nearest" });
    });

    // Reload whenever the addressed stack changes.
    $effect(() => {
        void route.path;
        void load();
    });

    $effect(() => {
        void request(endpoint, "docker.networks", undefined)
            .then((result) => (networks = result.networks))
            .catch(() => undefined);
    });

    $effect(() => {
        void poll();
        const timer = window.setInterval(() => void poll(), POLL_MS);
        return () => clearInterval(timer);
    });

    // Leaving with unsaved edits asks first, in the router and on a browser close.
    $effect(() => {
        const release = onBeforeLeave(() => {
            if (!dirty || mode !== "edit") return true;
            leaveDialog = true;
            return new Promise<boolean>((resolve) => {
                pendingLeave = resolve;
            });
        });
        return release;
    });

    function onBeforeUnload(event: BeforeUnloadEvent): void {
        if (!dirty || mode !== "edit") return;
        event.preventDefault();
    }

    const compact = media(COMPACT);

    interface BarAction {
        id: string;
        label: string;
        variant: "filled" | "tonal" | "text";
        disabled: boolean;
        run: () => void;
    }

    const halted = $derived(barBusy || hostOffline);
    const unsavable = $derived(halted || yamlInvalid || stackName === "");
    const running = $derived(summary?.status === RUNNING);

    /** The bar's own actions, primary first. On a compact screen only the first stays a button. */
    const barActions = $derived.by((): BarAction[] => {
        if (mode === "edit") {
            const items: BarAction[] = [
                {
                    id: "deploy",
                    label: t("actionDeploy"),
                    variant: "filled",
                    disabled: unsavable,
                    run: () => void save(true),
                },
                {
                    id: "save",
                    label: t("actionSaveDraft"),
                    variant: "tonal",
                    disabled: unsavable,
                    run: () => void save(false),
                },
            ];
            if (!isCreate) {
                items.push({
                    id: "discard",
                    label: t("actionDiscard"),
                    variant: "text",
                    disabled: barBusy,
                    run: () => {
                        mode = "view";
                        void load();
                    },
                });
            }
            return items;
        }

        const items: BarAction[] = [
            running
                ? {
                      id: "restart",
                      label: t("actionRestart"),
                      variant: "filled",
                      disabled: halted,
                      run: () => void runAction("restart"),
                  }
                : {
                      id: "start",
                      label: t("actionStart"),
                      variant: "filled",
                      disabled: halted,
                      run: () => void runAction("start"),
                  },
            {
                id: "edit",
                label: t("actionEdit"),
                variant: "tonal",
                disabled: halted,
                run: () => (mode = "edit"),
            },
        ];
        if (running) {
            items.push({
                id: "stop",
                label: t("actionStop"),
                variant: "text",
                disabled: halted,
                run: () => void runAction("stop"),
            });
        }
        return items;
    });

    /** Behind the trigger at every width: the destructive one must not land under a thumb. */
    const menuActions = $derived.by((): BarAction[] => {
        if (mode === "edit") return [];
        return [
            {
                id: "update",
                label: t("actionUpdate"),
                variant: "text",
                disabled: halted,
                run: () => void runAction("update"),
            },
            {
                id: "down",
                label: t("actionDown"),
                variant: "text",
                disabled: halted,
                run: () => void runAction("down"),
            },
            {
                id: "delete",
                label: t("actionDelete"),
                variant: "text",
                disabled: halted,
                run: () => (deleteDialog = true),
            },
        ];
    });

    const primary = $derived(barActions[0]);
    const secondary = $derived(barActions.slice(1));
    const overflow = $derived(compact.value ? [...secondary, ...menuActions] : menuActions);

    /** The bar exists only when the screen has a stack to act on. */
    const hasBar = $derived(!missing && !loading && summary?.managed !== false);

    // The bar becomes the bottom app bar on compact, and Material replaces the navigation bar with
    // one rather than stacking the two, so the shell is told to drop its own.
    $effect(() => {
        bottomBar.present = compact.value && hasBar;
        return () => (bottomBar.present = false);
    });

    const EDITOR_TABS = ["compose", "env"] as const;
    type EditorTab = (typeof EDITOR_TABS)[number];

    let editorTab = $state<EditorTab>("compose");

    function editorLabel(tab: EditorTab): string {
        return tab === "compose" ? t("stackCompose") : t("stackEnv");
    }

    /** Selection follows the arrow keys, which is what an automatic tablist owes the keyboard. */
    function moveTab(event: KeyboardEvent): void {
        const keys: Record<string, number> = {
            ArrowRight: 1,
            ArrowLeft: -1,
        };
        const total = EDITOR_TABS.length;
        const index = EDITOR_TABS.indexOf(editorTab);
        let next: number;
        if (event.key === "Home") next = 0;
        else if (event.key === "End") next = total - 1;
        else if (keys[event.key] !== undefined) next = (index + (keys[event.key] as number) + total) % total;
        else return;

        event.preventDefault();
        editorTab = EDITOR_TABS[next] as EditorTab;
        const strip = (event.currentTarget as HTMLElement).parentElement;
        strip?.querySelectorAll<HTMLElement>("[role='tab']")[next]?.focus();
    }
</script>

<svelte:window onbeforeunload={onBeforeUnload} />

<!-- The status travels with the name rather than leading the action bar: a filled control at the
     start of a row starts its ink inside its own padding, which is a third column start on a page
     that already has two. -->
<h1 class="type-headline" data-route-heading>
    <span class="title">{isCreate ? t("pageNewStack") : name}</span>
    {#if endpoint !== ""}<Badge tone="neutral">{endpointLabel(endpoint)}</Badge>{/if}
    {#if !isCreate}<StatusChip status={summary?.status ?? 0} />{/if}
</h1>

{#if extensionUrls.length > 0}
    <ul class="urls" data-audit-id="stack-urls" data-audit-row="center">
        {#each extensionUrls as url (url)}
            <li>
                <Chip variant="assist" href={url} target="_blank" rel="noreferrer noopener">
                    {url}
                    <Icon name="external" size="sm" />
                </Chip>
            </li>
        {/each}
    </ul>
{/if}

{#if hostOffline}
    <p class="banner type-body" role="status">{t("agentOfflineBanner", { host: endpointLabel(endpoint) })}</p>
{/if}

{#if missing}
    <EmptyState title={t("stackNotFoundTitle")} body={t("stackNotFoundBody")} auditId="stack-missing">
        {#snippet action()}
            <Button variant="filled" onclick={() => void navigate("/")}>{t("actionBack")}</Button>
        {/snippet}
    </EmptyState>
{:else if summary !== undefined && !summary.managed}
    <EmptyState title={t("stackUnmanagedTitle")} body={t("stackUnmanagedBody")} auditId="stack-unmanaged" />
{:else if loading}
    <Loading auditId="stack-loading" />
{:else}
    <!-- One filled primary and an overflow on compact, the full row on expanded. The compact form
         is the bottom app bar, which puts the action a thumb reaches without scrolling back up
         three screenfuls, and carries the way out in place of the destinations it replaced. -->
    <div
        class="bar"
        class:bar-bottom={compact.value}
        data-audit-id="stack-action-bar"
        data-audit-row="center"
    >
        {#if compact.value}
            <span class="back">
                <Button
                    variant="text"
                    iconType="full"
                    aria-label={t("actionBack")}
                    onclick={() => void navigate("/")}
                >
                    <Icon name="arrow-left" size="md" />
                </Button>
            </span>
        {/if}
        {#if primary !== undefined}
            <Button variant={primary.variant} disabled={primary.disabled} onclick={primary.run}>
                {primary.label}
            </Button>
        {/if}
        {#if !compact.value}
            {#each secondary as action (action.id)}
                <Button variant={action.variant} disabled={action.disabled} onclick={action.run}>
                    {action.label}
                </Button>
            {/each}
        {/if}
        {#if overflow.length > 0}
            <MenuButton label={t("actionMore")} iconType="full" auditId="stack-more">
                {#snippet trigger()}
                    <Icon name="more" size="md" />
                {/snippet}
                {#snippet children(close)}
                    {#each overflow as action (action.id)}
                        <MenuItem
                            disabled={action.disabled}
                            onclick={() => {
                                close();
                                action.run();
                            }}
                        >
                            {action.label}
                        </MenuItem>
                    {/each}
                {/snippet}
            </MenuButton>
        {/if}
    </div>

    {#if isCreate}
        <div class="field" data-audit-column>
            <TextFieldOutlined
                label={t("stackName")}
                class="type-mono"
                bind:value={draftName}
                autocomplete="off"
                aria-describedby={nameHintId}
            />
            <p class="hint type-label" id={nameHintId}>{t("stackNameHint")}</p>
        </div>
    {/if}

    {#if showProgress}
        <section
            class="pane"
            bind:this={progressPane}
            data-audit-column
            transition:slide={{ ...arrive(), axis: "y" }}
        >
            <div class="pane-head" data-audit-row="center">
                <h2 class="type-title">{t("stackProgress")}</h2>
                <Button
                    variant="text"
                    iconType="full"
                    aria-label={t("actionDismiss")}
                    onclick={() => (showProgress = false)}
                >
                    <Icon name="close" size="md" />
                </Button>
            </div>
            <TerminalView {endpoint} terminal={progressTerminal} rows={8} label={t("stackProgress")} />
        </section>
    {/if}

    {#snippet composePane()}
        <CodeEditor
            value={yamlText}
            ariaLabel={t("stackCompose")}
            auditId="compose-editor"
            readOnly={mode === "view"}
            onchange={onEditorInput}
            onfocuschange={(focused) => (editorFocused = focused)}
        />
        {#if yamlError !== null}
            <p class="error type-label" role="alert">{yamlError}</p>
        {/if}
    {/snippet}

    {#snippet envPane()}
        <CodeEditor
            value={envText}
            language="plain"
            ariaLabel={t("stackEnv")}
            auditId="env-editor"
            readOnly={mode === "view"}
            onchange={(next) => {
                envText = next;
                dirty = true;
                recomputeExpanded();
            }}
        />
    {/snippet}

    {#if compact.value}
        <!-- Two 400px editors with a four-button toolbar each is the whole of a phone screen twice
             over. One at a time removes that screenful and half of the buttons; the same component
             renders in both arms. -->
        <section class="editors" data-audit-id="stack-editors" data-audit-column>
            <div class="tab-strip" role="tablist" aria-label={t("stackEditorTabs")}>
                {#each EDITOR_TABS as tab (tab)}
                    <button
                        type="button"
                        role="tab"
                        class="tab-item"
                        class:active={editorTab === tab}
                        id="editor-tab-{tab}"
                        aria-selected={editorTab === tab}
                        aria-controls="editor-panel-{tab}"
                        tabindex={editorTab === tab ? 0 : -1}
                        onclick={() => (editorTab = tab)}
                        onkeydown={moveTab}
                    >
                        {editorLabel(tab)}
                    </button>
                {/each}
            </div>
            <div
                class="editor-block"
                role="tabpanel"
                id="editor-panel-{editorTab}"
                aria-labelledby="editor-tab-{editorTab}"
                data-audit-column
            >
                {#if editorTab === "compose"}
                    {@render composePane()}
                {:else}
                    {@render envPane()}
                {/if}
            </div>
        </section>
    {:else}
        <section class="editors">
            <div class="editor-block" data-audit-column>
                <h2 class="type-title">
                    {t("stackCompose")} <span class="file type-mono">{composeFileName}</span>
                </h2>
                {@render composePane()}
            </div>

            <div class="editor-block" data-audit-column>
                <h2 class="type-title">{t("stackEnv")}</h2>
                {@render envPane()}
            </div>
        </section>
    {/if}

    <section class="services" data-audit-column>
        <div class="services-head" data-audit-row="center">
            <h2 class="type-title">{t("stackServices")}</h2>
            {#if mode === "edit"}
                <Button variant="text" iconType="left" onclick={addService}>
                    <Icon name="add" size="md" />
                    {t("stackAddService")}
                </Button>
            {/if}
        </div>
        {#each serviceNames as serviceName (serviceName)}
            <ServiceCard
                name={serviceName}
                service={config.services[serviceName] ?? {}}
                expanded={expanded.services[serviceName]}
                editable={mode === "edit"}
                {hostname}
                multiService={serviceNames.length > 1}
                status={serviceStatus[serviceName]}
                stats={statsFor(serviceName)}
                onchange={(next) => patchService(serviceName, next)}
                onstart={(target) => void serviceAction("start", target)}
                onstop={(target) => void serviceAction("stop", target)}
                onrestart={(target) => void serviceAction("restart", target)}
                onremove={(target) => (removeService = target)}
                onshell={openShell}
            />
        {/each}
    </section>

    <NetworkInput
        networks={(config.networks ?? {}) as Record<string, unknown>}
        available={networks}
        editable={mode === "edit"}
        onchange={(next) => onFormChange({ ...config, networks: next })}
    />

    {#if !isCreate}
        <section class="pane" data-audit-column>
            <h2 class="type-title">{t("stackLogs")}</h2>
            <TerminalView {endpoint} terminal={logTerminal} rows={20} label={t("stackLogs")} />
        </section>
    {/if}
{/if}

<ConfirmDialog
    open={leaveDialog}
    title={t("stackLeaveTitle")}
    body={t("stackLeaveBody")}
    onconfirm={() => {
        leaveDialog = false;
        pendingLeave?.(true);
        pendingLeave = null;
    }}
    oncancel={() => {
        leaveDialog = false;
        pendingLeave?.(false);
        pendingLeave = null;
    }}
/>

<ConfirmDialog
    open={deleteDialog}
    destructive
    title={t("stackDeleteTitle", { name })}
    body={t("stackDeleteBody")}
    confirmLabel={t("actionDelete")}
    onconfirm={() => void confirmDelete()}
    oncancel={() => (deleteDialog = false)}
/>

<ConfirmDialog
    open={removeService !== null}
    destructive
    title={t("serviceRemoveTitle", { name: removeService ?? "" })}
    body={t("serviceRemoveBody")}
    confirmLabel={t("actionRemove")}
    onconfirm={() => {
        if (removeService !== null) dropService(removeService);
        removeService = null;
    }}
    oncancel={() => (removeService = null)}
/>

<style>
    h1 {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-2);
        margin: 0;
    }

    /* A stack name is one token with no spaces to wrap at, so it has to break mid-word. */
    .title {
        overflow-wrap: anywhere;
    }

    .urls {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
    }

    .banner {
        margin: 0;
        padding: var(--space-3);
        border-radius: var(--radius-md);
        background-color: rgb(var(--m3-scheme-error-container));
        color: rgb(var(--m3-scheme-on-error-container));
    }

    .bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-2);
    }

    /* Fixed rather than laid out, so the action stays under the thumb however far down the page the
       reader has scrolled. Lifted by the keyboard's own inset, which is what keeps it sitting on the
       keyboard rather than behind it where the layout viewport does not shrink. */
    .bar-bottom {
        position: fixed;
        inset-inline: 0;
        inset-block-end: var(--keyboard-inset, 0);
        z-index: 20;
        flex-wrap: nowrap;
        justify-content: flex-end;
        block-size: var(--size-nav-bar);
        padding-inline: var(--space-3);
        /* The rule is what stops the content passing underneath from reading as part of the bar. */
        box-shadow: inset 0 var(--hairline) 0 rgb(var(--m3-scheme-outline-variant));
        background-color: rgb(var(--m3-scheme-surface-container));
    }

    .back {
        display: inline-flex;
        margin-inline-end: auto;
    }

    /* An arrow states a direction rather than a shape, so it follows the way the page runs. */
    :global([dir="rtl"]) .back :global(svg) {
        transform: scaleX(-1);
    }

    /* Two of them, so they share the width rather than huddling at the inline start. */
    .editors :global(.tab-item) {
        flex: 1;
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        max-inline-size: var(--measure-form);
    }

    /* A hint reads as the field's own second line, so it starts where the field's label does. */
    .hint {
        margin: 0;
        padding-inline-start: var(--optical-inset);
        color: rgb(var(--m3-scheme-on-surface-variant));
    }

    .editors {
        display: grid;
        grid-template-columns: 1fr;
        gap: var(--space-3);
    }

    @media (width >= 1280px) {
        .editors {
            grid-template-columns: 2fr 1fr;
        }
    }

    .editor-block {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        min-inline-size: 0;
    }

    h2 {
        display: flex;
        align-items: baseline;
        gap: var(--space-2);
        margin: 0;
    }

    /* A file name has no spaces to wrap at, so it has to be allowed to break mid-word. */
    .file {
        color: rgb(var(--m3-scheme-on-surface-variant));
        overflow-wrap: anywhere;
    }

    .error {
        margin: 0;
        color: rgb(var(--m3-scheme-error));
    }

    .services {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
    }

    .services-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
    }

    .pane {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .pane-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
    }
</style>
