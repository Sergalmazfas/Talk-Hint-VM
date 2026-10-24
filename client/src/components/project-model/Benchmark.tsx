import React, { useMemo } from "react";
import { ArrowUpRight, Beaker, ExternalLink, FileText, PencilLine } from "lucide-react";
import {
  benchmarkSteps,
  benchmarkSubjects,
  detailFields,
  differenceBenchmarkSteps,
  pilotBenchmarkSteps,
  type ModelElement,
  type ProjectModelState,
} from "@shared/projectModel";

type Props = {
  state: ProjectModelState;
  openElement: (element: ModelElement) => void;
};

const knownSubjects: Record<string, string> = {
  "COMP-JOBBER": "jobber",
  "COMP-HOUSECALL-PRO": "housecall-pro",
  "COMP-ZENMAID": "zenmaid",
  "COMP-MASSAGEBOOK": "massagebook",
  "COMP-CLINICSENSE": "clinicsense",
};
const profileFields = [
  "buyer", "segment", "solution", "procedure", "features", "aiVoiceChat",
  "callsBooking", "marketing", "billing", "analytics", "pricing", "comparison",
  "contentEditing", "paidAdvertising", "attribution", "metrics", "convenience", "netIncome", "measurement",
  "competitorPriority", "prioritySegmentId", "decisionDate",
  "sourceDate", "researchDate", "recheckedAt", "provenance", "unknown",
] as const;
const proofLabels: Record<string, string> = {
  confirmed: "Подтверждено", hypothesis: "Гипотеза", unestablished: "Не установлено",
  "not-established": "Не установлено", not_established: "Не установлено", unknown: "Не установлено",
  practical_test: "Нужен практический тест", needs_practical_test: "Нужен практический тест",
  "needs-practical-test": "Нужен практический тест", practical_test_needed: "Нужен практический тест",
  "Подтверждено": "Подтверждено", "Гипотеза": "Гипотеза", "Не установлено": "Не установлено",
  "Нужен практический тест": "Нужен практический тест",
};

function usableUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function SourceLinks({ element, state, compact = false }: { element: ModelElement; state: ProjectModelState; compact?: boolean }) {
  const sourceUrls = (element.details.source ?? "").split(/[\n,;]/).map((value) => value.trim()).filter(Boolean);
  const documents = state.documents.filter((document) => document.elementIds.includes(element.id));
  if (!sourceUrls.length && !documents.length) return compact ? null : <p className="pm-benchmark-muted">Источники и связанные документы не указаны.</p>;
  return <div className="pm-benchmark-sources">
    {sourceUrls.map((raw, index) => {
      const href = usableUrl(raw);
      return href ? <a key={`${href}-${index}`} href={href} target="_blank" rel="noreferrer">{raw}<ExternalLink size={12} /></a>
        : <span className="pm-benchmark-source-text" key={`${raw}-${index}`}>{raw}</span>;
    })}
    {documents.map((document) => <div className="pm-benchmark-document" key={document.id}>
      <FileText size={13} />
      <div><strong>{document.title}</strong>{document.url && usableUrl(document.url)
        ? <a href={usableUrl(document.url)!} target="_blank" rel="noreferrer">{document.url}<ExternalLink size={11} /></a>
        : document.url && <span>{document.url}</span>}
      {document.text && <details><summary>Выдержка из документа</summary><p>{document.text}</p></details>}</div>
    </div>)}
  </div>;
}

function Value({ value }: { value?: string }) {
  return <p>{value?.trim() || <span className="pm-benchmark-muted">Не указано</span>}</p>;
}

function queryHref(updates: Record<string, string | null>) {
  const params = new URLSearchParams(window.location.search);
  params.set("view", "benchmark");
  Object.entries(updates).forEach(([key, value]) => value === null ? params.delete(key) : params.set(key, value));
  return `${window.location.pathname}?${params.toString()}`;
}

export default function Benchmark({ state, openElement }: Props) {
  const elements = state.elements;
  const competitors = useMemo(
    () => elements.filter((element) => element.details.benchmarkType === "competitor")
      .sort((a, b) => Number(b.details.competitorPriority === "primary-starting-segment") - Number(a.details.competitorPriority === "primary-starting-segment")),
    [elements],
  );
  const assessments = useMemo(
    () => elements.filter((element) => element.details.benchmarkType === "assessment"),
    [elements],
  );
  const marketNotes = elements.filter((element) =>
    element.details.benchmarkType === "market-note" && element.section === "Рынок и конкуренты",
  );
  const params = new URLSearchParams(window.location.search);
  const selectedId = params.get("element");
  const selected = competitors.find((element) => element.id === selectedId);
  const primaryOnly = params.get("filter") === "primary";
  const suite = params.get("suite") === "pilot" ? "pilot" : params.get("suite") === "difference" ? "difference" : "general";
  const pilotMethod = elements.find(element => element.id === "REQ-PILOT-COMPARE");
  const visibleCompetitors = primaryOnly
    ? competitors.filter((element) => element.details.competitorPriority === "primary-starting-segment" && element.details.prioritySegmentId === "TH-SEGMENT")
    : competitors;
  const relatedIds = new Set([...competitors.map(({ id }) => id), ...assessments.map(({ id }) => id), ...marketNotes.map(({ id }) => id)]);
  const relatedRelations = state.relations.filter((relation) => relatedIds.has(relation.from) || relatedIds.has(relation.to));
  relatedRelations.forEach((relation) => { relatedIds.add(relation.from); relatedIds.add(relation.to); });
  const relatedTasks = state.taskDrafts.filter((draft) => draft.elementIds.some((id) => relatedIds.has(id)));
  const suiteSteps = suite === "pilot" ? pilotBenchmarkSteps : suite === "difference" ? differenceBenchmarkSteps : benchmarkSteps;
  const steps = Object.entries(suiteSteps) as [string, string][];
  const suiteAssessments = assessments.filter((element) =>
    suite === "pilot" ? element.details.benchmarkSuite === "pilot"
      : suite === "difference" ? element.details.benchmarkSuite === "difference"
        : !element.details.benchmarkSuite || element.details.benchmarkSuite === "general",
  );
  const priceEvidence = elements.filter((element) => element.details.benchmarkType === "pricing-evidence" ||
    ["PRICE-MB-LAUNCH", "PRICE-MB-PRACTICE", "PRICE-MB-CLINIC", "PRICE-CS-LITE", "PRICE-CS-STANDARD", "PRICE-CS-PREMIUM"].includes(element.id));
  const subjects = useMemo(() => {
    const entries = new Map<string, string>();
    competitors.forEach((element) => {
      const subject = element.details.benchmarkSubject || knownSubjects[element.id] || element.id;
      entries.set(subject, (benchmarkSubjects as Record<string, string>)[subject] || element.title || subject);
    });
    suiteAssessments.forEach((element) => {
      const subject = element.details.benchmarkSubject;
      if (subject && subject !== "talkhint" && !entries.has(subject)) {
        entries.set(subject, (benchmarkSubjects as Record<string, string>)[subject] || subject);
      }
    });
    return Array.from(entries.entries());
  }, [competitors, suiteAssessments]);
  const columns = [["talkhint", benchmarkSubjects.talkhint] as [string, string], ...subjects.filter(([key]) => {
    const matchingCompetitors = competitors.filter((element) =>
      (element.details.benchmarkSubject || knownSubjects[element.id] || element.id) === key,
    );
    return !primaryOnly || matchingCompetitors.some((element) =>
      element.details.competitorPriority === "primary-starting-segment" && element.details.prioritySegmentId === "TH-SEGMENT",
    );
  })];

  function assessmentFor(subject: string, step: string) {
    return suiteAssessments.find((element) =>
      element.details.benchmarkSubject === subject && element.details.benchmarkStep === step,
    );
  }
  function profileFieldsFor(element: ModelElement) {
    return <dl className="pm-benchmark-profile-fields">{profileFields.map((key) => <div key={key}>
      <dt>{detailFields[key]}</dt><dd><Value value={element.details[key]} /></dd>
    </div>)}</dl>;
  }

  return <section className="pm-benchmark" aria-label="Конкурентный бенчмаркинг">
    <div className="pm-benchmark-heading">
      <div>
        <p className="pm-kicker">MARKET / EVIDENCE REGISTER</p>
        <h2>Конкурентный бенчмаркинг</h2>
        <p>Сравнение по сохранённым узлам модели. Пустая ячейка означает, что вывод пока не установлен.</p>
      </div>
      <span className="pm-benchmark-caution"><Beaker size={14} /> Практические тесты не проводились</span>
    </div>

    <div className="pm-benchmark-controls">
      <div className="pm-benchmark-control-group" aria-label="Фильтр конкурентов">
        <a className={`pm-btn small ${!primaryOnly ? "primary" : ""}`} href={queryHref({ filter: null })}>Все конкуренты</a>
        <a className={`pm-btn small ${primaryOnly ? "primary" : ""}`} href={queryHref({ filter: "primary" })}>Основные конкуренты сегмента</a>
      </div>
      <div className="pm-benchmark-control-group" aria-label="Набор сценариев">
        <a className={`pm-btn small ${suite === "general" ? "primary" : ""}`} href={queryHref({ suite: null })}>Общие сценарии</a>
        <a className={`pm-btn small ${suite === "pilot" ? "primary" : ""}`} href={queryHref({ suite: "pilot" })}>Пилотный сценарий</a>
        <a className={`pm-btn small ${suite === "difference" ? "primary" : ""}`} href={queryHref({ suite: "difference" })}>Отличие и две оси</a>
      </div>
    </div>

    {suite === "pilot" && pilotMethod && <section className="pm-benchmark-note" aria-label="Методика замеров пилота">
      <div><strong>Методика пилота</strong><p>{pilotMethod.description}</p>
        <p>{pilotMethod.details.unknown}</p>
        <p>{pilotMethod.details.practicalTest}</p></div>
    </section>}
    {suite === "difference" && <section className="pm-benchmark-note pm-difference-method" aria-label="Ограничения сравнения отличий">
      <div><strong>Качественная матрица гипотез</strong><p>Пустые оценки не означают отсутствия функции. Удобство и влияние на доход после расходов не измерены; у TalkHint показан только желаемый замысел, не результат.</p></div>
      <a className="pm-btn small" href="/admin/project-model?view=difference">Вернуться к карте двух осей</a>
    </section>}

    {selected && <section className="pm-benchmark-profile-focus" aria-label={`Профиль ${selected.title}`}>
      <div className="pm-benchmark-profile-top">
        <div><span className="pm-benchmark-id">{selected.id}</span><h3>{selected.title}</h3>
          {selected.details.competitorPriority === "primary-starting-segment" && selected.details.prioritySegmentId === "TH-SEGMENT" &&
            <span className="pm-benchmark-primary-badge">Основной конкурент стартового сегмента</span>}
        </div>
        <button className="pm-btn small" type="button" onClick={() => openElement(selected)}><PencilLine size={13} /> Редактировать запись</button>
      </div>
      <p className="pm-benchmark-description">{selected.description || "Описание не заполнено."}</p>
      {profileFieldsFor(selected)}
      <div className="pm-benchmark-profile-source"><h4>Источники и материалы</h4><SourceLinks element={selected} state={state} /></div>
    </section>}

    <div className="pm-benchmark-card-grid">
      {visibleCompetitors.map((element, index) => <article className="pm-benchmark-card" key={element.id}>
        <div className="pm-benchmark-card-head">
          <div><span className="pm-benchmark-id">{element.id}</span><h3>{element.title}</h3>
            {element.details.competitorPriority === "primary-starting-segment" && element.details.prioritySegmentId === "TH-SEGMENT" &&
              <span className="pm-benchmark-primary-badge">Основной конкурент стартового сегмента</span>}
          </div>
          <span className="pm-benchmark-card-index">{String(index + 1).padStart(2, "0")}</span>
        </div>
        <p>{element.description || "Описание не заполнено."}</p>
        <div className="pm-benchmark-card-meta">
          <span>{element.details.buyer || "Покупатель не указан"}</span>
          {element.details.recheckedAt && <span>Повторно прочитано: {element.details.recheckedAt}</span>}
        </div>
        <div className="pm-footer-actions">
          <a className="pm-btn small" href={queryHref({ element: element.id })}>Открыть профиль <ArrowUpRight size={12} /></a>
        </div>
        <details className="pm-benchmark-card-details">
          <summary>Показать профиль и источники</summary>
          {profileFieldsFor(element)}
          <div className="pm-benchmark-profile-source"><h4>Источники и материалы</h4><SourceLinks element={element} state={state} /></div>
          <button className="pm-btn small" type="button" onClick={() => openElement(element)}><PencilLine size={12} /> Редактировать запись</button>
        </details>
      </article>)}
      {!visibleCompetitors.length && <div className="pm-empty pm-benchmark-empty"><strong>Нет сохранённых конкурентов для этого фильтра</strong>Фильтр опирается только на записи модели с приоритетом и сегментом TH-SEGMENT.</div>}
    </div>

    {priceEvidence.length > 0 && <section className="pm-benchmark-related pm-pricing-evidence">
      <div className="pm-section-list-head"><div><h3>Сохранённые наблюдения цен</h3><span className="pm-help">Исторические значения и повторная проверка остаются раздельными в исходных записях.</span></div></div>
      <div className="pm-pricing-grid">{priceEvidence.map((item) => <article className="pm-pricing-card" key={item.id}>
        <div><span className="pm-benchmark-id">{item.id}</span><h4>{item.title}</h4><p>{item.description || item.details.evidence || "Описание наблюдения не заполнено."}</p></div>
        <div className="pm-pricing-values">{item.details.pricing && <div><b>Цена / тариф</b><span>{item.details.pricing}</span></div>}{item.details.limitations && <div><b>Ограничения</b><span>{item.details.limitations}</span></div>}{item.details.evidence && <div><b>Основание</b><span>{item.details.evidence}</span></div>}</div>
        <button type="button" className="pm-btn small" onClick={() => openElement(item)}><PencilLine size={12} /> Открыть запись</button>
      </article>)}</div>
    </section>}

    <section className="pm-benchmark-method">
      <div><span className="pm-benchmark-overline">МЕТОДИКА</span><h3>Сравниваем сценарии, а не обещания</h3></div>
      <p>Матрица отражает только оценки, сохранённые в модели. Статус доказательства, ограничения и неизвестные показываются из записи; отсутствие оценки не трактуется как отсутствие функции. Практическая проверка для участников пока не зафиксирована.</p>
      <p className="pm-benchmark-vision"><strong>TalkHint:</strong> описание решения — предварительное видение продукта, не готовая или проверенная возможность.</p>
    </section>

    <div className="pm-benchmark-table-wrap">
      <table className="pm-benchmark-table">
        <thead><tr><th scope="col">Сценарий</th>{columns.map(([key, label]) => <th scope="col" key={key}>{label}</th>)}</tr></thead>
        <tbody>{steps.map(([stepKey, stepLabel]) => <tr key={stepKey}>
          <th scope="row">{stepLabel}</th>
          {columns.map(([subjectKey, subjectLabel]) => {
            const element = assessmentFor(subjectKey, stepKey);
            const status = element?.details.proofStatus;
            const statusText = status ? proofLabels[status] ?? status : "Не установлено";
            return <td key={subjectKey} data-subject={subjectLabel}>
              {element ? <div className="pm-benchmark-cell">
                <button type="button" className="pm-benchmark-cell-open" onClick={() => openElement(element)} aria-label={`Открыть оценку: ${stepLabel}, ${subjectLabel}`}>
                  <span className={`pm-benchmark-proof ${statusText === "Подтверждено" ? "is-confirmed" : statusText === "Гипотеза" ? "is-hypothesis" : ""}`}>{statusText}</span>
                  <span className="pm-benchmark-cell-description">{element.description || "Описание не заполнено."}</span>
                  {element.details.solution && <span><b>Решение / видение:</b> {element.details.solution}</span>}
                  {element.details.limitations && <span><b>Ограничения:</b> {element.details.limitations}</span>}
                  {element.details.practicalTest && <span><b>Практическая проверка:</b> {element.details.practicalTest}</span>}
                  {element.details.unknown && <span><b>Неизвестное:</b> {element.details.unknown}</span>}
                  <span className="pm-benchmark-edit-hint">Открыть оценку <PencilLine size={11} /></span>
                </button>
                <SourceLinks element={element} state={state} compact />
              </div> : <div className="pm-benchmark-unset"><span>Не установлено</span><small>Оценка не сохранена</small></div>}
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>

    <section className="pm-benchmark-related">
      <div className="pm-section-list-head"><div><h3>Предварительные заметки о рынке</h3><span className="pm-help">Отдельные записи модели; не оценка TAM и не итоговый размер рынка.</span></div></div>
      {marketNotes.length ? <div className="pm-list">{marketNotes.map((note) => <article className="pm-benchmark-note" key={note.id}>
        <div><span className="pm-benchmark-id">{note.id}</span><h4>{note.title}</h4><p>{note.description || "Описание не заполнено."}</p></div>
        <button className="pm-btn small" type="button" onClick={() => openElement(note)}>Открыть заметку</button>
      </article>)}</div> : <div className="pm-empty"><strong>Предварительных заметок пока нет</strong>Заметки появятся здесь после сохранения записей типа market-note.</div>}
    </section>

    {(relatedRelations.length > 0 || relatedTasks.length > 0) && <section className="pm-benchmark-related">
      <div className="pm-section-list-head"><h3>Связанные узлы и задания</h3></div>
      {relatedRelations.length > 0 && <div className="pm-benchmark-related-group"><strong>Связи модели</strong>{relatedRelations.map((relation) => {
        const from = elements.find((element) => element.id === relation.from);
        const to = elements.find((element) => element.id === relation.to);
        return <div className="pm-benchmark-related-row" key={relation.id}>
          {from && <button type="button" onClick={() => openElement(from)}>{from.title}</button>}<span>{relation.label}</span>{to && <button type="button" onClick={() => openElement(to)}>{to.title}</button>}
        </div>;
      })}</div>}
      {relatedTasks.length > 0 && <div className="pm-benchmark-related-group"><strong>Черновики заданий</strong>{relatedTasks.map((task) => <article className="pm-benchmark-task" key={task.id}>
        <h4>{task.title}</h4><p>{task.acceptance || task.text}</p><span>{task.elementIds.filter((id) => relatedIds.has(id)).map((id) => elements.find((element) => element.id === id)?.title ?? id).join(" · ")}</span>
      </article>)}</div>}
    </section>}
  </section>;
}
