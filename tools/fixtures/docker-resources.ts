import type {
    ContainerSummary,
    ImageSummary,
    NetworkSummary,
    VolumeSummary,
} from "../../common/docker.ts";
import { RUNNING } from "../../common/stack.ts";
import type { Scenario } from "./data/types.ts";

/**
 * Docker resource listings derived from a scenario's own stacks, so a scenario stays one
 * literal world without every fixture file having to restate its containers, images, volumes,
 * and networks. Deterministic: no clock, no randomness.
 */

const BUILTIN_NETWORKS: Record<string, true> = { bridge: true, host: true, none: true };

export function fixtureContainers(scenario: Scenario): ContainerSummary[] {
    const containers: ContainerSummary[] = [];
    for (const [stack, services] of Object.entries(scenario.serviceStatus)) {
        for (const [service, instances] of Object.entries(services)) {
            instances.forEach((instance, index) => {
                const state = instance.status === "running" ? "running" : instance.status;
                containers.push({
                    id: `${stack}-${service}-${String(index + 1)}`,
                    name: instance.name || `${stack}-${service}-${String(index + 1)}`,
                    image: `${service}:latest`,
                    state,
                    status: state === "running" ? "Up 2 hours" : "Exited (0) 2 hours ago",
                    ports: state === "running" ? "0.0.0.0:8080->80/tcp" : "",
                    stack,
                    service,
                });
            });
        }
    }
    containers.push({
        id: "standalone-watchtower",
        name: "watchtower",
        image: "containrrr/watchtower:latest",
        state: "running",
        status: "Up 6 days",
        ports: "",
        stack: null,
        service: null,
    });
    return containers;
}

export function fixtureImages(scenario: Scenario): ImageSummary[] {
    const references = new Set(fixtureContainers(scenario).map((container) => container.image));
    const images: ImageSummary[] = [...references].map((reference, index) => {
        const [repository = reference, tag = "latest"] = reference.split(":");
        return {
            id: `sha256:image${String(index)}`,
            reference,
            repository,
            tag,
            size: "184MB",
            sizeBytes: 184_000_000,
            created: "2 weeks ago",
            dangling: false,
            inUse: true,
        };
    });
    images.push({
        id: "sha256:dangling0",
        reference: "<none>:<none>",
        repository: "<none>",
        tag: "<none>",
        size: "72.4MB",
        sizeBytes: 72_400_000,
        created: "3 months ago",
        dangling: true,
        inUse: false,
    });
    return images;
}

export function fixtureVolumes(scenario: Scenario): VolumeSummary[] {
    const volumes: VolumeSummary[] = Object.entries(scenario.stacks).map(([name, summary]) => ({
        name: `${name}_data`,
        driver: "local",
        mountpoint: `/var/lib/docker/volumes/${name}_data/_data`,
        inUse: summary.status === RUNNING,
        stack: name,
    }));
    // One volume no stack claims, so the orphan path has something to act on.
    volumes.push({
        name: "old_backup_data",
        driver: "local",
        mountpoint: "/var/lib/docker/volumes/old_backup_data/_data",
        inUse: false,
        stack: null,
    });
    return volumes;
}

export function fixtureNetworks(scenario: Scenario): NetworkSummary[] {
    return scenario.networks.map((name, index) => ({
        id: `net${String(index)}`,
        name,
        driver: BUILTIN_NETWORKS[name] === true ? name : "bridge",
        scope: "local",
        builtin: BUILTIN_NETWORKS[name] === true,
        inUse: BUILTIN_NETWORKS[name] === true || index % 3 !== 2,
    }));
}
