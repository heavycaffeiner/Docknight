import { createReadStream, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import {
    createServer as createServerHttp,
    type IncomingMessage,
    type Server,
    type ServerResponse,
} from "node:http";
import { createServer as createServerHttps } from "node:https";
import { extname, join, normalize, sep } from "node:path";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import type { Config } from "./config.ts";
import { log } from "./log.ts";

export type UpgradeHandler = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

const FRONTEND_DIR = fileURLToPath(new URL("../dist/frontend/", import.meta.url));
const INDEX_FILE = "index.html";

const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8",
};

/** Vite emits hashed names, which are safe to cache for a year. */
const HASHED = /-[A-Za-z0-9_]{8,}\.[a-z0-9]+$/;

function securityHeaders(response: ServerResponse): void {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader("X-Frame-Options", "SAMEORIGIN");
}

function contentType(path: string): string {
    return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/** Resolve a request path inside the bundle directory, refusing anything that escapes it. */
function resolveAsset(urlPath: string): string | null {
    let decoded: string;
    try {
        decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
    } catch {
        return null;
    }
    if (decoded.includes("\0")) return null;
    const relative = normalize(decoded).replace(/^([/\\])+/, "");
    const full = join(FRONTEND_DIR, relative);
    const withSep = FRONTEND_DIR.endsWith(sep) ? FRONTEND_DIR : FRONTEND_DIR + sep;
    if (!full.startsWith(withSep)) return null;
    return full;
}

interface Variant {
    path: string;
    encoding: string | null;
}

/** Prefer a pre-compressed neighbour when the client accepts it. */
async function pickVariant(path: string, accept: string): Promise<Variant | null> {
    const candidates: Variant[] = [];
    if (/\bbr\b/.test(accept)) candidates.push({ path: `${path}.br`, encoding: "br" });
    if (/\bgzip\b/.test(accept)) candidates.push({ path: `${path}.gz`, encoding: "gzip" });
    candidates.push({ path, encoding: null });

    for (const candidate of candidates) {
        try {
            const info = await stat(candidate.path);
            if (info.isFile()) return candidate;
        } catch {
            // Try the next variant.
        }
    }
    return null;
}

async function serveFile(
    response: ServerResponse,
    assetPath: string,
    accept: string,
    immutable: boolean,
    bodyless: boolean,
): Promise<boolean> {
    const variant = await pickVariant(assetPath, accept);
    if (variant === null) return false;

    response.statusCode = 200;
    response.setHeader("Content-Type", contentType(assetPath));
    response.setHeader("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
    if (variant.encoding !== null) {
        response.setHeader("Content-Encoding", variant.encoding);
        response.setHeader("Vary", "Accept-Encoding");
    }
    if (bodyless) {
        response.end();
        return true;
    }
    await new Promise<void>((resolve) => {
        const stream = createReadStream(variant.path);
        stream.on("error", (error: Error) => {
            log.warn("http", `cannot stream ${variant.path}`, error);
            if (!response.headersSent) response.statusCode = 500;
            response.end();
            resolve();
        });
        stream.on("end", () => resolve());
        stream.pipe(response);
    });
    return true;
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    securityHeaders(response);
    const url = request.url ?? "/";
    const path = url.split("?")[0] ?? "/";
    const accept = String(request.headers["accept-encoding"] ?? "");

    if (path === "/robots.txt") {
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.end("User-agent: *\nDisallow: /\n");
        return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
        response.statusCode = 405;
        response.setHeader("Allow", "GET, HEAD");
        response.end();
        return;
    }

    const bodyless = request.method === "HEAD";
    const assetPath = resolveAsset(path);
    if (assetPath !== null && path !== "/") {
        if (await serveFile(response, assetPath, accept, HASHED.test(assetPath), bodyless)) return;
    }

    // Any other GET returns index.html, so client-side routes deep-link correctly.
    const indexPath = join(FRONTEND_DIR, INDEX_FILE);
    if (await serveFile(response, indexPath, accept, false, bodyless)) return;

    response.statusCode = 500;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end("The frontend bundle is missing. Run `pnpm build:frontend` before starting the server.");
}

/** Build the HTTP(S) server. `upgradeHook` claims WebSocket upgrades; wired in phase 2. */
export function createHttpServer(config: Readonly<Config>, upgradeHook: UpgradeHandler): Server {
    const listener = (request: IncomingMessage, response: ServerResponse): void => {
        void handle(request, response).catch((error: unknown) => {
            log.error("http", "request handler failed", error);
            if (!response.headersSent) response.statusCode = 500;
            response.end();
        });
    };

    let server: Server;
    if (config.sslKey !== undefined && config.sslCert !== undefined) {
        server = createServerHttps(
            {
                key: readFileSync(config.sslKey),
                cert: readFileSync(config.sslCert),
                ...(config.sslKeyPassphrase === undefined ? {} : { passphrase: config.sslKeyPassphrase }),
            },
            listener,
        ) as unknown as Server;
    } else {
        server = createServerHttp(listener);
    }

    server.on("upgrade", upgradeHook);
    return server;
}
