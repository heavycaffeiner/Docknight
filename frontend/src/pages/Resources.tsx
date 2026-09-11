import { type ReactElement, useRef } from "react";
import ContainersTable from "../components/resources/ContainersTable.tsx";
import ImagesTable from "../components/resources/ImagesTable.tsx";
import NetworksTable from "../components/resources/NetworksTable.tsx";
import VolumesTable from "../components/resources/VolumesTable.tsx";
import { elementValue, useElementEvent } from "../lib/dom-events.ts";
import { useT } from "../lib/i18n.ts";
import { agents } from "../lib/push.ts";
import { navigate } from "../lib/router.ts";
import { useStore } from "../lib/store.ts";
import { useParams } from "../routes.ts";

const KINDS = ["containers", "images", "volumes", "networks"] as const;
type Kind = (typeof KINDS)[number];

function isKind(value: string): value is Kind {
    return (KINDS as readonly string[]).includes(value);
}

function hrefFor(kind: Kind, endpoint: string): string {
    return endpoint === "" ? `/resources/${kind}` : `/resources/${kind}/${encodeURIComponent(endpoint)}`;
}

/**
 * Containers, images, volumes, and networks are one task and one destination. Four top-level
 * destinations would not fit a bottom navigation bar alongside home, console, and settings.
 */
export default function Resources(): ReactElement {
    const { t } = useT();
    const params = useParams();
    const { byEndpoint } = useStore(agents);
    const tabsRef = useRef<HTMLElement>(null);

    const kindParam = params.kind ?? "containers";
    const kind: Kind = isKind(kindParam) ? kindParam : "containers";
    const endpoint = params.endpoint ?? "";

    useElementEvent(tabsRef, "change", () => {
        const value = elementValue(tabsRef);
        if (isKind(value) && value !== kind) void navigate(hrefFor(value, endpoint));
    });

    const hosts = [
        { endpoint: "", name: t("nav.home") },
        ...Object.values(byEndpoint).map((agent) => ({
            endpoint: agent.endpoint,
            name: agent.name || agent.endpoint,
        })),
    ];

    return (
        <div className="page resources-page">
            <div className="page-header">
                <h1 className="type-headline-small">{t("nav.resources")}</h1>
                {hosts.length > 1 ? (
                    <div className="page-header__actions">
                        <mdui-segmented-button-group
                            value={endpoint}
                            selects="single"
                            aria-label={t("dashboard.hosts.title")}
                        >
                            {hosts.map((host) => (
                                <mdui-segmented-button
                                    key={host.endpoint || "local"}
                                    value={host.endpoint}
                                    aria-label={host.name}
                                    onClick={() => void navigate(hrefFor(kind, host.endpoint))}
                                >
                                    {host.name}
                                </mdui-segmented-button>
                            ))}
                        </mdui-segmented-button-group>
                    </div>
                ) : null}
            </div>

            <mdui-tabs ref={tabsRef} value={kind} full-width>
                <mdui-tab value="containers" icon="inventory_2--outlined">
                    {t("resources.tab.containers")}
                </mdui-tab>
                <mdui-tab value="images" icon="layers--outlined">
                    {t("resources.tab.images")}
                </mdui-tab>
                <mdui-tab value="volumes" icon="storage--outlined">
                    {t("resources.tab.volumes")}
                </mdui-tab>
                <mdui-tab value="networks" icon="lan--outlined">
                    {t("resources.tab.networks")}
                </mdui-tab>

                <mdui-tab-panel slot="panel" value="containers">
                    {kind === "containers" ? <ContainersTable endpoint={endpoint} /> : null}
                </mdui-tab-panel>
                <mdui-tab-panel slot="panel" value="images">
                    {kind === "images" ? <ImagesTable endpoint={endpoint} /> : null}
                </mdui-tab-panel>
                <mdui-tab-panel slot="panel" value="volumes">
                    {kind === "volumes" ? <VolumesTable endpoint={endpoint} /> : null}
                </mdui-tab-panel>
                <mdui-tab-panel slot="panel" value="networks">
                    {kind === "networks" ? <NetworksTable endpoint={endpoint} /> : null}
                </mdui-tab-panel>
            </mdui-tabs>
        </div>
    );
}
