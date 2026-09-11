/** Shapes returned by the docker resource methods. Shared so both sides agree on the wire. */

export interface ImageSummary {
    id: string;
    /** `repository:tag`, or `<none>:<none>` for a dangling image. */
    reference: string;
    repository: string;
    tag: string;
    /** Docker's own human-readable size string, shown as-is. */
    size: string;
    sizeBytes: number;
    created: string;
    dangling: boolean;
    inUse: boolean;
}

export interface VolumeSummary {
    name: string;
    driver: string;
    mountpoint: string;
    /** Docker reports a volume as dangling when no container currently references it. */
    inUse: boolean;
    /**
     * The compose project that created it, when the volume carries the label. A stopped
     * stack's volume is unreferenced but not an orphan, so this is what separates the two.
     */
    stack: string | null;
}

export interface NetworkSummary {
    id: string;
    name: string;
    driver: string;
    scope: string;
    /** `bridge`, `host`, and `none` are created by the daemon and cannot be removed. */
    builtin: boolean;
    inUse: boolean;
}

export interface ContainerSummary {
    id: string;
    name: string;
    image: string;
    /** `running`, `exited`, `paused`, `created`, `restarting`, `dead`, `removing`. */
    state: string;
    /** Docker's human status line, for example `Up 3 hours (healthy)`. */
    status: string;
    ports: string;
    /** Compose project and service, when the container carries the compose labels. */
    stack: string | null;
    service: string | null;
}

export interface PruneResult {
    /** Docker's human-readable reclaimed-space string. */
    reclaimed: string;
    reclaimedBytes: number;
    deleted: number;
}

const SIZE_UNITS: Record<string, number> = {
    b: 1,
    kb: 1000,
    mb: 1000 ** 2,
    gb: 1000 ** 3,
    tb: 1000 ** 4,
    kib: 1024,
    mib: 1024 ** 2,
    gib: 1024 ** 3,
    tib: 1024 ** 4,
};

/**
 * Turn docker's human size string ("1.234GB", "0B", "512 kB") into bytes. Docker prints sizes
 * only in this form on the list endpoints, and a numeric value is needed to sort by size.
 * Returns 0 for anything unparseable, which sorts such a row to the bottom rather than
 * failing the whole listing.
 */
export function parseDockerSize(text: string): number {
    const match = /^\s*([0-9]*\.?[0-9]+)\s*([a-zA-Z]*)\s*$/.exec(text);
    if (match === null) return 0;
    const value = Number(match[1]);
    if (!Number.isFinite(value)) return 0;
    const unit = (match[2] ?? "").toLowerCase();
    if (unit === "") return value;
    const factor = SIZE_UNITS[unit];
    return factor === undefined ? 0 : Math.round(value * factor);
}

/** Parse docker's `key=value,key=value` label column. */
export function parseLabels(text: string): Record<string, string> {
    const labels: Record<string, string> = {};
    for (const pair of text.split(",")) {
        const at = pair.indexOf("=");
        if (at <= 0) continue;
        labels[pair.slice(0, at)] = pair.slice(at + 1);
    }
    return labels;
}
