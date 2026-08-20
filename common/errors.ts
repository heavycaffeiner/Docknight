import type { ErrorCode, ProtocolError } from "./protocol.ts";

/**
 * Thrown by handlers; the router serialises it onto the wire. Also thrown by the client when a
 * request fails locally, so both sides carry one shape.
 */
export class AppError extends Error {
    readonly code: ErrorCode;
    readonly i18n?: string;
    readonly values?: Record<string, string | number>;

    constructor(
        code: ErrorCode,
        message: string,
        i18n?: string,
        values?: Record<string, string | number>,
    ) {
        super(message);
        this.name = "AppError";
        this.code = code;
        if (i18n !== undefined) this.i18n = i18n;
        if (values !== undefined) this.values = values;
    }

    /** The wire form. Never carries a stack trace or a filesystem path. */
    toProtocolError(): ProtocolError {
        const error: ProtocolError = { code: this.code, message: this.message };
        if (this.i18n !== undefined) error.i18n = this.i18n;
        if (this.values !== undefined) error.values = this.values;
        return error;
    }
}

/**
 * Parameter and content validation failure. `code` is restricted to the two validation-shaped
 * codes: `invalidParams` for a method's `parse()` step, at the wire boundary, and `validation`
 * for content a handler rejects after parsing, such as malformed YAML.
 */
export class ValidationError extends AppError {
    constructor(
        code: "validation" | "invalidParams",
        message: string,
        i18n?: string,
        values?: Record<string, string | number>,
    ) {
        super(code, message, i18n, values);
        this.name = "ValidationError";
    }
}

export function isAbortError(error: unknown): boolean {
    return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}
