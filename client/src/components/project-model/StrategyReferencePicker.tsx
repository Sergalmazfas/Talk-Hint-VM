import React, { useMemo, useState } from "react";
import type { StrategyEntry } from "@shared/projectStrategy";

export type StrategyReferencePickerProps = {
  label: string;
  entries: StrategyEntry[];
  value: string[];
  onChange: (value: string[]) => void;
  single?: boolean;
  emptyLabel?: string;
};

export function StrategyReferencePicker({
  label, entries, value, onChange, single = false, emptyLabel = "Искать существующую запись",
}: StrategyReferencePickerProps) {
  const [query, setQuery] = useState("");
  const selected = useMemo(() => value.flatMap((key) => {
    const entry = entries.find((candidate) => candidate.key === key);
    return entry ? [entry] : [];
  }), [entries, value]);
  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return entries.filter((entry) => !normalized ||
      `${entry.title} ${entry.kind} ${entry.key}`.toLocaleLowerCase().includes(normalized))
      .slice(0, 40);
  }, [entries, query]);
  const toggle = (key: string) => {
    if (single) {
      onChange(value[0] === key ? [] : [key]);
      return;
    }
    onChange(value.includes(key) ? value.filter((item) => item !== key) : [...value, key]);
  };

  return <div className="pms-picker">
    <span className="pms-picker-label">{label}</span>
    <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={emptyLabel} aria-label={`Поиск: ${label}`} />
    {selected.length > 0 && <div className="pms-picker-selected" aria-label={`Выбрано: ${label}`}>
      {selected.map((entry) => <span className="pms-picker-chip" key={entry.key}>
        <span>{entry.title} <small>{entry.kind}</small></span>
        <button type="button" aria-label={`Убрать ${entry.title}`} onClick={() => toggle(entry.key)}>Убрать</button>
      </span>)}
    </div>}
    <div className="pms-picker-results" role="listbox" aria-label={label} aria-multiselectable={single ? undefined : "true"}>
      {results.map((entry) => {
        const active = value.includes(entry.key);
        return <button type="button" role="option" aria-selected={active} className={active ? "selected" : ""} key={entry.key} onClick={() => toggle(entry.key)}>
          <span>{entry.title}</span><small>{entry.kind}{entry.checkedAt ? ` · ${entry.checkedAt}` : ""}{entry.version !== null ? ` · v${entry.version}` : ""}</small>
        </button>;
      })}
      {!results.length && <span className="pms-picker-empty">Совпадений нет. Создайте или найдите запись в соответствующем разделе.</span>}
    </div>
  </div>;
}

