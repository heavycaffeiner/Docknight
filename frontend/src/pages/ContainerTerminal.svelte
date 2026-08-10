<script lang="ts">
    import { Button } from "m3-svelte";
    import EmptyState from "../components/EmptyState.svelte";
    import TerminalView from "../components/TerminalView.svelte";
    import { request } from "../lib/connection.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { toastError } from "../lib/stores/toast.svelte.ts";
    import { navigate, route } from "../router.svelte.ts";

    const stack = $derived(route.params.stack ?? "");
    const service = $derived(route.params.service ?? "");
    const shell = $derived(route.params.type ?? "sh");
    const endpoint = $derived(route.params.endpoint ?? "");

    let terminal = $state<string | null>(null);
    let failed = $state(false);

    // The server validates the shell against its allowlist; the route only carries the name.
    $effect(() => {
        const targetStack = stack;
        const targetService = service;
        const targetShell = shell;
        const targetEndpoint = endpoint;
        terminal = null;
        failed = false;

        void request(targetEndpoint, "terminal.exec", {
            stack: targetStack,
            service: targetService,
            shell: targetShell,
        })
            .then((result) => {
                terminal = result.terminal;
            })
            .catch((error: unknown) => {
                failed = true;
                toastError(error);
            });
    });
</script>

<h1 class="type-headline" data-route-heading>{t("terminalShellFor", { service })}</h1>

{#if failed}
    <EmptyState title={t("errorUnexpected")} auditId="exec-failed">
        {#snippet action()}
            <Button variant="filled" onclick={() => void navigate(`/compose/${encodeURIComponent(stack)}`)}>
                {t("actionBack")}
            </Button>
        {/snippet}
    </EmptyState>
{:else if terminal !== null}
    <TerminalView
        {endpoint}
        {terminal}
        interactive
        rows={24}
        label={t("terminalShellFor", { service })}
    />
{:else}
    <p class="type-body">{t("loading")}</p>
{/if}

<style>
    h1 {
        margin: 0;
    }
</style>
