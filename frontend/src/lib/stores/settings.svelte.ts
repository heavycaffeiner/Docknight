import { request, on } from "../connection.svelte.ts";

export interface SettingsValues {
    primaryHostname?: string;
    trustProxy?: boolean;
    checkUpdate?: boolean;
    checkBeta?: boolean;
    autoUpgrade?: boolean;
    globalENV?: string;
    disableAuth?: boolean;
    version?: string;
    latestVersion?: string | null;
    protocolVersion?: number;
    isContainer?: boolean;
}

export const settings = $state<{ values: SettingsValues | null }>({
    values: null,
});

export async function loadSettings(): Promise<SettingsValues> {
    const res = await request<SettingsValues>("", "settings.get", undefined);
    settings.values = { ...(settings.values ?? {}), ...res };
    return settings.values;
}

export async function saveSettings(partial: Partial<SettingsValues>): Promise<void> {
    await request("", "settings.set", partial);
    if (settings.values !== null) {
        Object.assign(settings.values, partial);
    }
}

on("info", (payload: unknown) => {
    const data = payload as Partial<SettingsValues> | undefined;
    if (data !== undefined) {
        settings.values = { ...(settings.values ?? {}), ...data };
    }
});
