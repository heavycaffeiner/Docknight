import { AppError } from "../../common/errors.ts";

const locks = new Map<string, Promise<unknown>>();

/**
 * Run `fn` while holding this stack's exclusive operation lock. One in-flight mutating command
 * per stack, process-wide.
 *
 * @throws AppError("conflict", ..., "operationInProgress") synchronously, before `fn` ever
 *         runs, when another command already holds this stack's lock. The error is thrown at
 *         once rather than queued behind the first command.
 */
export function withStackLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (locks.has(name)) {
        throw new AppError("conflict", `an operation is already running for ${name}`, "operationInProgress");
    }
    const promise = fn();
    locks.set(name, promise);
    return promise.finally(() => locks.delete(name));
}
