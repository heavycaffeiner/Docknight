import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/**
 * Svelte's accessibility warnings are the markup gate: role completeness, required ARIA properties,
 * accessible names, and keyboard reachability. In our own components they stop the build. A
 * dependency's markup is not ours to fix, so nothing from node_modules is reported at all.
 */
function warningFilter(warning) {
    // The compiler reports a path relative to the working directory, so this matches on a segment
    // rather than a prefix; vite passes an absolute one.
    const filename = (warning.filename ?? "").replaceAll("\\", "/");
    const own =
        !filename.includes("node_modules/") &&
        (filename.includes("frontend/src/") || filename.includes("tools/overlay/"));
    if (!own) return false;
    if (!warning.code.startsWith("a11y_")) return true;
    const line = warning.start?.line ?? 0;
    throw new Error(`${filename}:${line} ${warning.code}: ${warning.message}`);
}

export default {
    preprocess: vitePreprocess(),
    compilerOptions: {
        runes: true,
        warningFilter,
    },
};
