import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { compression } from "vite-plugin-compression2";

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8")) as {
    version: string;
};

export default defineConfig({
    root: "frontend",
    plugins: [
        react(),
        // Brotli and gzip siblings for the static handler's precompression lookup.
        compression({ algorithms: ["brotliCompress"], exclude: [/\.(br|gz)$/] }),
        compression({ algorithms: ["gzip"], exclude: [/\.(br|gz)$/] }),
    ],
    define: {
        FRONTEND_VERSION: JSON.stringify(pkg.version),
    },
    build: {
        outDir: "../dist/frontend",
        emptyOutDir: true,
    },
    server: {
        port: 5000,
        proxy: {
            "/ws": { target: "ws://localhost:5001", ws: true },
        },
    },
});
