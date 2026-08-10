declare module "composerize" {
    /**
     * Convert a `docker run ...` command line into compose YAML. The package ships no type
     * definitions, so this declares the one call the server makes.
     */
    export default function composerize(
        command: string,
        existingCompose?: string,
        composeVersion?: string,
    ): string;
}
