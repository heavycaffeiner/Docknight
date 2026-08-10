import { ValidationError } from "./errors.ts";

/**
 * Narrowing helpers for untrusted request parameters. Every one throws ValidationError naming
 * the offending field, which the router maps to `invalidParams`, so a handler never sees
 * unchecked input.
 */

export function asObject(raw: unknown, field = "params"): Record<string, unknown> {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new ValidationError(field, `${field} must be an object`);
    }
    return raw as Record<string, unknown>;
}

export function noParams(raw: unknown): undefined {
    if (raw !== undefined && raw !== null) {
        const object = asObject(raw);
        if (Object.keys(object).length > 0) {
            throw new ValidationError("params", "this method takes no parameters");
        }
    }
    return undefined;
}

export function str(
    object: Record<string, unknown>,
    field: string,
    opts?: { min?: number; max?: number; pattern?: RegExp },
): string {
    const value = object[field];
    if (typeof value !== "string") throw new ValidationError(field, `${field} must be a string`);
    const min = opts?.min ?? 0;
    const max = opts?.max ?? 8192;
    if (value.length < min) {
        throw new ValidationError(field, `${field} must be at least ${min} characters`);
    }
    if (value.length > max) {
        throw new ValidationError(field, `${field} must be at most ${max} characters`);
    }
    if (opts?.pattern && !opts.pattern.test(value)) {
        throw new ValidationError(field, `${field} has an unacceptable format`);
    }
    return value;
}

export function optionalStr(
    object: Record<string, unknown>,
    field: string,
    opts?: { min?: number; max?: number; pattern?: RegExp },
): string | undefined {
    if (object[field] === undefined || object[field] === null) return undefined;
    return str(object, field, opts);
}

export function int(
    object: Record<string, unknown>,
    field: string,
    opts?: { min?: number; max?: number },
): number {
    const value = object[field];
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
        throw new ValidationError(field, `${field} must be an integer`);
    }
    if (opts?.min !== undefined && value < opts.min) {
        throw new ValidationError(field, `${field} must be at least ${opts.min}`);
    }
    if (opts?.max !== undefined && value > opts.max) {
        throw new ValidationError(field, `${field} must be at most ${opts.max}`);
    }
    return value;
}

export function bool(object: Record<string, unknown>, field: string): boolean {
    const value = object[field];
    if (typeof value !== "boolean") throw new ValidationError(field, `${field} must be a boolean`);
    return value;
}

export function optionalBool(
    object: Record<string, unknown>,
    field: string,
): boolean | undefined {
    if (object[field] === undefined || object[field] === null) return undefined;
    return bool(object, field);
}
