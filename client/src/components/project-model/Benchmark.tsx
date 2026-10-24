import React, { useMemo } from "react";
import { ArrowUpRight, Beaker, ExternalLink, FileText, PencilLine } from "lucide-react";
import {
  benchmarkSteps,
  benchmarkSubjects,
  detailFields,
  type ModelElement,
  type ProjectModelState,
} from "@shared/projectModel";

type Props = {
  state: ProjectModelState;
  openElement: (element: ModelElement) => void;
};

const competitorIds = [
  { id: "COMP-JOBBER", subject: "jobber" },
  { id: "COMP-HOUSECALL-PRO", subject: "housecall-pro" },
  { id: "COMP-ZENMAID", subject: "zenmaid" },
] as const;

const profileFields = [
  "buyer", "segment", "solution", "procedure", "features", "aiVoiceChat",
  "callsBooking", "marketing", "billing", "analytics", "pricing", "comparison",
  "sourceDate", "researchDate", "recheckedAt", "provenance", "unknown",
] as const;

const proofLabels: Record<string, string> = {
  confirmed: "Подтверждено",
  hypothesis: "Гипотеза",
  unestablished: "Не установлено",
  "not-established": "Не установлено",
  not_established: "Не установлено",
  unknown: "Не установлено",
  practical_test: "Нужен практический тест",
  needs_practical_test: "Нужен практический тест",
  "needs-practical-test": "Нужен практический тест",
  practical_test_needed: "Нужен практический тест",
  "Подтверждено": "Подтверждено",
  "Гипотеза": "Гипотеза",
  "Не установлено": "Не установлено",
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
  const sourceUrls = (element.details.source ?? "")
    .split(/[\n,;]/)
    .map((value) => value.trim())
    .filter(Boolean);
  const documents = state.documents.filter((document) => document.elementIds.includes(element.id));
  if (!sourceUrls.length && !documents.length) return compact ? null : <p className="pm-benchmark-muted">Источники и связанные документы не указаны.</p>;

  return <div className="pm-benchmark-sources">
    {sourceUrls.map((raw, index) => {
      const href = usableUrl(raw);
      return href
        ? <a key={`${href}-${index}`} href={href} target="_blank" rel="noreferrer">{raw}<ExternalLink size={12} /></a>
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

export default function Benchmark({ state, openElement }: Props) {
  const elements = state.elements;
  const competitors = competitorIds.map(({ id, subject }) => ({
    id,
    subject,
    element: elements.find((element) => element.id === id),
  }));
  const selectedId = new URLSearchParams(window.location.search).get("element");
  const selected = competitors.find((item) => item.id === selectedId);
  const assessments = useMemo(
    () => elements.filter((element) => element.details.benchmarkType === "assessment"),
    [elements],
  );
  const marketNotes = elements.filter((element) =>
    element.details.benchmarkType === "market-note" && element.section === "Рынок и конкуренты",
  );
  const relatedIds = new Set([
    ...competitors.map(({ id }) => id),
    ...assessments.map(({ id }) => id),
    ...marketNotes.map(({ id }) => id),
  ]);
  const relatedRelations = state.relations.filter((relation) => relatedIds.has(relation.from) || relatedIds.has(relation.to));
  // Requirements are neighbors, not assessment records themselves.
  relatedRelations.forEach(relation => { relatedIds.add(relation.from); relatedIds.add(relation.to); });
  const relatedTasks = state.taskDrafts.filter((draft) => draft.elementIds.some((id) => relatedIds.has(id)));
  const subjectEntries = Object.entries(benchmarkSubjects) as [keyof typeof benchmarkSubjects, string][];
  const stepEntries = Object.entries(benchmarkSteps) as [keyof typeof benchmarkSteps, string][];

  function assessmentFor(subject: string, step: string) {
    return assessments.find((element) =>
      element.details.benchmarkSubject === subject && element.details.benchmarkStep === step,
    );
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

    {selected && selected.element && <section className="pm-benchmark-profile-focus" aria-label={`Профиль ${selected.element.title}`}>
      <div className="pm-benchmark-profile-top">
        <div><span className="pm-benchmark-id">{selected.id}</span><h3>{selected.element.title}</h3></div>
        <button className="pm-btn small" type="button" onClick={() => openElement(selected.element!)}><PencilLine size={13} /> Редактировать запись</button>
      </div>
      <p className="pm-benchmark-description">{selected.element.description || "Описание не заполнено."}</p>
      <dl className="pm-benchmark-profile-fields">{profileFields.map((key) => <div key={key}>
        <dt>{detailFields[key]}</dt><dd><Value value={selected.element!.details[key]} /></dd>
      </div>)}</dl>
      <div className="pm-benchmark-profile-source"><h4>Источники и материалы</h4><SourceLinks element={selected.element} state={state} /></div>
    </section>}

    <div className="pm-benchmark-card-grid">
      {competitors.map(({ id, subject, element }) => <article className="pm-benchmark-card" key={id}>
        <div className="pm-benchmark-card-head">
          <div><span className="pm-benchmark-id">{id}</span><h3>{element?.title ?? benchmarkSubjects[subject]}</h3></div>
          <span className="pm-benchmark-card-index">{String(competitors.findIndex((item) => item.id === id) + 1).padStart(2, "0")}</span>
        </div>
        {element ? <>
          <p>{element.description || "Описание не заполнено."}</p>
          <div className="pm-benchmark-card-meta">
            <span>{element.details.buyer || "Покупатель не указан"}</span>
            {element.details.recheckedAt && <span>Повторно прочитано: {element.details.recheckedAt}</span>}
          </div>
          <div className="pm-footer-actions">
            <a className="pm-btn small" href={`/admin/project-model?view=benchmark&element=${encodeURIComponent(id)}`}>Открыть профиль <ArrowUpRight size={12} /></a>
          </div>
          <details className="pm-benchmark-card-details">
            <summary>Показать профиль и источники</summary>
            <dl className="pm-benchmark-profile-fields">{profileFields.map((key) => <div key={key}>
              <dt>{detailFields[key]}</dt><dd><Value value={element.details[key]} /></dd>
            </div>)}</dl>
            <div className="pm-benchmark-profile-source"><h4>Источники и материалы</h4><SourceLinks element={element} state={state} /></div>
            <button className="pm-btn small" type="button" onClick={() => openElement(element)}><PencilLine size={12} /> Редактировать запись</button>
          </details>
        </> : <div className="pm-benchmark-card-empty">Запись с этим постоянным ID пока отсутствует в полученном состоянии.</div>}
      </article>)}
    </div>

    <section className="pm-benchmark-method">
      <div><span className="pm-benchmark-overline">МЕТОДИКА</span><h3>Сравниваем сценарии, а не обещания</h3></div>
      <p>Матрица отражает только оценки, сохранённые в модели. Статус доказательства, ограничения и неизвестные показываются из записи; отсутствие оценки не трактуется как отсутствие функции. Практическая проверка для участников пока не зафиксирована.</p>
      <p className="pm-benchmark-vision"><strong>TalkHint:</strong> описание решения — предварительное видение продукта, не готовая или проверенная возможность.</p>
    </section>

    <div className="pm-benchmark-table-wrap">
      <table className="pm-benchmark-table">
        <thead><tr><th scope="col">Сценарий</th>{subjectEntries.map(([key, label]) => <th scope="col" key={key}>{label}</th>)}</tr></thead>
        <tbody>{stepEntries.map(([stepKey, stepLabel]) => <tr key={stepKey}>
          <th scope="row">{stepLabel}</th>
          {subjectEntries.map(([subjectKey]) => {
            const element = assessmentFor(subjectKey, stepKey);
            const status = element?.details.proofStatus;
            const statusText = status ? proofLabels[status] ?? status : "Не установлено";
            return <td key={subjectKey} data-subject={benchmarkSubjects[subjectKey]}>
              {element ? <div className="pm-benchmark-cell">
                <button type="button" className="pm-benchmark-cell-open" onClick={() => openElement(element)} aria-label={`Открыть оценку: ${stepLabel}, ${benchmarkSubjects[subjectKey]}`}>
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
