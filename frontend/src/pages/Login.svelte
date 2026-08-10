<script lang="ts">
    import { Button, Checkbox, TextFieldOutlined } from "m3-svelte";
    import Loading from "../components/Loading.svelte";
    import { t } from "../lib/stores/i18n.svelte.ts";
    import { login, rememberPreference, setRemember } from "../lib/stores/session.svelte.ts";
    import { loadConsoleEnabled, loadSettings } from "../lib/stores/settings.svelte.ts";
    import { toastError } from "../lib/stores/toast.svelte.ts";

    let username = $state("");
    let password = $state("");
    let totp = $state("");
    let remember = $state(rememberPreference());
    let needTotp = $state(false);
    let busy = $state(false);
    let codeField = $state<HTMLElement | null>(null);

    async function submit(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (busy) return;
        busy = true;
        setRemember(remember);
        try {
            const result = await login(
                username,
                password,
                needTotp && totp !== "" ? totp : undefined,
            );
            if (result === "totp") {
                needTotp = true;
                queueMicrotask(() => codeField?.querySelector("input")?.focus());
                return;
            }
            await loadSettings().catch(() => undefined);
            await loadConsoleEnabled();
        } catch (error) {
            // Failure returns to the code field and does not clear the username or password.
            totp = "";
            toastError(error);
        } finally {
            busy = false;
        }
    }
</script>

<main class="page" data-audit-root data-grid-origin>
    <form class="card" onsubmit={submit} data-audit-id="login-card" data-audit-column>
        <h1 class="type-headline">{needTotp ? t("loginTotpTitle") : t("loginTitle")}</h1>

        {#if needTotp}
            <p class="body type-body">{t("loginTotpBody")}</p>
            <div bind:this={codeField}>
                <TextFieldOutlined
                    label={t("loginTotpCode")}
                    bind:value={totp}
                    inputmode="numeric"
                    autocomplete="one-time-code"
                    maxlength={6}
                    required
                />
            </div>
            <div class="submit" data-audit-row="center">
                {#if busy}<Loading size="sm" label={t("loginBusy")} />{/if}
                <Button variant="filled" type="submit" disabled={busy}>{t("loginTotpSubmit")}</Button>
            </div>
        {:else}
            <TextFieldOutlined
                label={t("loginUsername")}
                bind:value={username}
                autocomplete="username"
                required
            />
            <TextFieldOutlined
                label={t("loginPassword")}
                type="password"
                bind:value={password}
                autocomplete="current-password"
                required
            />
            <label class="remember" data-audit-row="center">
                <span class="box" data-audit-id="login-remember-box">
                    <Checkbox>
                        <input type="checkbox" bind:checked={remember} />
                    </Checkbox>
                </span>
                <span class="type-body">{t("loginRemember")}</span>
            </label>
            <div class="submit" data-audit-row="center">
                {#if busy}<Loading size="sm" label={t("loginBusy")} />{/if}
                <Button variant="filled" type="submit" disabled={busy}>{t("loginSubmit")}</Button>
            </div>
        {/if}
    </form>
</main>

<style>
    .page {
        display: grid;
        place-items: center;
        min-block-size: 100vh;
        padding: var(--space-4);
    }

    .card {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        inline-size: 100%;
        max-inline-size: var(--measure-form);
        padding: var(--space-6);
        /* A card that stands alone on the page takes the largest corner; the inline cards inside the
           app frame stay a step below it so the two do not read as the same surface. */
        border-radius: var(--radius-xl);
        /* A field's floating label paints a patch to cut the outline, and defaults to the plain
           surface colour, which shows as a lighter box on anything else. */
        --m3-util-background: rgb(var(--m3-scheme-surface-container-low));
        background-color: rgb(var(--m3-scheme-surface-container-low));
        color: rgb(var(--m3-scheme-on-surface));
    }

    h1 {
        margin: 0;
    }

    .body {
        margin: 0;
        color: rgb(var(--m3-scheme-on-surface-variant));
    }

    .remember {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        min-block-size: var(--size-control-md);
    }

    /* The checkbox is drawn at its own size by the component library; this box is what the row
       measures against. */
    .box {
        display: flex;
        align-items: center;
        justify-content: center;
        inline-size: var(--space-5);
        block-size: var(--space-5);
    }

    .submit {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--space-3);
        margin-block-start: var(--space-1);
    }
</style>
