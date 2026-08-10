/** Injected by Vite's `define` from package.json, per proposal 6 section 4.3.10. */
declare const FRONTEND_VERSION: string;

declare module "*.json" {
    const value: Record<string, string>;
    export default value;
}
