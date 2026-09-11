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
        "docker.imageRemove": { params: { id: string; force?: boolean }; result: { ok: true } };
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
        "docker.networkPrune": { params: undefined; result: PruneResult };
        "docker.containers": { params: undefined; result: { containers: ContainerSummary[] } };
    }
}

const imageRemoveParse = obj({ id: str({ min: 1, max: 256 }), force: optional(bool()) });
const nameParse = obj({ name: str({ min: 1, max: 256 }) });

const LIST_TIMEOUT_MS = 15_000;
const MUTATE_TIMEOUT_MS = 120_000;

/** Docker's own networks. The daemon refuses to remove them, so the UI never offers it. */
const BUILTIN_NETWORKS: Record<string, true> = { bridge: true, host: true, none: true };

interface ImageRow {
    ID?: string;
    Repository?: string;
    Tag?: string;
    Size?: string;
    CreatedAt?: string;
}

interface VolumeRow {
    Name?: string;
    Driver?: string;
    Mountpoint?: string;
    Labels?: string;
}

interface NetworkRow {
    ID?: string;
    Name?: string;
    Driver?: string;
    Scope?: string;
}

interface ContainerRow {
    ID?: string;
    Names?: string;
    Image?: string;
    State?: string;
    Status?: string;
    Ports?: string;
    Labels?: string;
}

/**
 * `docker ... --format json` emits one JSON object per line. A line that fails to parse is
 * skipped so one malformed record never costs the whole listing.
 */
export function parseJsonLines<T>(out: string): T[] {
    const rows: T[] = [];
    for (const line of out.split("\n")) {
        const trimmed = line.trim();
        if (trimmed === "") continue;
        try {
            rows.push(JSON.parse(trimmed) as T);
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
        return parseJsonLines<ContainerRow>(out);
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
                const images = parseJsonLines<ImageRow>(listOut).map((row): ImageSummary => {
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
            argv.push(params.id);
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
                parseJsonLines<VolumeRow>(danglingOut)
                    .map((row) => row.Name ?? "")
                    .filter((name) => name !== ""),
            );
            const volumes = parseJsonLines<VolumeRow>(allOut).map((row): VolumeSummary => {
                const labels = parseLabels(row.Labels ?? "");
                return {
                    name: row.Name ?? "",
                    driver: row.Driver ?? "",
                    mountpoint: row.Mountpoint ?? "",
                    inUse: !dangling.has(row.Name ?? ""),
                    stack: labels["com.docker.compose.project"] ?? null,
                };
            });
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
                parseJsonLines<NetworkRow>(danglingOut)
                    .map((row) => row.Name ?? "")
                    .filter((name) => name !== ""),
            );
            const networks = parseJsonLines<NetworkRow>(allOut).map((row): NetworkSummary => {
                const name = row.Name ?? "";
                return {
                    id: row.ID ?? "",
                    name,
                    driver: row.Driver ?? "",
                    scope: row.Scope ?? "",
                    builtin: BUILTIN_NETWORKS[name] === true,
                    inUse: !dangling.has(name),
                };
            });
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

    method("docker.networkPrune", {
        requiresAuth: true,
        routable: true,
        parse: noParams(),
        handle: async () =>
            parsePruneOutput(await runCapture(["network", "prune", "--force"], cwd, MUTATE_TIMEOUT_MS)),
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
