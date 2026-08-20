import { ValidationError } from "./errors.ts";

/** A narrowing function for one field. Throws on mismatch; never returns a partial value. */
export type Validator<T> = (raw: unknown) => T;

/** Thrown by a bare field validator; `obj()` catches it and prepends the field name. */
class FieldError extends Error {}

export function str(opts?: { min?: number; max?: number; pattern?: RegExp }): Validator<string> {
    const min = opts?.min ?? 0;
    const max = opts?.max ?? 4096;
    return (raw: unknown) => {
        if (typeof raw !== "string") throw new FieldError("must be a string");
        if (raw.length < min) throw new FieldError(`must be at least ${min} characters`);
        if (raw.length > max) throw new FieldError(`must be at most ${max} characters`);
        if (opts?.pattern !== undefined && !opts.pattern.test(raw)) {
            throw new FieldError("has an unacceptable format");
        }
        return raw;
    };
}

export function num(opts?: { int?: boolean; min?: number; max?: number }): Validator<number> {
    return (raw: unknown) => {
        if (typeof raw !== "number" || !Number.isFinite(raw)) throw new FieldError("must be a number");
        if (opts?.int === true && !Number.isInteger(raw)) throw new FieldError("must be an integer");
        if (opts?.min !== undefined && raw < opts.min) {
            throw new FieldError(`must be at least ${opts.min}`);
        }
        if (opts?.max !== undefined && raw > opts.max) {
            throw new FieldError(`must be at most ${opts.max}`);
        }
        return raw;
    };
}

export function bool(): Validator<boolean> {
    return (raw: unknown) => {
        if (typeof raw !== "boolean") throw new FieldError("must be a boolean");
        return raw;
    };
}

/** `undefined` and `null` pass through as `undefined`; anything else runs the wrapped validator. */
export function optional<T>(validator: Validator<T>): Validator<T | undefined> {
    return (raw: unknown) => (raw === undefined || raw === null ? undefined : validator(raw));
}

/**
 * A plain-object check that applies each field's validator and rejects any key not present in
 * the shape. Every field validator's `FieldError` is caught here and rethrown as a
 * `ValidationError` naming the field, which is the router's `invalidParams` shape.
 */
export function obj<S extends Record<string, Validator<unknown>>>(
    shape: S,
): Validator<{ [K in keyof S]: S[K] extends Validator<infer T> ? T : never }> {
    const fields = Object.keys(shape);
    return (raw: unknown) => {
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
            throw new ValidationError("invalidParams", "params must be an object");
        }
        const source = raw as Record<string, unknown>;
        for (const key of Object.keys(source)) {
            if (!fields.includes(key)) {
                throw new ValidationError("invalidParams", `${key}: unknown field`);
            }
        }
        const out: Record<string, unknown> = {};
        for (const field of fields) {
            try {
                out[field] = (shape[field] as Validator<unknown>)(source[field]);
            } catch (error) {
                if (error instanceof FieldError) {
                    throw new ValidationError("invalidParams", `${field}: ${error.message}`);
                }
                throw error;
            }
        }
        return out as { [K in keyof S]: S[K] extends Validator<infer T> ? T : never };
    };
}

/** `raw` must be `undefined`, meaning the method takes no parameters. */
export function noParams(): Validator<undefined> {
    return (raw: unknown) => {
        if (raw !== undefined) {
            throw new ValidationError("invalidParams", "params: this method takes no parameters");
        }
        return undefined;
    };
}
