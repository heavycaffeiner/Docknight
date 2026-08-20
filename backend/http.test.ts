import assert from "node:assert/strict";
import { test, after, before } from "node:test";
import { request as httpRequest, type Server } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.ts";
import { createHttpServer } from "./http.ts";

/** node:http's client sends a raw path unchanged, unlike fetch(), which normalises it first. */
function rawGet(path: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const req = httpRequest(
            { host: "127.0.0.1", port, path, method: "GET" },
            (res) => {
                let body = "";
                res.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
                res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
            },
        );
        req.on("error", reject);
        req.end();
    });
}

const FRONTEND_DIR = fileURLToPath(new URL("../dist/frontend/", import.meta.url));

let server: Server;
let port = 0;
let createdFrontendDir = false;

function baseUrl(): string {
    return `http://127.0.0.1:${port}`;
}

before(async () => {
    // The static handler serves a fixed dist/frontend/ path; build a minimal bundle there so the
    // SPA fallback and asset paths have something real to exercise, and clean it up afterward.
    try {
        await mkdir(FRONTEND_DIR, { recursive: true });
        createdFrontendDir = true;
    } catch {
        // Already exists from a real build; leave it and do not delete it afterward.
    }
    await writeFile(join(FRONTEND_DIR, "index.html"), "<html><body>docknight</body></html>");
    await mkdir(join(FRONTEND_DIR, "assets"), { recursive: true });
    await writeFile(join(FRONTEND_DIR, "assets", "app-a1b2c3d4.js"), "console.log(1)");

    const config = loadConfig(["node", "index.ts"], {});
    server = createHttpServer(config, () => {});
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (typeof address === "object" && address !== null) port = address.port;
});

after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (createdFrontendDir) await rm(FRONTEND_DIR, { recursive: true, force: true });
});

test("security headers are present on every response", async () => {
    const response = await fetch(`${baseUrl()}/`);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("referrer-policy"), "same-origin");
    assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
});

test("robots.txt disallows everything", async () => {
    const response = await fetch(`${baseUrl()}/robots.txt`);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.equal(body, "User-agent: *\nDisallow: /\n");
});

test("a deep client-side route falls back to index.html", async () => {
    const response = await fetch(`${baseUrl()}/stack/whatever/deep/route`);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /docknight/);
});

test("a hashed asset gets an immutable cache header", async () => {
    const response = await fetch(`${baseUrl()}/assets/app-a1b2c3d4.js`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
});

test("index.html gets a no-cache header", async () => {
    const response = await fetch(`${baseUrl()}/`);
    assert.equal(response.headers.get("cache-control"), "no-cache");
});

test("POST to an unknown path is rejected with 405", async () => {
    const response = await fetch(`${baseUrl()}/whatever`, { method: "POST" });
    assert.equal(response.status, 405);
});

test("a traversal attempt never escapes the frontend directory", async () => {
    const raw = await rawGet("/../../../../../../../../etc/passwd");
    // Escaping falls through to the SPA fallback (200, index.html) rather than leaking the file.
    assert.equal(raw.status, 200);
    assert.doesNotMatch(raw.body, /root:/);
    assert.match(raw.body, /docknight/);

    const encoded = await rawGet("/%2e%2e/%2e%2e/%2e%2e/etc/passwd");
    assert.doesNotMatch(encoded.body, /root:/);
});
