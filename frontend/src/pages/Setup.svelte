<script lang="ts">
    import { request } from "../lib/connection.svelte.ts";
    import { login } from "../lib/stores/session.svelte.ts";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { navigate, setup } from "../router.svelte.ts";
    import HiddenInput from "../components/HiddenInput.svelte";

    let username = $state("");
    let password = $state("");
    let repeatPassword = $state("");
    let submitting = $state(false);
    let errorMessage = $state<string | null>(null);

    const mismatch = $derived(password !== "" && repeatPassword !== "" && password !== repeatPassword);

    async function handleSubmit(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (submitting || mismatch) return;

        submitting = true;
        errorMessage = null;

        try {
            await request("", "auth.setup", { username, password });
            setup.needed = false;
            await login(username, password, true);
            await navigate("/");
        } catch (err: unknown) {
            if (err && typeof err === "object" && "message" in err) {
                errorMessage = String(err.message);
            } else {
                errorMessage = t("error.internal");
            }
        } finally {
            submitting = false;
        }
    }
</script>

<div class="gcp-auth-page" data-audit-root>
    <div class="gcp-auth-card" data-audit-column>
        <div class="gcp-auth-header" data-audit-column>
            <svg class="gcp-auth-logo" viewBox="0 0 24 24" aria-hidden="true" data-audit-opaque>
                <defs>
                    <linearGradient id="gcp-gemini-auth-setup" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#4285f4" />
                        <stop offset="50%" stop-color="#9b72cb" />
                        <stop offset="100%" stop-color="#d96570" />
                    </linearGradient>
                </defs>
                <path d="M12 2C12 7.52 7.52 12 2 12C7.52 12 12 16.48 12 22C12 16.48 16.48 12 22 12C16.48 12 12 7.52 12 2Z" fill="url(#gcp-gemini-auth-setup)" />
            </svg>
            <h1 class="text-headline gcp-auth-title">{t("auth.setup.title")}</h1>
            <span class="text-body-medium gcp-auth-subtitle">Set up the initial admin account</span>
        </div>

        {#if errorMessage !== null}
            <div class="gcp-auth-error text-body-medium" role="alert" data-audit-column>
                {errorMessage}
            </div>
        {/if}

        <form class="gcp-auth-form" onsubmit={handleSubmit} data-audit-column>
            <div class="gcp-field" data-audit-column>
                <label for="setup-username" class="text-label gcp-label" data-audit-heading>{t("auth.setup.username")}</label>
                <input
                    id="setup-username"
                    type="text"
                    class="gcp-input"
                    autocomplete="username"
                    required
                    disabled={submitting}
                    bind:value={username}
                />
            </div>

            <div class="gcp-field" data-audit-column>
                <label for="setup-password" class="text-label gcp-label" data-audit-heading>{t("auth.setup.password")}</label>
                <HiddenInput
                    id="setup-password"
                    autocomplete="new-password"
                    disabled={submitting}
                    bind:value={password}
                />
            </div>

            <div class="gcp-field" data-audit-column>
                <label for="setup-repeat" class="text-label gcp-label" data-audit-heading>{t("auth.setup.repeat")}</label>
                <HiddenInput
                    id="setup-repeat"
                    autocomplete="new-password"
                    disabled={submitting}
                    bind:value={repeatPassword}
                />
                {#if mismatch}
                    <span class="text-label gcp-mismatch-error">{t("auth.setup.passwordMismatch")}</span>
                {/if}
            </div>

            <div class="gcp-auth-actions" data-audit-row="center">
                <button
                    type="submit"
                    class="gcp-btn-primary"
                    disabled={submitting || mismatch || password === "" || username === ""}
                >
                    {t("auth.setup.submit")}
                </button>
            </div>
        </form>
    </div>
</div>

<style>
    .gcp-auth-page {
        display: flex;
        align-items: center;
        justify-content: center;
        block-size: var(--viewport-block, 100dvh);
        padding: var(--space-4);
        background: var(--m3c-surface);
    }

    .gcp-auth-card {
        display: flex;
        flex-direction: column;
        width: 100%;
        max-width: var(--measure-form);
        padding: var(--space-8);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-lg);
        background: var(--m3c-surface-container-low);
        gap: var(--space-6);
    }

    @media (width < 600px) {
        .gcp-auth-card {
            border: none;
            background: transparent;
            padding: var(--space-4) 0;
        }
    }

    .gcp-auth-header {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: var(--space-2);
    }

    .gcp-auth-logo {
        width: var(--space-8);
        height: var(--space-8);
        margin-block-end: var(--space-2);
    }

    .gcp-auth-title {
        font-weight: 500;
    }

    .gcp-auth-subtitle {
        color: var(--m3c-on-surface-variant);
    }

    .gcp-auth-error {
        padding: var(--space-3);
        border-radius: var(--radius-xs);
        background: var(--m3c-error-container);
        color: var(--m3c-on-error-container);
    }

    .gcp-auth-form {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
    }

    .gcp-field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .gcp-label {
        color: var(--m3c-on-surface-variant);
        font-weight: 500;
    }

    .gcp-input {
        width: 100%;
        block-size: var(--size-control-md);
        padding-block: 0;
        padding-inline: var(--control-padding-inline);
        border: 1px solid var(--m3c-outline-variant);
        border-radius: var(--radius-sm);
        background: var(--m3c-surface);
        color: var(--m3c-on-surface);
        font-family: inherit;
        font-size: var(--control-font-size);
        transition: border-color var(--duration-fast) var(--ease-standard);
    }

    .gcp-input:focus-visible {
        border-color: var(--m3c-primary);
    }

    .gcp-mismatch-error {
        color: var(--m3c-error);
    }

    .gcp-auth-actions {
        display: flex;
        justify-content: flex-end;
        margin-block-start: var(--space-2);
    }

    .gcp-btn-primary {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        block-size: var(--size-control-md);
        padding-block: 0;
        padding-inline: var(--space-4);
        border-radius: var(--radius-sm);
        border: none;
        background: var(--m3c-primary);
        color: var(--m3c-on-primary);
        font-weight: 500;
        font-size: var(--control-font-size);
        cursor: pointer;
        transition: background var(--duration-fast) var(--ease-standard);
    }

    .gcp-btn-primary:hover {
        background: var(--m3c-primary-dim);
    }

    .gcp-btn-primary:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }
</style>
