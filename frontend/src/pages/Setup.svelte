<script lang="ts">
    import { request } from "../lib/connection.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { login } from "../lib/stores/session.svelte.ts";
    import { toastError } from "../lib/stores/toast.svelte.ts";
    import HiddenInput from "../components/HiddenInput.svelte";

    let username = $state("");
    let password = $state("");
    let repeat = $state("");
    let submitting = $state(false);
    let mismatch = $derived(repeat !== "" && repeat !== password);

    async function onSubmit(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (mismatch) return;
        submitting = true;
        try {
            await request("", "auth.setup", { username, password });
            await login(username, password, true);
        } catch (error) {
            toastError(error);
        } finally {
            submitting = false;
        }
    }
</script>

<div class="wrap">
    <form class="card" onsubmit={onSubmit} data-audit-root data-audit-column>
        <h1 class="text-headline">{t("auth.setup.title")}</h1>

        <label class="field" for="setup-username">
            <span class="text-label">{t("auth.setup.username")}</span>
            <input id="setup-username" type="text" autocomplete="username" required bind:value={username} />
        </label>

        <label class="field" for="setup-password">
            <span class="text-label">{t("auth.setup.password")}</span>
            <HiddenInput id="setup-password" bind:value={password} autocomplete="new-password" />
        </label>

        <label class="field" for="setup-repeat">
            <span class="text-label">{t("auth.setup.repeat")}</span>
            <HiddenInput id="setup-repeat" bind:value={repeat} autocomplete="new-password" />
        </label>

        {#if mismatch}
            <p class="error text-label">{t("auth.setup.passwordMismatch")}</p>
        {/if}

        <button type="submit" class="submit" disabled={submitting || mismatch}>
            {t("auth.setup.submit")}
        </button>
    </form>
</div>

<style>
    .wrap {
        display: flex;
        align-items: center;
        justify-content: center;
        block-size: 100dvh;
        padding: var(--space-4);
    }

    .card {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        width: 100%;
        max-width: var(--measure-form);
        padding: var(--space-6);
        border-radius: var(--radius-lg);
        background: var(--m3c-surface-container);
        color: var(--m3c-on-surface);
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    input {
        height: var(--size-control-md);
        padding-inline: var(--space-3);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-xs);
        background: var(--m3c-surface-container-lowest);
        color: var(--m3c-on-surface);
    }

    .error {
        color: var(--m3c-error);
    }

    .submit {
        height: var(--size-control-lg);
        margin-block-start: var(--space-2);
        border: none;
        border-radius: var(--radius-xl);
        background: var(--m3c-primary);
        color: var(--m3c-on-primary);
        cursor: pointer;
    }

    .submit:disabled {
        opacity: 0.5;
        cursor: default;
    }
</style>
