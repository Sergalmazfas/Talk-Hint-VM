import { useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronDown, Search, UserRound } from "lucide-react";
import { labRequest } from "@/lib/secretary-lab";
import "./personality-picker.css";

export type PersonalityMode = "personal" | "work";
export type PersonalityChoice = { id: string; version: number; mode: PersonalityMode | null };
type CatalogPersonality = {
  id: string;
  name: string;
  description: string;
  status: string;
  version?: number;
  currentVersion?: number;
};
type PersonalityVersion = {
  version: number;
  rules?: unknown;
  examples?: unknown;
  modeGuidance?: unknown;
  [key: string]: unknown;
};
type PersonalityDetails = {
  personality: CatalogPersonality;
  versions: PersonalityVersion[];
};
type CatalogResponse = { items: CatalogPersonality[]; nextCursor: string | null };
type SelectedIdentity = { id: string; name: string; description: string; version: number };
type KeyedDetails = { key: string; data: PersonalityDetails };

const describe = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value, null, 2);

export default function PersonalityPicker({
  token, value, onChange, disabled, label = "Личность для теста",
}: {
  token: string;
  value: PersonalityChoice | null;
  onChange: (value: PersonalityChoice | null) => void;
  disabled: boolean;
  label?: string;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CatalogPersonality[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [details, setDetails] = useState<KeyedDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [detailsErrorKey, setDetailsErrorKey] = useState("");
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const [detailsRefresh, setDetailsRefresh] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [selectedIdentity, setSelectedIdentity] = useState<SelectedIdentity | null>(null);
  const catalogGenerationRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const generation = ++catalogGenerationRef.current;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      void labRequest<CatalogResponse>(`/api/secretary-personalities?q=${encodeURIComponent(query)}&limit=25`, token)
        .then((result) => {
          if (cancelled || generation !== catalogGenerationRef.current) return;
          setItems(result.items || []);
          setCursor(result.nextCursor || null);
          setHasMore(!!result.nextCursor);
        })
        .catch((cause: unknown) => { if (!cancelled && generation === catalogGenerationRef.current) setError(cause instanceof Error ? cause.message : "Не удалось загрузить каталог."); })
        .finally(() => { if (!cancelled && generation === catalogGenerationRef.current) setLoading(false); });
    }, query ? 250 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [catalogRefresh, query, token]);

  useEffect(() => {
    const selectedId = value?.id;
    const key = selectedId ? `${selectedId}:${value.version}` : "";
    if (!key) { setDetails(null); setDetailsError(""); setDetailsErrorKey(""); return; }
    let cancelled = false;
    setDetailsLoading(true);
    setDetailsError("");
    setDetailsErrorKey(key);
    void labRequest<PersonalityDetails>(`/api/secretary-personalities/${encodeURIComponent(selectedId!)}`, token)
      .then((result) => { if (!cancelled) setDetails({ key, data: result }); })
      .catch((cause: unknown) => { if (!cancelled) { setDetailsError(cause instanceof Error ? cause.message : "Не удалось загрузить описание."); setDetailsErrorKey(key); } })
      .finally(() => { if (!cancelled) setDetailsLoading(false); });
    return () => { cancelled = true; };
  }, [detailsRefresh, token, value?.id, value?.version]);

  const loadMore = async () => {
    if (!cursor || loading) return;
    const generation = catalogGenerationRef.current;
    const requestQuery = query;
    const requestToken = token;
    const requestCursor = cursor;
    setLoading(true);
    setError("");
    try {
      const result = await labRequest<CatalogResponse>(`/api/secretary-personalities?q=${encodeURIComponent(requestQuery)}&limit=25&cursor=${encodeURIComponent(requestCursor)}`, requestToken);
      if (generation !== catalogGenerationRef.current) return;
      setItems((old) => [...old, ...(result.items || [])]);
      setCursor(result.nextCursor || null);
      setHasMore(!!result.nextCursor);
    } catch (cause) {
      if (generation === catalogGenerationRef.current) setError(cause instanceof Error ? cause.message : "Не удалось загрузить следующую страницу.");
    } finally {
      if (generation === catalogGenerationRef.current) setLoading(false);
    }
  };

  const selectedKey = value?.id ? `${value.id}:${value.version}` : "";
  const matchingDetails = details?.key === selectedKey ? details.data : null;
  const matchingDetailsError = detailsErrorKey === selectedKey ? detailsError : "";
  const selectedItem = items.find((item) => item.id === value?.id);
  const matchingIdentity = selectedIdentity && selectedIdentity.id === value?.id && selectedIdentity.version === value?.version ? selectedIdentity : null;
  const selectedName = matchingIdentity?.name || matchingDetails?.personality.name || selectedItem?.name || "Личность из каталога";
  const currentVersion = Number(matchingDetails?.personality.currentVersion ?? matchingDetails?.personality.version ?? selectedItem?.currentVersion ?? selectedItem?.version ?? matchingIdentity?.version ?? value?.version ?? 0);
  const selectedVersion = matchingDetails?.versions?.find((item) => item.version === value?.version);

  return <section className="personality-picker" aria-label={label}>
    <div className="personality-picker-heading">
      <div><span>PERSONA · TEST CONTEXT</span><strong>{label}</strong></div>
      <span className="personality-test-tag">Только тестовый контекст</span>
    </div>
    <label className={`personality-none ${!value ? "chosen" : ""}`}>
      <input type="radio" name="secretary-personality" checked={!value} disabled={disabled} onChange={() => onChange(null)} />
      <span><b>Без личности</b><small>Legacy-поведение · не закреплять persona за прогоном</small></span>
      <i>{!value ? "ВЫБРАНО" : "LEGACY"}</i>
    </label>
    <div className="personality-catalog">
      <label className="personality-select-label" htmlFor="personality-catalog-select">Доступные актуальные личности</label>
      <div className="personality-select-wrap">
        <UserRound size={15} aria-hidden="true" />
        <select id="personality-catalog-select" value={value?.id || ""} disabled={disabled || loading} onChange={(event) => {
          const item = items.find((candidate) => candidate.id === event.target.value);
          if (!item) { setSelectedIdentity(null); onChange(null); return; }
          const version = Number(item.currentVersion ?? item.version ?? 0);
          setSelectedIdentity({ id: item.id, name: item.name, description: item.description, version });
          onChange({ id: item.id, version, mode: null });
          setExpanded(true);
        }}>
          <option value="">Выбрать из каталога…</option>
          {value && !items.some((item) => item.id === value.id) && <option value={value.id}>{selectedName} · v{value.version}</option>}
          {items.map((item) => <option key={item.id} value={item.id}>{item.name} · v{item.currentVersion ?? item.version ?? "?"}</option>)}
        </select>
        <ChevronDown size={14} aria-hidden="true" />
      </div>
      <label className="personality-search"><Search size={14} /><input value={query} onChange={(event) => {
        catalogGenerationRef.current++;
        setLoading(true);
        setItems([]);
        setCursor(null);
        setHasMore(false);
        setQuery(event.target.value);
      }} disabled={disabled} placeholder="Поиск по названию" aria-label="Поиск личностей" /></label>
      {loading && <p className="personality-loading">Обновляем каталог…</p>}
      {error && <p className="personality-error" role="alert"><AlertCircle size={14} />{error}<button type="button" className="personality-more" onClick={() => setCatalogRefresh((old) => old + 1)}>Повторить</button></p>}
      {!loading && !error && items.length === 0 && <p className="personality-loading">Доступных личностей по этому запросу нет.</p>}
      {hasMore && <button type="button" className="personality-more" disabled={disabled || loading} onClick={() => void loadMore()}>{loading ? "Загружаем…" : "Показать ещё"}</button>}
    </div>
    {value && <div className="personality-selected">
      <div className="personality-selected-head">
        <div><small>ВЫБРАНО · АКТУАЛЬНЫЙ СНИМОК</small><b>{selectedName} · v{value.version}</b></div>
        <button type="button" className="personality-inspect" onClick={() => setExpanded((old) => !old)} aria-expanded={expanded}>{expanded ? "Скрыть детали" : "Описание и детали"}</button>
      </div>
      {(matchingDetails?.personality.description || selectedItem?.description || matchingIdentity?.description) && <p className="personality-description">{matchingDetails?.personality.description || selectedItem?.description || matchingIdentity?.description}</p>}
      {expanded && <div className="personality-details">
        {detailsLoading && <p>Загружаем полное описание…</p>}
        {matchingDetailsError && <p className="personality-error" role="alert"><AlertCircle size={14} />{matchingDetailsError}<button type="button" className="personality-more" onClick={() => setDetailsRefresh((old) => old + 1)}>Повторить</button></p>}
        {matchingDetails && <>
          <p className="personality-description">{matchingDetails.personality.description || "Описание не задано."}</p>
          {selectedVersion ? <div className="personality-detail-grid">
            {(["rules", "examples", "modeGuidance"] as const).map((field) => <div key={field}><small>{field === "modeGuidance" ? "Рекомендации по режиму" : field === "rules" ? "Правила" : "Примеры"}</small><pre>{selectedVersion[field] === undefined ? "Не указано" : describe(selectedVersion[field])}</pre></div>)}
          </div> : <p>Выбранная версия пока не найдена в деталях. Она будет проверена сервером при запуске.</p>}
          <small className="personality-current-version">В каталоге сейчас: v{currentVersion || "не сообщена"} · статус {matchingDetails.personality.status}</small>
        </>}
      </div>}
      <fieldset className="personality-role">
        <legend>Роль для этого TEST-контекста <b>· выберите явно</b></legend>
        {(["personal", "work"] as const).map((mode) => <label key={mode} className={value.mode === mode ? "selected" : ""}>
          <input type="radio" name="personality-role-mode" checked={value.mode === mode} disabled={disabled} onChange={() => onChange({ ...value, mode })} />
          <span><b>{mode === "personal" ? "Личная" : "Рабочая"}</b><small>{mode === "personal" ? "TEST role · personal" : "TEST role · work"}</small></span>
        </label>)}
        {value.mode === null && <small className="personality-role-required">Выберите тестовую роль, чтобы включить запуск.</small>}
      </fieldset>
    </div>}
    <p className="personality-picker-foot">Выбор действует только для следующего тестового разговора. Он не связан с реальным номером и не меняет назначение Secretary.</p>
  </section>;
}
