import { validation } from "../common/errors.ts";
import { asObject, str } from "../common/validate.ts";
import { log } from "./log.ts";
import { method } from "./ws/router.ts";

const MAX_COMMAND_BYTES = 8 * 1024;

/**
 * Convert a `docker run ...` command line into compose YAML. The command is parsed, never
 * executed. It runs on the server so the flag parser stays out of the initial bundle.
 */
export function registerComposerizeMethod(): void {
    method("docker.composerize", {
        requiresAuth: true,
        routable: false,
        parse: (raw: unknown) => ({
            command: str(asObject(raw), "command", { min: 1, max: MAX_COMMAND_BYTES }),
        }),
        handle: async (_conn, params) => {
            const { default: composerize } = (await import("composerize")) as {
                default: (command: string, existing?: string, version?: string) => string;
            };
            let yaml: string;
            try {
                yaml = composerize(params.command, "", "latest");
            } catch (error) {
                log.debug("composerize", "conversion failed", error);
                throw validation("that does not read as a docker run command", {
                    i18n: "composerizeFailed",
                });
            }
            // The first line is the generated `name:` key, which a stack file does not need.
            const lines = yaml.split("\n");
            const body = lines[0]?.startsWith("name:") ? lines.slice(1).join("\n") : yaml;
            return { yaml: body.replace(/^\n+/, "") };
        },
    });
}
