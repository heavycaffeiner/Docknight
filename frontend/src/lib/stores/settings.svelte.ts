import { on, request } from "../connection.svelte.ts";

export interface SettingsValues {
    disableAuth: boolean;
    primaryHostname: string;
    checkUpdate: boolean;
    checkBeta: boolean;
    autoUpgrade: boolean;
    trustProxy: boolean;
    globalENV: string;
}

export interface InfoPayload {
    version: string;
    latestVersion?: string;
    protocolVersion: number;
    isContainer: boolean;
    primaryHostname: string;
}

const state = $state<{ values: SettingsValues | null; info: InfoPayload | null }>({
    values: null,
    info: null,
});

export const settings: { readonly values: SettingsValues | null; readonly info: InfoPayload | null } = {
    get values() {
        return state.values;
    },
    get info() {
        return state.info;
    },
};

export async function load(): Promise<SettingsValues> {
    const result = await request("", "settings.get", undefined);
    state.values = result;
    return result;
}

export async function save(
    partial: Partial<Omit<SettingsValues, "globalENV">>,
    globalENV?: string,
    currentPassword?: string,
): Promise<void> {
    await request("", "settings.set", { settings: partial, globalENV, currentPassword });
    if (state.values !== null) {
        state.values = { ...state.values, ...partial, ...(globalENV === undefined ? {} : { globalENV }) };
    }
}

export function resetSettingsStore(): void {
    state.values = null;
}

on("info", (_endpoint, data) => {
    state.info = data as InfoPayload;
});
