import { readFileSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompress, gzip } from "node:zlib";
import { promisify } from "node:util";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, type Plugin } from "vite";
import svelteConfig from "./svelte.config.js";

const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
) as { version: string };

const BACKEND_PORT = process.env.DOCKNIGHT_PORT ?? "5001";

const COMPRESSIBLE = new Set([".js", ".css", ".html", ".svg", ".json", ".map"]);
const MIN_COMPRESS_BYTES = 1024;

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

/** Emit .br and .gz neighbours for text assets, which the backend static handler prefers. */
function precompress(): Plugin {
    return {
        name: "docknight-precompress",
        apply: "build",
        async closeBundle() {
            const outDir = fileURLToPath(new URL("./dist/frontend", import.meta.url));
            const walk = async (dir: string): Promise<string[]> => {
                const entries = await readdir(dir, { withFileTypes: true });
                const files: string[] = [];
                for (const entry of entries) {
                    const full = join(dir, entry.name);
                    if (entry.isDirectory()) files.push(...(await walk(full)));
                    else files.push(full);
                }
                return files;
            };

            for (const file of await walk(outDir)) {
                if (!COMPRESSIBLE.has(extname(file))) continue;
                const body = await readFile(file);
                if (body.byteLength < MIN_COMPRESS_BYTES) continue;
                await Promise.all([
                    brotli(body).then((out) => writeFile(`${file}.br`, out)),
                    gz(body, { level: 9 }).then((out) => writeFile(`${file}.gz`, out)),
                ]);
            }
        },
    };
}

export default defineConfig({
    root: "frontend",
    // The Svelte config lives at the repository root while Vite's root is frontend/, so it is
    // passed inline and the file search is turned off.
    plugins: [svelte({ ...svelteConfig, configFile: false }), precompress()],
    define: {
        FRONTEND_VERSION: JSON.stringify(manifest.version),
    },
    resolve: {
        alias: {
            $common: fileURLToPath(new URL("./common", import.meta.url)),
        },
    },
    server: {
        port: 5000,
        strictPort: true,
        proxy: {
            "/ws": {
                target: `ws://127.0.0.1:${BACKEND_PORT}`,
                ws: true,
            },
        },
    },
    build: {
        outDir: "../dist/frontend",
        emptyOutDir: true,
        target: "es2023",
        sourcemap: true,
        reportCompressedSize: false,
    },
});
