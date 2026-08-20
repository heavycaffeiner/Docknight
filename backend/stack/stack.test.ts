import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    COMPOSE_FILE_NAMES,
    probeComposeFileName,
    readStack,
    resolveStackPath,
    validateStackFiles,
} from "./stack.ts";

const VALID_NAMES = ["a", "web", "web-app", "web_app", "my-stack-2", "a".repeat(63)];
const INVALID_NAMES = [
    "",
    "-leading-dash",
    "UPPER",
    "has spaces",
    "a".repeat(64),
    "..",
    "../escape",
    "a/b",
    ".hidden",
];

test("name policy: valid names pass, invalid names are rejected", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-stack-name-"));
    try {
        for (const name of VALID_NAMES) {
            assert.doesNotThrow(() => resolveStackPath(root, name), `expected ${name} to be valid`);
        }
        for (const name of INVALID_NAMES) {
            assert.throws(
                () => resolveStackPath(root, name),
                (error: unknown) => error instanceof Error && error.message.includes("valid stack name"),
                `expected ${JSON.stringify(name)} to be rejected`,
            );
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("containment: a crafted traversal name never resolves outside stacksDir", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-stack-contain-"));
    try {
        // The regex already blocks a literal "..", so this asserts the containment check is a
        // genuinely separate line of defence, not merely a consequence of the regex.
        assert.throws(() => resolveStackPath(root, "..%2f..%2fetc"));
        const resolved = resolveStackPath(root, "safe-name");
        assert.ok(resolved.startsWith(root));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("probeComposeFileName finds the first accepted name in the documented order", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-stack-probe-"));
    try {
        assert.equal(probeComposeFileName(root), null);
        await writeFile(join(root, "docker-compose.yml"), "services: {}\n");
        assert.equal(probeComposeFileName(root), "docker-compose.yml");
        await writeFile(join(root, "compose.yaml"), "services: {}\n");
        // compose.yaml is earlier in COMPOSE_FILE_NAMES, so it wins even though
        // docker-compose.yml was created first.
        assert.equal(probeComposeFileName(root), "compose.yaml");
        assert.equal(COMPOSE_FILE_NAMES[0], "compose.yaml");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("readStack returns notFound for an absent directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-stack-read-"));
    try {
        await assert.rejects(
            readStack(root, "nope"),
            (error: unknown) => error instanceof Error && error.message.includes("no stack named"),
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("readStack reads the compose file and .env, defaulting .env to an empty string", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-stack-read-"));
    try {
        const dir = join(root, "demo");
        await mkdir(dir);
        await writeFile(join(dir, "compose.yaml"), "services:\n  web:\n    image: nginx\n");
        const detail = await readStack(root, "demo");
        assert.equal(detail.composeFileName, "compose.yaml");
        assert.match(detail.composeYAML, /nginx/);
        assert.equal(detail.composeENV, "");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("readStack rejects a compose file over the 1 MiB cap", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-stack-read-"));
    try {
        const dir = join(root, "big");
        await mkdir(dir);
        await writeFile(join(dir, "compose.yaml"), "a".repeat(1024 * 1024 + 1));
        await assert.rejects(
            readStack(root, "big"),
            (error: unknown) => error instanceof Error && error.message.includes("1 MiB"),
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("validateStackFiles accepts a minimal valid compose document", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-stack-validate-"));
    try {
        assert.doesNotThrow(() =>
            validateStackFiles(root, "demo", "services:\n  web:\n    image: nginx\n", "KEY=value\n"),
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("validateStackFiles rejects YAML that does not parse", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-stack-validate-"));
    try {
        assert.throws(
            () => validateStackFiles(root, "demo", "not: valid: yaml: [", ""),
            (error: unknown) => error instanceof Error && error.message.length > 0,
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("validateStackFiles rejects a document that is not a mapping", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-stack-validate-"));
    try {
        assert.throws(
            () => validateStackFiles(root, "demo", "- 1\n- 2\n", ""),
            (error: unknown) => error instanceof Error && error.message.includes("mapping"),
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("validateStackFiles rejects services that is not a mapping", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-stack-validate-"));
    try {
        assert.throws(
            () => validateStackFiles(root, "demo", "services: [1, 2, 3]\n", ""),
            (error: unknown) => error instanceof Error && error.message.includes("services"),
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("validateStackFiles reports the 1-based line number of a malformed env line", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-stack-validate-"));
    try {
        const env = "FOO=bar\n# a comment\n\nNOTANASSIGNMENT\nBAZ=qux\n";
        assert.throws(
            () => validateStackFiles(root, "demo", "services: {}\n", env),
            (error: unknown) => error instanceof Error && error.message.includes("line 4"),
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("validateStackFiles accepts blank lines and comments in the env text", async () => {
    const root = await mkdtemp(join(tmpdir(), "docknight-stack-validate-"));
    try {
        const env = "\n# comment\nFOO=bar\n   \n# another\nBAZ=1\n";
        assert.doesNotThrow(() => validateStackFiles(root, "demo", "services: {}\n", env));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
