import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  analystBoundaries, analystCompetitors, analystFindingFields,
  analystProcedure, analystSourceAvailability, analystSourceKinds, analystPreparationStatus,
  analystDestinations, analystMilestones,
  type AnalystPreparationInput, type AnalystSource,
} from "@shared/competitiveAnalyst";
import { defaultAnalystPreparation } from "@shared/competitiveAnalystTemplate";
import { analystToolCandidates } from "@shared/competitiveAnalystTools";
import { dossierSections } from "@shared/competitorDossier";
import type { ModelCommand, ProjectModelState } from "@shared/projectModel";

type Props = {
  state: ProjectModelState;
  submit?: (command: ModelCommand) => Promise<boolean>;
  saving?: boolean;
};

const passportFields: { key: keyof AnalystPreparationInput["passport"]; label: string }[] = [
  { key: "purpose", label: "Назначение" }, { key: "duties", label: "Обязанности" },
  { key: "inputs", label: "Входы" }, { key: "outputs", label: "Результаты" },
  { key: "frequency", label: "Частота" }, { key: "quality", label: "Критерии качества" },
  { key: "handoff", label: "Передача Сергею" },
];
const limitFields: { key: keyof AnalystPreparationInput["limits"]; label: string; unit: string }[] = [
  { key: "maxMinutes", label: "Время", unit: "мин" }, { key: "maxEstimatedUsd", label: "Оценка затрат", unit: "USD" },
  { key: "maxSources", label: "Источники", unit: "шт." }, { key: "maxSearches", label: "Поиски", unit: "шт." },
  { key: "maxAttempts", label: "Повторы", unit: "шт." }, { key: "maxOutputTokens", label: "Выходные токены", unit: "токенов" },
  { key: "maxVideoSeconds", label: "Видео", unit: "сек." },
];
const dateLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });
};
const externalUrl = (value: string | null) => {
  if (!value) return "";
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : ""; }
  catch { return ""; }
};
const stableSnapshot = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableSnapshot).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSnapshot(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
};
const sourceProvenance = (source: AnalystSource) => {
  if (source.note.includes("Предложен при подготовке") || source.note.includes("Новый источник предложен")) return "Предложенный канал; не просмотрен и не согласован.";
  if (source.id.endsWith(":youtube:unknown") || source.id.endsWith(":instagram:unknown")) return "Кандидат канала без установленного аккаунта; URL намеренно не придуман.";
  if (source.availability === "public" && source.checkedAt) return "URL перенесён из существующей карточки; публичный доступ отдельно проверен при подготовке. Факты карточки не обновлялись.";
  if (source.note.includes("Импорт ссылки")) return "Импорт из существующей карточки; новая проверка доступа не выполнялась.";
  if (source.url === null) return "Аккаунт не установлен; URL намеренно отсутствует.";
  return "Доступность не подтверждена.";
};

export default function CompetitiveAnalystPreparation({ state, submit, saving = false }: Props) {
  const competitors = useMemo(() => analystCompetitors(state), [state]);
  const saved = state.analystPreparation?.revisions.at(-1);
  const [draft, setDraft] = useState<AnalystPreparationInput>(() =>
    structuredClone(saved?.data ?? defaultAnalystPreparation(state)));
  const [baseVersion, setBaseVersion] = useState(saved?.version ?? 0);
  const [successfulSaveSignal, setSuccessfulSaveSignal] = useState(0);
  const submittedSnapshot = useRef<string | null>(null);
  const [basisVersions] = useState(() => saved?.basisVersions ?? competitors.flatMap(({ record }) => {
    const version = record?.revisions.at(-1)?.version;
    return record && version ? [{ competitorId: record.id, version }] : [];
  }));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newSource, setNewSource] = useState({ competitorId: "", url: "", kind: "other" as AnalystSource["kind"] });
  useEffect(() => {
    if (!successfulSaveSignal || !saved || !submittedSnapshot.current) return;
    if (stableSnapshot(saved.data) === submittedSnapshot.current) {
      setBaseVersion(saved.version);
      submittedSnapshot.current = null;
    }
  }, [saved, successfulSaveSignal]);
  const basisDiffs = basisVersions.flatMap((basis) => {
    const competitor = competitors.find((item) => item.record?.id === basis.competitorId);
    const current = competitor?.record?.revisions.at(-1)?.version;
    if (!competitor?.record) return [{ name: competitor?.name ?? basis.competitorId, old: basis.version, current: "карточка отсутствует" }];
    return current !== undefined && current !== basis.version
      ? [{ name: competitor.name, old: basis.version, current: `v${current}` }] : [];
  });
  const patchPassport = (key: keyof AnalystPreparationInput["passport"], value: string) =>
    setDraft((current) => ({ ...current, passport: { ...current.passport, [key]: value } }));
  const patchSource = (id: string, updates: Partial<AnalystSource>) =>
    setDraft((current) => ({ ...current, sources: current.sources.map((source) => source.id === id ? { ...source, ...updates } : source) }));
  const removeSource = (id: string) => setDraft((current) => ({
    ...current,
    sources: current.sources.filter((source) => source.id !== id),
    pilot: { ...current.pilot, sourceIds: current.pilot.sourceIds.filter((sourceId) => sourceId !== id) },
  }));
  const addSource = () => {
    if (!newSource.competitorId) return;
    const index = draft.sources.filter((source) => source.competitorId === newSource.competitorId).length;
    const source: AnalystSource = {
      id: `${newSource.competitorId}:proposal:${Date.now()}:${index}`, competitorId: newSource.competitorId,
      url: newSource.url.trim() || null, kind: newSource.kind, ownership: "unverified",
      ownershipEvidence: "Предложен в подготовке; принадлежность отдельно не проверена.",
      approval: "pending", recommendation: "hold", checkedAt: null, availability: "unchecked",
      note: "Новый источник предложен; доступ и принадлежность не проверены.",
    };
    setDraft((current) => ({ ...current, sources: [...current.sources, source] }));
    setNewSource((current) => ({ ...current, url: "" }));
  };
  const togglePilotSource = (sourceId: string, checked: boolean) =>
    setDraft((current) => {
      if (checked && current.pilot.sourceIds.length >= current.limits.maxSources) return current;
      return { ...current, pilot: { ...current.pilot, sourceIds: checked
        ? Array.from(new Set([...current.pilot.sourceIds, sourceId]))
        : current.pilot.sourceIds.filter((id) => id !== sourceId) } };
    });
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!submit) { setError("Сохранение недоступно: команда модели не подключена."); return; }
    setError(""); setNotice("");
    const submitted = structuredClone(draft);
    const ok = await submit({
      type: "saveAnalystPreparation", baseVersion,
      preparation: submitted,
    } as ModelCommand);
    if (ok) {
      submittedSnapshot.current = stableSnapshot(submitted);
      setSuccessfulSaveSignal((signal) => signal + 1);
      setNotice("Сохранение принято. Версия основания изменится только после подтверждения совпадающего снимка в сохранённых данных.");
    }
    else setError("Не удалось сохранить. Возможно, основание изменилось или возник конфликт. Черновик и baseVersion оставлены закреплёнными; новая ревизия не перезаписывается.");
  };

  return <section className="ca-preparation" id="competitive-analyst" aria-labelledby="ca-title">
    <header className="ca-hero">
      <div><p className="pm-kicker">STAGE A / DEV · NEW-COUNTRY</p>
        <h2 id="ca-title">Подготовка AI-аналитика конкурентов</h2>
        <p>Рабочий паспорт и проект пилота для Сергея. Это подготовка к решению, а не запуск и не разрешение на сбор данных.</p></div>
      <div className="ca-status"><span className="ca-status-mark" aria-hidden="true" />{analystPreparationStatus}<small>Согласование не выполнено</small></div>
    </header>
    {error && <p className="ca-alert" role="alert">{error}</p>}
    {notice && <p className="ca-notice" role="status">{notice}</p>}
    {basisDiffs.length > 0 && <aside className="ca-alert" role="status"><strong>Версии основания разошлись.</strong>
      {basisDiffs.map((diff) => <span key={diff.name}>{diff.name}: зафиксировано v{diff.old}, сейчас {diff.current}. Сверьте карточку перед сохранением.</span>)}
    </aside>}
    {!submit && <p className="ca-alert">Режим чтения: сохранение модели недоступно в этой точке интерфейса.</p>}
    {saved && <div className="ca-revision"><span>Последняя сохранённая ревизия <b>v{saved.version}</b></span><span>{dateLabel(saved.at)} · {saved.actor}</span><span>Ожидает согласования</span></div>}

    <form onSubmit={(event) => void save(event)}>
      <section className="ca-panel ca-passport">
        <div className="ca-section-heading"><div><span className="ca-index">01</span><div><p className="pm-kicker">ROLE PASSPORT</p><h3>Паспорт роли</h3></div></div><span className="ca-tag">Редактируемый черновик</span></div>
        <p className="ca-intro">Формулировки сохраняются только в подготовке. Все семь полей доступны для правки.</p>
        <div className="ca-passport-grid">{passportFields.map((field) => <label className="ca-field" key={field.key}>
          <span>{field.label}</span><textarea value={draft.passport[field.key]} onChange={(event) => patchPassport(field.key, event.target.value)} rows={field.key === "purpose" ? 3 : 4} />
        </label>)}</div>
      </section>

      <section className="ca-panel">
        <div className="ca-section-heading"><div><span className="ca-index">02</span><div><p className="pm-kicker">RESEARCH SCOPE</p><h3>Конкуренты и источники</h3></div></div><span className="ca-tag">Только пять согласованных</span></div>
        <p className="ca-intro">Ссылки сгруппированы по существующим карточкам. Статусы, рекомендации и лимиты остаются предложенными; источники не считаются одобренными.</p>
        <div className="ca-source-groups">{competitors.map((competitor) => {
          const sources = draft.sources.filter((source) => source.competitorId === competitor.record?.id);
          return <article className="ca-competitor" key={competitor.appId}>
            <header><div><span className="ca-app-id">App Store ID {competitor.appId}</span><h4>{competitor.name}</h4></div>
              {competitor.record ? <a href={`/admin/project-model?hypothesis=new-country&view=benchmark&competitor=${encodeURIComponent(competitor.record.id)}`}>Открыть карточку <span className="ca-app-id">{competitor.record.id}</span></a> : <span className="ca-missing">Карточка отсутствует</span>}</header>
            {competitor.ambiguous && <p className="ca-alert">Найдено несколько карточек с этим App Store ID; связь неоднозначна и не выбрана.</p>}
            {competitor.record && !sources.length && <p className="ca-muted">Источники в черновике не перечислены.</p>}
            {sources.map((source) => <div className="ca-source" key={source.id}>
              <div className="ca-source-title"><b>{analystSourceKinds[source.kind]}</b><code>{source.id}</code>
                {source.url && externalUrl(source.url) ? <a href={externalUrl(source.url)} target="_blank" rel="noreferrer">{source.url}</a> : <span className="ca-muted">{source.kind === "youtube" || source.kind === "instagram" ? "Официальный аккаунт не установлен · URL отсутствует" : "URL не указан"}</span>}
                <small className="ca-source-provenance">{sourceProvenance(source)}</small>
              </div>
              <div className="ca-source-controls">
                <label>URL<input type="url" value={source.url ?? ""} placeholder="https://" onChange={(event) => patchSource(source.id, { url: event.target.value || null })} /></label>
                <label>Тип<select value={source.kind} onChange={(event) => patchSource(source.id, { kind: event.target.value as AnalystSource["kind"] })}>{Object.entries(analystSourceKinds).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
                <label>Рекомендация<select value={source.recommendation} onChange={(event) => patchSource(source.id, { recommendation: event.target.value as AnalystSource["recommendation"] })}><option value="include">Включить · предложение</option><option value="hold">Отложить · предложение</option><option value="exclude">Исключить · предложение</option></select></label>
                <label>Доступ<select value={source.availability} onChange={(event) => patchSource(source.id, { availability: event.target.value as AnalystSource["availability"] })}>{Object.entries(analystSourceAvailability).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
                <label>Принадлежность<select value={source.ownership} onChange={(event) => patchSource(source.id, { ownership: event.target.value as AnalystSource["ownership"] })}><option value="documented">Связь документирована</option><option value="unverified">Не проверена</option></select></label>
                <label>Принадлежность<input value={source.ownershipEvidence} onChange={(event) => patchSource(source.id, { ownershipEvidence: event.target.value })} /></label>
                <label>Заметка<input value={source.note} onChange={(event) => patchSource(source.id, { note: event.target.value })} /></label>
                <label>Проверено<input type="date" value={source.checkedAt ?? ""} onChange={(event) => patchSource(source.id, { checkedAt: event.target.value || null })} /></label>
                <div className="ca-source-approval">Согласование: <b>Ожидает</b> · нельзя одобрить здесь</div>
                <button type="button" className="pm-btn small ca-remove-source" onClick={() => removeSource(source.id)}>Убрать из черновика</button>
              </div>
            </div>)}
            {competitor.record && <div className="ca-propose-source">
              <label>Новый источник<select value={newSource.competitorId === competitor.record.id ? newSource.kind : "other"} onChange={(event) => setNewSource({ ...newSource, competitorId: competitor.record!.id, kind: event.target.value as AnalystSource["kind"] })}>{Object.entries(analystSourceKinds).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
              <label>URL (необязательно)<input value={newSource.competitorId === competitor.record.id ? newSource.url : ""} onFocus={() => setNewSource((current) => ({ ...current, competitorId: competitor.record!.id }))} onChange={(event) => setNewSource({ ...newSource, competitorId: competitor.record!.id, url: event.target.value })} placeholder="https://" /></label>
              <button type="button" className="pm-btn small" onClick={() => {
                if (newSource.competitorId !== competitor.record!.id) {
                  const kind = newSource.kind;
                  const source: AnalystSource = {
                    id: `${competitor.record!.id}:proposal:${Date.now()}:${draft.sources.length}`,
                    competitorId: competitor.record!.id, url: null, kind, ownership: "unverified",
                    ownershipEvidence: "Предложен в подготовке; принадлежность отдельно не проверена.",
                    approval: "pending", recommendation: "hold", checkedAt: null, availability: "unchecked",
                    note: "Новый источник предложен; доступ и принадлежность не проверены.",
                  };
                  setDraft((current) => ({ ...current, sources: [...current.sources, source] }));
                  setNewSource((current) => ({ ...current, competitorId: competitor.record!.id, url: "" }));
                } else addSource();
              }}>Добавить предложенный источник</button>
            </div>}
          </article>;
        })}</div>
        <div className="ca-limits"><div><p className="pm-kicker">PROPOSED LIMITS</p><h4>Предлагаемые лимиты пилота</h4><p>Не активны до отдельного согласования.</p></div>
          <div className="ca-limits-grid">{limitFields.map((field) => <label key={field.key}>{field.label}<span><input type="number" min="0" step={field.key === "maxEstimatedUsd" ? "0.01" : "1"} value={draft.limits[field.key]} onChange={(event) => setDraft((current) => ({ ...current, limits: { ...current.limits, [field.key]: Number(event.target.value) } }))} />{field.unit}</span></label>)}</div>
        </div>
      </section>

      <section className="ca-panel">
        <div className="ca-section-heading"><div><span className="ca-index">03</span><div><p className="pm-kicker">PILOT PROPOSAL</p><h3>Гипотеза и ручной пилот</h3></div></div></div>
        <p className="ca-intro">Предложен один ручной пилот по VocaLingo. Выбор конкурента и источников — редактируемый проект, а не утверждённый запуск.</p>
        <div className="ca-pilot-grid">
          <label>Конкурент<select value={draft.pilot.competitorId ?? ""} onChange={(event) => setDraft((current) => ({ ...current, pilot: { ...current.pilot, competitorId: event.target.value || null, sourceIds: [] } }))}><option value="">Не выбран</option>{competitors.filter((item) => item.record).map((item) => <option key={item.record!.id} value={item.record!.id}>{item.name}</option>)}</select></label>
          <label>Вопросы пилота<textarea rows={4} value={draft.pilot.questions} onChange={(event) => setDraft((current) => ({ ...current, pilot: { ...current.pilot, questions: event.target.value } }))} /></label>
          <label>Обоснование<textarea rows={4} value={draft.pilot.rationale} onChange={(event) => setDraft((current) => ({ ...current, pilot: { ...current.pilot, rationale: event.target.value } }))} /></label>
        </div>
        <fieldset className="ca-pilot-sources"><legend>Источники в проекте пилота</legend>
          <p className="ca-muted">Выбрано: {draft.pilot.sourceIds.length} / {draft.limits.maxSources} предложенных источников.</p>
          {draft.pilot.competitorId ? draft.sources.filter((source) => source.competitorId === draft.pilot.competitorId).map((source) => <label key={source.id}><input type="checkbox" checked={draft.pilot.sourceIds.includes(source.id)} disabled={!draft.pilot.sourceIds.includes(source.id) && draft.pilot.sourceIds.length >= draft.limits.maxSources} onChange={(event) => togglePilotSource(source.id, event.target.checked)} />{analystSourceKinds[source.kind]} · {source.url ?? "URL не установлен"} · {source.recommendation}</label>) : <p>Выберите конкурента, чтобы указать кандидаты. Карточка не создаётся при отсутствии данных.</p>}
        </fieldset>
        <label className="ca-field">Оставшиеся согласования и ограничения<textarea rows={3} value={draft.approvalNotes} onChange={(event) => setDraft((current) => ({ ...current, approvalNotes: event.target.value }))} /></label>
      </section>

      <section className="ca-panel ca-procedure">
        <div className="ca-section-heading"><div><span className="ca-index">04</span><div><p className="pm-kicker">OPERATING PROCEDURE</p><h3>Процедура и формат находки</h3></div></div></div>
        <ol>{analystProcedure.map((item, index) => <li key={item}><span>{String(index + 1).padStart(2, "0")}</span>{item}</li>)}</ol>
        <div className="ca-two-col"><div><h4>Шесть существующих разделов карточки</h4><ol className="ca-section-list">{dossierSections.map((section) => <li key={section}>{section}</li>)}</ol></div>
          <div><h4>Обязательные поля находки</h4><ul>{analystFindingFields.map((field) => <li key={field}>{field}</li>)}</ul></div></div>
        <div className="ca-taxonomy"><div><b>Этапы подтверждения</b><p>{Object.values(analystMilestones).join(" · ")}</p></div><div><b>Направления возможного значения</b><p>{Object.values(analystDestinations).join(" · ")}</p></div></div>
      </section>

      <section className="ca-panel">
        <div className="ca-section-heading"><div><span className="ca-index">05</span><div><p className="pm-kicker">TOOL REVIEW / {draft.toolResearchVersion}</p><h3>Кандидаты инструментов</h3></div></div></div>
        <p className="ca-intro">Обзор публичной документации, а не проверка подключений, тарифного аккаунта или живых возможностей.</p>
        <div className="ca-tool-list">{analystToolCandidates.map((tool) => <article className="ca-tool" key={tool.operation}>
          <header><div><span>{tool.operation}</span><h4>{tool.tool}</h4></div><b>Сверено: {tool.checkedAt}</b></header>
          <p>{tool.purpose}</p><dl><div><dt>Покрытие</dt><dd>{tool.coverage}</dd></div><div><dt>Ставки / затраты</dt><dd>{tool.pricing}</dd></div><div><dt>Доступ</dt><dd>{tool.access}</dd></div><div><dt>При сбое</dt><dd>{tool.onFailure}</dd></div></dl>
          {tool.sources.length > 0 && <div className="ca-tool-links"><b>Официальные материалы</b>{tool.sources.map((url) => <a key={url} href={externalUrl(url) || undefined} target={externalUrl(url) ? "_blank" : undefined} rel={externalUrl(url) ? "noreferrer" : undefined}>{url}</a>)}</div>}
        </article>)}</div>
      </section>

      <section className="ca-panel ca-guardrails">
        <div className="ca-section-heading"><div><span className="ca-index">06</span><div><p className="pm-kicker">IMMUTABLE BOUNDARIES</p><h3>Запреты и оставшиеся решения</h3></div></div><span className="ca-tag">Только чтение</span></div>
        <ul>{analystBoundaries.map((boundary) => <li key={boundary}>{boundary}</li>)}</ul>
        <div className="ca-runtime-note"><h4>Что должно произойти до любого запуска</h4>
          <p>CrewAI runtime только предложен и не установлен/не запущен. Существующие тесты — фикстуры и тестовые адаптеры, не реальный CrewAI. Reader, поиск, модель, доступы и бюджет не подключены.</p>
          <p>Нужны отдельные решения Сергея по паспорту, каждому источнику, доступам, тарифам и расходам; затем реализация безопасного runtime и узких адаптеров. Эта форма ничего из этого не включает.</p>
        </div>
      </section>
      <div className="ca-savebar"><span>Сохранение создаёт только ревизию подготовки.</span><button className="pm-btn primary" type="submit" disabled={!submit || saving}>{saving ? "Сохраняем…" : "Сохранить подготовку"}</button></div>
    </form>

    {state.analystPreparation?.revisions && state.analystPreparation.revisions.length > 1 && <section className="ca-panel ca-history">
      <div className="ca-section-heading"><div><span className="ca-index">H</span><div><p className="pm-kicker">IMMUTABLE SNAPSHOTS</p><h3>История подготовок</h3></div></div></div>
      {[...state.analystPreparation.revisions].slice(0, -1).reverse().map((revision) => <details key={revision.version}>
        <summary>v{revision.version} · {dateLabel(revision.at)} · {revision.actor} · Ожидает согласования</summary>
        <div className="ca-history-snapshot"><h4>Паспорт</h4>{passportFields.map((field) => <p key={field.key}><b>{field.label}:</b> {revision.data.passport[field.key]}</p>)}
          <h4>Источники ({revision.data.sources.length})</h4>{revision.data.sources.map((source) => <p key={source.id}><b>{source.competitorId} · {analystSourceKinds[source.kind]}</b> · {source.url ?? "URL не установлен"} · {source.recommendation} · {source.approval}</p>)}
          <h4>Пилот и ограничения</h4><p>{revision.data.pilot.questions}</p><p>{revision.data.approvalNotes}</p><pre>{JSON.stringify(revision.data.limits, null, 2)}</pre>
          <h4>Полный снимок ревизии</h4><pre>{JSON.stringify(revision.data, null, 2)}</pre>
        </div>
      </details>)}
    </section>}
  </section>;
}
