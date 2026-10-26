import React, { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, BookOpen, ChevronLeft, ChevronRight, Download, FileText, Save } from "lucide-react";
import type { ModelCommand, ProjectModelState } from "@shared/projectModel";
import { bookChapters, featureFieldLabels, productBookDocument, productBookText, readProductBook, type ProductBook, type ProductBookFeature } from "@shared/productBook";
import { researchFeatures } from "@shared/competitorResearch";
import { competitorPrice, competitorSnapshotDiff } from "@shared/projectCompetitors";
import PassportChapterView from "./PassportChapterView";
import "./ProductBookView.css";

type Props = { state: ProjectModelState; saving: boolean; onSave: (command: ModelCommand) => Promise<boolean> };
type Chapter = typeof bookChapters[number][0] | "hint";

const noData = "Нет данных";
const dateLabel = (value?: string | null) => {
  if (!value) return noData;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("ru-RU", { dateStyle: "medium" });
};
const safeHref = (value: string) => {
  try { const url = new URL(value, window.location.origin); return ["http:", "https:"].includes(url.protocol) ? url.toString() : ""; }
  catch { return ""; }
};

export default function ProductBookView({ state, saving, onSave }: Props) {
  const params = new URLSearchParams(window.location.search);
  const requestedChapter = params.get("chapter") as Chapter | null;
  const [chapter, setChapter] = useState<Chapter>(requestedChapter === "hint" || bookChapters.some(([id]) => id === requestedChapter) ? requestedChapter! : "home");
  const doc = productBookDocument(state);
  const sourceBook = readProductBook(doc);
  const [draft, setDraft] = useState<ProductBook | null>(sourceBook);
  const [draftBase, setDraftBase] = useState(doc?.text ?? "");
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const [expandedFeature, setExpandedFeature] = useState("");
  const book = draft ?? sourceBook;
  const revision = state.operatingModel?.revisions.at(-1);
  const nodes = revision?.data.nodes ?? [];
  const roles = nodes.filter((node) => node.kind === "role");
  const roadmapDocs = state.documents.filter((item) => /roadmap|дорожн|этап/i.test(`${item.id} ${item.title}`));
  const requirementGaps = state.elements.filter((element) => ["PB-GAP-TECH", "PB-GAP-DESIGN", "PB-GAP-LEGAL", "PB-GAP-FINANCE", "PB-GAP-OWNER"].includes(element.id));
  useEffect(() => {
    if (!dirty) {
      setDraft(readProductBook(doc));
      setDraftBase(doc?.text ?? "");
    }
  }, [doc?.text, dirty]);
  const productDecisions = state.decisions.filter((decision) => {
    const touchedElements = [...decision.elementIds, decision.before?.id || "", decision.after?.id || ""];
    const touchedDocuments = [decision.documentBefore?.id || "", decision.documentAfter?.id || ""];
    const referenceText = `${decision.action}\n${decision.reason}`;
    return touchedElements.some((id) => id === "TH-PRODUCT" || id.startsWith("PB-GAP-")) ||
      touchedDocuments.includes(doc?.id || "") || /TH-PRODUCT|PB-GAP-(TECH|DESIGN|LEGAL|FINANCE|OWNER)/.test(referenceText);
  });
  const currentFeatures = useMemo(() => book?.features ?? [], [book]);
  const tasksFor = (feature: ProductBookFeature) => state.taskDrafts.filter((task) => {
    const haystack = `${task.title}\n${task.acceptance}`.toLocaleLowerCase("ru");
    return haystack.includes(feature.name.toLocaleLowerCase("ru")) || haystack.includes(feature.id.toLocaleLowerCase("ru"));
  });
  const requirementsFor = (feature: ProductBookFeature) => requirementGaps.filter((element) => {
    const haystack = `${element.title}\n${element.description}\n${element.details.acceptance || ""}`.toLocaleLowerCase("ru");
    const featureTerms = [feature.id, feature.name].filter(Boolean).map((value) => value.toLocaleLowerCase("ru"));
    return featureTerms.some((term) => haystack.includes(term)) ||
      [element.id, element.title].some((term) => feature.requests.toLocaleLowerCase("ru").includes(term.toLocaleLowerCase("ru")));
  });
  const elementHref = (id: string) => {
    const query = new URLSearchParams({ hypothesis: "new-country", view: "overview", element: id });
    return `/admin/project-model?${query.toString()}`;
  };

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function moveTo(next: Chapter) {
    if (dirty && !window.confirm("Есть несохранённые изменения книги. Перейти и оставить черновик?")) return;
    setChapter(next);
    const nextParams = new URLSearchParams(window.location.search);
    nextParams.set("hypothesis", "new-country");
    nextParams.set("view", "book");
    nextParams.set("chapter", next);
    window.history.replaceState({}, "", `${window.location.pathname}?${nextParams}`);
    setNotice("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function patch(patch: Partial<ProductBook>) {
    if (!book) return;
    setDraft({ ...book, ...patch });
    setDirty(true);
    setNotice("");
  }
  function patchFeature(index: number, key: keyof ProductBookFeature, value: string) {
    if (!book) return;
    patch({ features: book.features.map((feature, i) => i === index ? { ...feature, [key]: value } : feature) });
  }
  async function save() {
    if (!book || !doc || !dirty || saving) return;
    if (doc.text !== draftBase) {
      setNotice("Исходная редакция изменилась в другой сессии. Скачайте черновик, затем загрузите актуальную редакцию: перезапись чужих изменений заблокирована.");
      return;
    }
    const updated: ProductBook = { ...book, version: Math.max(book.version, sourceBook?.version ?? 0) + 1, updatedAt: new Date().toISOString() };
    const baseTitle = doc.title.replace(/\s*[·—-]\s*v\d+(?=\s*(?:[·—-]|$))/gi, "").trim() || "TalkHint — живой паспорт продукта";
    if (productBookText(updated).length > 50000) {
      setNotice("Размер документа превышает доступные 50 000 символов. Черновик не потерян: скачайте его и сократите текст перед сохранением.");
      return;
    }
    const ok = await onSave({ type: "saveDocument", id: doc.id, title: `${baseTitle} · v${updated.version}`, text: productBookText(updated), url: doc.url, elementIds: doc.elementIds });
    if (ok) { setDraft(updated); setDirty(false); setNotice("Сохранена новая редакция. Статус согласования не изменён."); }
    else setNotice("Сохранение не подтверждено. Черновик оставлен на экране; проверьте сообщение о конфликте или ошибке и повторите.");
  }
  function updateText(field: keyof ProductBook, value: string) { patch({ [field]: value } as Partial<ProductBook>); }
  function downloadDocument(title: string, text: string) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `${title.replace(/[^a-zA-Z0-9а-яА-ЯёЁ-]+/g, "-") || "document"}.txt`;
    link.click(); URL.revokeObjectURL(url);
  }

  if (!book || !doc) return <section className="pb-view">
    <div className="pb-missing"><BookOpen size={22} /><p className="pb-eyebrow">TALKHINT / PRODUCT BOOK</p><h2>Книга ещё не доступна</h2>
      <p>Канонический паспорт продукта не найден или не содержит читаемой редакции. Другой документ не подменяется автоматически.</p>
      <div><b>Источник:</b> DOC-TALKHINT-PRODUCT-PASSPORT · <b>Состояние:</b> Нет данных</div>
    </div>
  </section>;

  const activeIndex = bookChapters.findIndex(([id]) => id === chapter);
  const featureFields = Object.keys(featureFieldLabels) as (keyof ProductBookFeature)[];

  return <section className="pb-view">
    <header className="pb-masthead">
      <div className="pb-mast-copy"><p className="pb-eyebrow">NEW-COUNTRY / LIVING PRODUCT BOOK</p><h2>Продукт без витринных метрик.</h2>
        <p>Живая редакция паспорта TalkHint: план, факты, ответственность и пробелы — отдельно.</p></div>
      <div className="pb-meta"><span>РЕДАКЦИЯ <b>V{book.version}</b></span><span>СНИМОК <b>{dateLabel(book.snapshotDate)}</b></span>
        <span className="pb-status"><i />{book.status || noData}</span>
        {chapter !== "hint" && <button className="pm-btn primary" type="button" onClick={() => void save()} disabled={!dirty || saving}><Save size={14} />{saving ? "Сохраняем…" : "Сохранить книгу"}</button>}
        {chapter !== "hint" && dirty && <button type="button" className="pm-btn" onClick={() => downloadDocument("TalkHint-черновик", productBookText(book))}><Download size={14} />Скачать черновик</button>}
        {chapter !== "hint" && dirty && doc.text !== draftBase && <button type="button" className="pm-btn" onClick={() => {
          if (!window.confirm("Заменить несохранённый черновик актуальной редакцией? Сначала скачайте нужные правки.")) return;
          setDraft(sourceBook); setDraftBase(doc.text); setDirty(false); setNotice("Загружена актуальная редакция.");
        }}>Загрузить актуальную редакцию</button>}
      </div>
    </header>
    {notice && <p className={`pb-notice ${dirty ? "is-warning" : ""}`} role="status">{notice}</p>}
    <div className="pb-frame">
      <nav className="pb-chapters" aria-label="Главы книги">
        <p className="pb-eyebrow">СОДЕРЖАНИЕ</p>
        {bookChapters.map(([id, label], index) => <button type="button" key={id} className={chapter === id ? "active" : ""} onClick={() => moveTo(id)}>
          <span>{String(index + 1).padStart(2, "0")}</span>{label}{chapter === id && <ChevronRight size={14} />}
        </button>)}
        <button type="button" className={`pm-nav-book${chapter === "hint" ? " active" : ""}`} onClick={() => moveTo("hint")}>
          <span className="pm-nav-index">H</span>Hint · рабочая глава{chapter === "hint" && <ChevronRight size={14} />}
        </button>
        <div className="pb-chapter-foot"><b>Только текущая модель</b><span>Ревизия operating model: {revision ? `v${revision.version}` : noData}</span></div>
      </nav>
      <main className="pb-content">
        {chapter === "hint" ? <div className="pb-chapter-heading"><span>HINT / 01</span><h3>Рабочая глава</h3>
          <div className="pb-pager"><button type="button" aria-label="Вернуться к главной" onClick={() => moveTo("home")}><ChevronLeft size={16} /></button><button type="button" aria-label="Перейти к возможностям" onClick={() => moveTo("features")}><ChevronRight size={16} /></button></div>
        </div> : <div className="pb-chapter-heading"><span>{String(activeIndex + 1).padStart(2, "0")} / 10</span><h3>{bookChapters[activeIndex]?.[1]}</h3>
          <div className="pb-pager"><button type="button" aria-label="Предыдущая глава" disabled={activeIndex <= 0} onClick={() => moveTo(bookChapters[activeIndex - 1][0])}><ChevronLeft size={16} /></button><button type="button" aria-label="Следующая глава" disabled={activeIndex >= bookChapters.length - 1} onClick={() => moveTo(bookChapters[activeIndex + 1][0])}><ChevronRight size={16} /></button></div>
        </div>}
        {chapter === "home" && <section className="pb-home">
          <div className="pb-home-lead"><span className="pb-stamp">TALKHINT · PASSPORT</span><p className="pb-serif">{book.vision || book.purpose || noData}</p>
            <span className="pb-home-caption">Формулировка из текущего паспорта · редактируется в главе «Видение и аудитория»</span></div>
          <div className="pb-home-columns"><article><span>01 / СЕЙЧАС</span><p>{book.current || noData}</p></article><article><span>02 / СЛЕДОМ</span><p>{book.nextStage || noData}</p></article><article><span>03 / СОСТОЯНИЕ</span><p>{book.lifecycle || noData}</p><small>Документ: {book.status || noData}</small></article></div>
          <div className="pb-truth"><b>Правило книги</b><p>Запись в плане — не работающий продукт. Неизвестное остаётся неизвестным; изменение текста не означает согласования.</p></div>
          <div className="pb-home-actions"><button type="button" className="pm-btn" onClick={() => moveTo("hint")}>Открыть главу Hint <ArrowUpRight size={14} /></button><button type="button" className="pm-btn" onClick={() => moveTo("features")}>К матрице возможностей <ArrowUpRight size={14} /></button><button type="button" className="pm-btn" onClick={() => moveTo("history")}>Смотреть историю решений <ArrowUpRight size={14} /></button></div>
        </section>}
        {chapter === "hint" && <PassportChapterView state={state} />}
        {chapter === "vision" && <div className="pb-narratives">
          <p className="pb-intro">Нарратив — редактируемая часть этого же паспорта. Сохраняется как новая версия документа.</p>
          {([
            ["purpose", "Зачем существует продукт"], ["vision", "Видение"], ["b2c", "B2C · для человека"], ["b2b", "B2B · для организации"],
            ["lifecycle", "Жизненный цикл продукта"], ["current", "Где мы сейчас"], ["nextStage", "Ближайший этап"], ["completion", "Условие завершения этапа"],
          ] as [keyof ProductBook, string][]).map(([key, label]) => <label className="pb-narrative" key={key}><span>{label}</span><textarea value={String(book[key] || "")} placeholder={noData} onChange={(event) => updateText(key, event.target.value)} /></label>)}
        </div>}
        {chapter === "features" && <section className="pb-features">
          <p className="pb-intro">Матрица использует только записи паспорта. «Текущий статус» не выводится из планов или текста.</p>
          <div className="pb-matrix-wrap"><table className="pb-matrix"><thead><tr><th>Возможность</th><th>Сейчас</th><th>Платформа</th><th>Доказательство</th><th>Следующий шаг</th></tr></thead>
            <tbody>{currentFeatures.map((feature, index) => <tr key={feature.id}><th><button type="button" onClick={() => setExpandedFeature(expandedFeature === feature.id ? "" : feature.id)}>{feature.name || noData}<small>{feature.id}</small></button></th>
              <td>{feature.actual || noData}</td><td>{feature.platform || noData}</td><td>{feature.evidence || noData}</td><td>{feature.next || noData}</td></tr>)}</tbody>
          </table></div>
          {!currentFeatures.length && <div className="pb-empty">В паспорте нет возможностей. Данные не создаются автоматически.</div>}
          <section className="pb-requirements"><div><span>CONNECTED REQUIREMENTS</span><h4>Требования продукта из модели</h4><p>Эти элементы остаются предложениями в модели. Просмотр или редактирование книги не запускает работу и не меняет их статус.</p></div>
            {requirementGaps.length ? requirementGaps.map((element) => <RequirementCard key={element.id} element={element} href={elementHref(element.id)} />) : <div className="pb-empty">PB-GAP requirements не найдены в текущем состоянии модели.</div>}
          </section>
          {currentFeatures.map((feature, index) => <article className={`pb-feature ${expandedFeature === feature.id ? "open" : ""}`} key={`detail-${feature.id}`}>
            <button className="pb-feature-toggle" type="button" aria-expanded={expandedFeature === feature.id} onClick={() => setExpandedFeature(expandedFeature === feature.id ? "" : feature.id)}><span><small>{feature.id}</small><b>{feature.name || noData}</b></span><ChevronRight size={16} /></button>
            {expandedFeature === feature.id && <div className="pb-feature-body"><div className="pb-feature-fields">
              {featureFields.filter((key) => key !== "comparisonKey").map((key) => <label key={key}><span>{featureFieldLabels[key]}</span><textarea value={String(feature[key] ?? "")} placeholder={noData} onChange={(event) => patchFeature(index, key, event.target.value)} /></label>)}
              <label><span>{featureFieldLabels.comparisonKey}</span><input value={feature.comparisonKey ?? ""} placeholder={noData} onChange={(event) => patchFeature(index, "comparisonKey", event.target.value)} /></label>
            </div>
              <div className="pb-related">
                <b>Существующие требования · только модель, не запуск</b>
                {requirementsFor(feature).length ? requirementsFor(feature).map((element) => <RequirementCard key={element.id} element={element} href={elementHref(element.id)} />) : <p>{noData} — связанное требование по ID/названию не найдено.</p>}
                <b className="pb-related-subhead">Черновики заданий</b>
                {tasksFor(feature).length ? tasksFor(feature).map((task) => <article key={task.id}><span>{task.id}</span><strong>{task.title}</strong><p>{task.acceptance || noData}</p></article>) : <p>{noData} — подходящих черновиков по ID или названию нет.</p>}
                {feature.requests && <div className="pb-request-links"><b>Обращения и запросы паспорта</b><p>{feature.requests}</p>{requirementGaps.filter((element) => feature.requests.toLocaleLowerCase("ru").includes(element.id.toLocaleLowerCase("ru")) || feature.requests.toLocaleLowerCase("ru").includes(element.title.toLocaleLowerCase("ru"))).map((element) => <a key={element.id} href={elementHref(element.id)}>{element.id} · открыть в редакторе</a>)}</div>}
              </div>
            </div>}
          </article>)}
        </section>}
        {chapter === "team" && <section className="pb-team"><p className="pb-intro">Роли и работы берутся из последней сохранённой ревизии операционной модели. Назначение в модели не доказывает запуск.</p>
          <div className="pb-narratives">
            <label className="pb-narrative"><span>Нарратив ответственности</span><textarea value={book.responsibilities || ""} placeholder={noData} onChange={(event) => updateText("responsibilities", event.target.value)} /></label>
            <label className="pb-narrative"><span>Неразрешённые противоречия</span><textarea value={book.contradictions || ""} placeholder={noData} onChange={(event) => updateText("contradictions", event.target.value)} /></label>
          </div>
          <div className="pb-team-banner"><b>Дизайн и исполнение — разные состояния</b><span>Структура описывает задуманную ответственность. Подтверждённых событий выполнения из этих записей не следует.</span></div>
          {roles.length ? roles.map((role) => {
            const parent = nodes.find((node) => node.id === role.parentId);
            const assignments = nodes.filter((node) => [node.roleId, node.executorId, node.recipientId, node.acceptorId].includes(role.id));
            return <article className="pb-role" key={role.id}><div className="pb-role-head"><span>{role.code || role.id}</span><b>{role.name}</b><em>{role.status === "proposal" ? "Предложение" : "Согласовано в модели"} · запуск: нет данных</em></div>
              <dl><div><dt>Группа</dt><dd>{parent?.name || noData}</dd></div><div><dt>Описание</dt><dd>{role.purpose || role.description || noData}</dd></div><div><dt>Руководитель</dt><dd>{role.managerId ? nodes.find((item) => item.id === role.managerId)?.name || role.managerId : noData}</dd></div></dl>
              <div className="pb-linked"><span>Связанные работы модели</span>{assignments.length ? assignments.map((item) => <p key={item.id}><code>{item.code || item.id}</code> {item.name} <small>{item.status === "proposal" ? "Предложение" : "Сохранено"}</small></p>) : <p>{noData}</p>}</div>
            </article>;
          }) : <div className="pb-empty">В текущей ревизии нет role-узлов.</div>}
        </section>}
        {chapter === "competitors" && <section className="pb-competitors"><p className="pb-intro">Сопоставление по comparisonKey из паспорта и последнему сохранённому снимку исследовательского справочника. Планы TalkHint не показаны как текущие факты.</p>
          {currentFeatures.filter((feature) => feature.comparisonKey).map((feature) => <article className="pb-compare" key={feature.id}><div className="pb-compare-title"><span>{feature.id}</span><h4>{feature.name}</h4><p>TalkHint · текущее: {feature.actual || noData} <b>Целевое: {feature.behavior || noData}</b></p></div>
            <div className="pb-compare-grid">{(state.competitorDirectory?.records ?? []).map((record) => {
              const revisionItem = record.revisions.at(-1);
              const snapshot = revisionItem?.snapshot;
              const evidence = snapshot?.research?.features[feature.comparisonKey as keyof typeof researchFeatures];
              return <article key={record.id}><a href={`/admin/project-model?hypothesis=new-country&view=benchmark&competitor=${encodeURIComponent(record.id)}`}>{snapshot?.name || record.id}<ArrowUpRight size={12} /></a>
                <strong>{evidence?.status || noData}</strong><p>{evidence?.note || noData}</p><small>Дата: {dateLabel(evidence?.checkedAt ?? snapshot?.checkedAt)} · снимок v{revisionItem?.version ?? noData}</small>
                {evidence?.sourceUrls.map((url) => safeHref(url) ? <a className="pb-source" key={url} href={safeHref(url)} target="_blank" rel="noreferrer">{url}</a> : null)}
              </article>;
            })}{!state.competitorDirectory?.records.length && <p className="pb-empty">Сохранённых карточек конкурентов нет.</p>}</div>
          </article>)}
          {book.features.some((feature) => !feature.comparisonKey) && <p className="pb-footnote">Без comparisonKey возможность не сопоставляется: ключи не угадываются.</p>}
          <div className="pb-competitor-caveat"><b>Данные источника отдельно от нашей оценки</b><p>Публичные материалы, тарифы и отметки проверки показаны как сохранённый снимок. «Цель TalkHint» берётся из нарратива паспорта, не является текущим состоянием или проверенным сравнением. Неизвестное не трактуется как отсутствие функции.</p></div>
          {(state.competitorDirectory?.records ?? []).map((record) => <CompetitorHistory key={`history-${record.id}`} record={record} />)}
        </section>}
        {chapter === "roadmap" && <section className="pb-roadmap"><p className="pb-intro">Нарратив этапов хранится в паспорте; источником roadmap также остаётся существующий документ модели.</p>
          <label className="pb-narrative"><span>Этапы и логика перехода</span><textarea value={book.roadmap || ""} placeholder={noData} onChange={(event) => updateText("roadmap", event.target.value)} /></label>
          <h4>Канонические материалы roadmap</h4>{roadmapDocs.length ? roadmapDocs.map((item) => <DocCard key={item.id} item={item} onDownload={downloadDocument} />) : <div className="pb-empty">Roadmap-документ не найден среди сохранённых документов.</div>}
        </section>}
        {chapter === "legal" && <><Narrative title="Право и документы" value={book.legal} onChange={(value) => updateText("legal", value)} />
          <section className="pb-documents"><h4>Связанные материалы</h4>{state.documents.filter(d => /юрид|правов|согласи|конфиденц|хранени|удалени|договор/i.test(d.title)).map(d => <DocCard key={d.id} item={d} onDownload={downloadDocument} />)}
          <p className="pb-footnote">Наличие документа не означает юридическую проверку. Утверждённые версии и заключение специалиста пока не подтверждены.</p></section></>}
        {chapter === "finance" && <><Narrative title="Финансы" value={book.finance} onChange={(value) => updateText("finance", value)} />
          <section className="pb-documents"><h4>Связанные материалы</h4>{state.documents.filter(d => /финанс|себестоим|тариф|экономик|бюджет/i.test(d.title)).map(d => <DocCard key={d.id} item={d} onDownload={downloadDocument} />)}
          <p className="pb-footnote">Подтверждённый расчёт себестоимости и утверждённые пользовательские тарифы не представлены в исходном паспорте.</p></section></>}
        {chapter === "history" && <section className="pb-history"><p className="pb-intro">Фактический журнал решений модели. Пустые поля не интерпретируются как одобрение.</p>
          {productDecisions.length ? productDecisions.slice().reverse().map((decision) => <article className="pb-decision" key={decision.id}><div className="pb-decision-head"><span>{dateLabel(decision.at)}</span><b>{decision.action || noData}</b><small>{decision.actor || noData}</small></div>
            <p><strong>Основание:</strong> {decision.reason || noData}</p>
            {decision.documentBefore || decision.documentAfter ? <details className="pb-history-diff"><summary>Показать документ до / после</summary><div className="pb-diff"><div><b>До</b><span>{decision.documentBefore?.title || noData}</span><small>{decision.documentBefore ? `Обновлено ${dateLabel(decision.documentBefore.updatedAt)}` : noData}</small><pre>{decision.documentBefore?.text || noData}</pre></div><div><b>После</b><span>{decision.documentAfter?.title || noData}</span><small>{decision.documentAfter ? `Обновлено ${dateLabel(decision.documentAfter.updatedAt)}` : noData}</small><pre>{decision.documentAfter?.text || noData}</pre></div></div></details>
              : decision.before || decision.after ? <details className="pb-history-diff"><summary>Показать запись до / после</summary><div className="pb-diff"><div><b>До</b><pre>{decision.before ? `${decision.before.title}\n${decision.before.description}` : noData}</pre></div><div><b>После</b><pre>{decision.after ? `${decision.after.title}\n${decision.after.description}` : noData}</pre></div></div></details> : <p>{noData} · данные «до / после» в записи решения отсутствуют.</p>}
            <small>ID {decision.id} · статус решения: {decision.proposalAfter?.status || decision.proposalBefore?.status || noData}</small></article>
          ) : <div className="pb-empty">Нет решений, связанных с паспортом продукта, TH-PRODUCT или PB-GAP.</div>}
          <details className="pb-original-v1"><summary>Открыть исходный паспорт v1</summary><pre>{book.previousPassport || noData}</pre><button type="button" className="pm-btn small" onClick={() => downloadDocument("TalkHint-original-passport-v1", book.previousPassport)}>Скачать v1</button></details>
        </section>}
        {chapter === "documents" && <section className="pb-documents"><p className="pb-intro">Только сохранённые документы. Владелец и статус показываются только если такие сведения представлены в записи.</p>
          {state.documents.length ? state.documents.map((item) => <DocCard key={item.id} item={item} onDownload={downloadDocument}
            version={item.id === doc.id ? `v${book.version}` : undefined} status={item.id === doc.id ? book.status : undefined} />) : <div className="pb-empty">Документов нет.</div>}
        </section>}
        <footer className="pb-footer"><span>{chapter === "hint" ? "КАНОНИЧЕСКИЙ СНИМОК · ТОЛЬКО ЧТЕНИЕ" : dirty ? "ЕСТЬ НЕСОХРАНЁННЫЙ ЧЕРНОВИК" : "СОХРАНЕНО В КАНОНИЧЕСКОМ ПАСПОРТЕ"}</span><b>{chapter === "hint" ? "ГЛАВА HINT" : doc.id}</b><span>{chapter === "hint" ? "Изменение возможно только в источнике данных" : `Изменено: ${dateLabel(book.updatedAt)} · автор: см. историю решений`}</span></footer>
      </main>
    </div>
  </section>;
}

function Narrative({ title, value, onChange }: { title: string; value: string; onChange: (value: string) => void }) {
  return <section className="pb-narratives"><p className="pb-intro">{title} · содержание паспорта. Не заменяет юридическое заключение или финансовую отчётность.</p>
    <label className="pb-narrative"><span>{title}</span><textarea value={value || ""} placeholder={noData} onChange={(event) => onChange(event.target.value)} /></label></section>;
}
function RequirementCard({ element, href }: { element: ProjectModelState["elements"][number]; href: string }) {
  return <article className="pb-requirement">
    <div><code>{element.id}</code><a href={href}>{element.title || noData}<ArrowUpRight size={12} /></a></div>
    <span className={`pb-requirement-status ${element.contentStatus === "proposal" ? "proposal" : ""}`}>
      {element.contentStatus === "proposal" ? "Предложение · статус сохранён" : element.contentStatus}
    </span>
    <dl>
      <div><dt>Критерий приёмки</dt><dd>{element.details.acceptance || noData}</dd></div>
      <div><dt>Ответственный</dt><dd>{element.details.accountable || noData}</dd></div>
      <div><dt>Следующий шаг</dt><dd>{element.details.nextStep || noData}</dd></div>
      <div><dt>Ресурсы</dt><dd>{element.details.resources || noData}</dd></div>
      <div><dt>Происхождение</dt><dd>{element.details.provenance || noData}</dd></div>
    </dl>
  </article>;
}
function CompetitorHistory({ record }: { record: NonNullable<ProjectModelState["competitorDirectory"]>["records"][number] }) {
  const revisions = record.revisions;
  const latest = revisions.at(-1);
  if (!latest) return null;
  const snapshot = latest.snapshot;
  const website = safeHref(snapshot.website);
  const app = safeHref(snapshot.appStore);
  return <article className="pb-competitor-history">
    <header><div><span>{record.id}</span><h4>{snapshot.name || noData}</h4><p>{snapshot.developer || noData} · снимок от {dateLabel(snapshot.checkedAt)} · v{latest.version}</p></div>
      <strong>{snapshot.verification === "manual" ? "Ручная проверка" : snapshot.verification === "provided" ? "Сведения предоставлены" : noData}</strong></header>
    <div className="pb-provider-context"><b>Контекст сохранённого снимка</b>
      <span>Функции: {snapshot.offer.features || noData}</span><span>Языки: {snapshot.offer.languages || noData}</span><span>Регионы: {snapshot.offer.regions || noData}</span>
      <span>Платформа / каналы из записи: {snapshot.offer.channels || noData}</span>
      <span>Сайт: {website ? <a href={website} target="_blank" rel="noreferrer">{snapshot.website}</a> : noData}</span>
      <span>Магазин приложений: {app ? <a href={app} target="_blank" rel="noreferrer">{snapshot.appStore}</a> : noData}</span>
    </div>
    <div className="pb-provider-plans"><b>Тарифы и публичные условия из сохранённых записей</b>
      {snapshot.plans.length ? snapshot.plans.map((plan) => <article key={plan.id}>
        <strong>{plan.name || noData}</strong><span>{competitorPrice(plan)}</span>
        <small>Регион: {plan.region || noData} · номер: {plan.includedNumbers || noData} · минуты: {plan.includedMinutes || noData}</small>
        <small>Статус источника: {plan.evidence?.status || noData} · дата: {dateLabel(plan.evidence?.checkedAt)}</small>
        {safeHref(plan.sourceUrl) && <a href={safeHref(plan.sourceUrl)} target="_blank" rel="noreferrer">Источник тарифа</a>}
      </article>) : <p>{noData} — тарифы не сохранены.</p>}
    </div>
    <details className="pb-competitor-revisions"><summary>Изменения в сохранённых редакциях · {revisions.length}</summary>
      {revisions.slice().reverse().map((revision, index) => {
        const previous = revisions[revisions.length - index - 2];
        const changes = previous ? competitorSnapshotDiff(previous.snapshot, revision.snapshot) : [];
        return <article key={`${revision.version}-${revision.savedAt}`}><b>v{revision.version} · {dateLabel(revision.savedAt)}</b><span>{revision.reason || noData}</span>
          {previous ? changes.length ? <ul>{changes.slice(0, 16).map((change) => <li key={change.field}><code>{change.field}</code><span>{change.before} → {change.after}</span></li>)}</ul>
            : <small>В сохранённом сравнении отличий от предыдущей версии нет.</small>
            : <small>Первая сохранённая редакция.</small>}
          {changes.length > 16 && <small>Ещё {changes.length - 16} изменений остаются в источнике истории.</small>}
        </article>;
      })}
    </details>
  </article>;
}
function DocCard({ item, onDownload, version, status }: { item: ProjectModelState["documents"][number]; onDownload: (title: string, text: string) => void; version?: string; status?: string }) {
  const href = safeHref(item.url);
  const savedVersion = version || item.title.match(/\bv\d+\b/i)?.[0] || "не указана";
  const savedStatus = status || item.title.match(/на согласовании|для обсуждения|черновик/i)?.[0] || "Неизвестно";
  return <article className="pb-doc"><div className="pb-doc-icon"><FileText size={17} /></div><div className="pb-doc-copy"><span>{item.id}</span><h4>{item.title}</h4><p>Версия: {savedVersion} · владелец: {item.id === "DOC-TALKHINT-PRODUCT-PASSPORT" ? "HEAD.06 — руководитель продукта" : "Нет данных"} · статус: {savedStatus} · обновлено {dateLabel(item.updatedAt)}</p><details><summary>Открыть содержание</summary><pre>{item.text || noData}</pre></details></div>
    <div className="pb-doc-actions">{href && <a className="pm-btn small" href={href} target="_blank" rel="noreferrer">Открыть <ArrowUpRight size={13} /></a>}<button type="button" className="pm-btn small" onClick={() => onDownload(item.title, item.text)}><Download size={13} />Скачать</button></div>
  </article>;
}
