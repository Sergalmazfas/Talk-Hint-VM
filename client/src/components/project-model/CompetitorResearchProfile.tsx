import React from "react";
import { competitorEvidenceStatuses } from "@shared/projectCompetitors";
import {
  researchFeatures,
  unknownResearchEvidence,
  type CompetitorResearch,
  type ResearchCoverage,
  type ResearchEvidence,
  type ResearchFeature,
  type ResearchLanguage,
} from "@shared/competitorResearch";

type Props = { research: CompetitorResearch };
type EditorProps = { research: CompetitorResearch; onChange: (research: CompetitorResearch) => void };
const featureEntries = Object.entries(researchFeatures) as [ResearchFeature, string][];
const statusEntries = Object.entries(competitorEvidenceStatuses) as [ResearchEvidence["status"], string][];
const languageValues = [
  ["yes", "Да"], ["no", "Нет"], ["unknown", "Не подтверждено"],
] as const;
const geographyTypes = [
  ["service", "География сервиса"],
  ["phoneNumbers", "Телефонные номера"],
  ["customers", "Клиенты"],
] as const;
const autonomyModes = [
  ["unknown", "Не подтверждено"],
  ["assist_only", "Только помощь оператору"],
  ["confirmed_tasks", "Выполнение подтверждённых задач"],
  ["bounded_autonomy", "Ограниченная автономия"],
] as const;
const contextLabels = { personal: "Личный сценарий", business: "Бизнес-сценарий" } as const;

function sourceHref(raw: string): string {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}
function valueOrUnknown(value: string) { return value.trim() || "Не указано"; }
function dateText(value: string | null) {
  if (!value) return "Дата проверки не указана";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("ru-RU", { dateStyle: "medium" });
}
function EvidenceStatus({ evidence }: { evidence: ResearchEvidence }) {
  return <span className={`pm-cr-status status-${evidence.status}`}>{competitorEvidenceStatuses[evidence.status]}</span>;
}
function EvidenceLinks({ evidence }: { evidence: ResearchEvidence }) {
  return evidence.sourceUrls.length ? <div className="pm-cr-sources">{evidence.sourceUrls.map((source, index) => {
    const href = sourceHref(source);
    return href ? <a key={`${source}-${index}`} href={href} target="_blank" rel="noreferrer">{source}</a>
      : <span key={`${source}-${index}`}>{source}</span>;
  })}</div> : <span className="pm-cr-no-source">Источник не указан</span>;
}

export function CompetitorResearchProfile({ research }: Props) {
  const sourcedSize = research.companySize && research.companySize.evidence.sourceUrls.length > 0 && !!research.companySize.evidence.checkedAt;
  return <section className="pm-cr-profile" aria-label="Структурированные исследования продукта">
    <section className="pm-cr-section">
      <div className="pm-cr-section-head"><span>RESEARCH / GEOGRAPHY</span><h3>География</h3></div>
      <div className="pm-cr-geo-grid">{geographyTypes.map(([key, title]) => <article key={key}>
        <h4>{title}</h4>
        {research.geography[key].length ? <ul>{research.geography[key].map((item, index) => <li key={`${item.region}-${index}`}>
          <strong>{valueOrUnknown(item.region)}</strong><EvidenceStatus evidence={item.evidence} />
          <p>{valueOrUnknown(item.evidence.note)} · {dateText(item.evidence.checkedAt)}</p><EvidenceLinks evidence={item.evidence} />
        </li>)}</ul> : <p className="pm-cr-muted">Сохранённых сведений нет.</p>}
      </article>)}</div>
    </section>
    <section className="pm-cr-section">
      <div className="pm-cr-section-head"><span>RESEARCH / LANGUAGES</span><h3>Языки и масштаб по функции</h3></div>
      <div className="pm-cr-language-table-wrap"><table className="pm-cr-language-table">
        <thead><tr><th scope="col">Функция</th><th scope="col">Подтверждённое число</th><th scope="col">Русский</th><th scope="col">Испанский</th><th scope="col">Доказательство</th></tr></thead>
        <tbody>{featureEntries.map(([feature]) => {
          const item = research.languages.find((language) => language.feature === feature) ?? emptyLanguage(feature);
          return <tr key={item.feature}>
          <th scope="row">{researchFeatures[item.feature]}</th>
          <td>{item.count === null ? "Не подтверждено" : item.count.toLocaleString("ru-RU")}</td>
          <td>{item.russian === "yes" ? "Да" : item.russian === "no" ? "Нет" : "Не подтверждено"}</td>
          <td>{item.spanish === "yes" ? "Да" : item.spanish === "no" ? "Нет" : "Не подтверждено"}</td>
          <td><EvidenceStatus evidence={item.evidence} /><span>{valueOrUnknown(item.evidence.note)}</span><EvidenceLinks evidence={item.evidence} /></td>
        </tr>;
        })}</tbody>
      </table></div>
    </section>
    <section className="pm-cr-section">
      <div className="pm-cr-section-head"><span>RESEARCH / NINE FEATURES</span><h3>Функции и свидетельства</h3></div>
      <div className="pm-cr-feature-grid">{featureEntries.map(([key, label]) => {
        const evidence = research.features[key] ?? unknownResearchEvidence();
        return <article key={key}><strong>{label}</strong><EvidenceStatus evidence={evidence} />
          <p>{valueOrUnknown(evidence.note)}</p>
          <div className="pm-cr-context-state">{(["personal", "business"] as const).map((context) =>
            <span key={context}>{contextLabels[context]}: {evidence.contexts?.includes(context) ? "Указан явно" : "Не указан"}</span>)}</div>
          <span>{dateText(evidence.checkedAt)}</span><EvidenceLinks evidence={evidence} />
        </article>;
      })}</div>
    </section>
    <div className="pm-cr-profile-bottom">
      <section className="pm-cr-section"><div className="pm-cr-section-head"><span>RESEARCH / AUTONOMY</span><h3>Режим автономии</h3></div>
        <strong>{autonomyModes.find(([value]) => value === research.autonomy.mode)?.[1] ?? "Не подтверждено"}</strong>
        <EvidenceStatus evidence={research.autonomy.evidence} />
        <p>{valueOrUnknown(research.autonomy.evidence.note)}</p><EvidenceLinks evidence={research.autonomy.evidence} />
        <span>{dateText(research.autonomy.evidence.checkedAt)}</span>
      </section>
      <section className="pm-cr-section"><div className="pm-cr-section-head"><span>SEPARATE / SOURCED METRIC</span><h3>Размер компании</h3></div>
        {sourcedSize ? <><strong>{research.companySize!.metric}: {research.companySize!.value}</strong>
          <p>{valueOrUnknown(research.companySize!.evidence.note)} · {dateText(research.companySize!.evidence.checkedAt)}</p><EvidenceLinks evidence={research.companySize!.evidence} />
        </> : <p className="pm-cr-muted">Нет метрики размера компании с сохранённым источником; она не участвует в оценке близости.</p>}
      </section>
    </div>
  </section>;
}

function EvidenceEditor({ label, evidence, onChange }: { label: string; evidence: ResearchEvidence; onChange: (value: ResearchEvidence) => void }) {
  return <fieldset className="pm-cr-evidence-editor">
    <legend>{label}</legend>
    <label>Статус доказательства<select value={evidence.status} onChange={(event) => onChange({ ...evidence, status: event.target.value as ResearchEvidence["status"] })}>
      {statusEntries.map(([value, title]) => <option value={value} key={value}>{title}</option>)}
    </select></label>
    <label>Заметка / описание<textarea value={evidence.note} onChange={(event) => onChange({ ...evidence, note: event.target.value })} /></label>
    <label>Источники, по одному URL на строку<textarea value={evidence.sourceUrls.join("\n")} onChange={(event) => onChange({ ...evidence, sourceUrls: event.target.value.split("\n").map((source) => source.trim()).filter(Boolean) })} /></label>
    <label>Дата проверки<input type="date" value={evidence.checkedAt?.slice(0, 10) ?? ""} onChange={(event) => onChange({ ...evidence, checkedAt: event.target.value || null })} /></label>
  </fieldset>;
}

function emptyLanguage(feature: ResearchFeature): ResearchLanguage {
  return {
    feature, count: null, russian: "unknown" as const, spanish: "unknown" as const,
    evidence: unknownResearchEvidence(),
  };
}

export function CompetitorResearchEditor({ research, onChange }: EditorProps) {
  const patch = (updates: Partial<CompetitorResearch>) => onChange({ ...research, ...updates });
  const patchFeature = (key: ResearchFeature, evidence: ResearchEvidence) =>
    patch({ features: { ...research.features, [key]: evidence } });
  const patchGeography = (category: keyof CompetitorResearch["geography"], index: number, value: ResearchCoverage) =>
    patch({ geography: { ...research.geography, [category]: research.geography[category].map((item, itemIndex) => itemIndex === index ? value : item) } });
  const patchLanguage = (feature: ResearchFeature, value: Partial<ResearchLanguage>) => {
    const current = research.languages.find((item) => item.feature === feature) ?? emptyLanguage(feature);
    const updated = { ...current, ...value };
    const remaining = research.languages.filter((item) => item.feature !== feature);
    patch({ languages: [...remaining, updated].sort((a, b) => featureEntries.findIndex(([key]) => key === a.feature) - featureEntries.findIndex(([key]) => key === b.feature)) });
  };
  return <div className="pm-cr-editor">
    <section className="pm-cr-editor-section"><div className="pm-cr-section-head"><span>01 / GEOGRAPHY</span><h4>Раздельная география</h4></div>
      <p>География сервиса, выдачи телефонных номеров и клиентов хранится отдельно. Неизвестное не означает отсутствие.</p>
      {geographyTypes.map(([category, label]) => <div className="pm-cr-coverage-editor" key={category}>
        <div className="pm-cr-coverage-head"><strong>{label}</strong><button className="pm-btn small" type="button" onClick={() => patch({ geography: { ...research.geography, [category]: [...research.geography[category], { region: "", evidence: unknownResearchEvidence() }] } })}>Добавить регион</button></div>
        {!research.geography[category].length && <p className="pm-cr-muted">Сведения не внесены.</p>}
        {research.geography[category].map((coverage, index) => <article className="pm-cr-coverage-row" key={`${category}-${index}`}>
          <label>Регион<input value={coverage.region} onChange={(event) => patchGeography(category, index, { ...coverage, region: event.target.value })} /></label>
          <EvidenceEditor label="Доказательство" evidence={coverage.evidence} onChange={(evidence) => patchGeography(category, index, { ...coverage, evidence })} />
          <button className="pm-btn small danger" type="button" onClick={() => patch({ geography: { ...research.geography, [category]: research.geography[category].filter((_, itemIndex) => itemIndex !== index) } })}>Удалить регион</button>
        </article>)}
      </div>)}
    </section>
    <section className="pm-cr-editor-section"><div className="pm-cr-section-head"><span>02 / LANGUAGES</span><h4>Языки и количества по функциям</h4></div>
      <p>Число оставляйте пустым, если источник его не подтверждает. Кредиты не переводятся в минуты.</p>
      <div className="pm-cr-editor-list">{featureEntries.map(([feature, label]) => {
        const language = research.languages.find((item) => item.feature === feature) ?? emptyLanguage(feature);
        return <article className="pm-cr-language-editor" key={feature}>
          <strong>{label}</strong>
          <div className="pm-cr-form-grid">
            <label>Подтверждённое число<input type="number" min="0" step="1" value={language.count ?? ""} onChange={(event) => patchLanguage(feature, { count: event.target.value === "" ? null : Number(event.target.value) })} /></label>
            <label>Русский<select value={language.russian} onChange={(event) => patchLanguage(feature, { russian: event.target.value as typeof language.russian })}>{languageValues.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
            <label>Испанский<select value={language.spanish} onChange={(event) => patchLanguage(feature, { spanish: event.target.value as typeof language.spanish })}>{languageValues.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
          </div>
          <EvidenceEditor label="Основание" evidence={language.evidence} onChange={(evidence) => patchLanguage(feature, { evidence })} />
        </article>;
      })}</div>
    </section>
    <section className="pm-cr-editor-section"><div className="pm-cr-section-head"><span>03 / FEATURES</span><h4>Девять функций</h4></div>
      <p>Для карты у каждой функции укажите личный и/или бизнес-сценарий явно. Старые данные не получают область применения автоматически.</p>
      <div className="pm-cr-editor-list">{featureEntries.map(([key, label]) => {
        const evidence = research.features[key] ?? unknownResearchEvidence();
        const contexts = evidence.contexts ?? [];
        return <article className="pm-cr-feature-editor-card" key={key}>
          <EvidenceEditor label={label} evidence={evidence} onChange={(value) => patchFeature(key, value)} />
          <fieldset className="pm-cr-context-editor"><legend>Контекст сценария · Личное (личный сценарий) / бизнес · без автоматических значений</legend>
            {(["personal", "business"] as const).map((context) => <label key={context}>
              <input type="checkbox" checked={contexts.includes(context)} onChange={(event) => {
                const next = event.target.checked ? [...contexts, context] : contexts.filter((item) => item !== context);
                patchFeature(key, { ...evidence, contexts: next });
              }} />{contextLabels[context]}
            </label>)}
          </fieldset>
        </article>;
      })}</div>
    </section>
    <section className="pm-cr-editor-section"><div className="pm-cr-section-head"><span>04 / AUTONOMY</span><h4>Самостоятельность продукта</h4></div>
      <label>Режим<select value={research.autonomy.mode} onChange={(event) => patch({ autonomy: { ...research.autonomy, mode: event.target.value as CompetitorResearch["autonomy"]["mode"] } })}>{autonomyModes.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
      <EvidenceEditor label="Основание режима" evidence={research.autonomy.evidence} onChange={(evidence) => patch({ autonomy: { ...research.autonomy, evidence } })} />
    </section>
    <section className="pm-cr-editor-section"><div className="pm-cr-section-head"><span>05 / COMPANY SIZE</span><h4>Размер компании · отдельная метрика</h4></div>
      <label className="pm-cr-checkbox"><input type="checkbox" checked={!!research.companySize} onChange={(event) => patch({ companySize: event.target.checked ? { metric: "", value: "", evidence: unknownResearchEvidence() } : null })} /> Внести метрику размера только с источником</label>
      {research.companySize && <>
        <div className="pm-cr-form-grid">
          <label>Название метрики<input value={research.companySize.metric} onChange={(event) => patch({ companySize: { ...research.companySize!, metric: event.target.value } })} /></label>
          <label>Значение<input value={research.companySize.value} onChange={(event) => patch({ companySize: { ...research.companySize!, value: event.target.value } })} /></label>
        </div>
        <EvidenceEditor label="Источник и подтверждение" evidence={research.companySize.evidence} onChange={(evidence) => patch({ companySize: { ...research.companySize!, evidence } })} />
      </>}
    </section>
  </div>;
}
