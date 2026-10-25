import React, { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid, LabelList, Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  featureFor,
  featureStatusLabel,
  emptyCompetitorResearch,
  languageFeatures,
  matchesResearchFilters,
  positioningFor,
  proximityWeights,
  researchFeatures,
  researchProximity,
  researchRows,
  researchFor,
  unknownResearchEvidence,
  type ResearchFeature,
  type ResearchLanguage,
  type LanguageFeature,
  type CompetitorResearch,
  type ResearchRow,
  type ResearchEvidence,
} from "@shared/competitorResearch";
import { avatarFields, dossierFor } from "@shared/competitorDossier";
import {
  competitorEvidenceStatuses,
  competitorPrice,
  type CompetitorDirectory,
} from "@shared/projectCompetitors";
import type { ModelCommand } from "@shared/projectModel";
import { CompetitorResearchEditor, CompetitorResearchProfile } from "@/components/project-model/CompetitorResearchProfile";
import CompetitorQuarterArchive from "@/components/project-model/CompetitorQuarterArchive";

type Props = {
  directory: CompetitorDirectory;
  initialSelectedIds?: string[];
  submit?: (command: ModelCommand) => Promise<boolean>;
  saving?: boolean;
  showSelectionControls?: boolean;
  onClearInitialSelection?: () => void;
};
type EvidenceDialogData = {
  title: string;
  value: string;
  status?: ResearchEvidence["status"];
  statusText?: string;
  note: string;
  checkedAt: string | null;
  sources: string[];
};
type MatrixLine = { id: string; label: string; group: string; cell: (row: ResearchRow) => EvidenceDialogData };
type TalkHintDraft = { current: CompetitorResearch; target: CompetitorResearch; checkedAt: string; reason: string };

const featureEntries = Object.entries(researchFeatures) as [ResearchFeature, string][];
const languageFeatureEntries = Object.entries(languageFeatures).filter(([key]) => key !== "contacts_history") as [LanguageFeature, string][];
function languageCount(item: ResearchLanguage) {
  if (item.count === null) return "не подтверждено";
  if (item.countQualifier === "at_least") return `${item.count.toLocaleString("ru-RU")}+`;
  if (item.countQualifier === "exact") return item.count.toLocaleString("ru-RU");
  return `${item.count.toLocaleString("ru-RU")} (формат не указан)`;
}
const geographyOptions = [
  ["service", "География сервиса"],
  ["phoneNumbers", "География доступности телефонных номеров"],
  ["customers", "География клиентов"],
] as const;
const languageOptions = [["", "Все языки"], ["russian", "Русский"], ["spanish", "Испанский"]] as const;
const yLabels: Record<number, string> = { 0: "Помощь оператору", 1: "Подтверждённые задачи", 2: "Ограниченная автономия" };

function display(value: string | null | undefined) { return value?.trim() || "Не подтверждено"; }
function dateDisplay(value: string | null) {
  if (!value) return "Дата проверки не указана";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("ru-RU", { dateStyle: "medium" });
}
function sourceHref(raw: string) {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}
function evidenceCell(title: string, evidence: ResearchEvidence, value = evidence.note): EvidenceDialogData {
  return { title, value, status: evidence.status, statusText: title, note: evidence.note, checkedAt: evidence.checkedAt, sources: evidence.sourceUrls };
}
function languageText(row: ResearchRow, feature: LanguageFeature | "contacts_history"): EvidenceDialogData {
  const language = researchFor(row.snapshot).languages.find((item) => item.feature === feature);
  const answer = (value: string) => value === "yes" ? "Да" : value === "no" ? "Нет" : "Не подтверждено";
  const featureLabel = feature === "contacts_history" ? "Контакты и история · единое старое поле" : languageFeatures[feature];
  return {
    title: `${featureLabel} · языковое покрытие`,
    value: language
      ? `Количество: ${languageCount(language)}; русский: ${answer(language.russian)}; испанский: ${answer(language.spanish)}`
      : "Количество и языковая поддержка не подтверждены.",
    status: language?.evidence.status ?? "unknown",
    statusText: language ? competitorEvidenceStatuses[language.evidence.status] : competitorEvidenceStatuses.unknown,
    note: language?.evidence.note ?? "Не подтверждено",
    checkedAt: language?.evidence.checkedAt ?? null,
    sources: language?.evidence.sourceUrls ?? [],
  };
}
function coverageText(row: ResearchRow, kind: "service" | "phoneNumbers" | "customers"): EvidenceDialogData {
  const list = researchFor(row.snapshot).geography[kind];
  const labels = { service: "География сервиса", phoneNumbers: "География телефонных номеров", customers: "География клиентов" };
  const sources = list.flatMap((item) => item.evidence.sourceUrls);
  return {
    title: labels[kind],
    value: list.length ? list.map((item) => `${item.region || "Регион не указан"} · ${competitorEvidenceStatuses[item.evidence.status]}`).join("\n") : "Подтверждённые регионы не внесены; это не означает отсутствия покрытия.",
    status: list.length === 1 ? list[0].evidence.status : undefined,
    note: list.map((item) => item.evidence.note).filter(Boolean).join("\n") || "Сведения не внесены.",
    checkedAt: list.map((item) => item.evidence.checkedAt).filter(Boolean).join(", ") || null,
    sources,
  };
}
function priceText(row: ResearchRow): EvidenceDialogData {
  const plans = row.snapshot.plans;
  const evidenceFor = (plan: (typeof plans)[number]): ResearchEvidence => plan.evidence ?? {
    status: plan.sourceUrl ? "official_claim" : "unknown",
    note: plan.sourceUrl ? "Сохранённые источник и дата исходного тарифа; свежая проверка не выполнялась." : "Доказательство тарифа не сохранено.",
    sourceUrls: plan.sourceUrl ? [plan.sourceUrl] : [],
    checkedAt: row.snapshot.checkedAt || null,
  };
  const planEvidence = plans.map(evidenceFor);
  const unitLabel = { coins: "монеты", credits: "кредиты", tokens: "токены" } as const;
  return {
    title: `${row.snapshot.name} · тарифы`,
    value: plans.length ? plans.map((plan) => {
      const units = plan.includedUnits?.unit ? `${plan.includedUnits.amount === null ? "Количество неизвестно" : plan.includedUnits.amount} ${unitLabel[plan.includedUnits.unit]}` : "Единица не указана";
      return `${plan.name || (plan.kind === "credit_pack" ? "Пакет единиц" : "Тариф")}: ${competitorPrice(plan)} · канал покупки: ${display(plan.purchaseChannel)} · валюта: ${display(plan.currency)} · регион тарифа: ${display(plan.region)} · период: ${plan.period} · номера: ${display(plan.includedNumbers)} · минуты: ${display(plan.includedMinutes)} · единицы: ${display(plan.includedCredits)} · SMS: ${display(plan.includedSms)} · дополнительные единицы: ${units} · сверх лимита: ${display(plan.overages)} · ограничения: ${display(plan.limitations)}`;
    }).join("\n") : "Сохранённых тарифов нет; цена не подтверждена.",
    status: planEvidence.length === 1 ? planEvidence[0].status : undefined,
    statusText: planEvidence.length === 1 ? competitorEvidenceStatuses[planEvidence[0].status] : undefined,
    note: planEvidence.map((item) => item.note).filter(Boolean).join("\n") || (plans.length ? "Сумма и эквиваленты показаны через общий helper competitorPrice; кредиты не переводятся в минуты." : "Отсутствие записи не является бесплатным тарифом."),
    checkedAt: planEvidence.map((item) => item.checkedAt).filter(Boolean).join(", ") || null,
    sources: planEvidence.flatMap((item) => item.sourceUrls),
  };
}
function avatarText(row: ResearchRow): EvidenceDialogData {
  const dossier = dossierFor(row.snapshot);
  const presence = dossier.avatar.presence ?? { value: null, evidence: unknownResearchEvidence() };
  const details = Object.entries(avatarFields).map(([key, label]) => {
    const fact = dossier.avatar[key as keyof typeof avatarFields];
    const value = fact?.value?.trim() || "Не подтверждено";
    const status = fact?.evidence ? competitorEvidenceStatuses[fact.evidence.status] : competitorEvidenceStatuses.unknown;
    const date = fact?.evidence.checkedAt ? dateDisplay(fact.evidence.checkedAt) : "дата не указана";
    const note = fact?.evidence.note?.trim() || "основание не указано";
    const citations = fact?.evidence.sourceUrls.length ? fact.evidence.sourceUrls.join(", ") : "источник не указан";
    return `${label}: ${value} · ${status} · ${date} · ${note} · источники: ${citations}`;
  });
  const sources = Array.from(new Set(Object.values(dossier.avatar).flatMap((fact) => fact?.evidence.sourceUrls ?? [])));
  const checkedAt = Array.from(new Set(Object.values(dossier.avatar).map((fact) => fact?.evidence.checkedAt).filter((date): date is string => !!date)));
  return {
    title: `${row.snapshot.name} · все поля аватара`,
    value: `Наличие живого аватара в чате: ${presence.value?.trim() || "Не подтверждено"}\n\n${details.join("\n")}`,
    status: presence.evidence.status,
    statusText: competitorEvidenceStatuses[presence.evidence.status],
    note: details.join("\n"),
    checkedAt: checkedAt.length ? checkedAt.join(", ") : null,
    sources,
  };
}
function matchesWorkbenchFilters(
  row: ResearchRow,
  region: string,
  language: "" | "russian" | "spanish",
  geographyKind: keyof CompetitorResearch["geography"],
) {
  if (!matchesResearchFilters(row, region, language, geographyKind)) return false;
  const research = researchFor(row.snapshot);
  const valid = (evidence: ResearchEvidence) =>
    ["official_claim", "live_verified"].includes(evidence.status) &&
    evidence.sourceUrls.length > 0 && !!evidence.checkedAt;
  if (region.trim() && !research.geography[geographyKind].some((item) =>
    item.region.toLocaleLowerCase().includes(region.trim().toLocaleLowerCase()) && valid(item.evidence))) return false;
  if (language && !research.languages.some((item) =>
    item[language] === "yes" && valid(item.evidence))) return false;
  return true;
}

function makeMatrixLines(): MatrixLine[] {
  const features: MatrixLine[] = featureEntries.map(([key, label]) => ({
    id: `feature-${key}`, group: "Одиннадцать функций", label,
    cell: (row) => {
      const evidence = featureFor(row, key);
      const statusText = featureStatusLabel(row, key);
      const scope = evidence.contexts?.length ? evidence.contexts.map((context) => context === "personal" ? "Личное" : "Бизнес").join(" · ") : "Контекст не указан";
      return { ...evidenceCell(statusText, evidence, `${statusText}\nСценарии: ${scope}\n${display(evidence.note)}`), statusText };
    },
  }));
  const languages: MatrixLine[] = [
    ...languageFeatureEntries.map(([key, label]): MatrixLine => ({
    id: `language-${key}`, group: "Язык и число · функции, медиа, текст", label,
    cell: (row: ResearchRow) => languageText(row, key),
    })),
    { id: "language-contacts_history-legacy", group: "Язык и число · совместимость", label: "Контакты и история · единое старое поле", cell: (row) => languageText(row, "contacts_history") },
  ];
  const avatarLine: MatrixLine = { id: "dossier-avatar-chat", group: "Досье · sourced facts", label: "Аватар в чате", cell: avatarText };
  const coverage: MatrixLine[] = geographyOptions.map(([key, label]) => ({
    id: `coverage-${key}`, group: "География · категории не смешиваются", label,
    cell: (row) => coverageText(row, key),
  }));
  return [
    ...features,
    ...languages,
    avatarLine,
    ...coverage,
    { id: "prices", group: "Тарифы", label: "Цена, лимиты и период", cell: priceText },
  ];
}
const matrixLines = makeMatrixLines();

function evidenceFromLegacyRows(directory: CompetitorDirectory): { current: CompetitorResearch; target: CompetitorResearch } {
  const rows = researchRows(directory);
  const currentRow = rows.find((row) => row.kind === "talkhint_current");
  const targetRow = rows.find((row) => row.kind === "talkhint_target");
  return {
    current: directory.talkhint.research?.current ?? (currentRow ? researchFor(currentRow.snapshot) : emptyCompetitorResearch()),
    target: directory.talkhint.research?.target ?? (targetRow ? researchFor(targetRow.snapshot) : emptyCompetitorResearch()),
  };
}

function EvidenceDialog({ data, onClose }: { data: EvidenceDialogData; onClose: () => void }) {
  return <div className="pm-cr-evidence-backdrop" onClick={onClose}>
    <section className="pm-cr-evidence-dialog" role="dialog" aria-modal="true" aria-labelledby="pm-cr-evidence-title" onClick={(event) => event.stopPropagation()}>
      <div className="pm-cr-evidence-dialog-head"><div><p className="pm-kicker">SAVED EVIDENCE</p><h3 id="pm-cr-evidence-title">{data.title}</h3></div><button className="pm-btn small" type="button" onClick={onClose}>Закрыть</button></div>
      {data.status && <span className={`pm-cr-status status-${data.status}`}>{competitorEvidenceStatuses[data.status]}</span>}
      <pre>{data.value}</pre>
      <p>{data.note}</p>
      <span>Дата проверки: {dateDisplay(data.checkedAt)}</span>
      <div className="pm-cr-sources">{data.sources.length ? data.sources.map((source, index) => {
        const href = sourceHref(source);
        return href ? <a key={`${source}-${index}`} href={href} target="_blank" rel="noreferrer">{source}</a> : <span key={`${source}-${index}`}>{source}</span>;
      }) : <span>Источники не указаны.</span>}</div>
    </section>
  </div>;
}

function ResearchMatrix({
  rows, selected, onCell,
}: {
  rows: ResearchRow[];
  selected: ResearchRow[];
  onCell: (data: EvidenceDialogData) => void;
}) {
  const current = rows.find((row) => row.kind === "talkhint_current");
  const target = rows.find((row) => row.kind === "talkhint_target");
  const columns = [...(current ? [current] : []), ...(target ? [target] : []), ...selected];
  return <div className="pm-cr-research-matrix-wrap">
    <table className="pm-cr-research-matrix">
      <thead><tr><th scope="col">Сохранённое поле</th>{columns.map((row) => <th key={row.id} scope="col" className={`kind-${row.kind}`}>{row.snapshot.name}</th>)}</tr></thead>
      {matrixLines.map((line) => <tbody key={line.id} className="pm-cr-matrix-group">
        <tr className="pm-cr-matrix-group-label"><th colSpan={columns.length + 1}>{line.group}</th></tr>
        <tr><th scope="row">{line.label}</th>{columns.map((row) => {
          const cell = line.cell(row);
          return <td key={row.id}><button type="button" className="pm-cr-matrix-cell" onClick={() => onCell(cell)}>
            {cell.status && <span className={`pm-cr-status status-${cell.status}`}>{cell.statusText ?? competitorEvidenceStatuses[cell.status]}</span>}
            <span>{cell.value}</span><small>Открыть источник и подробности</small>
          </button></td>;
        })}</tr>
      </tbody>)}
    </table>
    {!columns.length && <p className="pm-cd-empty">Нет сохранённой базы TalkHint для отображения.</p>}
  </div>;
}

function TalkHintResearchForm({
  draft, setDraft, saving, onSubmit, onClose, error,
}: {
  draft: TalkHintDraft;
  setDraft: React.Dispatch<React.SetStateAction<TalkHintDraft | null>>;
  saving: boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  error: string;
}) {
  const patch = (updates: Partial<TalkHintDraft>) => setDraft((current) => current ? { ...current, ...updates } : current);
  return <form className="pm-cr-talkhint-editor" onSubmit={onSubmit}>
    <div className="pm-cr-workbench-head"><div><p className="pm-kicker">TALKHINT / RESEARCH ONLY</p><h3>Текущая позиция и целевая концепция</h3>
      <p>Редактируются только исследовательские заметки; это не меняет телефонные функции, код или продуктовую конфигурацию.</p></div><button className="pm-btn small" type="button" onClick={onClose} disabled={saving}>Закрыть</button></div>
    <div className="pm-cr-form-grid">
      <label>Дата проверки<input type="date" value={draft.checkedAt.slice(0, 10)} onChange={(event) => patch({ checkedAt: event.target.value })} /></label>
      <label>Причина сохранения<input required value={draft.reason} onChange={(event) => patch({ reason: event.target.value })} /></label>
    </div>
    <details open><summary>Текущая позиция TalkHint</summary><CompetitorResearchEditor research={draft.current} onChange={(current) => patch({ current })} /></details>
    <details><summary>Целевая концепция TalkHint · не достигнутая позиция</summary><CompetitorResearchEditor research={draft.target} onChange={(target) => patch({ target })} /></details>
    {error && <p className="pm-cr-form-error" role="alert">{error}</p>}
    <button className="pm-btn primary" type="submit" disabled={saving || !draft.reason.trim()}>{saving ? "Сохраняем…" : "Сохранить исследовательскую версию"}</button>
  </form>;
}

function TalkHintResearchSection({ directory, submit, saving }: { directory: CompetitorDirectory; submit?: Props["submit"]; saving: boolean }) {
  const [draft, setDraft] = useState<TalkHintDraft | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const history = directory.talkhint.researchHistory ?? [];
  function startEdit() {
    const defaults = evidenceFromLegacyRows(directory);
    setError(""); setNotice("");
    setDraft({
      current: structuredClone(defaults.current ?? directory.talkhint.research?.current),
      target: structuredClone(defaults.target ?? directory.talkhint.research?.target),
      checkedAt: directory.talkhint.research?.checkedAt ?? directory.talkhint.checkedAt,
      reason: "",
    });
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !submit) return;
    setError("");
    const ok = await submit({ type: "saveTalkHintResearch", ...draft });
    if (ok) { setNotice("Исследовательская версия TalkHint сохранена."); setDraft(null); }
    else setError("Сохранение не выполнено; введённые заметки остались в форме.");
  }
  return <section className="pm-cr-talkhint-section">
    <div className="pm-cr-workbench-head"><div><p className="pm-kicker">BASELINE / VERSIONED</p><h3>TalkHint: текущая версия и цель</h3>
      <p>Раздел фиксирует исследовательские данные отдельно от реализации телефонного агента.</p></div>
      {submit && <button className="pm-btn" type="button" disabled={saving || !!draft} onClick={startEdit}>Редактировать исследования TalkHint</button>}
    </div>
    {notice && <p className="pm-cr-workbench-notice" role="status">{notice}</p>}
    {draft && <TalkHintResearchForm draft={draft} setDraft={setDraft} saving={saving} onSubmit={(event) => void save(event)} onClose={() => setDraft(null)} error={error} />}
    {history.length ? <div className="pm-cr-talkhint-history">
      <h4>Сохранённая история TalkHint</h4>
      {history.slice().reverse().map((item) => <details key={`${item.version}-${item.savedAt}`}>
        <summary>Версия {item.version} · {dateDisplay(item.savedAt)}</summary><p>{item.research.reason} · проверено {dateDisplay(item.research.checkedAt)}</p>
        <div className="pm-cr-history-pair"><section><h5>Текущая позиция</h5><CompetitorResearchProfile research={item.research.current} /></section>
          <section><h5>Целевая концепция</h5><CompetitorResearchProfile research={item.research.target} /></section></div>
      </details>)}
    </div> : <p className="pm-cr-muted">Версионной истории исследовательских заметок TalkHint пока нет.</p>}
  </section>;
}

function mapRows(directory: CompetitorDirectory, selected: ResearchRow[]) {
  const rows = researchRows(directory);
  const selectedIds = new Set(selected.map((row) => row.id));
  return rows.filter((row) => row.kind !== "competitor" || selectedIds.has(row.id));
}

function ProximityRanking({ rows }: { rows: ResearchRow[] }) {
  const ranks = rows.map((row) => ({ row, proximity: researchProximity(row), research: researchFor(row.snapshot) }))
    .sort((a, b) => {
      if (a.proximity.score === null) return b.proximity.score === null ? a.row.snapshot.name.localeCompare(b.row.snapshot.name) : 1;
      if (b.proximity.score === null) return -1;
      return b.proximity.score - a.proximity.score;
    });
  return <section className="pm-cr-section">
    <div className="pm-cr-section-head"><span>VERIFIED EVIDENCE ONLY</span><h3>Близость по подтверждённым действиям</h3></div>
    <p className="pm-cr-ranking-note">Не рейтинг качества. Вес начисляется за функцию, а не за её личный или бизнес-контекст; учитывается только живая проверка с датой и источником. Неизвестное остаётся диапазоном, а не нулевой оценкой.</p>
    {ranks.length ? <ol className="pm-cr-ranking-list">{ranks.map(({ row, proximity, research }) => {
      const size = research.companySize && research.companySize.evidence.sourceUrls.length > 0 && research.companySize.evidence.checkedAt;
      return <li key={row.id}>
        <div className="pm-cr-rank-main"><strong>{row.snapshot.name}</strong>
          {proximity.score === null ? <span className="pm-cr-unranked">Не ранжирован · нет подтверждённых совпадений</span>
            : <span className="pm-cr-ranked">{proximity.score} подтверждённых весовых баллов · верхняя граница {proximity.upper} · {proximity.confirmed}/11</span>}
          <small>{proximity.explanation}</small>
        </div>
        <div className="pm-cr-size-metric"><b>Размер · отдельно</b>{size ? <><span>{research.companySize!.metric}: {research.companySize!.value}</span>{research.companySize!.evidence.sourceUrls.map((source, index) => <a key={`${source}-${index}`} href={sourceHref(source) || undefined}>{source}</a>)}</> : <span>Нет sourced-метрики</span>}</div>
      </li>;
    })}</ol> : <div className="pm-cd-empty">Нет карточек для оценки.</div>}
    <details className="pm-cr-weights"><summary>Критерии и веса</summary><ul>{featureEntries.map(([key, label]) => <li key={key}><span>{label}</span><strong>{proximityWeights[key]}</strong></li>)}</ul></details>
  </section>;
}

function PositioningMap({ rows }: { rows: ResearchRow[] }) {
  const items = rows.map((row) => ({ row, position: positioningFor(row) }));
  const plotted = items.filter((item) => item.position.plottable && item.position.x !== null && item.position.y !== null);
  const competitors = plotted.filter(({ row }) => row.kind === "competitor").map(({ row, position }) => ({ x: position.x!, y: position.y!, name: row.snapshot.name, label: "Конкурент" }));
  const current = plotted.filter(({ row }) => row.kind === "talkhint_current").map(({ row, position }) => ({ x: position.x!, y: position.y!, name: row.snapshot.name, label: "Текущая позиция" }));
  const target = plotted.filter(({ row }) => row.kind === "talkhint_target").map(({ row, position }) => ({ x: position.x!, y: position.y!, name: row.snapshot.name, label: "Целевая концепция" }));
  return <section className="pm-cr-section pm-cr-positioning">
    <div className="pm-cr-section-head"><span>POSITIONING / EVIDENCE BOUNDS</span><h3>Карта функций и самостоятельности</h3></div>
    <p className="pm-cr-ranking-note">X: число личных и бизнес-сценариев, подтверждённых явно для 11 функций (22 возможные пары). Y: только помощь оператору, подтверждённые задачи или ограниченная автономия. Цель TalkHint выделена отдельно и не считается достигнутой.</p>
    {plotted.length ? <div className="pm-cr-position-chart">
      <ResponsiveContainer width="100%" height={320}>
        <ScatterChart margin={{ top: 14, right: 18, bottom: 22, left: 14 }}>
          <CartesianGrid stroke="#d8e5e5" />
          <XAxis type="number" dataKey="x" name="Явно подтверждённые сценарии" domain={[0, 22]} ticks={[0,2,4,6,8,10,12,14,16,18,20,22]} label={{ value: "Явно подтверждённые личные + бизнес-сценарии из 22", position: "insideBottom", offset: -12 }} />
          <YAxis type="number" dataKey="y" name="Самостоятельность" domain={[0, 2]} ticks={[0,1,2]} tickFormatter={(value: number) => yLabels[value] || ""} width={142} />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} formatter={(value: number, name: string) => [name === "x" ? `${value} из 22` : yLabels[value] || value, name === "x" ? "Явные сценарии" : "Режим"]} />
          <Legend />
          <Scatter name="Текущая позиция TalkHint" data={current} fill="#087e83"><LabelList dataKey="name" position="top" /></Scatter>
          <Scatter name="Целевая концепция TalkHint" data={target} fill="#a96720" shape="triangle"><LabelList dataKey="name" position="top" /></Scatter>
          <Scatter name="Конкуренты" data={competitors} fill="#647e8a" shape="square"><LabelList dataKey="name" position="top" /></Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div> : <div className="pm-cd-empty">Нет точек с достаточными проверяемыми данными. Точки не подменяются предполагаемыми позициями.</div>}
    <div className="pm-cr-position-bounds">{items.map(({ row, position }) => <article key={row.id}>
      <strong>{row.snapshot.name}{row.kind === "talkhint_target" ? " · цель" : ""}</strong>
      <span>Явные сценарии: {position.lower}–{position.upper} из 22 подтверждено / не разрешено</span>
      <p>{position.reason}</p>
    </article>)}</div>
  </section>;
}

export default function CompetitorResearchWorkbench({ directory, initialSelectedIds = [], submit, saving = false, showSelectionControls = true, onClearInitialSelection }: Props) {
  const rows = useMemo(() => researchRows(directory), [directory]);
  const [selection, setSelection] = useState<string[]>(() => [...initialSelectedIds]);
  const [comparedIds, setComparedIds] = useState<string[]>(() => [...initialSelectedIds]);
  const selectionSignature = initialSelectedIds.join("|");
  useEffect(() => {
    const ids = selectionSignature ? selectionSignature.split("|") : [];
    setSelection(ids);
    setComparedIds(ids);
  }, [selectionSignature]);
  const [geographyKind, setGeographyKind] = useState<keyof CompetitorResearch["geography"]>("service");
  const [region, setRegion] = useState("");
  const [language, setLanguage] = useState<"" | "russian" | "spanish">("");
  const [dialog, setDialog] = useState<EvidenceDialogData | null>(null);
  const filteredCompetitors = rows.filter((row) => row.kind === "competitor" && matchesWorkbenchFilters(row, region, language, geographyKind));
  const selectedRows = comparedIds.flatMap((id) => filteredCompetitors.filter((row) => row.id === id));
  const positionRows = mapRows(directory, selectedRows);
  const talkhintDefaults = evidenceFromLegacyRows(directory);
  const talkhintCurrent = rows.find((row) => row.kind === "talkhint_current");
  const talkhintTarget = rows.find((row) => row.kind === "talkhint_target");

  function clearSelection() {
    setSelection([]);
    setComparedIds([]);
    onClearInitialSelection?.();
  }

  return <section className="pm-cr-workbench">
    <header className="pm-cr-workbench-intro">
      <div><p className="pm-kicker">RESEARCH MATRIX / NEW-COUNTRY</p><h2>Сравнение по сохранённым свидетельствам</h2>
        <p>Матрица не исследует веб и не заполняет пробелы автоматически. Источник, статус и дата открываются в каждой ячейке.</p></div>
      <div className="pm-cr-workbench-controls">
        <label>Категория географии<select value={geographyKind} onChange={(event) => setGeographyKind(event.target.value as keyof CompetitorResearch["geography"])}>
          {geographyOptions.map(([value, title]) => <option value={value} key={value}>{title}</option>)}
        </select></label>
        <label>Регион, свободный ввод<input value={region} onChange={(event) => setRegion(event.target.value)} placeholder="Например: New York" /></label>
        <label>Язык любой функции<select value={language} onChange={(event) => setLanguage(event.target.value as typeof language)}>
          {languageOptions.map(([value, title]) => <option value={value} key={value}>{title}</option>)}
        </select></label>
        <small>Языковой фильтр совпадает с любой функцией с сохранённым источником; RU для SMS не означает RU для голоса. География сервиса, номеров и клиентов не выводится из App Store или тарифа.</small>
      </div>
    </header>

    {showSelectionControls && <section className="pm-cr-selection">
      <div className="pm-cr-section-head"><span>01 / SELECT</span><h3>Выберите карточки для матрицы</h3></div>
      {filteredCompetitors.length ? <div className="pm-cr-selection-list">{filteredCompetitors.map((row) => <label key={row.id}>
        <input type="checkbox" checked={selection.includes(row.id)} onChange={(event) => setSelection((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))} />
        <span>{row.snapshot.name}</span><small>v{row.version}</small>
      </label>)}</div> : <div className="pm-cd-empty">{region || language ? "Нет подтверждённого покрытия или языка по выбранным фильтрам; это не означает отсутствия." : "Карточек конкурентов пока нет."}</div>}
      <div className="pm-cr-selection-actions">
        <span>{comparedIds.length ? `В матрице: ${comparedIds.length}` : "Выберите минимум одну карточку."}</span>
        <button className="pm-btn primary" type="button" disabled={!selection.length} onClick={() => setComparedIds([...selection])}>Сравнить выбранных</button>
        {(selection.length > 0 || comparedIds.length > 0) && <button className="pm-btn" type="button" onClick={clearSelection}>Очистить выбор</button>}
      </div>
    </section>}

    {comparedIds.length > 0 && <section className="pm-cr-section pm-cr-matrix-section">
      <div className="pm-cr-section-head"><span>02 / FIELD MATRIX</span><h3>Текущая версия · целевая концепция · выбранные продукты</h3></div>
      {selectedRows.length ? <ResearchMatrix rows={rows} selected={selectedRows} onCell={setDialog} />
        : <div className="pm-cd-empty">Выбранные карточки скрыты текущими фильтрами. Измените фильтр или выберите видимые строки.</div>}
      <p className="pm-cr-matrix-footnote">Заявленное, находящееся в коде, живое подтверждение, план и неизвестное имеют разные статусы. Пустое поле не считается отсутствием.</p>
    </section>}

    <section className="pm-cr-analytics">
      <ProximityRanking rows={filteredCompetitors} />
      <PositioningMap rows={positionRows} />
    </section>

    {directory && <TalkHintResearchSection directory={directory} submit={submit} saving={saving} />}
    {directory && <CompetitorQuarterArchive directory={directory} submit={submit} saving={saving} />}

    {dialog && <EvidenceDialog data={dialog} onClose={() => setDialog(null)} />}
    {!talkhintDefaults.current && !talkhintCurrent && !talkhintTarget && <p className="pm-cr-muted">Исследовательская база TalkHint не сохранена.</p>}
  </section>;
}
