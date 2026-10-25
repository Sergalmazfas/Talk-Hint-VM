import React from "react";
import {
  avatarFields,
  dossierSections,
  dossierFor,
  scaleFields,
  type AdditionalDossierFact,
  type CompetitorDossier,
  type DossierFact,
} from "@shared/competitorDossier";
import {
  competitorEvidenceStatuses,
  competitorPrice,
  type CompetitorPlan,
  type CompetitorSnapshot,
} from "@shared/projectCompetitors";
import {
  unknownResearchEvidence,
  type CompetitorResearch,
  type ResearchEvidence,
} from "@shared/competitorResearch";
import {
  CompetitorResearchCoverage,
  CompetitorResearchProposal,
  CompetitorResearchScale,
  ResearchEvidenceEditor,
} from "@/components/project-model/CompetitorResearchProfile";

const layerLabels = {
  telephony: "Телефония",
  stt: "Распознавание речи",
  llm: "LLM",
  translation: "Перевод",
  tts: "Синтез речи",
  technology: "Технология",
} as const;
const scopeLabels = { live_call: "Живой звонок", file_tool: "Файл / инструмент", chat: "Чат", platform: "Платформа" } as const;
const unitLabels = { coins: "монеты", credits: "кредиты", tokens: "токены" } as const;
const periodLabels: Record<CompetitorPlan["period"], string> = {
  week: "Неделя", month: "Месяц", year: "Год", one_time: "Разовая оплата", unknown: "Не подтверждён",
};
const revenueLabels = { unknown: "Не подтверждено", official: "Официально раскрытая выручка", scenario: "Сценарий / оценка" } as const;
const evidenceStatusEntries = Object.entries(competitorEvidenceStatuses) as [ResearchEvidence["status"], string][];

function safeHref(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "";
  } catch {
    return "";
  }
}
function display(value: string | null | undefined) {
  return value?.trim() || "Не указано";
}
function dateLabel(value: string | null | undefined) {
    if (!value) return "Не указана";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("ru-RU", { dateStyle: "medium" });
}
function EvidenceMeta({ evidence }: { evidence: ResearchEvidence }) {
  return <div className="pm-dossier-evidence">
    <span className={`pm-cr-status status-${evidence.status}`}>{competitorEvidenceStatuses[evidence.status]}</span>
    <span>Проверено: {dateLabel(evidence.checkedAt)}</span>
    <p>{display(evidence.note)}</p>
    <div className="pm-cr-sources">{evidence.sourceUrls.length ? evidence.sourceUrls.map((source, index) => {
      const href = safeHref(source);
      return href ? <a href={href} target="_blank" rel="noreferrer" key={`${source}-${index}`}>{source}</a> : <span key={`${source}-${index}`}>{source}</span>;
    }) : <span>Источник не указан</span>}</div>
  </div>;
}
function legacyEvidence(snapshot: CompetitorSnapshot, identitySource?: string): ResearchEvidence {
  return {
    status: identitySource && snapshot.verification === "manual" ? "official_claim" : "unknown",
    note: identitySource && snapshot.verification === "manual" ? "Наименование и ссылки из сохранённого официального источника; проверка при показе страницы не выполняется."
      : snapshot.verification === "manual" ? "Обобщённое поле карточки, не отдельное официальное заявление. Источники и статусы конкретных фактов — в структурированных данных ниже."
        : "Сведения предоставлены; независимая проверка не заявлена.",
    sourceUrls: identitySource ? [identitySource] : snapshot.sources.map((source) => source.url).filter(Boolean),
    checkedAt: snapshot.checkedAt || null,
  };
}
export function planEvidenceForSnapshot(plan: CompetitorPlan, snapshot: CompetitorSnapshot): ResearchEvidence {
  if (plan.evidence) return plan.evidence;
  return {
    status: plan.sourceUrl ? "official_claim" : "unknown",
    note: plan.sourceUrl ? "Ранее сохранённый тариф: источник и дата снимка. Новая проверка не выполнялась." : "Доказательство тарифа не сохранено.",
    sourceUrls: plan.sourceUrl ? [plan.sourceUrl] : [],
    checkedAt: snapshot.checkedAt || null,
  };
}

function LegacyFact({ label, value, snapshot, identitySource }: { label: string; value: string; snapshot: CompetitorSnapshot; identitySource?: string }) {
  return <article className="pm-dossier-fact">
    <strong>{label}</strong><p>{display(value)}</p><EvidenceMeta evidence={legacyEvidence(snapshot, identitySource)} />
  </article>;
}
function DossierFactView({ label, fact }: { label: string; fact: DossierFact | undefined }) {
  const value = fact ?? { value: null, evidence: unknownResearchEvidence() };
  return <article className="pm-dossier-fact">
    <strong>{label}</strong><p>{value.value === null ? "Не подтверждено" : display(value.value)}</p><EvidenceMeta evidence={value.evidence} />
  </article>;
}
function AdditionalFactView({ fact }: { fact: AdditionalDossierFact }) {
  return <DossierFactView label={fact.title || "Факт"} fact={fact} />;
}

function ProposalSection({ snapshot, dossier, research }: { snapshot: CompetitorSnapshot; dossier: CompetitorDossier; research: CompetitorResearch }) {
  const limits = snapshot.limitations.split("СТРАТЕГИЧЕСКИЙ ВЫВОД")[0].trim();
  return <section className="pm-dossier-section">
    <div className="pm-dossier-heading"><span>01</span><h3>{dossierSections[0]}</h3></div>
    <div className="pm-dossier-facts-grid">
      <LegacyFact label="Название продукта" value={snapshot.name} snapshot={snapshot} identitySource={snapshot.appStore || snapshot.website} />
      <LegacyFact label="Разработчик" value={snapshot.developer} snapshot={snapshot} identitySource={snapshot.appStore || snapshot.website} />
      <LegacyFact label="Аудитория" value={snapshot.audience} snapshot={snapshot} />
      <LegacyFact label="Функциональное описание" value={snapshot.offer.features} snapshot={snapshot} />
      <LegacyFact label="Каналы" value={snapshot.offer.channels} snapshot={snapshot} />
      <LegacyFact label="Сохранённое общее описание языков · не заменяет сведения по функциям" value={snapshot.offer.languages} snapshot={snapshot} />
      {limits && <LegacyFact label="Ограничения" value={limits} snapshot={snapshot} />}
      <article className="pm-dossier-fact"><strong>Официальный сайт</strong><p>{safeHref(snapshot.website) ? <a href={safeHref(snapshot.website)} target="_blank" rel="noreferrer">{snapshot.website}</a> : display(snapshot.website)}</p><EvidenceMeta evidence={legacyEvidence(snapshot, snapshot.website)} /></article>
      <article className="pm-dossier-fact"><strong>Магазин приложений</strong><p>{safeHref(snapshot.appStore) ? <a href={safeHref(snapshot.appStore)} target="_blank" rel="noreferrer">{snapshot.appStore}</a> : display(snapshot.appStore)}</p><EvidenceMeta evidence={legacyEvidence(snapshot, snapshot.appStore)} /></article>
      {dossier.offerFacts.map((fact) => <AdditionalFactView key={fact.id} fact={fact} />)}
    </div>
    <div className="pm-dossier-subsection">
      <div className="pm-dossier-subhead"><span>AVATAR EVIDENCE</span><h4>Персонаж в разговоре</h4></div>
      <p className="pm-dossier-caution">Иконка приложения, декоративный круг, демонстрационное видео или lip-sync в видеодубляже не доказывают наличие живого аватара в чате.</p>
      <div className="pm-dossier-facts-grid">{Object.entries(avatarFields).map(([key, label]) =>
        <DossierFactView key={key} label={label} fact={dossier.avatar[key as keyof typeof avatarFields]} />)}</div>
    </div>
    <div className="pm-dossier-subsection"><div className="pm-dossier-subhead"><span>RESEARCH / CANONICAL FEATURES</span><h4>Функции и языки</h4></div>
      <CompetitorResearchProposal research={research} />
    </div>
  </section>;
}

function PricesSection({ snapshot, dossier }: { snapshot: CompetitorSnapshot; dossier: CompetitorDossier }) {
  return <section className="pm-dossier-section">
    <div className="pm-dossier-heading"><span>02</span><h3>{dossierSections[1]}</h3></div>
    {snapshot.plans.length ? <div className="pm-cd-plan-list">{snapshot.plans.map((plan, index) => {
      const evidence = planEvidenceForSnapshot(plan, snapshot);
      return <article className="pm-cd-plan pm-dossier-plan" key={plan.id || `${plan.name}-${index}`}>
        <div className="pm-cd-plan-heading"><div><span className="pm-cd-plan-kind">{plan.kind === "subscription" ? "Подписка" : "Пакет единиц"}</span><h4>{display(plan.name)}</h4></div><strong>{competitorPrice(plan)}</strong></div>
        <dl className="pm-cd-facts">
          <div><dt>Канал покупки</dt><dd>{display(plan.purchaseChannel)}</dd></div>
          <div><dt>Валюта / регион</dt><dd>{display(plan.currency)} · {display(plan.region)}</dd></div>
          <div><dt>Период</dt><dd>{periodLabels[plan.period]}</dd></div>
          <div><dt>Номера / минуты</dt><dd>{display(plan.includedNumbers)} · {display(plan.includedMinutes)}</dd></div>
          <div><dt>Единицы / SMS</dt><dd>{display(plan.includedCredits)} · {display(plan.includedSms)}</dd></div>
          <div><dt>Дополнительная единица</dt><dd>{plan.includedUnits?.unit ? `${plan.includedUnits.amount === null ? "Количество не подтверждено" : plan.includedUnits.amount} ${unitLabels[plan.includedUnits.unit]}` : "Единица не указана"}</dd></div>
          <div><dt>Сверх лимита</dt><dd>{display(plan.overages)}</dd></div>
          <div className="pm-cd-wide"><dt>Ограничения</dt><dd>{display(plan.limitations)}</dd></div>
        </dl>
        <EvidenceMeta evidence={evidence} />
      </article>;
    })}</div> : <div className="pm-cd-empty">Тарифы не сохранены. Неизвестная цена не считается нулевой.</div>}
    {dossier.pricingNotes.length > 0 && <div className="pm-dossier-facts-grid">{dossier.pricingNotes.map((fact) => <AdditionalFactView key={fact.id} fact={fact} />)}</div>}
  </section>;
}
function CoverageSection({ snapshot, research, dossier }: { snapshot: CompetitorSnapshot; research: CompetitorResearch; dossier: CompetitorDossier }) {
  return <section className="pm-dossier-section">
    <div className="pm-dossier-heading"><span>03</span><h3>{dossierSections[2]}</h3></div>
    <p className="pm-dossier-caution">Назначения звонков, доступность сервиса, телефонные номера и география клиентов — разные факты. Доступные страны звонков не подтверждают страны регистрации сервиса; пустые сведения не означают отсутствия покрытия.</p>
    <div className="pm-dossier-facts-grid">
      <LegacyFact label="Сохранённое описание географии · не подтверждает присутствие клиентов" value={snapshot.offer.regions} snapshot={snapshot} />
      <LegacyFact label="Сохранённое описание номеров" value={snapshot.offer.numbers} snapshot={snapshot} />
    </div>
    <div className="pm-dossier-coverage-facts">
      <h4>Направления звонков · отдельные данные</h4>
      {dossier.coverageFacts.length > 0 ? <div className="pm-dossier-facts-grid">{dossier.coverageFacts.map((fact) => <AdditionalFactView key={fact.id} fact={fact} />)}</div>
        : <div className="pm-cd-empty">Факты о направлениях звонков не внесены; это не подтверждает и не опровергает географию сервиса.</div>}
    </div>
    <CompetitorResearchCoverage research={research} showHeading={false} />
  </section>;
}
function TechnicalSection({ dossier }: { dossier: CompetitorDossier }) {
  return <section className="pm-dossier-section">
    <div className="pm-dossier-heading"><span>04</span><h3>{dossierSections[3]}</h3></div>
    {dossier.technical.length ? <div className="pm-dossier-technical-list">{dossier.technical.map((item) => <article className="pm-dossier-fact" key={item.id}>
      <div className="pm-dossier-tech-head"><strong>{layerLabels[item.layer]}</strong><span>{scopeLabels[item.scope]}</span></div>
      <p>{display(item.tool)} · поставщик: {item.provider === null ? "Не подтверждено" : display(item.provider)}</p><EvidenceMeta evidence={item.evidence} />
    </article>)}</div> : <div className="pm-cd-empty">Точные технические компоненты не подтверждены.</div>}
  </section>;
}
function FundingSection({ dossier }: { dossier: CompetitorDossier }) {
  return <section className="pm-dossier-section">
    <div className="pm-dossier-heading"><span>05</span><h3>{dossierSections[4]}</h3></div>
    {dossier.funding.length ? <div className="pm-dossier-technical-list">{dossier.funding.map((item) => <article className="pm-dossier-fact" key={item.id}>
      <strong>{display(item.round)}</strong>
      <p>Инвесторы: {display(item.investors)}</p>
      <p>Дата объявления: {dateLabel(item.announcedAt)}</p>
      <p>Сумма: {item.amount === null ? "Не подтверждено" : `${item.amount.toLocaleString("ru-RU")} ${display(item.currency)}`}</p>
      <EvidenceMeta evidence={item.evidence} />
    </article>)}</div> : <div className="pm-cd-empty">Раунды, инвесторы и суммы не подтверждены. Это не означает отсутствия инвестиций.</div>}
  </section>;
}
function ScaleSection({ dossier, research }: { dossier: CompetitorDossier; research: CompetitorResearch }) {
  return <section className="pm-dossier-section">
    <div className="pm-dossier-heading"><span>06</span><h3>{dossierSections[5]}</h3></div>
    <div className="pm-dossier-facts-grid">{Object.entries(scaleFields).map(([key, label]) =>
      <DossierFactView key={key} label={label} fact={dossier.scale[key as keyof typeof scaleFields]} />)}</div>
    <div className="pm-dossier-revenue-method">
      <strong>Тип выручки: {revenueLabels[dossier.revenueKind]}</strong>
      <p>Выручка показывается только как отдельное сохранённое значение. Загрузки не умножаются на цену.</p>
      {dossier.revenueAssumptions && <p>Допущения: {dossier.revenueAssumptions}</p>}
    </div>
    <CompetitorResearchScale research={research} />
  </section>;
}

export function CompetitorDossierView({ snapshot, research }: { snapshot: CompetitorSnapshot; research: CompetitorResearch }) {
  const dossier = dossierFor(snapshot);
  const conclusionAt = snapshot.limitations.indexOf("СТРАТЕГИЧЕСКИЙ ВЫВОД");
  return <div className="pm-dossier">
    <ProposalSection snapshot={snapshot} dossier={dossier} research={research} />
    <PricesSection snapshot={snapshot} dossier={dossier} />
    <CoverageSection snapshot={snapshot} research={research} dossier={dossier} />
    <TechnicalSection dossier={dossier} />
    <FundingSection dossier={dossier} />
    <ScaleSection dossier={dossier} research={research} />
    {conclusionAt >= 0 && <section className="pm-dossier-section" aria-label="Стратегический вывод">
      <h3>Стратегический вывод</h3>
      <p className="pm-dossier-caution">Наша интерпретация опубликованных данных, не результат живого теста и не утверждение разработчика.</p>
      <p>{snapshot.limitations.slice(conclusionAt)}</p>
    </section>}
  </div>;
}

function blankFact(): DossierFact { return { value: null, evidence: unknownResearchEvidence() }; }
function patchAdditional(
  facts: AdditionalDossierFact[],
  index: number,
  updates: Partial<AdditionalDossierFact>,
  setFacts: (facts: AdditionalDossierFact[]) => void,
) {
  setFacts(facts.map((fact, factIndex) => factIndex === index ? { ...fact, ...updates } : fact));
}
function DossierFactEditor({ label, fact, onChange }: { label: string; fact: DossierFact; onChange: (fact: DossierFact) => void }) {
  return <article className="pm-dossier-edit-card">
    <label>{label}<input value={fact.value ?? ""} onChange={(event) => onChange({ ...fact, value: event.target.value === "" ? null : event.target.value })} /></label>
    <ResearchEvidenceEditor label="Доказательство этого факта" evidence={fact.evidence} onChange={(evidence) => onChange({ ...fact, evidence })} />
  </article>;
}
function newAdditional(title = ""): AdditionalDossierFact {
  return { id: `dossier-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, title, ...blankFact() };
}

export function CompetitorDossierEditor({ dossier, onChange }: { dossier: CompetitorDossier; onChange: (dossier: CompetitorDossier) => void }) {
  const patch = (updates: Partial<CompetitorDossier>) => onChange({ ...dossier, ...updates });
  const updateAvatar = (key: keyof typeof avatarFields, fact: DossierFact) => patch({ avatar: { ...dossier.avatar, [key]: fact } });
  const updateScale = (key: keyof typeof scaleFields, fact: DossierFact) => patch({ scale: { ...dossier.scale, [key]: fact } });
  return <div className="pm-dossier-editor">
    <section className="pm-dossier-edit-section"><div className="pm-dossier-heading"><span>01</span><h4>{dossierSections[0]}</h4></div>
      <div className="pm-dossier-edit-list">{dossier.offerFacts.map((fact, index) => <article className="pm-dossier-edit-card" key={fact.id}>
        <div className="pm-dossier-edit-head"><strong>Дополнительный факт {index + 1}</strong><button className="pm-btn small danger" type="button" onClick={() => patch({ offerFacts: dossier.offerFacts.filter((_, itemIndex) => itemIndex !== index) })}>Удалить</button></div>
        <label>Название<input value={fact.title} onChange={(event) => patchAdditional(dossier.offerFacts, index, { title: event.target.value }, (offerFacts) => patch({ offerFacts }))} /></label>
        <DossierFactEditor label="Значение" fact={fact} onChange={(value) => patchAdditional(dossier.offerFacts, index, value, (offerFacts) => patch({ offerFacts }))} />
      </article>)}</div>
      <button className="pm-btn small" type="button" onClick={() => patch({ offerFacts: [...dossier.offerFacts, newAdditional()] })}>Добавить факт предложения</button>
      <div className="pm-dossier-editor-subhead"><h5>Аватар и присутствие</h5><p>Не трактуйте app icon, декоративные круги, demo video или video dubbing lip-sync как подтверждение живого аватара в чате.</p></div>
      <div className="pm-dossier-edit-list">{Object.entries(avatarFields).map(([key, label]) => <DossierFactEditor key={key} label={label} fact={dossier.avatar[key as keyof typeof avatarFields] ?? blankFact()} onChange={(fact) => updateAvatar(key as keyof typeof avatarFields, fact)} />)}</div>
    </section>

    <section className="pm-dossier-edit-section"><div className="pm-dossier-heading"><span>02</span><h4>{dossierSections[1]}</h4></div>
      <div className="pm-dossier-edit-list">{dossier.pricingNotes.map((fact, index) => <article className="pm-dossier-edit-card" key={fact.id}>
        <div className="pm-dossier-edit-head"><strong>Дополнительная заметка {index + 1}</strong><button className="pm-btn small danger" type="button" onClick={() => patch({ pricingNotes: dossier.pricingNotes.filter((_, itemIndex) => itemIndex !== index) })}>Удалить</button></div>
        <label>Название<input value={fact.title} onChange={(event) => patchAdditional(dossier.pricingNotes, index, { title: event.target.value }, (pricingNotes) => patch({ pricingNotes }))} /></label>
        <DossierFactEditor label="Значение" fact={fact} onChange={(value) => patchAdditional(dossier.pricingNotes, index, value, (pricingNotes) => patch({ pricingNotes }))} />
      </article>)}</div>
      <button className="pm-btn small" type="button" onClick={() => patch({ pricingNotes: [...dossier.pricingNotes, newAdditional()] })}>Добавить заметку о цене</button>
    </section>

    <section className="pm-dossier-edit-section"><div className="pm-dossier-heading"><span>03</span><h4>{dossierSections[2]}</h4></div>
      <p className="pm-dossier-caution">Сохраняйте факты о направлениях звонков отдельно от географии сервиса, доступности телефонных номеров и клиентов. Сайт/App Store не подтверждает страны регистрации сервиса или географию клиентов.</p>
      <div className="pm-dossier-edit-list">{dossier.coverageFacts.map((fact, index) => <article className="pm-dossier-edit-card" key={fact.id}>
        <div className="pm-dossier-edit-head"><strong>Факт покрытия {index + 1}</strong><button className="pm-btn small danger" type="button" onClick={() => patch({ coverageFacts: dossier.coverageFacts.filter((_, itemIndex) => itemIndex !== index) })}>Удалить</button></div>
        <label>Название<input value={fact.title} onChange={(event) => patchAdditional(dossier.coverageFacts, index, { title: event.target.value }, (coverageFacts) => patch({ coverageFacts }))} /></label>
        <DossierFactEditor label="Значение" fact={fact} onChange={(value) => patchAdditional(dossier.coverageFacts, index, value, (coverageFacts) => patch({ coverageFacts }))} />
      </article>)}</div>
      <button className="pm-btn small" type="button" onClick={() => patch({ coverageFacts: [...dossier.coverageFacts, newAdditional()] })}>Добавить факт покрытия</button>
    </section>

    <section className="pm-dossier-edit-section"><div className="pm-dossier-heading"><span>04</span><h4>{dossierSections[3]}</h4></div>
      <div className="pm-dossier-edit-list">{dossier.technical.map((item, index) => <article className="pm-dossier-edit-card" key={item.id}>
        <div className="pm-dossier-edit-head"><strong>Компонент {index + 1}</strong><button className="pm-btn small danger" type="button" onClick={() => patch({ technical: dossier.technical.filter((row) => row.id !== item.id) })}>Удалить</button></div>
        <div className="pm-dossier-edit-grid">
          <label>Слой<select value={item.layer} onChange={(event) => patch({ technical: dossier.technical.map((row) => row.id === item.id ? { ...row, layer: event.target.value as typeof item.layer } : row) })}>{Object.entries(layerLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label>Область<select value={item.scope} onChange={(event) => patch({ technical: dossier.technical.map((row) => row.id === item.id ? { ...row, scope: event.target.value as typeof item.scope } : row) })}>{Object.entries(scopeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label>Инструмент<input value={item.tool} onChange={(event) => patch({ technical: dossier.technical.map((row) => row.id === item.id ? { ...row, tool: event.target.value } : row) })} /></label>
          <label>Поставщик<input value={item.provider ?? ""} onChange={(event) => patch({ technical: dossier.technical.map((row) => row.id === item.id ? { ...row, provider: event.target.value || null } : row) })} /></label>
        </div>
        <ResearchEvidenceEditor label="Источник, дата и статус компонента" evidence={item.evidence} onChange={(evidence) => patch({ technical: dossier.technical.map((row) => row.id === item.id ? { ...row, evidence } : row) })} />
      </article>)}</div>
      <button className="pm-btn small" type="button" onClick={() => patch({ technical: [...dossier.technical, { id: `tech-${Date.now()}-${dossier.technical.length}`, layer: "technology", scope: "platform", tool: "", provider: null, evidence: unknownResearchEvidence() }] })}>Добавить технический факт</button>
    </section>

    <section className="pm-dossier-edit-section"><div className="pm-dossier-heading"><span>05</span><h4>{dossierSections[4]}</h4></div>
      <div className="pm-dossier-edit-list">{dossier.funding.map((item, index) => <article className="pm-dossier-edit-card" key={item.id}>
        <div className="pm-dossier-edit-head"><strong>Раунд {index + 1}</strong><button className="pm-btn small danger" type="button" onClick={() => patch({ funding: dossier.funding.filter((row) => row.id !== item.id) })}>Удалить</button></div>
        <div className="pm-dossier-edit-grid">
          <label>Раунд<input value={item.round} onChange={(event) => patch({ funding: dossier.funding.map((row) => row.id === item.id ? { ...row, round: event.target.value } : row) })} /></label>
          <label>Инвесторы<input value={item.investors} onChange={(event) => patch({ funding: dossier.funding.map((row) => row.id === item.id ? { ...row, investors: event.target.value } : row) })} /></label>
          <label>Дата объявления<input type="date" value={item.announcedAt?.slice(0, 10) ?? ""} onChange={(event) => patch({ funding: dossier.funding.map((row) => row.id === item.id ? { ...row, announcedAt: event.target.value || null } : row) })} /></label>
          <label>Сумма<input type="number" min="0" step="any" value={item.amount ?? ""} onChange={(event) => patch({ funding: dossier.funding.map((row) => row.id === item.id ? { ...row, amount: event.target.value === "" ? null : Number(event.target.value) } : row) })} /></label>
          <label>Валюта<input value={item.currency ?? ""} onChange={(event) => patch({ funding: dossier.funding.map((row) => row.id === item.id ? { ...row, currency: event.target.value || null } : row) })} /></label>
        </div>
        <ResearchEvidenceEditor label="Источник, дата и статус раунда" evidence={item.evidence} onChange={(evidence) => patch({ funding: dossier.funding.map((row) => row.id === item.id ? { ...row, evidence } : row) })} />
      </article>)}</div>
      <button className="pm-btn small" type="button" onClick={() => patch({ funding: [...dossier.funding, { id: `funding-${Date.now()}-${dossier.funding.length}`, round: "", investors: "", announcedAt: null, amount: null, currency: null, evidence: unknownResearchEvidence() }] })}>Добавить раунд</button>
    </section>

    <section className="pm-dossier-edit-section"><div className="pm-dossier-heading"><span>06</span><h4>{dossierSections[5]}</h4></div>
      <div className="pm-dossier-edit-list">{Object.entries(scaleFields).map(([key, label]) => <DossierFactEditor key={key} label={label} fact={dossier.scale[key as keyof typeof scaleFields] ?? blankFact()} onChange={(fact) => updateScale(key as keyof typeof scaleFields, fact)} />)}</div>
      <label>Тип выручки<select value={dossier.revenueKind} onChange={(event) => patch({ revenueKind: event.target.value as CompetitorDossier["revenueKind"] })}>{Object.entries(revenueLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label>Допущения сценария выручки<textarea value={dossier.revenueAssumptions} onChange={(event) => patch({ revenueAssumptions: event.target.value })} /></label>
      <p className="pm-dossier-caution">Не рассчитывать выручку как загрузки × цена. Сценарные значения должны оставаться помеченными как сценарий.</p>
    </section>
  </div>;
}
