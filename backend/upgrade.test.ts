import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import { loadConfig } from "./config.ts";
import { resolveTarget, selfContainerId, shellQuote, type ResolveTargetDeps } from "./upgrade.ts";

async function withTempDir<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), "docknight-upgrade-"));
    try {
        return await fn(dir);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

const CONTAINER_ID = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
const SHORT_ID = "a1b2c3d4e5f6";

test("selfContainerId reads a docker-managed mount path from mountinfo", async () => {
    await withTempDir(async (dir) => {
        const mountinfoPath = join(dir, "mountinfo");
        await writeFile(
            mountinfoPath,
            `123 45 0:1 / / rw - overlay overlay rw\n` +
                `456 45 0:2 / /etc/hosts rw - overlay overlay ` +
                `upperdir=/var/lib/docker/containers/${CONTAINER_ID}/upper\n`,
        );
        const id = selfContainerId({ mountinfoPath, cgroupPath: join(dir, "missing"), hostname: "whatever" });
        assert.equal(id, CONTAINER_ID);
    });
});

test("selfContainerId falls back to the cgroup path when mountinfo has nothing", async () => {
    await withTempDir(async (dir) => {
        const cgroupPath = join(dir, "cgroup");
        await writeFile(cgroupPath, `0::/system.slice/docker-${CONTAINER_ID}.scope\n`);
        const id = selfContainerId({
            mountinfoPath: join(dir, "missing"),
            cgroupPath,
            hostname: "whatever",
        });
        assert.equal(id, CONTAINER_ID);
    });
});

test("selfContainerId falls back to the hostname when it looks like a short container id", () => {
    const id = selfContainerId({
        mountinfoPath: "/does/not/exist",
        cgroupPath: "/does/not/exist",
        hostname: SHORT_ID,
    });
    assert.equal(id, SHORT_ID);
});

test("selfContainerId returns null when nothing identifies the container", () => {
    const id = selfContainerId({
        mountinfoPath: "/does/not/exist",
        cgroupPath: "/does/not/exist",
        hostname: "not-a-container-id",
    });
    assert.equal(id, null);
});

function containerConfig(isContainer: boolean): Parameters<typeof resolveTarget>[0] {
    return loadConfig(["node", "index.ts", "--data-dir", "/tmp/x", "--stacks-dir", "/tmp/y"], {
        DOCKNIGHT_IS_CONTAINER: isContainer ? "1" : "0",
    });
}

const fakeSources = { mountinfoPath: "/dev/null", cgroupPath: "/dev/null", hostname: SHORT_ID };

test("resolveTarget reports upgradeNotContainer when not running as a container", async () => {
    const result = await resolveTarget(containerConfig(false), {
        sources: fakeSources,
        socketExists: () => true,
        inspect: () => Promise.resolve("{}"),
    });
    assert.deepEqual(result, { reason: "upgradeNotContainer" });
});

test("resolveTarget reports upgradeNoSocket when the docker socket is absent", async () => {
    const result = await resolveTarget(containerConfig(true), {
        sources: fakeSources,
        socketExists: () => false,
        inspect: () => Promise.resolve("{}"),
    });
    assert.deepEqual(result, { reason: "upgradeNoSocket" });
});

test("resolveTarget reports upgradeSelfUnknown when the container cannot identify itself", async () => {
    const result = await resolveTarget(containerConfig(true), {
        sources: { mountinfoPath: "/dev/null", cgroupPath: "/dev/null", hostname: "not-an-id" },
        socketExists: () => true,
        inspect: () => Promise.resolve("{}"),
    });
    assert.deepEqual(result, { reason: "upgradeSelfUnknown" });
});

test("resolveTarget reports upgradeSelfUnknown when inspect itself fails", async () => {
    const result = await resolveTarget(containerConfig(true), {
        sources: fakeSources,
        socketExists: () => true,
        inspect: () => Promise.reject(new Error("no such container")),
    });
    assert.deepEqual(result, { reason: "upgradeSelfUnknown" });
});

test("resolveTarget reports upgradeNotCompose when a compose label is missing", async () => {
    const result = await resolveTarget(containerConfig(true), {
        sources: fakeSources,
        socketExists: () => true,
        inspect: () =>
            Promise.resolve(
                JSON.stringify({
                    Image: "ghcr.io/heavycaffeiner/docknight:latest",
                    Labels: { "com.docker.compose.project": "docknight" },
                }),
            ),
    });
    assert.deepEqual(result, { reason: "upgradeNotCompose" });
});

test("resolveTarget reports upgradeNotCompose when a config path contains a newline", async () => {
    const result = await resolveTarget(containerConfig(true), {
        sources: fakeSources,
        socketExists: () => true,
        inspect: () =>
            Promise.resolve(
                JSON.stringify({
                    Image: "ghcr.io/heavycaffeiner/docknight:latest",
                    Labels: {
                        "com.docker.compose.project": "docknight",
                        "com.docker.compose.service": "docknight",
                        "com.docker.compose.project.working_dir": "/opt/docknight",
                        "com.docker.compose.project.config_files": "/opt/docknight/compose.yaml\n/etc/passwd",
                    },
                }),
            ),
    });
    assert.deepEqual(result, { reason: "upgradeNotCompose" });
});

test("resolveTarget reports upgradeNotCompose when a path is not absolute", async () => {
    const result = await resolveTarget(containerConfig(true), {
        sources: fakeSources,
        socketExists: () => true,
        inspect: () =>
            Promise.resolve(
                JSON.stringify({
                    Image: "ghcr.io/heavycaffeiner/docknight:latest",
                    Labels: {
                        "com.docker.compose.project": "docknight",
                        "com.docker.compose.service": "docknight",
                        "com.docker.compose.project.working_dir": "relative/path",
                        "com.docker.compose.project.config_files": "/opt/docknight/compose.yaml",
                    },
                }),
            ),
    });
    assert.deepEqual(result, { reason: "upgradeNotCompose" });
});

test("resolveTarget returns the full target for a well-formed compose container", async () => {
    const deps: ResolveTargetDeps = {
        sources: fakeSources,
        socketExists: () => true,
        inspect: () =>
            Promise.resolve(
                JSON.stringify({
                    Image: "ghcr.io/heavycaffeiner/docknight:latest",
                    Labels: {
                        "com.docker.compose.project": "docknight",
                        "com.docker.compose.service": "docknight",
                        "com.docker.compose.project.working_dir": "/opt/docknight",
                        "com.docker.compose.project.config_files": "/opt/docknight/compose.yaml",
                    },
                }),
            ),
    };
    const result = await resolveTarget(containerConfig(true), deps);
    assert.deepEqual(result, {
        image: "ghcr.io/heavycaffeiner/docknight:latest",
        project: "docknight",
        service: "docknight",
        workingDir: "/opt/docknight",
        configFiles: ["/opt/docknight/compose.yaml"],
    });
});

test("shellQuote round-trips a value containing spaces and a single quote through a real shell", async () => {
    const value = "/opt/my stack's dir";
    const quoted = shellQuote(value);
    // The shell's own quoting rules, not this function's idea of them: sh -c 'echo <quoted>'
    // is what startUpgrade's handoff command actually runs the string through.
    const { stdout } = await execFileAsync("sh", ["-c", `echo ${quoted}`]);
    assert.equal(stdout.trimEnd(), value);
});
