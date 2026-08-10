import { GENERAL_SETTINGS_DEFAULTS, type GeneralSettings } from "$common/protocol.ts";
import { request } from "../connection.svelte.ts";

export interface ServerInfo {
    version: string;
    latestVersion?: string;
    protocolVersion: number;
    isContainer: boolean;
    primaryHostname: string;
}

export const serverInfo = $state<{ value: ServerInfo | null }>({ value: null });

export const settings = $state<{
    value: (GeneralSettings & { globalENV: string }) | null;
    loaded: boolean;
}>({ value: null, loaded: false });

/** True once the host shell is known to be available, so the nav entry can be hidden. */
export const consoleEnabled = $state<{ value: boolean }>({ value: false });

export function applyInfo(info: ServerInfo): void {
    serverInfo.value = info;
}

export async function loadSettings(): Promise<void> {
    settings.value = await request("", "settings.get", undefined);
    settings.loaded = true;
}

export async function saveSettings(
    next: Partial<GeneralSettings>,
    extra?: { globalENV?: string; currentPassword?: string },
): Promise<void> {
    await request("", "settings.set", {
        settings: next,
        ...(extra?.globalENV === undefined ? {} : { globalENV: extra.globalENV }),
        ...(extra?.currentPassword === undefined ? {} : { currentPassword: extra.currentPassword }),
    });
    await loadSettings();
}

export async function loadConsoleEnabled(): Promise<void> {
    try {
        const result = await request("", "terminal.mainEnabled", undefined);
        consoleEnabled.value = result.enabled;
    } catch {
        consoleEnabled.value = false;
    }
}

export function clearSettings(): void {
    settings.value = null;
    settings.loaded = false;
    consoleEnabled.value = false;
}

export function general(): GeneralSettings {
    return settings.value ?? { ...GENERAL_SETTINGS_DEFAULTS };
}
