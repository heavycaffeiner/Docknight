import type { ErrorCode, ProtocolError } from "./protocol.ts";

/**
 * An error that maps directly onto a protocol error response. Thrown by handlers and by the
 * client when a request fails locally, so both sides carry one shape.
 */
export class RequestError extends Error implements ProtocolError {
    readonly code: ErrorCode;
    readonly i18n?: string;
    readonly values?: Record<string, string | number>;

    constructor(
        code: ErrorCode,
        message: string,
        options?: { i18n?: string; values?: Record<string, string | number>; cause?: unknown },
    ) {
        super(message, options?.cause === undefined ? undefined : { cause: options.cause });
        this.name = "RequestError";
        this.code = code;
        if (options?.i18n !== undefined) this.i18n = options.i18n;
        if (options?.values !== undefined) this.values = options.values;
    }

    /** The wire form. Never carries a stack trace or a filesystem path. */
    toProtocolError(): ProtocolError {
        const error: ProtocolError = { code: this.code, message: this.message };
        if (this.i18n !== undefined) error.i18n = this.i18n;
        if (this.values !== undefined) error.values = this.values;
        return error;
    }
}

/** Parameter validation failure. The router maps it to `invalidParams`. */
export class ValidationError extends Error {
    readonly field: string;

    constructor(field: string, message: string) {
        super(message);
        this.name = "ValidationError";
        this.field = field;
    }
}

type Options = { i18n?: string; values?: Record<string, string | number>; cause?: unknown };

export function unauthorized(message: string, options?: Options): RequestError {
    return new RequestError("unauthorized", message, options);
}

export function notFound(message: string, options?: Options): RequestError {
    return new RequestError("notFound", message, options);
}

export function conflict(message: string, options?: Options): RequestError {
    return new RequestError("conflict", message, options);
}

export function validation(message: string, options?: Options): RequestError {
    return new RequestError("validation", message, options);
}

export function commandFailed(message: string, options?: Options): RequestError {
    return new RequestError("commandFailed", message, options);
}

export function rateLimited(message: string, options?: Options): RequestError {
    return new RequestError("rateLimited", message, options);
}

export function agentUnreachable(message: string, options?: Options): RequestError {
    return new RequestError("agentUnreachable", message, options);
}

export function agentTimeout(message: string, options?: Options): RequestError {
    return new RequestError("agentTimeout", message, options);
}

export function internal(message: string, options?: Options): RequestError {
    return new RequestError("internal", message, options);
}

export function isAbortError(error: unknown): boolean {
    return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}
