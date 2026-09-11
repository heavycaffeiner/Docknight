import { type FormEvent, type ReactElement, useEffect, useRef, useState } from "react";
import { AppError } from "../../../common/errors.ts";
import { elementChecked, elementValue, useElementEvent } from "../lib/dom-events.ts";
import { useT } from "../lib/i18n.ts";
import { login } from "../lib/session.ts";
import { toastError } from "../lib/toast.ts";

/** Falls back to 30s when the server does not attach a `seconds` value to the error. */
function rateLimitSeconds(err: AppError): number {
    const raw = err.values?.seconds;
    if (raw === undefined) return 30;
    const seconds = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 30;
}

export default function Login(): ReactElement {
    const { t } = useT();
    const usernameRef = useRef<HTMLElement>(null);
    const passwordRef = useRef<HTMLElement>(null);
    const totpRef = useRef<HTMLElement>(null);
    const rememberRef = useRef<HTMLElement>(null);

    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [remember, setRemember] = useState(true);
    const [totpCode, setTotpCode] = useState("");
    const [totpMode, setTotpMode] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
    const [rateLimitRemaining, setRateLimitRemaining] = useState(0);

    useElementEvent(usernameRef, "input", () => setUsername(elementValue(usernameRef)));
    useElementEvent(passwordRef, "input", () => setPassword(elementValue(passwordRef)));
    useElementEvent(totpRef, "input", () => setTotpCode(elementValue(totpRef)));
    useElementEvent(rememberRef, "change", () => setRemember(elementChecked(rememberRef)));

    // Mirrors the old screen's countdown: ticks the remaining seconds shown on the submit button.
    useEffect(() => {
        if (rateLimitedUntil === null) return;
        const interval = window.setInterval(() => {
            const remaining = Math.max(0, Math.ceil((rateLimitedUntil - Date.now()) / 1000));
            setRateLimitRemaining(remaining);
            if (remaining <= 0) setRateLimitedUntil(null);
        }, 1000);
        return () => window.clearInterval(interval);
    }, [rateLimitedUntil]);

    const disabled = submitting || rateLimitedUntil !== null;

    async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        if (disabled) return;

        setSubmitting(true);
        try {
            const res = await login(username, password, remember, totpMode ? totpCode : undefined);
            if (res === "totp") setTotpMode(true);
        } catch (err) {
            if (err instanceof AppError && err.code === "rateLimited") {
                const seconds = rateLimitSeconds(err);
                setRateLimitedUntil(Date.now() + seconds * 1000);
                setRateLimitRemaining(seconds);
            }
            toastError(err);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="center-screen auth-screen">
            <mdui-card variant="elevated" className="auth-card">
                <div className="auth-brand">
                    <span className="auth-brand__mark" aria-hidden="true">
                        <mdui-icon name="inventory_2--outlined" />
                    </span>
                    <span className="type-title-large">Docknight</span>
                </div>
                <div className="form-column form-column--narrow">
                    <div className="section">
                        <h1 className="type-headline-small">{t("auth.login.title")}</h1>
                        <span className="type-body-medium text-muted">{t("auth.login.subtitle")}</span>
                    </div>

                    <form className="form-column" onSubmit={(event) => void handleSubmit(event)}>
                        {!totpMode ? (
                            <>
                                <mdui-text-field
                                    ref={usernameRef}
                                    variant="outlined"
                                    label={t("auth.login.username")}
                                    autocomplete="username"
                                    enterkeyhint="next"
                                    required
                                    disabled={disabled}
                                />
                                <mdui-text-field
                                    ref={passwordRef}
                                    variant="outlined"
                                    type="password"
                                    toggle-password
                                    label={t("auth.login.password")}
                                    autocomplete="current-password"
                                    enterkeyhint="go"
                                    required
                                    disabled={disabled}
                                />
                                <mdui-checkbox ref={rememberRef} checked={remember} disabled={disabled}>
                                    {t("auth.login.remember")}
                                </mdui-checkbox>
                                <mdui-button
                                    type="submit"
                                    variant="filled"
                                    full-width
                                    disabled={disabled}
                                    loading={submitting}
                                >
                                    {rateLimitedUntil !== null
                                        ? t("error.rateLimited", { seconds: rateLimitRemaining })
                                        : t("auth.login.submit")}
                                </mdui-button>
                            </>
                        ) : (
                            <>
                                <mdui-text-field
                                    ref={totpRef}
                                    variant="outlined"
                                    className="mono"
                                    label={t("auth.login.totpLabel")}
                                    inputmode="numeric"
                                    autocomplete="one-time-code"
                                    enterkeyhint="go"
                                    required
                                    disabled={disabled}
                                />
                                <mdui-button
                                    type="submit"
                                    variant="filled"
                                    full-width
                                    disabled={disabled}
                                    loading={submitting}
                                >
                                    {t("auth.login.totpSubmit")}
                                </mdui-button>
                            </>
                        )}
                    </form>
                </div>
            </mdui-card>
        </div>
    );
}
