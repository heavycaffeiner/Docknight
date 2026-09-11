import { t } from "./i18n.ts";

/**
 * mdui renders a text field's `<label>` with no `for` and its `<input>` with no `id`, leaves
 * the built-in password-toggle and clear buttons unnamed, and does not forward a host
 * `aria-label` onto the `<button>` inside an icon button. axe reports all three as critical,
 * and none can be fixed from a call site: the elements live in mdui's shadow roots, where a
 * host attribute does not reach them.
 *
 * This repairs them in one place, for every instance, as they appear. It is deliberately not
 * a per-component wrapper: the defect is mdui's, so the fix belongs at the boundary with
 * mdui rather than spread across every form in the app.
 */

const FIELD_HOSTS =
    "mdui-text-field, mdui-select, mdui-segmented-button-group, mdui-switch, mdui-checkbox, mdui-radio";
const BUTTON_HOSTS = "mdui-button-icon, mdui-fab, mdui-segmented-button";
const ALL_HOSTS = `${FIELD_HOSTS}, ${BUTTON_HOSTS}`;

function setName(element: Element | null | undefined, name: string): void {
    if (element == null || name === "") return;
    if (element.getAttribute("aria-label") !== name) element.setAttribute("aria-label", name);
}

/**
 * mdui identifies its internal field buttons only by the slot they wrap, so that is what the
 * role is read from: `show-password-icon`, `hide-password-icon`, `clear-icon`.
 */
function nameFieldButtons(root: ShadowRoot): void {
    for (const button of root.querySelectorAll("mdui-button-icon")) {
        const slot = button.querySelector("slot")?.getAttribute("name") ?? "";
        if (slot.includes("password")) setName(button, t("password.show"));
        else if (slot.includes("clear")) setName(button, t("action.clear"));
        else continue;
        // The nested button re-renders on its own, so it needs its own watcher rather than a
        // one-off write that the next lit render drops.
        watch(button);
    }
}

function repair(host: Element): void {
    const root = host.shadowRoot;
    if (root === null) return;

    if (host.matches(BUTTON_HOSTS)) {
        // A segmented button carries its label as slotted text, which does not name the
        // shadow `<button>`; every other icon button is named by the call site.
        const name = host.getAttribute("aria-label") ?? host.textContent?.trim() ?? "";
        setName(root.querySelector("button, a"), name);
        return;
    }

    const name = host.getAttribute("label") ?? host.getAttribute("aria-label") ?? "";
    for (const control of root.querySelectorAll("input, textarea, [part='input']")) {
        setName(control, name);
    }
    nameFieldButtons(root);

    // A group owns the insertion of its own children, so naming them from here covers the
    // case where a child arrives after the document-level observer has already run.
    for (const child of host.querySelectorAll(BUTTON_HOSTS)) watch(child);
}

const watched = new WeakSet<Element>();
const pending = new WeakSet<Element>();

function watch(host: Element): void {
    if (host.shadowRoot === null) {
        // A custom element that React just inserted has no shadow root until it upgrades and
        // renders once; retry after that rather than silently skipping the element.
        if (pending.has(host)) return;
        pending.add(host);
        void customElements.whenDefined(host.localName).then(() => {
            requestAnimationFrame(() => {
                pending.delete(host);
                watch(host);
            });
        });
        return;
    }

    repair(host);
    if (watched.has(host)) return;
    watched.add(host);
    // mdui re-renders its shadow tree on every property change, which drops the attributes
    // set above. The light DOM matters too: a segmented button is named by its own slotted
    // text, which React inserts after the element upgrades.
    const observer = new MutationObserver(() => repair(host));
    observer.observe(host.shadowRoot, { childList: true, subtree: true });
    observer.observe(host, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["label", "aria-label"],
    });
}

function sweep(root: ParentNode): void {
    for (const host of root.querySelectorAll(ALL_HOSTS)) watch(host);
}

export function mduiA11yInit(): void {
    sweep(document);
    new MutationObserver((records) => {
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (!(node instanceof Element)) continue;
                if (node.matches(ALL_HOSTS)) watch(node);
                sweep(node);
            }
        }
    }).observe(document.body, { childList: true, subtree: true });
}
