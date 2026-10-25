import React, { useRef, useState } from "react";
import {
  competitorScenarios,
  competitorPrice,
  competitorSnapshotDiff,
  emptyCompetitorSnapshot,
  type CompetitorDirectory as CompetitorDirectoryData,
  type CompetitorPlan,
  type CompetitorScenario,
  type CompetitorSnapshot,
} from "@shared/projectCompetitors";
import type { ModelCommand } from "@shared/projectModel";
import { emptyCompetitorResearch, researchFor } from "@shared/competitorResearch";
import { CompetitorResearchEditor, CompetitorResearchProfile } from "@/components/project-model/CompetitorResearchProfile";
import CompetitorResearchWorkbench from "@/components/project-model/CompetitorResearchWorkbench";

type Props = {
  directory?: CompetitorDirectoryData;
  hypothesisId: string;
  selectedId?: string;
  view: "overview" | "benchmark";
  saving?: boolean;
  submit?: (command: ModelCommand) => Promise<boolean>;
};
type Draft = { id?: string; baseVersion: number; reason: string; snapshot: CompetitorSnapshot };
type PlanKey = keyof CompetitorPlan;
type ScenarioKey = keyof typeof competitorScenarios;

const periodLabels: Record<CompetitorPlan["period"], string> = {
  week: "Неделя", month: "Месяц", year: "Год", one_time: "Разовая оплата", unknown: "Не подтверждён",
};
const kindLabels: Record<CompetitorPlan["kind"], string> = {
  subscription: "Подписка", credit_pack: "Пакет кредитов",
};
const evidenceFieldLabels: Record<string, string> = {
  name: "Название", developer: "Разработчик", audience: "Аудитория", website: "Сайт", appStore: "Магазин приложений",
  checkedAt: "Дата проверки", verification: "Тип проверки", "offer.features": "Функции",
  "offer.languages": "Языки", "offer.regions": "Регионы", "offer.numbers": "Номера",
  "offer.channels": "Каналы", plans: "Тарифы", scenarios: "Сценарии", sources: "Источники",
  limitations: "Ограничения", reason: "Причина обновления",
};
const nestedFieldLabels: Record<string, Record<string, string>> = {
  plans: {
    id: "ID тарифа", name: "Название тарифа", kind: "Тип тарифа", currency: "Валюта", region: "Регион",
    period: "Период оплаты", price: "Цена", includedNumbers: "Включено номеров",
    includedMinutes: "Включено минут", includedCredits: "Включено кредитов",
    includedSms: "Включено SMS", overages: "Сверх лимита", limitations: "Ограничения", sourceUrl: "Источник тарифа",
  },
  scenarios: { scenario: "Сценарий", status: "Статус доказательства", note: "Основание", sourceUrls: "Источники" },
  sources: { url: "URL источника", checkedAt: "Дата проверки источника", note: "Заметка источника" },
};
const scenarioEntries = Object.entries(competitorScenarios) as [ScenarioKey, string][];

function latestRevision(directory: CompetitorDirectoryData | undefined, id: string) {
  const record = directory?.records.find((item) => item.id === id);
  return record?.revisions[record.revisions.length - 1];
}

function cloneSnapshot(snapshot: CompetitorSnapshot): CompetitorSnapshot {
  return {
    ...snapshot,
    offer: { ...snapshot.offer },
    research: snapshot.research ? structuredClone(snapshot.research) : undefined,
    plans: snapshot.plans.map((plan) => ({ ...plan })),
    scenarios: scenarioEntries.map(([scenario]) => {
      const current = snapshot.scenarios.find((item) => item.scenario === scenario);
      return current ? { ...current, sourceUrls: [...current.sourceUrls] } : {
        scenario, status: "unknown", note: "Не подтверждено", sourceUrls: [],
      };
    }),
    sources: snapshot.sources.map((source) => ({ ...source })),
  };
}

function sourceHref(raw: string): string {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function routeFor(view: Props["view"], hypothesisId: string, competitorId?: string): string {
  const params = new URLSearchParams();
  params.set("view", view);
  params.set("hypothesis", hypothesisId);
  if (competitorId) params.set("competitor", competitorId);
  return `/admin/project-model?${params.toString()}`;
}

function showValue(value: string | null | undefined): string {
  return value?.trim() || "Не указано";
}

function dateLabel(value: string): string {
  if (!value) return "Дата не указана";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("ru-RU", { dateStyle: "medium" });
}

function dateInputValue(value: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value.slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function diffLabel(path: string): string {
  const parts = path.split(".");
  if (parts.length >= 3 && nestedFieldLabels[parts[0]]) {
    const collectionIndex = Number(parts[1]);
    const itemLabel = parts[0] === "plans" ? "Тариф" : parts[0] === "sources" ? "Источник" : "Сценарий";
    const field = nestedFieldLabels[parts[0]][parts[2]] || parts[2];
    return `${itemLabel} ${Number.isFinite(collectionIndex) ? collectionIndex + 1 : ""} · ${field}`;
  }
  return evidenceFieldLabels[path] || path;
}

function latestSnapshot(directory: CompetitorDirectoryData | undefined, id: string): CompetitorSnapshot | undefined {
  return latestRevision(directory, id)?.snapshot;
}

function LinkValue({ value }: { value: string }) {
  const href = sourceHref(value);
  return href ? <a href={href} target="_blank" rel="noreferrer">{value}</a> : <span>{showValue(value)}</span>;
}

function OfferSection({ snapshot }: { snapshot: CompetitorSnapshot }) {
  return <section className="pm-cd-section">
    <div className="pm-cd-section-head"><span>01 / OFFER</span><h3>Предложение</h3></div>
    <dl className="pm-cd-facts">
      <div><dt>Разработчик</dt><dd>{showValue(snapshot.developer)}</dd></div>
      <div><dt>Целевая аудитория</dt><dd>{showValue(snapshot.audience)}</dd></div>
      <div><dt>Функции</dt><dd>{showValue(snapshot.offer.features)}</dd></div>
      <div><dt>Каналы</dt><dd>{showValue(snapshot.offer.channels)}</dd></div>
      <div><dt>Ограничения</dt><dd>{showValue(snapshot.limitations)}</dd></div>
    </dl>
    <div className="pm-cd-links"><span>Официальный сайт <LinkValue value={snapshot.website} /></span><span>Магазин приложений <LinkValue value={snapshot.appStore} /></span></div>
  </section>;
}

function TariffsSection({ snapshot }: { snapshot: CompetitorSnapshot }) {
  return <section className="pm-cd-section">
    <div className="pm-cd-section-head"><span>02 / PLANS</span><h3>Тарифы и ограничения</h3></div>
    {snapshot.plans.length ? <div className="pm-cd-plan-list">{snapshot.plans.map((plan, index) => <article className="pm-cd-plan" key={plan.id || `${plan.name}-${index}`}>
      <div className="pm-cd-plan-heading"><div><span className="pm-cd-plan-kind">{kindLabels[plan.kind]}</span><h4>{showValue(plan.name)}</h4></div><strong>{competitorPrice(plan)}</strong></div>
      <dl className="pm-cd-facts">
        <div><dt>Валюта</dt><dd>{showValue(plan.currency)}</dd></div>
        <div><dt>Регион</dt><dd>{showValue(plan.region)}</dd></div>
        <div><dt>Период оплаты</dt><dd>{periodLabels[plan.period]}</dd></div>
        <div><dt>Включено номеров</dt><dd>{showValue(plan.includedNumbers)}</dd></div>
        <div><dt>Включено минут</dt><dd>{showValue(plan.includedMinutes)}</dd></div>
        <div><dt>Включено кредитов</dt><dd>{showValue(plan.includedCredits)}</dd></div>
        <div><dt>Включено SMS</dt><dd>{showValue(plan.includedSms)}</dd></div>
        <div><dt>Сверх лимита</dt><dd>{showValue(plan.overages)}</dd></div>
        <div className="pm-cd-wide"><dt>Ограничения</dt><dd>{showValue(plan.limitations)}</dd></div>
        <div className="pm-cd-wide"><dt>Источник тарифа</dt><dd><LinkValue value={plan.sourceUrl} /></dd></div>
      </dl>
    </article>)}</div> : <div className="pm-cd-empty">Тарифы не сохранены. Неизвестная цена не считается нулевой.</div>}
  </section>;
}

function LegacyScenarioCell({ evidence }: { evidence?: Pick<CompetitorScenario, "status" | "note" | "sourceUrls"> }) {
  const status = evidence?.status ?? "unknown";
  const statusLabels = {
    official_claim: "Заявлено официально",
    code_present: "Есть в коде; не проверено этим сравнением",
    live_verified: "Проверено живым сценарием",
    planned: "Целевая концепция / план",
    not_supported: "Не поддерживается по источнику",
    unknown: "Не подтверждено",
  } as const;
  return <div className="pm-cr-legacy-cell">
    <span className={`pm-cr-status status-${status}`}>{statusLabels[status]}</span>
    <p>{evidence?.note || "Не подтверждено"}</p>
    {evidence?.sourceUrls.map((source, index) => <LinkValue value={source} key={`${source}-${index}`} />)}
  </div>;
}

function LegacyScenarioReadOnly({ snapshot, directory }: { snapshot: CompetitorSnapshot; directory: CompetitorDirectoryData }) {
  return <section className="pm-cr-legacy-compat pm-cd-section">
    <div className="pm-cd-section-head"><span>READ-ONLY COMPATIBILITY</span><h3>Функциональное сравнение</h3></div>
    <p>Совместимое представление прежних шести сценариев для старых сохранённых данных. Поля только для чтения; редактирование ведётся в едином редакторе девяти функций выше.</p>
    <div className="pm-cr-legacy-table-wrap"><table className="pm-cr-legacy-table">
      <thead><tr><th scope="col">Совместимый сценарий</th><th scope="col">TalkHint · текущая позиция</th><th scope="col">TalkHint · цель</th><th scope="col">{snapshot.name}</th></tr></thead>
      <tbody>{scenarioEntries.map(([scenario, label]) => {
        const baseline = directory.talkhint.scenarios.find((item) => item.scenario === scenario);
        const current = directory.talkhint.research?.current.features[scenario] ?? baseline;
        const target = directory.talkhint.research?.target.features[scenario];
        const competitor = snapshot.scenarios.find((item) => item.scenario === scenario);
        return <tr key={scenario}><th scope="row">{label}</th>
          <td><LegacyScenarioCell evidence={current} /></td>
          <td><LegacyScenarioCell evidence={target} /></td>
          <td><LegacyScenarioCell evidence={competitor} /></td>
        </tr>;
      })}</tbody>
    </table></div>
  </section>;
}

function EvidenceSection({ directory, id, snapshot }: { directory: CompetitorDirectoryData; id: string; snapshot: CompetitorSnapshot }) {
  const record = directory.records.find((item) => item.id === id);
  const revisions = record?.revisions ?? [];
  return <section className="pm-cd-section">
    <div className="pm-cd-section-head"><span>04 / SOURCES & HISTORY</span><h3>Источники и история</h3></div>
    <p className="pm-cd-verification">{snapshot.verification === "manual" ? "Проверка источников выполняется вручную. Автоматического сканирования или обновления нет." : "Сведения предоставлены; независимая проверка не заявлена."}</p>
    <p className="pm-cd-checked">Снимок: {dateLabel(snapshot.checkedAt)}</p>
    {snapshot.sources.length ? <ul className="pm-cd-source-list">{snapshot.sources.map((source, index) => <li key={`${source.url}-${index}`}>
      <LinkValue value={source.url} /><span>{dateLabel(source.checkedAt)}</span>{source.note && <p>{source.note}</p>}
    </li>)}</ul> : <div className="pm-cd-empty">Источники не сохранены.</div>}
    {revisions.length > 0 && <div className="pm-cd-history">
      <h4>Сохранённые версии</h4>
      {revisions.slice().reverse().map((revision, index) => {
        const previous = revisions[revisions.length - index - 2];
        const differences = previous ? competitorSnapshotDiff(previous.snapshot, revision.snapshot) : [];
        return <details key={`${revision.version}-${revision.savedAt}`}>
          <summary>Версия {revision.version} · {dateLabel(revision.savedAt)}</summary>
          <p>{revision.reason}</p>
          {previous ? differences.length ? <ul>{differences.map((difference) => <li key={difference.field}>
            <strong>{diffLabel(difference.field)}</strong>
            <span>{difference.before} → {difference.after}</span>
          </li>)}</ul> : <span>Изменений относительно предыдущей версии не зафиксировано.</span>
            : <span>Первая сохранённая версия.</span>}
        </details>;
      })}
    </div>}
  </section>;
}

function DirectoryEditor({
  draft, setDraft, onClose, onSave, saving, needsRebase, onRebase, rebaseSnapshot,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft | null>>;
  onClose: () => void;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
  saving: boolean;
  needsRebase: boolean;
  onRebase: () => void;
  rebaseSnapshot?: CompetitorSnapshot;
}) {
  const snapshot = draft.snapshot;
  const updateDraft = (updater: (current: Draft) => Draft) =>
    setDraft((current) => current ? updater(current) : current);
  const patchSnapshot = (updates: Partial<CompetitorSnapshot>) =>
    updateDraft((current) => ({ ...current, snapshot: { ...current.snapshot, ...updates } }));
  const patchOffer = (key: keyof CompetitorSnapshot["offer"], value: string) =>
    patchSnapshot({ offer: { ...snapshot.offer, [key]: value } });
  const updatePlan = (index: number, key: PlanKey, value: string | number | null) =>
    patchSnapshot({ plans: snapshot.plans.map((plan, planIndex) => planIndex === index ? { ...plan, [key]: value } : plan) });
  const rebaseDiff = rebaseSnapshot ? competitorSnapshotDiff(rebaseSnapshot, snapshot) : [];
  return <form className="pm-cd-editor" onSubmit={onSave}>
    <div className="pm-cd-editor-head">
      <div><p className="pm-kicker">MANUAL RESEARCH ENTRY</p><h3>{draft.id ? "Обновить карточку конкурента" : "Добавить конкурента"}</h3>
        <p>Данные вносятся вручную по сохранённым источникам. Эта форма ничего не ищет и не проверяет автоматически.</p></div>
      <button className="pm-btn small" type="button" onClick={onClose} disabled={saving}>Закрыть</button>
    </div>
    {needsRebase && <div className="pm-cd-rebase" role="alert">
      <strong>Сохранение не принято. Форма и введённые данные сохранены.</strong>
      <span>Проверьте актуальную версию и явно выполните перебазирование перед повторной отправкой.</span>
      {rebaseDiff.length > 0 && <details><summary>Изменения в вашей форме относительно текущей версии ({rebaseDiff.length})</summary><ul>{rebaseDiff.slice(0, 20).map((difference) => <li key={difference.field}><b>{diffLabel(difference.field)}:</b> {difference.before} → {difference.after}</li>)}</ul></details>}
      <button className="pm-btn small" type="button" onClick={onRebase}>Перебазировать на последнюю версию</button>
    </div>}
    <fieldset disabled={saving || needsRebase}>
      <legend>Идентификация и предложение</legend>
      <div className="pm-cd-form-grid">
        <label>Название<input required value={snapshot.name} onChange={(event) => patchSnapshot({ name: event.target.value })} /></label>
        <label>Разработчик<input value={snapshot.developer} onChange={(event) => patchSnapshot({ developer: event.target.value })} /></label>
        <label>Аудитория<input value={snapshot.audience} onChange={(event) => patchSnapshot({ audience: event.target.value })} /></label>
        <label>Сайт<input type="url" value={snapshot.website} onChange={(event) => patchSnapshot({ website: event.target.value })} /></label>
        <label>Магазин приложений<input type="url" value={snapshot.appStore} onChange={(event) => patchSnapshot({ appStore: event.target.value })} /></label>
        <label>Дата ручной проверки<input type="date" value={dateInputValue(snapshot.checkedAt)} onChange={(event) => patchSnapshot({ checkedAt: event.target.value })} /><small>Дата сохраняется только после явного изменения и отправки формы.</small></label>
        <label>Основание проверки<select value={snapshot.verification} onChange={(event) => patchSnapshot({ verification: event.target.value as CompetitorSnapshot["verification"] })}>
          <option value="manual">Проверка источников вручную</option><option value="provided">Сведения предоставлены, не проверены</option>
        </select></label>
        {([
          ["features", "Описание функций"], ["channels", "Каналы"],
        ] as [keyof CompetitorSnapshot["offer"], string][]).map(([key, label]) => <label key={key}>{label}
          <textarea value={snapshot.offer[key]} onChange={(event) => patchOffer(key, event.target.value)} /></label>)}
        <label className="pm-cd-form-wide">Ограничения<textarea value={snapshot.limitations} onChange={(event) => patchSnapshot({ limitations: event.target.value })} /></label>
        <label className="pm-cd-form-wide">Причина добавления / обновления<input required value={draft.reason} onChange={(event) => updateDraft((current) => ({ ...current, reason: event.target.value }))} placeholder="Например: проверен официальный тарифный раздел" /></label>
      </div>
    </fieldset>

    <fieldset disabled={saving || needsRebase}>
      <legend>Тарифы</legend>
      <div className="pm-cd-editor-list">{snapshot.plans.map((plan, index) => <article className="pm-cd-edit-card" key={plan.id || index}>
        <div className="pm-cd-edit-card-head"><strong>Тариф {index + 1}</strong><button className="pm-btn small danger" type="button" onClick={() => patchSnapshot({ plans: snapshot.plans.filter((_, planIndex) => planIndex !== index) })}>Удалить тариф</button></div>
        <div className="pm-cd-form-grid">
          <label>Название<input value={plan.name} onChange={(event) => updatePlan(index, "name", event.target.value)} /></label>
          <label>Тип<select value={plan.kind} onChange={(event) => updatePlan(index, "kind", event.target.value as CompetitorPlan["kind"])}><option value="subscription">Подписка</option><option value="credit_pack">Пакет кредитов</option></select></label>
          <label>Цена<input type="number" min="0" step="any" value={plan.price ?? ""} placeholder="Не подтверждена" onChange={(event) => updatePlan(index, "price", event.target.value === "" ? null : Number(event.target.value))} /></label>
          <label>Валюта<input value={plan.currency} onChange={(event) => updatePlan(index, "currency", event.target.value)} placeholder="Например USD" /></label>
          <label>Регион<input value={plan.region} onChange={(event) => updatePlan(index, "region", event.target.value)} /></label>
          <label>Период<select value={plan.period} onChange={(event) => updatePlan(index, "period", event.target.value as CompetitorPlan["period"])}>
            {Object.entries(periodLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select></label>
          {([
            ["includedNumbers", "Включено номеров"], ["includedMinutes", "Включено минут"],
            ["includedCredits", "Включено кредитов"], ["includedSms", "Включено SMS"],
            ["overages", "Сверх лимита"], ["limitations", "Ограничения"],
          ] as [PlanKey, string][]).map(([key, label]) => <label key={key}>{label}<textarea value={plan[key] as string} onChange={(event) => updatePlan(index, key, event.target.value)} /></label>)}
          <label className="pm-cd-form-wide">Источник тарифа<input type="url" value={plan.sourceUrl} onChange={(event) => updatePlan(index, "sourceUrl", event.target.value)} /></label>
        </div>
      </article>)}</div>
      <button className="pm-btn small" type="button" onClick={() => patchSnapshot({ plans: [...snapshot.plans, {
        id: `plan-${Date.now()}`, name: "", kind: "subscription", currency: "", region: "", period: "unknown", price: null,
        includedNumbers: "", includedMinutes: "", includedCredits: "", includedSms: "", overages: "", limitations: "", sourceUrl: "",
      }] })}>Добавить тариф</button>
    </fieldset>

    <fieldset disabled={saving || needsRebase}>
      <legend>Структурированное исследование</legend>
      <p className="pm-cr-editor-intro">Старые сценарии читаются как совместимые сведения. Новые поля остаются неизвестными, пока не внесены с источником.</p>
      <CompetitorResearchEditor
        research={snapshot.research ?? researchFor(snapshot)}
        onChange={(research) => patchSnapshot({ research })}
      />
    </fieldset>
    <fieldset disabled={saving || needsRebase}>
      <legend>Источники и даты проверки</legend>
      <div className="pm-cd-editor-list">{snapshot.sources.map((source, index) => <article className="pm-cd-edit-card" key={`source-${index}`}>
        <div className="pm-cd-edit-card-head"><strong>Источник {index + 1}</strong><button className="pm-btn small danger" type="button" onClick={() => patchSnapshot({ sources: snapshot.sources.filter((_, sourceIndex) => sourceIndex !== index) })}>Удалить источник</button></div>
        <div className="pm-cd-form-grid">
          <label className="pm-cd-form-wide">URL<input type="url" value={source.url} onChange={(event) => patchSnapshot({ sources: snapshot.sources.map((item, sourceIndex) => sourceIndex === index ? { ...item, url: event.target.value } : item) })} /></label>
          <label>Дата проверки источника<input type="date" value={dateInputValue(source.checkedAt)} onChange={(event) => patchSnapshot({ sources: snapshot.sources.map((item, sourceIndex) => sourceIndex === index ? { ...item, checkedAt: event.target.value } : item) })} /></label>
          <label className="pm-cd-form-wide">Заметка<textarea value={source.note} onChange={(event) => patchSnapshot({ sources: snapshot.sources.map((item, sourceIndex) => sourceIndex === index ? { ...item, note: event.target.value } : item) })} /></label>
        </div>
      </article>)}</div>
      <button className="pm-btn small" type="button" onClick={() => patchSnapshot({ sources: [...snapshot.sources, { url: "", checkedAt: "", note: "" }] })}>Добавить источник</button>
    </fieldset>
    <div className="pm-cd-form-actions">
      <button className="pm-btn primary" type="submit" disabled={saving || needsRebase || !draft.reason.trim() || !snapshot.name.trim()}>{saving ? "Сохраняем…" : "Сохранить версию"}</button>
      <button className="pm-btn" type="button" onClick={onClose} disabled={saving}>Отменить</button>
    </div>
  </form>;
}

export default function CompetitorDirectory({ directory, hypothesisId, selectedId, view, saving = false, submit }: Props) {
  const records = directory?.records ?? [];
  const [comparisonSelection, setComparisonSelection] = useState<string[]>([]);
  const [comparedIds, setComparedIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [needsRebase, setNeedsRebase] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedNotice, setSavedNotice] = useState("");
  const directoryRef = useRef(directory);
  directoryRef.current = directory;
  const selectedRevision = selectedId ? latestRevision(directory, selectedId) : undefined;
  const selectedRecord = selectedId ? records.find((record) => record.id === selectedId) : undefined;
  const selectedSnapshot = selectedRevision?.snapshot;

  function startNew() {
    setSavedNotice("");
    setSaveError("");
    setNeedsRebase(false);
    setDraft({ baseVersion: 0, reason: "", snapshot: { ...emptyCompetitorSnapshot(), research: emptyCompetitorResearch() } });
  }
  function startEdit(id: string) {
    const revision = latestRevision(directory, id);
    if (!revision) return;
    setSavedNotice("");
    setSaveError("");
    setNeedsRebase(false);
    const snapshot = cloneSnapshot(revision.snapshot);
    snapshot.research = researchFor(revision.snapshot);
    setDraft({ id, baseVersion: revision.version, reason: "", snapshot });
  }
  function closeEditor() {
    setDraft(null);
    setNeedsRebase(false);
  }
  async function saveDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !submit || !draft.reason.trim() || !draft.snapshot.name.trim()) return;
    setSaveError("");
    const ok = await submit({
      type: "saveCompetitor",
      ...(draft.id ? { id: draft.id } : {}),
      baseVersion: draft.baseVersion,
      reason: draft.reason.trim(),
      snapshot: draft.snapshot,
    });
    if (ok) {
      setSavedNotice("Сохранена новая версия карточки.");
      setSaveError("");
      closeEditor();
    } else {
      const latestVersion = draft.id
        ? latestRevision(directoryRef.current, draft.id)?.version ?? 0
        : 0;
      if (latestVersion !== draft.baseVersion) {
        setNeedsRebase(true);
      } else {
        setNeedsRebase(false);
        setSaveError("Изменения не сохранены. Форма остаётся доступной; проверьте сообщение об ошибке и повторите сохранение.");
      }
    }
  }
  function rebaseDraft() {
    if (!draft) return;
    const current = draft.id ? latestRevision(directory, draft.id) : undefined;
    setDraft((value) => value ? { ...value, baseVersion: current?.version ?? 0 } : value);
    setNeedsRebase(false);
    setSaveError("");
  }

  if (selectedId) {
    if (!selectedSnapshot || !selectedRecord) return <section className="pm-competitor-directory"><div className="pm-cd-empty">Карточка не найдена в сохранённом справочнике этой гипотезы.</div><a className="pm-btn small" href={routeFor(view, hypothesisId)}>Вернуться к справочнику</a></section>;
    return <section className="pm-competitor-directory">
      <div className="pm-cd-heading">
        <div><p className="pm-kicker">NEW-COUNTRY / COMPETITOR RECORD</p><h2>{selectedSnapshot.name}</h2>
          <p>Снимок версии {selectedRevision.version}. Данные внутреннего исследования, не описание телефонного агента TalkHint.</p></div>
        <div className="pm-cd-heading-actions">
          <a className="pm-btn small" href={routeFor(view, hypothesisId)}>Все карточки</a>
          {submit && <button type="button" className="pm-btn primary" disabled={!!draft || saving} onClick={() => startEdit(selectedId)}>Обновить данные вручную</button>}
        </div>
      </div>
      {savedNotice && <p className="pm-cd-success" role="status">{savedNotice}</p>}
      {saveError && <p className="pm-cd-save-error" role="alert">{saveError}</p>}
      {draft && <DirectoryEditor draft={draft} setDraft={setDraft} onClose={closeEditor} onSave={(event) => void saveDraft(event)} saving={saving} needsRebase={needsRebase} onRebase={rebaseDraft} rebaseSnapshot={latestSnapshot(directory, draft.id || "")} />}
      <div className="pm-cd-detail-grid">
        <OfferSection snapshot={selectedSnapshot} />
        <TariffsSection snapshot={selectedSnapshot} />
        <CompetitorResearchProfile research={researchFor(selectedSnapshot)} />
        {directory && <LegacyScenarioReadOnly snapshot={selectedSnapshot} directory={directory} />}
        {directory && <EvidenceSection directory={directory} id={selectedRecord.id} snapshot={selectedSnapshot} />}
      </div>
    </section>;
  }

  return <section className="pm-competitor-directory">
    <div className="pm-cd-heading">
      <div><p className="pm-kicker">NEW-COUNTRY / RESEARCH DIRECTORY</p><h2>Справочник конкурентов</h2>
        <p>Исследование продукта TalkHint для основателя. Карточки заполняются вручную по источникам; автоматического поиска, проверки или обновления нет.</p></div>
      {submit && <button type="button" className="pm-btn primary" disabled={!!draft || saving} onClick={startNew}>Добавить конкурента</button>}
    </div>
    {savedNotice && <p className="pm-cd-success" role="status">{savedNotice}</p>}
    {saveError && <p className="pm-cd-save-error" role="alert">{saveError}</p>}
    {draft && <DirectoryEditor draft={draft} setDraft={setDraft} onClose={closeEditor} onSave={(event) => void saveDraft(event)} saving={saving} needsRebase={needsRebase} onRebase={rebaseDraft} rebaseSnapshot={latestSnapshot(directory, draft.id || "")} />}

    <div className="pm-cd-table-scroll">
      <table className="pm-cd-directory-table">
        <thead><tr><th scope="col">Сравнить</th><th scope="col">Продукт</th><th scope="col">Аудитория</th><th scope="col">Функции</th><th scope="col">Подписка и цена</th><th scope="col">Дополнительно</th><th scope="col">Проверено</th><th scope="col">Действие</th></tr></thead>
        <tbody>{records.map((record) => {
          const revision = record.revisions[record.revisions.length - 1];
          if (!revision) return null;
          const snapshot = revision.snapshot;
          const subscriptions = snapshot.plans.filter((plan) => plan.kind === "subscription");
          const extras = snapshot.plans.flatMap((plan) => [
            plan.kind === "credit_pack" && `${plan.name || "Пакет кредитов"}: ${competitorPrice(plan)}`,
            plan.includedNumbers && `Номера: ${plan.includedNumbers}`,
            plan.includedMinutes && `Минуты: ${plan.includedMinutes}`,
            plan.includedCredits && `Кредиты: ${plan.includedCredits}`,
            plan.includedSms && `SMS: ${plan.includedSms}`,
            plan.overages && `Сверх лимита: ${plan.overages}`,
            plan.limitations && `Ограничения: ${plan.limitations}`,
          ]).filter(Boolean);
          return <tr key={record.id}>
            <td><input aria-label={`Добавить ${snapshot.name} в сравнение`} type="checkbox" checked={comparisonSelection.includes(record.id)} onChange={(event) => setComparisonSelection((current) => event.target.checked ? [...current, record.id] : current.filter((id) => id !== record.id))} /></td>
            <th scope="row"><a href={routeFor("benchmark", hypothesisId, record.id)}>{snapshot.name}</a><small>{snapshot.developer || "Разработчик не указан"}</small></th>
            <td>{showValue(snapshot.audience)}</td>
            <td>{showValue(snapshot.offer.features)}</td>
            <td>{subscriptions.length ? subscriptions.map((plan) => <span className="pm-cd-table-line" key={plan.id}>{plan.name || "Тариф"} · {competitorPrice(plan)}</span>) : <span>Подписки не указаны</span>}</td>
            <td>{extras.length ? extras.join(" · ") : "Дополнения не указаны"}</td>
            <td>{dateLabel(snapshot.checkedAt)}</td>
            <td>{submit && <button className="pm-btn small" type="button" disabled={!!draft || saving} onClick={() => startEdit(record.id)}>Обновить данные</button>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {!records.length && <div className="pm-cd-empty">Сохранённых карточек пока нет. Добавьте конкурента вручную после выбора источников; автоматического обнаружения нет.</div>}

    <div className="pm-cd-comparison-actions">
      <p>{comparedIds.length ? `В матрице карточек: ${comparedIds.length}. Измените отмеченные строки и примените выбор.` : "Отметьте карточки, затем примените выбранный набор к матрице."}</p>
      <div className="pm-cd-comparison-buttons">
        <button className="pm-btn primary small" type="button" disabled={!comparisonSelection.length} onClick={() => setComparedIds([...comparisonSelection])}>Сравнить выбранных</button>
        {(comparisonSelection.length > 0 || comparedIds.length > 0) && <button className="pm-btn small" type="button" onClick={() => { setComparisonSelection([]); setComparedIds([]); }}>Очистить выбор</button>}
      </div>
    </div>

    {directory && (view === "benchmark" || comparedIds.length > 0) && <CompetitorResearchWorkbench
      directory={directory}
      initialSelectedIds={comparedIds}
      submit={submit}
      saving={saving}
      showSelectionControls={view === "benchmark"}
      onClearInitialSelection={() => { setComparisonSelection([]); setComparedIds([]); }}
    />}
    {directory && <section className="pm-cd-talkhint-note">
      <div><h3>TalkHint · baseline</h3><span>Проверено: {dateLabel(directory.talkhint.checkedAt)}</span></div>
      <p>{showValue(directory.talkhint.note)}</p>
    </section>}
  </section>;
}
