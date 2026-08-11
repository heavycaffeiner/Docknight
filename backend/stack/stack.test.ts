import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
    assertValidName,
    declaredServices,
    resolveStackPath,
    validateCompose,
    validateEnv,
    writeAtomic,
} from "./stack.ts";

const STACKS = resolve(`${sep}srv${sep}stacks`);

test("resolveStackPath keeps every result inside the stacks directory", () => {
    assert.equal(resolveStackPath(STACKS, "immich"), join(STACKS, "immich"));
});

test("resolveStackPath refuses traversal, absolute names and flag-like names", () => {
    for (const bad of ["..", "../etc", "/etc", "a/b", "-rf", ".hidden", "", "a".repeat(64)]) {
        assert.throws(() => resolveStackPath(STACKS, bad), /invalid|not acceptable|outside/i, bad);
    }
});

test("assertValidName carries the i18n key the UI words the message from", () => {
    try {
        assertValidName("Bad Name");
        assert.fail("expected a rejection");
    } catch (error) {
        assert.equal((error as { i18n?: string }).i18n, "invalidStackName");
    }
});

test("validateEnv names the offending line number", () => {
    assert.doesNotThrow(() => validateEnv("# comment\n\nKEY=value\nOTHER=\n", ".env"));
    try {
        validateEnv("KEY=value\nBROKEN\n", ".env");
        assert.fail("expected a rejection");
    } catch (error) {
        assert.equal((error as { values?: { line?: number } }).values?.line, 2);
    }
});

test("validateCompose accepts a mapping root and refuses the rest", () => {
    assert.doesNotThrow(() => validateCompose("services:\n  app:\n    image: nginx\n"));
    assert.doesNotThrow(() => validateCompose("services: {}\n"));
    assert.throws(() => validateCompose("- a\n- b\n"), /mapping/);
    assert.throws(() => validateCompose("services:\n  - app\n"), /services must be a mapping/);
    assert.throws(() => validateCompose("services:\n  app:\n   image: [unclosed\n"), /./);
});

test("writeAtomic leaves no temporary file behind and replaces the target", async () => {
    const dir = await mkdtemp(join(tmpdir(), "docknight-"));
    try {
        const target = join(dir, "compose.yaml");
        await writeAtomic(target, "first\n");
        assert.equal(await readFile(target, "utf8"), "first\n");
        await writeAtomic(target, "second\n");
        assert.equal(await readFile(target, "utf8"), "second\n");

        const { readdir } = await import("node:fs/promises");
        assert.deepEqual(await readdir(dir), ["compose.yaml"]);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("declaredServices separates what is built from what is pulled", () => {
    const services = declaredServices(
        [
            "services:",
            "  web:",
            "    image: nginx:1.27",
            "  api:",
            "    build: .",
            "  worker:",
            "    build:",
            "      context: ./worker",
            "      dockerfile: Dockerfile",
            "    image: local/worker:dev",
            "",
        ].join("\n"),
    );

    // Order is the file's, so a caller can act on services in the order they are declared.
    assert.deepEqual(
        services.map((service) => service.name),
        ["web", "api", "worker"],
    );
    // A build context wins over an image: the image is the tag the build writes, not one to fetch.
    assert.deepEqual(
        services.map((service) => service.builds),
        [false, true, true],
    );
});

test("declaredServices reports nothing for a buffer that does not parse", () => {
    assert.deepEqual(declaredServices("services: [oops\n  - broken"), []);
    assert.deepEqual(declaredServices(""), []);
});
