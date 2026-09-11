import { AppError } from "../../common/errors.ts";
import type {
    ContainerSummary,
    ImageSummary,
    NetworkSummary,
    PruneResult,
    VolumeSummary,
} from "../../common/docker.ts";
import { parseDockerSize, parseLabels } from "../../common/docker.ts";
import { bool, noParams, obj, optional, str } from "../../common/validate.ts";
import type { Config } from "../config.ts";
import { log } from "../log.ts";
import { runCapture } from "../stack/compose.ts";
import type { Conn } from "../ws/conn.ts";
import { method } from "../ws/router.ts";

declare module "../../common/protocol.ts" {
    interface MethodMap {
        "docker.images": { params: undefined; result: { images: ImageSummary[] } };
        "docker.imageRemove": { params: { target: string; force?: boolean }; result: { ok: true } };
        /**
         * Dangling layers only. There is deliberately no `--all` option and no volume prune:
         * before Engine 23 `docker volume prune` also removed unused named volumes, so bulk
         * deletion always goes through an explicit list of names the user saw first.
         */
        "docker.imagePrune": { params: undefined; result: PruneResult };
        "docker.volumes": { params: undefined; result: { volumes: VolumeSummary[] } };
        "docker.volumeRemove": { params: { name: string }; result: { ok: true } };
        "docker.networkList": { params: undefined; result: { networks: NetworkSummary[] } };
        "docker.networkRemove": { params: { name: string }; result: { ok: true } };
        "docker.containers": { params: undefined; result: { containers: ContainerSummary[] } };
    }
}

const imageRemoveParse = obj({ target: str({ min: 1, max: 512 }), force: optional(bool()) });
const nameParse = obj({ name: str({ min: 1, max: 256 }) });

const LIST_TIMEOUT_MS = 15_000;
const MUTATE_TIMEOUT_MS = 120_000;

/** Docker's own networks. The daemon refuses to remove them, so the UI never offers it. */
const BUILTIN_NETWORKS: Record<string, true> = { bridge: true, host: true, none: true };

type JsonRow<Fields extends readonly string[]> = Partial<Record<Fields[number], string>>;

const IMAGE_FIELDS = ["ID", "Repository", "Tag", "Size", "CreatedAt"] as const;
const IMAGE_IDENTITY_FIELDS = ["ID", "Repository", "Tag"] as const;

const VOLUME_FIELDS = ["Name", "Driver", "Mountpoint", "Labels"] as const;
const VOLUME_IDENTITY_FIELDS = ["Name"] as const;

const NETWORK_FIELDS = ["ID", "Name", "Driver", "Scope"] as const;
const NETWORK_IDENTITY_FIELDS = ["Name"] as const;

const CONTAINER_FIELDS = ["ID", "Names", "Image", "State", "Status", "Ports", "Labels"] as const;
const CONTAINER_IDENTITY_FIELDS = ["ID", "Names"] as const;
type ContainerRow = JsonRow<typeof CONTAINER_FIELDS>;

/**
 * `docker ... --format json` emits one JSON object per line. Subprocess output is untrusted:
 * non-objects are skipped, only known string fields survive, and identity fields must be nonempty.
 */
export function parseJsonLines<Field extends string>(
    out: string,
    fields: readonly Field[],
    identityFields: readonly Field[],
): Array<Partial<Record<Field, string>>> {
    const rows: Array<Partial<Record<Field, string>>> = [];
    for (const line of out.split("\n")) {
        const trimmed = line.trim();
        if (trimmed === "") continue;
        try {
            const parsed: unknown = JSON.parse(trimmed);
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;

            const source = parsed as Record<string, unknown>;
            const row: Partial<Record<Field, string>> = {};
            let hasField = false;
            for (const field of fields) {
                const value = source[field];
                if (typeof value !== "string") continue;
                row[field] = value;
                hasField = true;
            }
            let hasIdentity = true;
            for (const field of identityFields) {
                const value = row[field];
                if (value === undefined || value.trim() === "") {
                    hasIdentity = false;
                    break;
                }
            }
            if (hasField && hasIdentity) rows.push(row);
        } catch {
            continue;
        }
    }
    return rows;
}

/**
 * Read `Total reclaimed space: 1.2GB` and the deleted-item lines out of a prune's output.
 * Docker offers no machine-readable form for prune, so the summary line is the only source.
 */
export function parsePruneOutput(out: string): PruneResult {
    const match = /Total reclaimed space:\s*(.+)\s*$/m.exec(out);
    const reclaimed = match?.[1]?.trim() ?? "0B";
    const deleted = out
        .split("\n")
        .filter((line) => /^(deleted|untagged):/i.test(line.trim())).length;
    return { reclaimed, reclaimedBytes: parseDockerSize(reclaimed), deleted };
}

export function registerDockerMethods(config: Readonly<Config>): void {
    const cwd = config.stacksDir;

    async function listContainerRows(): Promise<ContainerRow[]> {
        const out = await runCapture(
            ["ps", "--all", "--no-trunc", "--format", "json"],
            cwd,
            LIST_TIMEOUT_MS,
        );
        return parseJsonLines(out, CONTAINER_FIELDS, CONTAINER_IDENTITY_FIELDS);
    }

    method("docker.images", {
        requiresAuth: true,
        routable: true,
        parse: noParams(),
        handle: async () => {
            try {
                const [listOut, containers] = await Promise.all([
                    runCapture(["image", "ls", "--all", "--format", "json"], cwd, LIST_TIMEOUT_MS),
                    listContainerRows(),
                ]);
                const usedReferences = new Set(
                    containers.map((row) => row.Image ?? "").filter((name) => name !== ""),
                );
                const images = parseJsonLines(
                    listOut,
                    IMAGE_FIELDS,
                    IMAGE_IDENTITY_FIELDS,
                ).map((row): ImageSummary => {
                    const repository = row.Repository ?? "<none>";
                    const tag = row.Tag ?? "<none>";
                    const reference = `${repository}:${tag}`;
                    const id = row.ID ?? "";
                    const size = row.Size ?? "0B";
                    return {
                        id,
                        reference,
                        repository,
                        tag,
                        size,
                        sizeBytes: parseDockerSize(size),
                        created: row.CreatedAt ?? "",
                        dangling: repository === "<none>" || tag === "<none>",
                        inUse: usedReferences.has(reference) || usedReferences.has(id),
                    };
                });
                images.sort((a, b) => b.sizeBytes - a.sizeBytes);
                return { images };
            } catch (error) {
                log.warn("docker", "docker.images failed", error);
                throw error instanceof AppError
                    ? error
                    : new AppError("commandFailed", "image listing failed");
            }
        },
    });

    method("docker.imageRemove", {
        requiresAuth: true,
        routable: true,
        parse: imageRemoveParse,
        handle: async (_conn: Conn, params) => {
            const argv = ["image", "rm"];
            if (params.force === true) argv.push("--force");
            argv.push(params.target);
            await runCapture(argv, cwd, MUTATE_TIMEOUT_MS);
            return { ok: true } as const;
        },
    });

    method("docker.imagePrune", {
        requiresAuth: true,
        routable: true,
        parse: noParams(),
        handle: async () =>
            parsePruneOutput(
                await runCapture(["image", "prune", "--force"], cwd, MUTATE_TIMEOUT_MS),
            ),
    });

    method("docker.volumes", {
        requiresAuth: true,
        routable: true,
        parse: noParams(),
        handle: async () => {
            const [allOut, danglingOut] = await Promise.all([
                runCapture(["volume", "ls", "--format", "json"], cwd, LIST_TIMEOUT_MS),
                runCapture(
                    ["volume", "ls", "--filter", "dangling=true", "--format", "json"],
                    cwd,
                    LIST_TIMEOUT_MS,
                ),
            ]);
            const dangling = new Set(
                parseJsonLines(danglingOut, VOLUME_FIELDS, VOLUME_IDENTITY_FIELDS)
                    .map((row) => row.Name ?? "")
                    .filter((name) => name !== ""),
            );
            const volumes = parseJsonLines(allOut, VOLUME_FIELDS, VOLUME_IDENTITY_FIELDS).map(
                (row): VolumeSummary => {
                    const labels = parseLabels(row.Labels ?? "");
                    return {
                        name: row.Name ?? "",
                        driver: row.Driver ?? "",
                        mountpoint: row.Mountpoint ?? "",
                        inUse: !dangling.has(row.Name ?? ""),
                        stack: labels["com.docker.compose.project"] ?? null,
                    };
                },
            );
            volumes.sort((a, b) => a.name.localeCompare(b.name));
            return { volumes };
        },
    });

    method("docker.volumeRemove", {
        requiresAuth: true,
        routable: true,
        parse: nameParse,
        handle: async (_conn: Conn, params) => {
            await runCapture(["volume", "rm", params.name], cwd, MUTATE_TIMEOUT_MS);
            return { ok: true } as const;
        },
    });

    // No volume prune. A volume holds user data, and on Engine versions before 23 the prune
    // subcommand removes unused named volumes too, so removal is always one named target.

    method("docker.networkList", {
        requiresAuth: true,
        routable: true,
        parse: noParams(),
        handle: async () => {
            const [allOut, danglingOut] = await Promise.all([
                runCapture(["network", "ls", "--format", "json"], cwd, LIST_TIMEOUT_MS),
                runCapture(
                    ["network", "ls", "--filter", "dangling=true", "--format", "json"],
                    cwd,
                    LIST_TIMEOUT_MS,
                ),
            ]);
            const dangling = new Set(
                parseJsonLines(danglingOut, NETWORK_FIELDS, NETWORK_IDENTITY_FIELDS)
                    .map((row) => row.Name ?? "")
                    .filter((name) => name !== ""),
            );
            const networks = parseJsonLines(allOut, NETWORK_FIELDS, NETWORK_IDENTITY_FIELDS).map(
                (row): NetworkSummary => {
                    const name = row.Name ?? "";
                    return {
                        id: row.ID ?? "",
                        name,
                        driver: row.Driver ?? "",
                        scope: row.Scope ?? "",
                        builtin: BUILTIN_NETWORKS[name] === true,
                        inUse: !dangling.has(name),
                    };
                },
            );
            networks.sort((a, b) => a.name.localeCompare(b.name));
            return { networks };
        },
    });

    method("docker.networkRemove", {
        requiresAuth: true,
        routable: true,
        parse: nameParse,
        handle: async (_conn: Conn, params) => {
            if (BUILTIN_NETWORKS[params.name] === true) {
                throw new AppError(
                    "validation",
                    "a built-in network cannot be removed",
                    "networkBuiltin",
                );
            }
            await runCapture(["network", "rm", params.name], cwd, MUTATE_TIMEOUT_MS);
            return { ok: true } as const;
        },
    });

    method("docker.containers", {
        requiresAuth: true,
        routable: true,
        parse: noParams(),
        handle: async () => {
            const containers = (await listContainerRows()).map((row): ContainerSummary => {
                const labels = parseLabels(row.Labels ?? "");
                return {
                    id: row.ID ?? "",
                    name: (row.Names ?? "").split(",")[0] ?? "",
                    image: row.Image ?? "",
                    state: row.State ?? "",
                    status: row.Status ?? "",
                    ports: row.Ports ?? "",
                    stack: labels["com.docker.compose.project"] ?? null,
                    service: labels["com.docker.compose.service"] ?? null,
                };
            });
            containers.sort((a, b) => a.name.localeCompare(b.name));
            return { containers };
        },
    });
}
