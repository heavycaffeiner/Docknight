import { type RefObject, useEffect, useRef } from "react";

/**
 * React does not route custom-element events through its synthetic system, so mdui events
 * (`change` on a navigation bar, `close` on a dialog) need a real listener. The handler is
 * held in a ref so a new closure each render does not resubscribe.
 */
export function useElementEvent<E extends Event = Event>(
    ref: RefObject<HTMLElement | null>,
    type: string,
    handler: (event: E) => void,
): void {
    const saved = useRef(handler);
    useEffect(() => {
        saved.current = handler;
    });

    useEffect(() => {
        const element = ref.current;
        if (element === null) return;
        const listener = (event: Event): void => saved.current(event as E);
        element.addEventListener(type, listener);
        return () => element.removeEventListener(type, listener);
    }, [ref, type]);
}

/**
 * mdui's element classes declare `autocorrect?: string` where lib.dom declares
 * `autocorrect: boolean` on `HTMLElement`, so an mdui class is not assignable to `HTMLElement`
 * and its ref cannot be handed to a JSX `ref` prop. Refs are therefore plain `HTMLElement`
 * refs, and a control's value is read back through a runtime check rather than an assertion.
 */
export function elementValue(ref: RefObject<HTMLElement | null>): string {
    const element = ref.current;
    if (element === null || !("value" in element)) return "";
    return typeof element.value === "string" ? element.value : "";
}

export function elementChecked(ref: RefObject<HTMLElement | null>): boolean {
    const element = ref.current;
    if (element === null || !("checked" in element)) return false;
    return element.checked === true;
}

/** Clears or sets a control's value; a no-op when the element is absent or has no value. */
export function setElementValue(ref: RefObject<HTMLElement | null>, value: string): void {
    const element = ref.current;
    if (element === null || !("value" in element)) return;
    element.value = value;
}
