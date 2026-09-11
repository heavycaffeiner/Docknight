import type { ReactElement } from "react";
import { useT } from "../lib/i18n.ts";

type Tone = "running" | "error" | "pending" | "info" | "neutral";

const TONE_BY_STATUS: Record<string, Tone> = {
    running: "running",
    healthy: "running",
    exited: "error",
    dead: "error",
    unhealthy: "error",
    restarting: "pending",
    starting: "pending",
    paused: "pending",
    created: "info",
    draft: "info",
};

const LABEL_KEY_BY_STATUS: Record<string, string> = {
    running: "stack.status.running",
    exited: "stack.status.exited",
    created: "stack.status.created",
    draft: "stack.status.draft",
    unknown: "stack.status.unknown",
    healthy: "stack.status.healthy",
    unhealthy: "stack.status.unhealthy",
    starting: "stack.status.starting",
    restarting: "stack.status.restarting",
    paused: "stack.status.paused",
    dead: "stack.status.dead",
};

export default function StatusChip({ status }: { status: string }): ReactElement {
    const { t } = useT();
    const normalized = status.toLowerCase();
    const tone = TONE_BY_STATUS[normalized] ?? "neutral";
    const labelKey = LABEL_KEY_BY_STATUS[normalized];
    // An unmapped state is docker's own word, which beats showing nothing.
    const label = labelKey !== undefined ? t(labelKey) : status || t("stack.status.unknown");

    return (
        <span
            className={`status-chip type-label-medium${tone === "neutral" ? "" : ` status-chip--${tone}`}`}
        >
            <span className="status-chip__dot" aria-hidden="true" />
            {label}
        </span>
    );
}
