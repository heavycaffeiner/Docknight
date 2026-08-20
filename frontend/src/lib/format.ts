/** Format a byte count with binary units, e.g. "412.3 MiB". */
export function formatBytes(bytes: number): string {
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    const formatted = new Intl.NumberFormat(undefined, {
        maximumFractionDigits: unitIndex === 0 ? 0 : 1,
    }).format(value);
    return `${formatted} ${units[unitIndex]}`;
}

const RELATIVE_UNITS: [seconds: number, unit: Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [30, "day"],
    [12, "month"],
    [Infinity, "year"],
];

/** Relative time from a unix-seconds timestamp to now, e.g. "3 minutes ago". */
export function formatRelativeTime(unixSeconds: number, locale?: string): string {
    const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    let delta = unixSeconds - Math.floor(Date.now() / 1000);
    for (const [span, unit] of RELATIVE_UNITS) {
        if (Math.abs(delta) < span || span === Infinity) {
            return formatter.format(Math.round(delta), unit);
        }
        delta /= span;
    }
    return formatter.format(Math.round(delta), "year");
}
