/** Stack status values, shared by the registry, the protocol payloads and the UI chips. */
export const UNKNOWN = 0;
export const DRAFT = 1;
export const CREATED = 2;
export const RUNNING = 3;
export const EXITED = 4;

export type StackStatus = typeof UNKNOWN | typeof DRAFT | typeof CREATED | typeof RUNNING | typeof EXITED;

/** Probed in this order; the first that exists wins and is preserved on save. */
export const COMPOSE_FILE_NAMES = [
    "compose.yaml",
    "docker-compose.yaml",
    "docker-compose.yml",
    "compose.yml",
] as const;

export const DEFAULT_COMPOSE_FILE_NAME = "compose.yaml";

/**
 * The leading character is constrained so a name can never begin with `-` and be read as a
 * flag by the docker CLI.
 */
export const STACK_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/** Read cap for compose.yaml and .env, so an oversized file never reaches an editor. */
export const MAX_STACK_FILE_BYTES = 1024 * 1024;

export const GLOBAL_ENV_FILE_NAME = "global.env";

/** Written back as a deletion signal: content equal to this removes the file. */
export const GLOBAL_ENV_PLACEHOLDER = "# VARIABLE=value #comment";

export interface StackSummary {
    name: string;
    status: StackStatus;
    /** True when a directory for this stack exists under the stacks directory. */
    managed: boolean;
    composeFileName: string;
}

export interface StackDetail extends StackSummary {
    composeYAML: string;
    composeENV: string;
    /** For building service URLs in the UI. */
    primaryHostname: string;
}

/** One container of one service: its container name and its health or state. */
export interface ServiceInstance {
    name: string;
    status: string;
}

/** One record of `docker stats --format json`, passed through unchanged. */
export interface DockerStat {
    Name: string;
    ID?: string;
    CPUPerc?: string;
    MemUsage?: string;
    MemPerc?: string;
    NetIO?: string;
    BlockIO?: string;
    PIDs?: string;
}

/** Convert a `docker compose ls` status string such as "exited(1), running(2)". */
export function convertStatus(text: string): StackStatus {
    const value = text.trim().toLowerCase();
    if (value.startsWith("created")) return CREATED;
    if (value.includes("exited")) return EXITED;
    if (value.startsWith("running")) return RUNNING;
    return UNKNOWN;
}

/** i18n key for a status value, so the chip text and the colour come from one place. */
export function statusKey(status: StackStatus): string {
    switch (status) {
        case DRAFT:
            return "statusDraft";
        case CREATED:
            return "statusCreated";
        case RUNNING:
            return "statusRunning";
        case EXITED:
            return "statusExited";
        default:
            return "statusUnknown";
    }
}

/** Composite key under which the client merges one host's stacks into the shared store. */
export function stackKey(name: string, endpoint: string): string {
    return `${name} ${endpoint}`;
}
