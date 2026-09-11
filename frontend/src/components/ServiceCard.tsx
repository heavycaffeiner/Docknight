import { type ReactElement, useMemo, useRef, useState } from "react";
import type { ServiceInstance } from "../../../common/stack.ts";
import { elementValue, useElementEvent } from "../lib/dom-events.ts";
import { useT } from "../lib/i18n.ts";
import { useSizeClass } from "../lib/media.ts";
import { linkHandler } from "../lib/router.ts";
import { parsePort } from "../pages/compose/sync.ts";
import NetworkInput from "../pages/compose/NetworkInput.tsx";
import ArrayInput from "./ArrayInput.tsx";
import BottomSheet from "./BottomSheet.tsx";
import ConfirmDialog from "./ConfirmDialog.tsx";
import "./ServiceCard.css";
import StatusChip from "./StatusChip.tsx";

interface ContainerStats {
    Name?: string;
    CPUPerc?: string;
    MemUsage?: string;
}

interface Props {
    name: string;
    stackName: string;
    service: Record<string, unknown> | undefined;
    editable: boolean;
    multiService: boolean;
    status?: ServiceInstance[];
    stats?: ContainerStats[];
    expandedPorts?: string[];
    availableNetworks: string[];
    onStart?: (name: string) => void;
    onStop?: (name: string) => void;
    onRestart?: (name: string) => void;
    onRemove: (name: string) => void;
    onServiceChange: (name: string, patch: Record<string, unknown>) => void;
}

function stringField(service: Record<string, unknown>, key: string): string | undefined {
    const value = service[key];
    return typeof value === "string" ? value : undefined;
}

function stringArrayField(service: Record<string, unknown>, key: string): string[] | undefined {
    const value = service[key];
    if (!Array.isArray(value)) return undefined;
    return value.filter((entry): entry is string => typeof entry === "string");
}

export default function ServiceCard({
    name,
    stackName,
    service,
    editable,
    multiService,
    status,
    stats,
    expandedPorts,
    availableNetworks,
    onStart,
    onStop,
    onRestart,
    onRemove,
    onServiceChange,
}: Props): ReactElement {
    const { t } = useT();
    const sizeClass = useSizeClass();

    const [removeConfirm, setRemoveConfirm] = useState(false);
    const [statsExpanded, setStatsExpanded] = useState(false);
    const [overflowOpen, setOverflowOpen] = useState(false);
    const imageRef = useRef<HTMLElement>(null);

    useElementEvent(imageRef, "input", () => onServiceChange(name, { image: elementValue(imageRef) }));

    // The backend's service status no longer reports per-instance shell availability (see
    // ServiceInstance in common/stack.ts); the closest available signal is that the service
    // has at least one known container instance. `terminal.exec` rejects a shell into a
    // service that is not actually running, so this only gates the affordance, not safety.
    const canShell = status !== undefined && status.length > 0;
    const primaryStatus = status?.[0]?.status ?? "unknown";
    const shellHref = `/terminal/${stackName}/${name}/sh`;

    const ports = useMemo(() => {
        const raw = expandedPorts ?? (service !== undefined ? stringArrayField(service, "ports") : undefined) ?? [];
        return raw.map((entry) => ({ entry, parsed: parsePort(entry, location.hostname) }));
    }, [expandedPorts, service]);

    const showInlineActions = !editable && sizeClass !== "compact";
    const showOverflowTrigger = !editable && sizeClass === "compact";

    return (
        <>
            <mdui-card variant="outlined">
                <div className="row">
                    <span className="type-title-medium">{name}</span>
                    {status !== undefined ? <StatusChip status={primaryStatus} /> : null}
                    <div className="row-end">
                        {showInlineActions ? (
                            <>
                                {canShell ? (
                                    <mdui-button variant="text" href={shellHref} onClick={linkHandler(shellHref)}>
                                        {t("service.action.shell")}
                                    </mdui-button>
                                ) : null}
                                {multiService ? (
                                    <>
                                        <mdui-button variant="text" onClick={() => onStart?.(name)}>
                                            {t("service.action.start")}
                                        </mdui-button>
                                        <mdui-button variant="text" onClick={() => onStop?.(name)}>
                                            {t("service.action.stop")}
                                        </mdui-button>
                                        <mdui-button variant="text" onClick={() => onRestart?.(name)}>
                                            {t("service.action.restart")}
                                        </mdui-button>
                                    </>
                                ) : null}
                            </>
                        ) : null}
                        {showOverflowTrigger ? (
                            <mdui-button-icon
                                icon="more_vert"
                                aria-label={t("action.more")}
                                onClick={() => setOverflowOpen(true)}
                            />
                        ) : null}
                    </div>
                </div>

                {!editable ? (
                    <dl className="service-details">
                        <dt className="type-label-medium text-muted">{t("stack.service.image")}</dt>
                        <dd className="mono type-body-medium">
                            {service !== undefined ? (stringField(service, "image") ?? "") : ""}
                        </dd>

                        {ports.length > 0 ? (
                            <>
                                <dt className="type-label-medium text-muted">{t("stack.service.ports")}</dt>
                                <dd>
                                    <div className="row">
                                        {ports.map(({ entry, parsed }) =>
                                            parsed !== null ? (
                                                <a
                                                    key={entry}
                                                    href={parsed.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="status-chip type-label-medium"
                                                >
                                                    {parsed.display}
                                                </a>
                                            ) : (
                                                <span key={entry} className="status-chip type-label-medium">
                                                    {entry}
                                                </span>
                                            ),
                                        )}
                                    </div>
                                </dd>
                            </>
                        ) : null}

                        {stats !== undefined && stats.length > 0 ? (
                            <>
                                <dt className="type-label-medium text-muted">{t("stack.service.stats")}</dt>
                                <dd>
                                    <div className="row">
                                        <span className="type-label-medium text-muted mono">
                                            {stats[0]?.CPUPerc ?? "-"} CPU
                                        </span>
                                        <span className="type-label-medium text-muted mono">
                                            {stats[0]?.MemUsage ?? "-"}
                                        </span>
                                        {stats.length > 1 ? (
                                            <mdui-button-icon
                                                icon={statsExpanded ? "expand_less" : "expand_more"}
                                                aria-label={t("action.more")}
                                                aria-expanded={statsExpanded}
                                                onClick={() => setStatsExpanded(!statsExpanded)}
                                            />
                                        ) : null}
                                    </div>
                                    {statsExpanded
                                        ? stats.slice(1).map((stat) => (
                                              <div key={stat.Name} className="row">
                                                  <span className="type-label-medium text-muted">{stat.Name}</span>
                                                  <span className="type-label-medium text-muted mono">
                                                      {stat.CPUPerc ?? "-"}
                                                  </span>
                                                  <span className="type-label-medium text-muted mono">
                                                      {stat.MemUsage ?? "-"}
                                                  </span>
                                              </div>
                                          ))
                                        : null}
                                </dd>
                            </>
                        ) : null}
                    </dl>
                ) : service !== undefined ? (
                    <div className="form-column">
                        <mdui-text-field
                            ref={imageRef}
                            variant="outlined"
                            label={t("stack.service.image")}
                            value={stringField(service, "image") ?? ""}
                        />
                        <ArrayInput
                            items={stringArrayField(service, "ports")}
                            onChange={(items) => onServiceChange(name, { ports: items })}
                            label={t("stack.service.ports")}
                            placeholder={t("stack.service.hostContainerPlaceholder")}
                        />
                        <ArrayInput
                            items={stringArrayField(service, "volumes")}
                            onChange={(items) => onServiceChange(name, { volumes: items })}
                            label={t("stack.service.volumes")}
                            placeholder={t("stack.service.hostContainerPlaceholder")}
                        />
                        <ArrayInput
                            items={stringArrayField(service, "depends_on")}
                            onChange={(items) => onServiceChange(name, { depends_on: items })}
                            label={t("stack.service.dependsOn")}
                        />
                        <NetworkInput
                            networks={stringArrayField(service, "networks")}
                            onChange={(items) => onServiceChange(name, { networks: items })}
                            available={availableNetworks}
                        />
                        <div className="form-actions">
                            <mdui-button
                                variant="filled"
                                className="danger-action"
                                onClick={() => setRemoveConfirm(true)}
                            >
                                {t("service.action.remove")}
                            </mdui-button>
                        </div>
                    </div>
                ) : null}
            </mdui-card>

            <BottomSheet open={overflowOpen} title={name} onClose={() => setOverflowOpen(false)}>
                <mdui-list>
                    {canShell ? (
                        <mdui-list-item
                            href={shellHref}
                            onClick={(event) => {
                                setOverflowOpen(false);
                                linkHandler(shellHref)(event);
                            }}
                        >
                            {t("service.action.shell")}
                        </mdui-list-item>
                    ) : null}
                    {multiService ? (
                        <>
                            <mdui-list-item
                                onClick={() => {
                                    setOverflowOpen(false);
                                    onStart?.(name);
                                }}
                            >
                                {t("service.action.start")}
                            </mdui-list-item>
                            <mdui-list-item
                                onClick={() => {
                                    setOverflowOpen(false);
                                    onStop?.(name);
                                }}
                            >
                                {t("service.action.stop")}
                            </mdui-list-item>
                            <mdui-list-item
                                onClick={() => {
                                    setOverflowOpen(false);
                                    onRestart?.(name);
                                }}
                            >
                                {t("service.action.restart")}
                            </mdui-list-item>
                        </>
                    ) : null}
                </mdui-list>
            </BottomSheet>

            <ConfirmDialog
                open={removeConfirm}
                title={t("service.action.remove")}
                message={name}
                danger
                onConfirm={() => {
                    setRemoveConfirm(false);
                    onRemove(name);
                }}
                onCancel={() => setRemoveConfirm(false)}
            />
        </>
    );
}
