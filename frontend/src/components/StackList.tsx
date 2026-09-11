import { type ReactElement, useMemo, useRef, useState } from "react";
import type { StackSummary } from "../../../common/stack.ts";
import { CREATED, DRAFT, EXITED, RUNNING } from "../../../common/stack.ts";
import { elementValue, useElementEvent } from "../lib/dom-events.ts";
import { useT } from "../lib/i18n.ts";
import { agents, splitStackKey, stacks } from "../lib/push.ts";
import { linkHandler, useRoute } from "../lib/router.ts";
import { useStore } from "../lib/store.ts";
import StatusChip from "./StatusChip.tsx";

const STATUS_WORD: Record<number, string> = {
    [RUNNING]: "running",
    [EXITED]: "exited",
    [CREATED]: "created",
    [DRAFT]: "draft",
};

interface Group {
    endpoint: string;
    hostName: string;
    items: Array<{ key: string; name: string; summary: StackSummary }>;
}

function stackHref(name: string, endpoint: string): string {
    return endpoint === "" ? `/compose/${name}` : `/compose/${name}/${encodeURIComponent(endpoint)}`;
}

export default function StackList({ onNavigate }: { onNavigate?: () => void }): ReactElement {
    const { t } = useT();
    const { byKey, loaded } = useStore(stacks);
    const { byEndpoint } = useStore(agents);
    const { path } = useRoute();
    const [filter, setFilter] = useState("");
    const searchRef = useRef<HTMLElement>(null);

    useElementEvent(searchRef, "input", () => setFilter(elementValue(searchRef)));

    const groups = useMemo((): Group[] => {
        const needle = filter.trim().toLowerCase();
        const byGroup = new Map<string, Group>();

        byGroup.set("", { endpoint: "", hostName: t("nav.home"), items: [] });
        for (const [endpoint, agent] of Object.entries(byEndpoint)) {
            byGroup.set(endpoint, { endpoint, hostName: agent.name || endpoint, items: [] });
        }

        for (const [key, summary] of Object.entries(byKey)) {
            const { name, endpoint } = splitStackKey(key);
            if (needle !== "" && !name.toLowerCase().includes(needle)) continue;
            let group = byGroup.get(endpoint);
            if (group === undefined) {
                group = { endpoint, hostName: endpoint, items: [] };
                byGroup.set(endpoint, group);
            }
            group.items.push({ key, name, summary });
        }

        for (const group of byGroup.values()) {
            group.items.sort((a, b) => a.name.localeCompare(b.name));
        }
        return [...byGroup.values()].filter((g) => g.items.length > 0 || needle === "");
    }, [byKey, byEndpoint, filter, t]);

    const multiHost = Object.keys(byEndpoint).length > 0;
    const total = groups.reduce((sum, g) => sum + g.items.length, 0);

    return (
        <div className="stack-list">
            <div className="stack-list__header">
                <span className="type-title-medium">{t("stack.list.title")}</span>
                <span className="stack-list__count mono type-label-medium">{total}</span>
            </div>
            <mdui-text-field
                ref={searchRef}
                variant="outlined"
                icon="search"
                clearable
                label={t("stack.list.search")}
            />

            {loaded && total === 0 ? (
                <p className="type-body-medium text-muted stack-list__empty">
                    {t("stack.list.empty")}
                </p>
            ) : null}

            <mdui-list>
                {groups.map((group) => (
                    <div className="list-group" key={group.endpoint || "local"}>
                        {multiHost ? <mdui-list-subheader>{group.hostName}</mdui-list-subheader> : null}
                        {group.items.map((item) => {
                            const href = stackHref(item.name, group.endpoint);
                            return (
                                <mdui-list-item
                                    key={item.key}
                                    href={href}
                                    rounded
                                    active={path === href}
                                    onClick={(event) => {
                                        linkHandler(href)(event);
                                        onNavigate?.();
                                    }}
                                >
                                    {item.name}
                                    <span slot="end-icon">
                                        <StatusChip
                                            status={STATUS_WORD[item.summary.status] ?? "unknown"}
                                        />
                                    </span>
                                </mdui-list-item>
                            );
                        })}
                    </div>
                ))}
            </mdui-list>

            <mdui-button
                variant="tonal"
                icon="add"
                onClick={(event) => {
                    linkHandler("/compose")(event);
                    onNavigate?.();
                }}
            >
                {t("stack.list.create")}
            </mdui-button>
        </div>
    );
}
