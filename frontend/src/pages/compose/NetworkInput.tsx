import { type ReactElement, useRef, useState } from "react";
import { elementValue, setElementValue, useElementEvent } from "../../lib/dom-events.ts";
import { useT } from "../../lib/i18n.ts";

interface Props {
    networks: string[] | undefined;
    onChange: (networks: string[]) => void;
    available: string[];
}

function NetworkChip({ name, onRemove }: { name: string; onRemove: (name: string) => void }): ReactElement {
    const ref = useRef<HTMLElement>(null);
    useElementEvent(ref, "delete", () => onRemove(name));
    return (
        <mdui-chip ref={ref} deletable>
            {name}
        </mdui-chip>
    );
}

/** Attaches a service to zero or more Docker networks: a chip per attachment, plus a picker for known networks and a field for a custom one. */
export default function NetworkInput({ networks, onChange, available }: Props): ReactElement {
    const { t } = useT();
    const [customName, setCustomName] = useState("");
    const selectRef = useRef<HTMLElement>(null);
    const inputRef = useRef<HTMLElement>(null);

    const current = networks ?? [];
    const selectable = available.filter((net) => !current.includes(net));

    function addNetwork(name: string): void {
        const trimmed = name.trim();
        if (trimmed === "") return;
        if (!current.includes(trimmed)) {
            onChange([...current, trimmed]);
        }
        setCustomName("");
        setElementValue(inputRef, "");
    }

    function removeNetwork(name: string): void {
        onChange(current.filter((n) => n !== name));
    }

    useElementEvent(selectRef, "change", () => {
        const val = elementValue(selectRef);
        if (val !== "") {
            addNetwork(val);
            setElementValue(selectRef, "");
        }
    });

    useElementEvent(inputRef, "input", () => setCustomName(elementValue(inputRef)));
    useElementEvent<KeyboardEvent>(inputRef, "keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            addNetwork(customName);
        }
    });

    return (
        <div className="form-column">
            <span className="type-label-medium text-muted">{t("stack.service.networks")}</span>

            {current.length > 0 ? (
                <div className="row">
                    {current.map((net) => (
                        <NetworkChip key={net} name={net} onRemove={removeNetwork} />
                    ))}
                </div>
            ) : null}

            <div className="section">
                {selectable.length > 0 ? (
                    <mdui-select ref={selectRef} variant="outlined" placeholder={t("network.select")}>
                        {selectable.map((net) => (
                            <mdui-menu-item key={net} value={net}>
                                {net}
                            </mdui-menu-item>
                        ))}
                    </mdui-select>
                ) : null}
                <mdui-text-field
                    ref={inputRef}
                    variant="outlined"
                    placeholder={t("network.add")}
                    aria-label={t("network.add")}
                />
            </div>

            <div className="form-actions">
                <mdui-button variant="text" onClick={() => addNetwork(customName)}>
                    {t("action.add")}
                </mdui-button>
            </div>
        </div>
    );
}
