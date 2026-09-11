import { type ReactElement, useRef, useState } from "react";
import { elementValue, setElementValue, useElementEvent } from "../lib/dom-events.ts";
import { useT } from "../lib/i18n.ts";

interface Props {
    items: string[] | undefined;
    onChange: (items: string[]) => void;
    label: string;
    placeholder?: string;
}

interface RowProps {
    value: string;
    index: number;
    ariaLabel: string;
    removeLabel: string;
    onEdit: (index: number, value: string) => void;
    onRemove: (index: number) => void;
}

function ArrayInputRow({ value, index, ariaLabel, removeLabel, onEdit, onRemove }: RowProps): ReactElement {
    const ref = useRef<HTMLElement>(null);
    useElementEvent(ref, "input", () => onEdit(index, elementValue(ref)));

    return (
        <div className="row">
            <mdui-text-field ref={ref} variant="outlined" value={value} aria-label={ariaLabel} />
            <mdui-button-icon icon="close" aria-label={removeLabel} onClick={() => onRemove(index)} />
        </div>
    );
}

/** A free-form list of strings (ports, volumes, dependencies): add one at a time, edit or remove any row. */
export default function ArrayInput({ items, onChange, label, placeholder = "" }: Props): ReactElement {
    const { t } = useT();
    const [newItem, setNewItem] = useState("");
    const newItemRef = useRef<HTMLElement>(null);

    function add(): void {
        const trimmed = newItem.trim();
        if (trimmed === "") return;
        onChange([...(items ?? []), trimmed]);
        setNewItem("");
        setElementValue(newItemRef, "");
    }

    function edit(index: number, value: string): void {
        const next = [...(items ?? [])];
        next[index] = value;
        onChange(next);
    }

    function remove(index: number): void {
        onChange((items ?? []).filter((_, i) => i !== index));
    }

    useElementEvent(newItemRef, "input", () => setNewItem(elementValue(newItemRef)));
    useElementEvent<KeyboardEvent>(newItemRef, "keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            add();
        }
    });

    return (
        <div className="form-column">
            <span className="type-label-medium text-muted">{label}</span>
            <div className="section">
                {(items ?? []).map((item, i) => (
                    <ArrayInputRow
                        key={i}
                        value={item}
                        index={i}
                        ariaLabel={`${label} ${i + 1}`}
                        removeLabel={t("service.action.remove")}
                        onEdit={edit}
                        onRemove={remove}
                    />
                ))}
                <mdui-text-field
                    ref={newItemRef}
                    variant="outlined"
                    placeholder={placeholder}
                    aria-label={label}
                />
            </div>
            <div className="form-actions">
                <mdui-button variant="text" onClick={add}>
                    {t("action.add")}
                </mdui-button>
            </div>
        </div>
    );
}
