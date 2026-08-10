import { conflict } from "../../common/errors.ts";

const locks = new Map<string, Promise<unknown>>();

/**
 * One in-flight mutating command per stack, process-wide, so two browser tabs cannot run `up`
 * and `down` against the same stack at once.
 *
 * @throws RequestError("conflict", "operationInProgress") when another command is running.
 */
export async function withStackLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (locks.has(name)) {
        throw conflict(`another operation is running on ${name}`, {
            i18n: "operationInProgress",
            values: { name },
        });
    }
    const promise = fn();
    locks.set(name, promise);
    try {
        return await promise;
    } finally {
        locks.delete(name);
    }
}

export function isLocked(name: string): boolean {
    return locks.has(name);
}
