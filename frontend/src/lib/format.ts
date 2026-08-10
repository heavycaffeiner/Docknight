const UNITS = ["B", "KiB", "MiB", "GiB", "TiB"] as const;

export function formatBytes(bytes: number, locale: string): string {
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < UNITS.length - 1) {
        value /= 1024;
        unit += 1;
    }
    const formatter = new Intl.NumberFormat(locale, {
        maximumFractionDigits: unit === 0 ? 0 : 1,
    });
    return `${formatter.format(value)} ${UNITS[unit] as string}`;
}

export function formatPercent(value: number, locale: string): string {
    return new Intl.NumberFormat(locale, {
        style: "percent",
        maximumFractionDigits: 1,
    }).format(value / 100);
}

export function formatNumber(value: number, locale: string): string {
    return new Intl.NumberFormat(locale).format(value);
}

export function formatRelative(fromMs: number, locale: string): string {
    const seconds = Math.round((fromMs - Date.now()) / 1000);
    const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    const steps: [Intl.RelativeTimeFormatUnit, number][] = [
        ["second", 60],
        ["minute", 60],
        ["hour", 24],
        ["day", 7],
        ["week", 4],
        ["month", 12],
    ];
    let value = seconds;
    for (const [unit, size] of steps) {
        if (Math.abs(value) < size) return formatter.format(value, unit);
        value = Math.round(value / size);
    }
    return formatter.format(value, "year");
}

/** Parse a `.env` style buffer. Quoting and escapes follow the compose rules closely enough. */
export function parseEnvText(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("#")) continue;
        const separator = trimmed.indexOf("=");
        if (separator < 0) continue;
        const key = trimmed.slice(0, separator).trim().replace(/^export\s+/, "");
        let value = trimmed.slice(separator + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
            (value.startsWith("'") && value.endsWith("'") && value.length > 1)
        ) {
            const quote = value[0];
            value = value.slice(1, -1);
            if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\"/g, '"');
        }
        if (key !== "") out[key] = value;
    }
    return out;
}
