import { useSyncExternalStore } from "react";

/**
 * The smallest external store that `useSyncExternalStore` accepts. Module-scoped state lives
 * here rather than in React context so non-component code (the socket, the router guard) can
 * read and write it without a provider in scope.
 */
export interface Store<T> {
    get(): T;
    set(next: T): void;
    update(recipe: (current: T) => T): void;
    subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
    let value = initial;
    const listeners = new Set<() => void>();

    return {
        get: () => value,
        set(next: T) {
            if (Object.is(next, value)) return;
            value = next;
            for (const listener of listeners) listener();
        },
        update(recipe) {
            const next = recipe(value);
            if (Object.is(next, value)) return;
            value = next;
            for (const listener of listeners) listener();
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

export function useStore<T>(store: Store<T>): T {
    return useSyncExternalStore(store.subscribe, store.get, store.get);
}
