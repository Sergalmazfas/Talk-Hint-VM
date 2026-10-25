import React from "react";
import {
  contentStatuses,
  detailFields,
  implementationStatuses,
  projectPackageBlocks,
  type ModelElement,
  type ProjectModelState,
} from "@shared/projectModel";

type Props = {
  state: ProjectModelState;
  view: string;
  openElement: (element: ModelElement) => void;
};

const viewNodeIds: Record<string, string[]> = {
  segment: ["TH-SEGMENT", "TH-CLIENT", "TH-PROBLEM", "TH-PILOT-VALUE"],
  market: ["TH-SAM-SOM", "TH-TAM", "TH-SAM", "TH-SOM", "TH-ECONOMICS"],
  difference: ["TH-DIFFERENTIATION", "TH-POSITIONING", "TH-CONTENT-PIPELINE", "TH-VALIDATION"],
};
const detailKeysByView: Record<string, (keyof typeof detailFields)[]> = {
  segment: ["client", "buyer", "user", "beneficiary", "segment", "problem", "trigger", "whyNow", "alternatives", "solution", "businessModel", "economics", "failure", "acquisition", "evidence", "unknown"],
  market: ["tamFormula", "samFormula", "somFormula", "monetaryScenario", "region", "comparability", "inputs", "resources", "rules", "economics", "unknown", "evidence", "metrics"],
  difference: ["differentiation", "contentEditing", "paidAdvertising", "attribution", "convenience", "netIncome", "positionIntent", "measurement", "rules", "aiAllowed", "humanHandoff", "unknown", "evidence", "metrics"],
};
type CuratedDetailKey = keyof typeof detailFields | "consent";
type DescriptionBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "table"; headers: string[]; rows: string[][] };
const differenceConsentKey: CuratedDetailKey = "consent";
const confidenceLabel = (element: ModelElement) =>
  element.contentStatus === "confirmed" ? "Согласовано"
    : element.contentStatus === "hypothesis" ? "Гипотеза" : "Требует исследования";
const selectedHypothesisId = (state: ProjectModelState) =>
  state.hypothesisContext?.selectedId ||
  (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("hypothesis") : null) ||
  undefined;
const safeUrl = (raw: string, hypothesisId?: string) => {
  const trimmed = raw.trim();
  if (trimmed.startsWith("/admin/project-model?") && !trimmed.startsWith("//") && !trimmed.includes("\n")) {
    const url = new URL(trimmed, "http://project-model.local");
    if (hypothesisId) url.searchParams.set("hypothesis", hypothesisId);
    return `${url.pathname}${url.search}${url.hash}`;
  }
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
};
const dateLabel = (raw: string) => {
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleDateString("ru-RU", { dateStyle: "medium" });
};
const projectRoute = (query: string, hypothesisId?: string) => {
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  if (hypothesisId) params.set("hypothesis", hypothesisId);
  return `/admin/project-model?${params.toString()}`;
};

function markdownCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableSeparator(line: string, columnCount: number): boolean {
  const cells = markdownCells(line);
  return cells.length === columnCount && cells.length > 1 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseDescription(raw: string): { blocks: DescriptionBlock[]; lead: string; hasTables: boolean } {
  const lines = raw.split(/\r?\n/);
  const blocks: DescriptionBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const header = markdownCells(lines[index]);
    const separator = lines[index + 1];
    if (lines[index].includes("|") && separator && isTableSeparator(separator, header.length)) {
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|")) {
        const candidate = markdownCells(lines[index]);
        if (isTableSeparator(lines[index], header.length)) {
          index += 1;
          continue;
        }
        if (candidate.length === header.length) rows.push(candidate);
        index += 1;
      }
      blocks.push({ type: "table", headers: header, rows });
      continue;
    }

    const line = lines[index].trim();
    index += 1;
    if (!line) continue;
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      blocks.push({ type: "heading", text: heading[1] });
      continue;
    }
    const paragraph = [line];
    while (index < lines.length && lines[index].trim() && !/^#{1,6}\s+/.test(lines[index].trim())) {
      const nextHeader = markdownCells(lines[index]);
      const nextSeparator = lines[index + 1];
      if (lines[index].includes("|") && nextSeparator && isTableSeparator(nextSeparator, nextHeader.length)) break;
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
  }
  const firstTable = blocks.findIndex((block) => block.type === "table");
  const lead = (firstTable < 0 ? blocks : blocks.slice(0, firstTable))
    .flatMap((block) => block.type === "table" ? [] : [block.text])
    .join(" ");
  return { blocks, lead, hasTables: firstTable >= 0 };
}

function DescriptionContent({ blocks }: { blocks: DescriptionBlock[] }) {
  return <div className="pm-package-description">
    {blocks.map((block, index) => {
      if (block.type === "heading") return <h4 key={`heading-${index}`}>{block.text}</h4>;
      if (block.type === "paragraph") return <p key={`paragraph-${index}`}>{block.text}</p>;
      return <div className="pm-package-table-wrap" key={`table-${index}`}>
        <table>
          <thead><tr>{block.headers.map((header, cellIndex) => <th scope="col" key={`head-${cellIndex}`}>{header}</th>)}</tr></thead>
          <tbody>{block.rows.map((row, rowIndex) => <tr key={`row-${rowIndex}`}>
            {row.map((cell, cellIndex) => <td key={`cell-${cellIndex}`}>{cell}</td>)}
          </tr>)}</tbody>
        </table>
      </div>;
    })}
  </div>;
}

function EvidenceLinks({ element, state, openElement }: { element: ModelElement; state: ProjectModelState; openElement: (element: ModelElement) => void }) {
  const hypothesisId = selectedHypothesisId(state);
  const sources = (element.details.source ?? "").split(/[\n,;]/).map((value) => value.trim()).filter(Boolean);
  const documents = state.documents.filter((document) => document.elementIds.includes(element.id));
  const relations = state.relations.filter((relation) => relation.from === element.id || relation.to === element.id);
  if (!sources.length && !documents.length && !relations.length) return null;
  return <div className="pm-node-evidence">
    {sources.map((source, index) => {
      const href = safeUrl(source, hypothesisId);
      return href ? <a key={`${source}-${index}`} href={href} target="_blank" rel="noreferrer">Источник: {source}</a>
        : <span key={`${source}-${index}`}>Источник: {source}</span>;
    })}
    {documents.map((document) => {
      const href = safeUrl(document.url, hypothesisId);
      return <div className="pm-curated-document" key={document.id}>
        <span>Документ: {href
          ? <a href={href} target={href.startsWith("/admin/") ? undefined : "_blank"} rel={href.startsWith("/admin/") ? undefined : "noreferrer"}>{document.title}</a>
          : document.title}{document.updatedAt && ` · ${dateLabel(document.updatedAt)}`}</span>
        {document.text && <details><summary>Текст документа</summary><p>{document.text}</p></details>}
      </div>;
    })}
    {relations.map((relation) => {
      const otherId = relation.from === element.id ? relation.to : relation.from;
      const other = state.elements.find((item) => item.id === otherId);
      return <span className="pm-node-relation" key={relation.id}>
        Связь: {relation.label} · {other ? <button type="button" onClick={() => openElement(other)}>{other.title}</button> : otherId}
      </span>;
    })}
  </div>;
}

export default function PackageViews({ state, view, openElement }: Props) {
  const hypothesisId = selectedHypothesisId(state);
  const talkhint = state.elements.filter((element) => element.scope === "talkhint");
  const packageElements = projectPackageBlocks.map((block) => ({
    block,
    element: talkhint.find((element) => element.id === block.id),
  }));
  const viewNodes = (viewNodeIds[view] ?? []).map((id) => talkhint.find((element) => element.id === id))
    .filter((element): element is ModelElement => !!element);
  const position = talkhint.find((element) => element.id === "TH-POSITIONING");
  const pipeline = talkhint.find((element) => element.id === "TH-CONTENT-PIPELINE");
  const pipelineText = pipeline?.details.procedure?.trim() || pipeline?.description?.trim() || "";
  const primaryCompetitors = state.elements.filter((element) =>
    element.scope === "talkhint" && element.details.benchmarkType === "competitor" &&
    element.details.competitorPriority === "primary-starting-segment" &&
    element.details.prioritySegmentId === "TH-SEGMENT",
  );

  if (view === "overview") return <section className="pm-package-overview" aria-label="Краткий пакет проекта">
    <div className="pm-package-intro">
      <div><p className="pm-kicker">OWNER RESEARCH / PROJECT BRIEF</p><h2>Десять блоков, одна рабочая версия</h2><p>Краткие ответы берутся из текущих узлов модели. Раскройте блок для основания, даты и источников.</p></div>
      <span className="pm-package-count">{packageElements.filter(({ element }) => !!element?.description.trim()).length}<small>/ 10 заполнено</small></span>
    </div>
    <div className="pm-package-blocks">{packageElements.map(({ block, element }, index) => {
      const documents = element ? state.documents.filter((document) => document.elementIds.includes(element.id)) : [];
      const description = element ? parseDescription(element.description) : null;
      const blockView = "view" in block ? block.view : undefined;
      const route = blockView === "benchmark" ? projectRoute("view=benchmark&suite=pilot&filter=primary", hypothesisId)
        : blockView ? projectRoute(`view=${blockView}`, hypothesisId)
          : projectRoute(`view=overview&element=${encodeURIComponent(block.id)}`, hypothesisId);
      const sources = (element?.details.source ?? "").split(/[\n,;]/).map((value) => value.trim()).filter(Boolean);
      return <details className="pm-package-block" key={block.id} open={description?.hasTables || undefined}>
        <summary>
          <span className="pm-package-number">{String(index + 1).padStart(2, "0")}</span>
           <span className="pm-package-block-main"><strong>{block.title}</strong><small>{description?.hasTables ? description.lead : element?.description || (element ? "Ещё не проработано." : "Узел не найден в сохранённой модели.")}</small></span>
          <span className={`pm-package-confidence ${element?.contentStatus ?? "missing"}`}>{element ? confidenceLabel(element) : "Нет узла"}</span>
        </summary>
        <div className="pm-package-detail">
          {element ? <>
            <div className="pm-package-meta">
              <span>Контент: {contentStatuses[element.contentStatus]}</span>
              <span>Реализация: {implementationStatuses[element.implementationStatus]}</span>
              <span>Обновлено: {dateLabel(element.updatedAt)}</span>
              {element.details.sourceDate && <span>Дата источника: {element.details.sourceDate}</span>}
            </div>
            {description?.hasTables && <DescriptionContent blocks={description.blocks} />}
            {sources.length > 0 && <div className="pm-package-sources"><b>Источники</b>{sources.map((source, index) => {
              const href = safeUrl(source, hypothesisId);
              return href ? <a key={`${source}-${index}`} href={href} target="_blank" rel="noreferrer">{source}</a>
                : <span key={`${source}-${index}`}>{source}</span>;
            })}</div>}
            {documents.map((document) => {
              const href = safeUrl(document.url, hypothesisId);
              return <div className="pm-package-doc" key={document.id}><b>{document.title}</b>
                {document.updatedAt && <small>{dateLabel(document.updatedAt)}</small>}
                {href && <a href={href} target="_blank" rel="noreferrer">{document.url}</a>}
                {document.text && <details><summary>Фрагмент документа</summary><p>{document.text}</p></details>}
              </div>;
            })}
            <a className="pm-btn small pm-package-route" href={route}>{blockView ? "Открыть рабочее представление" : "Открыть карточку узла"}</a>
            <button className="pm-btn small" type="button" onClick={() => openElement(element)}>Открыть и редактировать узел</button>
          </> : <a className="pm-btn small" href={route}>Проверить узел</a>}
        </div>
      </details>;
    })}</div>
  </section>;

  if (!["segment", "market", "difference"].includes(view)) return null;
  const title = view === "segment" ? "Стартовый сегмент" : view === "market" ? "Рынок и экономика" : "Отличие и проверка";
  return <section className="pm-curated-view">
    <div className="pm-section-list-head"><div><p className="pm-kicker">OWNER RESEARCH / {view.toUpperCase()}</p><h2>{title}</h2></div><span className="pm-help">Сохранённые узлы · без подмены исследовательских данных</span></div>

    {view === "difference" && <section className="pm-position-map" aria-label="Качественная карта позиционирования">
      <div className="pm-position-copy"><strong>Качественная карта позиционирования</strong><span>Неизмерено — нет фактических оценок или plotted-позиций.</span></div>
      <div className="pm-axis-map"><span className="pm-axis-label axis-y">Влияние на доход после расходов →</span><span className="pm-axis-label axis-x">Удобство управления практикой →</span><span className="pm-axis-item talkhint">TalkHint <b>Желаемая позиция · замысел, не измерение</b></span></div>
      <div className="pm-unmeasured-competitors"><span>MassageBook <b>Неизмерено</b></span><span>ClinicSense <b>Неизмерено</b></span></div>
      <p>{position?.details.convenience ? `Удобство: ${position.details.convenience}` : "Удобство: не измерено"} · {position?.details.netIncome ? `Влияние на доход после расходов: ${position.details.netIncome}` : "Влияние на доход после расходов: не измерено"} · {position?.details.positionIntent ? `Замысел: ${position.details.positionIntent}` : "Замысел TalkHint не зафиксирован."} · {position?.details.measurement ? `Измерения: ${position.details.measurement}` : "Измерения: не определены"}</p>
    </section>}
    {view === "difference" && <section className="pm-pipeline"><div><p className="pm-kicker">CONTENT + PAID MEDIA / CONCEPT ONLY</p><h3>Сохранённый маршрут контента</h3><p>Монтаж исходного видео владельца, без генерации новых сцен. Публикация, реклама и бюджет не запускаются этим представлением.</p></div>
      {pipelineText ? <p className="pm-pipeline-source">{pipelineText}</p> : <div className="pm-empty"><strong>Маршрут не заполнен в модели</strong>Описание появится после сохранения узла TH-CONTENT-PIPELINE.</div>}
    </section>}
    {view === "difference" && <p className="pm-research-note">Гипотеза отличия — единый разговорный интерфейс вместе с командой контента и рекламы. Конкуренты уже имеют маркетинг, документы и платежи; преимущество не предполагается без проверки.</p>}
     {view === "difference" && <a className="pm-btn small pm-difference-matrix-link" href={projectRoute("view=benchmark&suite=difference&filter=primary", hypothesisId)}>Открыть бенчмарк отличия и двух осей</a>}
    {view === "market" && <p className="pm-research-note">Размер рынка не рассчитан. Здесь показываются только сохранённые формулы и допущения; неизвестные величины остаются пустыми.</p>}

    {viewNodes.length ? <div className="pm-list">{viewNodes.map((element) => {
      const keys: CuratedDetailKey[] = view === "difference"
        ? [...detailKeysByView[view], differenceConsentKey]
        : detailKeysByView[view];
      const details = keys.flatMap((key) => {
        const value = key === "consent"
          ? (element.details as unknown as Record<string, string | undefined>).consent?.trim()
          : element.details[key]?.trim();
        return value ? [{ key, value }] : [];
      });
      return <article className="pm-curated-node" key={element.id}>
      <div><span className="pm-benchmark-id">{element.id}</span><h3>{element.title}</h3><p>{element.description || "Описание не заполнено в модели."}</p>
        <span className={`pm-pill ${element.contentStatus}`}>{confidenceLabel(element)}</span><span className="pm-pill implementation">Реализация: {implementationStatuses[element.implementationStatus]}</span>
        {details.length > 0 && <dl className="pm-curated-details">{details.map(({ key, value }) => <div key={key}><dt>{key === "consent" ? "Согласие владельца" : detailFields[key]}</dt><dd>{value}</dd></div>)}</dl>}
        <EvidenceLinks element={element} state={state} openElement={openElement} />
      </div><button className="pm-btn small" type="button" onClick={() => openElement(element)}>Открыть редактор</button>
    </article>;
    })}</div> : <div className="pm-empty"><strong>Узлы для этого представления не найдены</strong>Данные не подменяются демонстрационными значениями.</div>}

    {view === "segment" && <section className="pm-segment-competitors">
      <div className="pm-section-list-head"><div><h3>Основные конкуренты стартового сегмента</h3><span className="pm-help">Сохранённые профили с приоритетом TH-SEGMENT.</span></div><a className="pm-btn small" href={projectRoute("view=benchmark&suite=pilot&filter=primary", hypothesisId)}>Открыть матрицу конкурентов</a></div>
      {primaryCompetitors.length ? <div className="pm-list">{primaryCompetitors.map((competitor) => <article className="pm-curated-node pm-segment-competitor" key={competitor.id}>
        <div><span className="pm-benchmark-id">{competitor.id}</span><h4>{competitor.title}</h4><p>{competitor.description || "Профиль без краткого описания."}</p></div>
        <a className="pm-btn small" href={projectRoute(`view=benchmark&filter=primary&element=${encodeURIComponent(competitor.id)}`, hypothesisId)}>Открыть профиль</a>
      </article>)}</div> : <div className="pm-empty"><strong>Сохранённых основных профилей пока нет</strong>Список формируется только по конкурентным узлам с приоритетом TH-SEGMENT.</div>}
    </section>}
    {view === "segment" && <a className="pm-btn small" href={projectRoute("view=market", hypothesisId)}>Перейти к рынку и формулам</a>}
    {view === "market" && <a className="pm-btn small" href={projectRoute("view=benchmark&suite=pilot&filter=primary", hypothesisId)}>Основные конкуренты стартового сегмента</a>}
    {view === "difference" && <div className="pm-validation-note"><strong>Проверка гипотезы — результаты не внесены</strong><span>Интервью владельцев · удобство управления · чистая прибыль после расходов · практические тесты. До появления записанных результатов преимуществ нет.</span></div>}
  </section>;
}
