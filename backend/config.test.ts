import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { ConfigError, loadConfig } from "./config.ts";

function argv(...args: string[]): string[] {
    return ["node", "index.ts", ...args];
}

test("defaults are the container paths", () => {
    const config = loadConfig(argv(), {});
    assert.equal(config.port, 5001);
    assert.equal(config.dataDir, resolve("/app/data"));
    assert.equal(config.stacksDir, resolve("/opt/stacks"));
    assert.equal(config.logLevel, "info");
    assert.equal(config.enableConsole, false);
    assert.equal(config.hostname, undefined);
    assert.equal(config.sslKey, undefined);
    assert.equal(config.sslCert, undefined);
    assert.equal(config.puid, undefined);
    assert.equal(config.pgid, undefined);
    assert.equal(config.isContainer, false);
});

test("a CLI argument beats the environment, which beats the default", () => {
    assert.equal(loadConfig(argv("--port", "6000"), { DOCKNIGHT_PORT: "7000" }).port, 6000);
    assert.equal(loadConfig(argv(), { DOCKNIGHT_PORT: "7000" }).port, 7000);
    assert.equal(loadConfig(argv(), {}).port, 5001);

    assert.equal(
        loadConfig(argv("--hostname", "cli-host"), { DOCKNIGHT_HOSTNAME: "env-host" }).hostname,
        "cli-host",
    );
    assert.equal(loadConfig(argv(), { DOCKNIGHT_HOSTNAME: "env-host" }).hostname, "env-host");

    assert.equal(
        loadConfig(argv("--data-dir", "/cli/data"), { DOCKNIGHT_DATA_DIR: "/env/data" }).dataDir,
        resolve("/cli/data"),
    );
    assert.equal(
        loadConfig(argv(), { DOCKNIGHT_DATA_DIR: "/env/data" }).dataDir,
        resolve("/env/data"),
    );

    assert.equal(
        loadConfig(argv("--log-level", "debug"), { DOCKNIGHT_LOG_LEVEL: "warn" }).logLevel,
        "debug",
    );
    assert.equal(loadConfig(argv(), { DOCKNIGHT_LOG_LEVEL: "warn" }).logLevel, "warn");
});

test("an unknown CLI argument is fatal", () => {
    assert.throws(() => loadConfig(argv("--nope"), {}), ConfigError);
});

test("an unknown environment variable is ignored", () => {
    assert.doesNotThrow(() => loadConfig(argv(), { DOCKNIGHT_NOPE: "1" }));
});

test("an unusable port is rejected by name", () => {
    for (const bad of ["0", "65536", "abc", "80.5"]) {
        assert.throws(() => loadConfig(argv("--port", bad), {}), /^ConfigError: port:/, bad);
    }
    // parseArgs refuses a dash-leading value before the range check sees it; still fatal.
    assert.throws(() => loadConfig(argv("--port=-1"), {}), ConfigError);
});

test("TLS options come in pairs", () => {
    assert.throws(() => loadConfig(argv("--ssl-key", "/k"), {}), /sslKey and sslCert/);
    assert.throws(() => loadConfig(argv("--ssl-cert", "/c"), {}), /sslKey and sslCert/);
    const config = loadConfig(argv("--ssl-key", "/k", "--ssl-cert", "/c"), {});
    assert.equal(config.sslKey, "/k");
    assert.equal(config.sslCert, "/c");
});

test("the data and stacks directories may not overlap, in either direction", () => {
    assert.throws(
        () => loadConfig(argv("--data-dir", "/srv/x", "--stacks-dir", "/srv/x"), {}),
        /must not overlap/,
    );
    assert.throws(
        () => loadConfig(argv("--data-dir", "/srv/x", "--stacks-dir", "/srv/x/inner"), {}),
        /must not overlap/,
    );
    assert.throws(
        () => loadConfig(argv("--data-dir", "/srv/x/inner", "--stacks-dir", "/srv/x"), {}),
        /must not overlap/,
    );
    assert.doesNotThrow(() =>
        loadConfig(argv("--data-dir", "/srv/data", "--stacks-dir", "/srv/stacks"), {}),
    );
});

test("PUID and PGID must both be set and both be non-negative integers", () => {
    assert.throws(() => loadConfig(argv(), { PUID: "1000" }), /PUID and PGID/);
    assert.throws(() => loadConfig(argv(), { PGID: "1000" }), /PUID and PGID/);
    assert.throws(() => loadConfig(argv(), { PUID: "-1", PGID: "1000" }), /^ConfigError: PUID:/);
    assert.throws(() => loadConfig(argv(), { PUID: "x", PGID: "1000" }), /^ConfigError: PUID:/);
    const config = loadConfig(argv(), { PUID: "1000", PGID: "1000" });
    assert.equal(config.puid, 1000);
    assert.equal(config.pgid, 1000);
});

test("an unknown log level names the accepted set", () => {
    assert.throws(() => loadConfig(argv("--log-level", "verbose"), {}), /debug, info, warn, error/);
});

test("enableConsole reads a CLI or environment boolean", () => {
    assert.equal(loadConfig(argv(), {}).enableConsole, false);
    assert.equal(loadConfig(argv("--enable-console", "true"), {}).enableConsole, true);
    assert.equal(loadConfig(argv("--enable-console", "1"), {}).enableConsole, true);
    assert.equal(loadConfig(argv(), { DOCKNIGHT_ENABLE_CONSOLE: "true" }).enableConsole, true);
    assert.equal(loadConfig(argv(), { DOCKNIGHT_ENABLE_CONSOLE: "false" }).enableConsole, false);
});

test("the configuration is frozen, so no module can mutate it later", () => {
    const config = loadConfig(argv(), {});
    assert.ok(Object.isFrozen(config));
});

test("DOCKNIGHT_IS_CONTAINER is reported, not inferred", () => {
    assert.equal(loadConfig(argv(), {}).isContainer, false);
    assert.equal(loadConfig(argv(), { DOCKNIGHT_IS_CONTAINER: "1" }).isContainer, true);
    assert.equal(loadConfig(argv(), { DOCKNIGHT_IS_CONTAINER: "true" }).isContainer, false);
});

test("the version manifest URL has a default and can be overridden", () => {
    assert.match(loadConfig(argv(), {}).versionManifestUrl, /^https:\/\//);
    assert.equal(
        loadConfig(argv(), { DOCKNIGHT_VERSION_MANIFEST_URL: "https://example.test/v.json" })
            .versionManifestUrl,
        "https://example.test/v.json",
    );
});
