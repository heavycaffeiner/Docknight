import { useMutation } from "@tanstack/react-query";
import { type FormEvent, type ReactElement, useRef, useState } from "react";
import { elementValue, useElementEvent } from "../lib/dom-events.ts";
import { useT } from "../lib/i18n.ts";
import { navigate, setupNeeded } from "../lib/router.ts";
import { login } from "../lib/session.ts";
import { toastError } from "../lib/toast.ts";
import { request } from "../lib/transport.ts";

export default function Setup(): ReactElement {
    const { t } = useT();
    const usernameRef = useRef<HTMLElement>(null);
    const passwordRef = useRef<HTMLElement>(null);
    const repeatRef = useRef<HTMLElement>(null);

    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [repeatPassword, setRepeatPassword] = useState("");

    useElementEvent(usernameRef, "input", () => setUsername(elementValue(usernameRef)));
    useElementEvent(passwordRef, "input", () => setPassword(elementValue(passwordRef)));
    useElementEvent(repeatRef, "input", () => setRepeatPassword(elementValue(repeatRef)));

    const mismatch = password !== "" && repeatPassword !== "" && password !== repeatPassword;

    const mutation = useMutation({
        mutationFn: async () => {
            await request("", "auth.setup", { username, password });
            setupNeeded.set(false);
            await login(username, password, true);
        },
        onSuccess: () => {
            void navigate("/");
        },
        onError: (err: unknown) => {
            toastError(err);
        },
    });

    function handleSubmit(event: FormEvent<HTMLFormElement>): void {
        event.preventDefault();
        if (mutation.isPending || mismatch || password === "" || username === "") return;
        mutation.mutate();
    }

    const disabled = mutation.isPending;

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
                        <h1 className="type-headline-small">{t("auth.setup.title")}</h1>
                        <span className="type-body-medium text-muted">
                            Set up the initial admin account
                        </span>
                    </div>

                    <form className="form-column" onSubmit={handleSubmit}>
                        <mdui-text-field
                            ref={usernameRef}
                            variant="outlined"
                            label={t("auth.setup.username")}
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
                            label={t("auth.setup.password")}
                            autocomplete="new-password"
                            enterkeyhint="next"
                            required
                            disabled={disabled}
                        />
                        <div className="section">
                            <mdui-text-field
                                ref={repeatRef}
                                variant="outlined"
                                type="password"
                                toggle-password
                                label={t("auth.setup.repeat")}
                                autocomplete="new-password"
                                enterkeyhint="go"
                                required
                                disabled={disabled}
                            />
                            {mismatch ? (
                                <span role="alert" className="type-label-medium danger-text">
                                    {t("auth.setup.passwordMismatch")}
                                </span>
                            ) : null}
                        </div>
                        <mdui-button
                            type="submit"
                            variant="filled"
                            full-width
                            loading={mutation.isPending}
                            disabled={disabled || mismatch || password === "" || username === ""}
                        >
                            {t("auth.setup.submit")}
                        </mdui-button>
                    </form>
                </div>
            </mdui-card>
        </div>
    );
}
