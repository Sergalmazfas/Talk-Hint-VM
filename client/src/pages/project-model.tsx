import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "wouter";
import {
  AlertCircle, ArrowLeft, Check, ChevronDown, Clipboard, FileText,
  History, Plus, RefreshCw, Save, Send, ShieldCheck, Sparkles, X,
} from "lucide-react";
import {
  contentStatuses, detailFields, elementKinds, implementationStatuses, modelSections,
  type ElementInput, type ModelCommand, type ModelDocument, type ModelElement,
  type ModelProposal, type ProjectModelState,
} from "@shared/projectModel";
import { useAuth } from "@/lib/auth";
import { modelRequest } from "@/lib/project-model-api";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import Benchmark from "@/components/project-model/Benchmark";
import CompetitorDirectory from "@/components/project-model/CompetitorDirectory";
import PackageViews from "@/components/project-model/PackageViews";
import "./project-model.css";
import "@xyflow/react/dist/style.css";
import "@/components/project-model/TeamView.css";

type Tab = "overview" | "links" | "documents";
const projectViews = ["overview", "segment", "market", "difference", "benchmark"] as const;
const projectTabs: Tab[] = ["overview", "links", "documents"];
const sections = modelSections;
const projectHref = (query: string) => {
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  if (!params.has("hypothesis")) params.set("hypothesis", new URLSearchParams(window.location.search).get("hypothesis") || "original");
  return `/admin/project-model?${params.toString()}`;
};
const emptyElement = (section: ElementInput["section"] = "Обзор"): ElementInput => ({
  title: "", section, scope: "talkhint", kind: "context", description: "",
  contentStatus: "proposal", implementationStatus: "not_started", details: {},
});
const statusLabel = (key: ModelElement["contentStatus"]) => contentStatuses[key];
const implLabel = (key: ModelElement["implementationStatus"]) => implementationStatuses[key];
const dateLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });
};

export default function ProjectModel() {
  const { token } = useAuth();
  const authToken = token || null;
  const [state, setState] = useState<ProjectModelState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState("");
  const initialParams = new URLSearchParams(window.location.search);
  const hypothesisId = initialParams.get("hypothesis") || "original";
  const requestedView = initialParams.get("view");
  const selectedCompetitorId = initialParams.get("competitor")?.trim() || "";
  const initialView = projectViews.includes(requestedView as typeof projectViews[number]) ? requestedView as typeof projectViews[number] : "overview";
  const requestedSection = initialParams.get("section");
  const initialSection = sections.find((item) => item === requestedSection) ?? (initialView === "benchmark" ? "Рынок и конкуренты" : "Обзор");
  const requestedTab = initialParams.get("tab");
  const initialTab = projectTabs.includes(requestedTab as Tab) ? requestedTab as Tab : "overview";
  const [section, setSection] = useState<ElementInput["section"]>(() =>
    initialSection,
  );
  const [tab, setTab] = useState<Tab>(initialTab);
  const [editor, setEditor] = useState<{ id?: string; value: ElementInput } | null>(null);
  const [relationDraft, setRelationDraft] = useState<{ id?: string; from: string; to: string; label: string }>({ from: "", to: "", label: "" });
  const [documentDraft, setDocumentDraft] = useState({ title: "", text: "", url: "", elementIds: [] as string[], id: undefined as string | undefined });
  const [taskTitle, setTaskTitle] = useState("");
  const [taskAcceptance, setTaskAcceptance] = useState("");
  const [taskError, setTaskError] = useState("");
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [proposalEditorOpen, setProposalEditorOpen] = useState(false);
  const [deepLinkError, setDeepLinkError] = useState("");
  const benchmarkView = initialView === "benchmark";
  const currentView = initialView;
  const deepLinkId = useMemo(() => benchmarkView ? "" : new URLSearchParams(window.location.search).get("element")?.trim() ?? "", [benchmarkView]);
  const deepLinkHandled = useRef("");

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const result = await modelRequest(authToken, undefined, undefined, hypothesisId);
      setState(result);
    } catch (e) {
      setState(null);
      setError(e instanceof Error ? e.message : "Не удалось загрузить модель.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [authToken, hypothesisId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!state || !deepLinkId || deepLinkHandled.current === deepLinkId) return;
    deepLinkHandled.current = deepLinkId;
    const target = state.elements.find((element) => element.id === deepLinkId);
    if (!target) {
      setDeepLinkError(`Элемент ${deepLinkId} не найден в текущей версии модели.`);
      return;
    }
    setDeepLinkError("");
    setSection(target.section);
    setTab("overview");
    setUrlState({ section: target.section, tab: "overview" });
    setEditor({
      id: target.id,
      value: {
        title: target.title, section: target.section, scope: target.scope, kind: target.kind,
        description: target.description, contentStatus: target.contentStatus,
        implementationStatus: target.implementationStatus, details: { ...target.details },
      },
    });
  }, [state, deepLinkId]);

  const submit = useCallback(async (command: ModelCommand) => {
    if (!state) return false;
    setSaving(true);
    setError("");
    setConflict("");
    try {
      const result = await modelRequest(authToken, command, state.revision, hypothesisId);
      setState(result);
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Не удалось сохранить изменения.";
      let latest: ProjectModelState | null = null;
      try { latest = await modelRequest(authToken, undefined, undefined, hypothesisId); } catch { /* Preserve the original save error. */ }
      if (/409|conflict|конфликт|устаревш/i.test(message) || (latest && latest.revision !== state.revision)) {
        if (latest) setState(latest);
        setConflict(latest
          ? "Версия модели изменилась в другой сессии. Актуальное состояние загружено; введённые здесь данные сохранены в форме и не были отправлены."
          : "Возможен конфликт версии модели, но обновить состояние не удалось. Введённые здесь данные сохранены в форме; повторите обновление перед повторной отправкой.");
      } else {
        setError(message);
      }
      return false;
    } finally {
      setSaving(false);
    }
  }, [authToken, hypothesisId, state]);

  const elements = state?.elements ?? [];
  const hypothesisContext = state?.hypothesisContext;
  const selectedHypothesisId = hypothesisContext?.selectedId || hypothesisId;
  const selectedHypothesisTitle = hypothesisContext?.options.find((option) => option.id === selectedHypothesisId)?.title || selectedHypothesisId;
  const talkhintElements = useMemo(() => elements.filter((element) => element.scope === "talkhint"), [elements]);
  const selectedElements = useMemo(() => elements.filter((element) =>
    element.section === section && (element.scope === "talkhint" || section === "Модели клиентов")), [elements, section]);
  const unresolvedCount = talkhintElements.filter((element) => element.needsReview).length;

  function openElement(element?: ModelElement) {
    setEditor({ id: element?.id, value: element ? {
      title: element.title, section: element.section, scope: element.scope, kind: element.kind,
      description: element.description, contentStatus: element.contentStatus,
      implementationStatus: element.implementationStatus, details: { ...element.details },
    } : emptyElement(section) });
  }
  function clearElementQuery() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("element")) return;
    params.delete("element");
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  }
  function closeElementEditor() {
    setEditor(null);
    clearElementQuery();
  }
  async function saveElement(value: ElementInput, id?: string) {
    if (id) {
      const current = elements.find((el) => el.id === id);
      if (current?.contentStatus === "confirmed" || value.contentStatus === "confirmed") {
        setProposalForm({
          targetId: id, source: "Ручная правка администратора", rationale: "",
          relatedIds: [], change: value, proposalId: undefined,
        });
        closeElementEditor();
        return;
      }
    }
    if (await submit({ type: "saveElement", ...(id ? { id } : {}), element: value })) closeElementEditor();
  }

  const [proposalForm, setProposalForm] = useState<{
    targetId: string; source: string; rationale: string; relatedIds: string[];
    change: ElementInput; proposalId?: string;
  }>({ targetId: "", source: "", rationale: "", relatedIds: [], change: emptyElement() });
  const [clarifyId, setClarifyId] = useState<string | null>(null);
  const [clarifyNote, setClarifyNote] = useState("");
  const [editingDocument, setEditingDocument] = useState(false);
  const [copyLabel, setCopyLabel] = useState("");

  function editProposal(proposal: ModelProposal) {
    setProposalForm({
      targetId: proposal.targetId, source: proposal.source, rationale: proposal.rationale,
      relatedIds: [...proposal.relatedIds], change: { ...proposal.change, details: { ...proposal.change.details } },
      proposalId: proposal.id,
    });
  }
  async function saveProposal() {
    if (!proposalForm.targetId || !proposalForm.change.title.trim()) return;
    const ok = await submit({
      type: "saveProposal", ...(proposalForm.proposalId ? { id: proposalForm.proposalId } : {}),
      targetId: proposalForm.targetId, source: proposalForm.source.trim(),
      rationale: proposalForm.rationale.trim(), relatedIds: proposalForm.relatedIds,
      change: proposalForm.change,
    });
    if (ok) setProposalForm({ targetId: "", source: "", rationale: "", relatedIds: [], change: emptyElement() });
  }

  const pendingProposals = (state?.proposals ?? []).filter((proposal) => proposal.status !== "approved");
  const currentProposalTarget = elements.find((el) => el.id === proposalForm.targetId);
  const proposalScopeElements = currentProposalTarget
    ? elements.filter((element) => element.scope === currentProposalTarget.scope)
    : talkhintElements;
  const orphanElements = elements.filter((el) => !(state?.relations ?? []).some((relation) => relation.from === el.id || relation.to === el.id));
  const taskSelection = talkhintElements.filter((el) => el.contentStatus === "confirmed");
  const questionElements = talkhintElements.filter((element) => element.contentStatus === "question" || !!element.details.unknown?.trim());
  const actionElements = talkhintElements.filter((element) => element.kind === "action" || element.kind === "sub_action");
  const actionRequiredFields = ["trigger", "accountable", "executor", "inputs", "procedure", "output", "success"] as const;
  const incompleteActions = actionElements.map((element) => ({
    element,
    missing: actionRequiredFields.filter((key) => !element.details[key]?.trim()),
  })).filter(({ missing }) => missing.length > 0);
  const readyTaskSelectedCount = selectedTaskIds.filter((id) => talkhintElements.some((element) => element.id === id && element.contentStatus === "confirmed" && !element.needsReview)).length;

  async function createRelation(event: FormEvent) {
    event.preventDefault();
    if (!relationDraft.from || !relationDraft.to || relationDraft.from === relationDraft.to || !relationDraft.label.trim()) return;
    const { id, ...relation } = relationDraft;
    if (await submit({ type: "saveRelation", ...(id ? { id } : {}), ...relation, label: relation.label.trim() })) setRelationDraft({ from: "", to: "", label: "" });
  }
  async function saveDocument(event: FormEvent) {
    event.preventDefault();
    if (!documentDraft.title.trim()) return;
    const { id, ...document } = documentDraft;
    if (await submit({ type: "saveDocument", ...(id ? { id } : {}), ...document, title: document.title.trim(), url: document.url.trim() })) {
      setDocumentDraft({ title: "", text: "", url: "", elementIds: [], id: undefined });
      setEditingDocument(false);
    }
  }
  async function makeTask(event: FormEvent) {
    event.preventDefault();
    const ids = selectedTaskIds.filter((id) => talkhintElements.some((element) => element.id === id && element.contentStatus === "confirmed" && !element.needsReview));
    if (!ids.length || !taskTitle.trim() || !taskAcceptance.trim()) return;
    setTaskError("");
    const ok = await submit({ type: "prepareTask", title: taskTitle.trim(), elementIds: ids, acceptance: taskAcceptance.trim() });
    if (ok) { setTaskTitle(""); setTaskAcceptance(""); setSelectedTaskIds([]); }
    else setTaskError("Черновик задания не создан. Проверьте сообщение об ошибке выше.");
  }
  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyLabel("Скопировано");
      window.setTimeout(() => setCopyLabel(""), 1800);
    } catch {
      setCopyLabel("Копирование недоступно — выделите текст вручную");
    }
  }

  const setUrlState = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(window.location.search);
    params.set("hypothesis", params.get("hypothesis") || "original");
    Object.entries(updates).forEach(([key, value]) => value === null ? params.delete(key) : params.set(key, value));
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  };
  const changeSection = (value: ElementInput["section"]) => {
    setSection(value); setTab("overview");
    setUrlState({ view: "overview", section: value, tab: "overview", element: null, suite: null, filter: null });
  };
  const changeTab = (value: Tab) => { setTab(value); setUrlState({ tab: value }); };
  const startingSegment = talkhintElements.find((element) => element.id === "TH-SEGMENT");
  const primaryCompetitors = elements.filter((element) =>
    element.details.benchmarkType === "competitor" &&
    element.details.competitorPriority === "primary-starting-segment" &&
    element.details.prioritySegmentId === "TH-SEGMENT",
  );
  const isFocusedTasks = section === "Задания Replit";
  const isFocusedHistory = section === "История решений";

  return (
    <div className="pm-page">
      <header className="pm-topbar">
        <Link href="/" className="pm-brand" aria-label="Вернуться в администрацию TalkHint">
          <span className="pm-mark">TH</span><strong>TalkHint</strong><span>Внутренняя модель проекта</span>
        </Link>
        <div className="pm-top-actions">
          {state && <span className="pm-revision">REV {String(state.revision).padStart(4, "0")}</span>}
          <button className="pm-btn small" type="button" onClick={() => void load()} disabled={loading || saving}><RefreshCw size={13} /> Обновить</button>
          <Link className="pm-btn small" href="/"><ArrowLeft size={13} /> Админ</Link>
        </div>
      </header>

      <div className={`pm-shell ${isFocusedTasks || isFocusedHistory ? "pm-shell-focused" : ""}`}>
        <aside className="pm-sidebar" aria-label="Разделы модели">
          <p className="pm-overline">Project model / 01</p>
          <nav className="pm-nav">
            {sections.map((item, index) => (
              <div className="pm-nav-group" key={item}>
                <button type="button" onClick={() => changeSection(item)} className={section === item ? "active" : ""} aria-current={section === item ? "page" : undefined}>
                  <span className="pm-nav-index">{String(index + 1).padStart(2, "0")}</span>{item}
                </button>
                {item === "Рынок и конкуренты" && <a className={`pm-nav-subitem ${benchmarkView && section === item ? "active" : ""}`} href={projectHref("view=benchmark")} aria-current={benchmarkView && section === item ? "page" : undefined}>Конкурентный бенчмаркинг</a>}
              </div>
            ))}
          </nav>
          <div className="pm-side-note">Только планирование TalkHint. Содержимое этой модели не добавляется в инструкции телефонного агента.</div>
          <div className="pm-side-links" aria-label="Другие административные инструменты">
            <p className="pm-overline">Инструменты</p>
            <Link href="/voice-lab">Voice Lab</Link>
            <Link href="/secretary-lab">Secretary Lab</Link>
            <Link href="/">Администрация</Link>
          </div>
        </aside>

        <main className="pm-main">
          <div className="pm-heading">
            <div>
              <p className="pm-kicker">INTERNAL / ADMIN WORKSPACE</p>
              <h1>Модель проекта</h1>
              <p>Структура продукта, процессов и решений TalkHint. Подтверждение в модели не запускает разработку и не исполняет агентов.</p>
            </div>
            <div className="pm-heading-tools">
              <button className="pm-btn" type="button" onClick={() => openElement()}><Plus size={14} /> Новый элемент</button>
            </div>
          </div>

          {hypothesisContext && <section className="pm-hypothesis-switcher" aria-label="Рабочая гипотеза">
            <div className="pm-hypothesis-title">
              <p className="pm-kicker">НЕЗАВИСИМАЯ ГИПОТЕЗА</p>
              <h2>{selectedHypothesisTitle}</h2>
              <p>Отдельная модель и собственные материалы. Переключение меняет только просмотр и не выбирает основную гипотезу.</p>
            </div>
            <div className="pm-hypothesis-control">
              <label htmlFor="pm-hypothesis-select">Рабочая гипотеза</label>
              <select id="pm-hypothesis-select" value={selectedHypothesisId} disabled={loading || saving || !hypothesisContext.options.length}
                onChange={(event) => {
                  const nextId = event.target.value;
                  if (nextId === selectedHypothesisId) return;
                  if (editor && !window.confirm("В редакторе есть несохранённые данные. Перейти к другой гипотезе и закрыть редактор?")) {
                    event.currentTarget.value = selectedHypothesisId;
                    return;
                  }
                  window.location.assign(projectHref(`view=overview&hypothesis=${encodeURIComponent(nextId)}`));
                }}>
                {hypothesisContext.options.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}
              </select>
              <span className={hypothesisContext.primaryId === null ? "pm-hypothesis-primary-none" : "pm-hypothesis-note"}>
                {hypothesisContext.primaryId === null
                  ? "Основная гипотеза ещё не выбрана."
                  : "Смена представления не меняет выбранную основную гипотезу."}
              </span>
            </div>
          </section>}

          <nav className="pm-package-nav" aria-label="Пакет проекта">
            <a className={currentView === "overview" ? "active" : ""} href={projectHref("view=overview")}>Обзор пакета</a>
            <a className={currentView === "segment" ? "active" : ""} href={projectHref("view=segment")}>Сегмент</a>
            <a className={currentView === "market" ? "active" : ""} href={projectHref("view=market")}>Рынок и экономика</a>
            <a className={currentView === "difference" ? "active" : ""} href={projectHref("view=difference")}>Отличие и проверка</a>
            <a className={benchmarkView ? "active" : ""} href={projectHref("view=benchmark&suite=pilot&filter=primary")}>Основные конкуренты</a>
          </nav>

          {conflict && <div role="alert" className="pm-alert"><AlertCircle size={16} />{conflict} <button className="pm-btn small" type="button" onClick={() => setConflict("")}>Понятно</button></div>}
          {error && <div role="alert" className="pm-alert pm-error"><AlertCircle size={16} /><span>{error}</span><button className="pm-btn small" type="button" onClick={() => void load()}>Повторить</button></div>}
          {deepLinkError && <div role="alert" className="pm-alert pm-error"><AlertCircle size={16} /><span>{deepLinkError}</span><button className="pm-btn small" type="button" onClick={() => setDeepLinkError("")}>Закрыть</button></div>}

          <div className="pm-tabs" role="tablist" aria-label="Представление модели">
            <button type="button" role="tab" aria-selected={tab === "overview"} className={tab === "overview" ? "active" : ""} onClick={() => changeTab("overview")}>Обзор <span className="pm-count">{talkhintElements.length}</span></button>
            <button type="button" role="tab" aria-selected={tab === "links"} className={tab === "links" ? "active" : ""} onClick={() => changeTab("links")}>Связи <span className="pm-count">{state?.relations.length ?? 0}</span></button>
            <button type="button" role="tab" aria-selected={tab === "documents"} className={tab === "documents" ? "active" : ""} onClick={() => changeTab("documents")}>Документы <span className="pm-count">{state?.documents.length ?? 0}</span></button>
          </div>

          {loading && !state ? <div className="pm-overview-grid" aria-label="Загрузка модели"><div className="pm-skeleton" /><div className="pm-skeleton" /><div className="pm-skeleton" /><div className="pm-skeleton" /></div> : null}
          {!loading && !state && !error && <div className="pm-empty"><strong>Модель пока недоступна</strong>Повторите загрузку, чтобы получить актуальное состояние.</div>}

          {state && tab === "overview" && !isFocusedTasks && !isFocusedHistory && (
            <>
              {section === "Обзор" && <PackageViews state={state} view={currentView} openElement={openElement} submit={submit} saving={saving} selectedCompetitorId={selectedCompetitorId} />}
              {section === "Обзор" && currentView === "overview" && startingSegment && <section className="pm-starting-segment" aria-label="Стартовый сегмент">
                <div className="pm-starting-segment-copy">
                  <p className="pm-kicker">PILOT / STARTING SEGMENT</p>
                  <h2>{startingSegment.title}</h2>
                  <p>{startingSegment.description || "Описание сегмента не заполнено в модели."}</p>
                  <div className="pm-starting-segment-meta">
                    <span><strong>Решение владельца:</strong> {startingSegment.details.decisionDate || "дата не указана в модели"}</span>
                    <span>Подтверждение выбора сегмента — не доказательство прибыльности или результата пилота.</span>
                  </div>
                </div>
                <div className="pm-starting-segment-actions">
                  <a className="pm-btn small" href={projectHref("view=benchmark&filter=primary")}>Основные конкуренты</a>
                  <a className="pm-btn small" href={projectHref("view=benchmark&suite=pilot")}>Пилотные сценарии</a>
                  {primaryCompetitors.map((competitor) => <a className="pm-segment-company" key={competitor.id}
                    href={projectHref(`view=benchmark&element=${encodeURIComponent(competitor.id)}`)}>
                    Профиль: {competitor.title} <span>{competitor.id}</span>
                  </a>)}
                </div>
              </section>}

              {section === "Рынок и конкуренты" && benchmarkView && state && (selectedHypothesisId === "new-country"
                ? <CompetitorDirectory directory={state.competitorDirectory} hypothesisId={selectedHypothesisId} selectedId={selectedCompetitorId} view="benchmark" submit={submit} saving={saving} />
                : <Benchmark state={state} openElement={openElement} />)}

              {section === "Обзор" && currentView === "overview" && <section className="pm-gap-summary" aria-label="Сводка пробелов модели">
                <div className="pm-section-list-head"><h2>Что ещё требует внимания</h2><span className="pm-help">Актуально по текущей версии</span></div>
                <div className="pm-gap-metrics">
                  <div><b>{questionElements.length}</b><span>открытых вопросов / неизвестных</span></div>
                  <div><b>{incompleteActions.length}</b><span>действий с незаполненными полями</span></div>
                  <div><b>{orphanElements.length}</b><span>узлов без связей</span></div>
                  <div><b>{unresolvedCount}</b><span>узлов требуют проверки</span></div>
                </div>
                {incompleteActions.length > 0 && <div className="pm-gap-detail">Не заполнено у: {incompleteActions.slice(0, 4).map(({ element, missing }) => `${element.title} (${missing.map((key) => detailFields[key]).join(", ")})`).join(" · ")}</div>}
              </section>}

              {!isFocusedTasks && !isFocusedHistory && !(section === "Рынок и конкуренты" && benchmarkView) && !(section === "Обзор" && ["segment", "market", "difference"].includes(currentView)) && <section className="pm-section-list">
                <div className="pm-section-list-head">
                  <h2>{section}</h2>
                  <button className="pm-btn small" type="button" onClick={() => openElement()}><Plus size={12} /> Добавить элемент</button>
                </div>
                {selectedElements.length ? <div className="pm-list">
                  {selectedElements.map((element) => <div className="pm-element-row" key={element.id}>
                    <button type="button" className="pm-element-open" onClick={() => openElement(element)}>
                      <span className="pm-element-title">{element.title}</span>
                      <span className="pm-element-desc">{element.description || `ID ${element.id}`}</span>
                    </button>
                    <div className="pm-row-meta">
                      {element.scope === "salon_example" && <span className="pm-pill">Демо-салон · не данные TalkHint</span>}
                      <span className={`pm-pill ${element.contentStatus}`}>{statusLabel(element.contentStatus)}</span>
                      <span className="pm-pill implementation">{implLabel(element.implementationStatus)}</span>
                      {element.needsReview && <span className="pm-pill question">Проверить</span>}
                    </div>
                  </div>)}
                </div> : <div className="pm-empty"><strong>В этом разделе пока нет записей</strong>Создайте контекст, гипотезу, правило, действие или другой элемент модели.</div>}
              </section>}

              {section === "Обзор" && elements.some((element) => element.scope === "salon_example") && <section className="pm-section-list">
                <div className="pm-section-list-head"><h2>Демо-контекст: салон</h2><span className="pm-help">Отдельный пример · не является фактом о TalkHint</span></div>
                <div className="pm-list">{elements.filter((element) => element.scope === "salon_example").map((element) => <div className="pm-element-row" key={element.id}>
                  <button type="button" className="pm-element-open" onClick={() => openElement(element)}><span className="pm-element-title">{element.title}</span><span className="pm-element-desc">{element.section} · {element.description || element.id}</span></button>
                  <span className={`pm-pill ${element.contentStatus}`}>{statusLabel(element.contentStatus)}</span>
                </div>)}</div>
              </section>}
            </>
          )}

          {state && tab === "overview" && isFocusedTasks && (
            <>
              <section className="pm-section-list">
                <div className="pm-section-list-head"><h2>Черновик задания в Replit</h2><span className="pm-help">Только подтверждённые элементы · ничего не запускается</span></div>
                <form className="pm-form" onSubmit={(event) => void makeTask(event)}>
                  <div className="pm-field"><label htmlFor="pm-task-title">Название задания</label><input id="pm-task-title" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Например: описать маршрут передачи оператору" /></div>
                  <div className="pm-field"><label htmlFor="pm-task-acceptance">Критерии приёмки</label><textarea id="pm-task-acceptance" className="short" value={taskAcceptance} onChange={(event) => setTaskAcceptance(event.target.value)} placeholder="Как проверить результат" /></div>
                  <div className="pm-field"><span className="pm-help">Включить подтверждённые элементы TalkHint</span><div className="pm-checklist">
                    {taskSelection.length ? taskSelection.map((element) => <label className={`pm-check ${element.needsReview ? "pm-check-disabled" : ""}`} key={element.id}><input type="checkbox" disabled={element.needsReview || saving} checked={selectedTaskIds.includes(element.id)} onChange={(event) => setSelectedTaskIds(event.target.checked ? [...selectedTaskIds, element.id] : selectedTaskIds.filter((id) => id !== element.id))} /><span>{element.title}{element.needsReview && <em> — сначала завершите проверку</em>}</span></label>) : <span className="pm-help">Нет подтверждённых элементов для включения.</span>}
                  </div></div>
                  <div><button className="pm-btn primary" type="submit" disabled={saving || !readyTaskSelectedCount || !taskTitle.trim() || !taskAcceptance.trim()}><Send size={13} /> Подготовить черновик</button></div>
                  {taskError && <div className="pm-conflict" role="alert">{taskError}</div>}
                </form>
                {!!state.taskDrafts.length && <div className="pm-list" style={{ marginTop: 14 }}>
                  {state.taskDrafts.slice().reverse().map((draft) => <article className="pm-doc-card" key={draft.id}>
                    <div className="pm-section-list-head"><div><div className="pm-document-title">{draft.title}</div><div className="pm-document-meta">{dateLabel(draft.createdAt)} · {draft.references.length} ссылок на версии</div></div><button className="pm-btn small" type="button" onClick={() => void copyText(draft.text)}><Clipboard size={12} /> {copyLabel || "Копировать"}</button></div>
                    <div className="pm-task-references">{draft.references.map((reference) => {
                      const current = elements.find((element) => element.id === reference.id);
                      const stale = !current || current.version !== reference.version || current.needsReview;
                      return <span className={`pm-pill ${stale ? "question" : "confirmed"}`} key={`${reference.id}:${reference.version}`}>
                        {current?.title ?? reference.id} · v{reference.version}{current && current.version !== reference.version ? ` → v${current.version}` : ""}{current?.needsReview ? " · требует проверки" : !current ? " · узел отсутствует" : ""}
                      </span>;
                    })}</div>
                    <div className="pm-field" style={{ marginTop: 10 }}><label htmlFor={`draft-${draft.id}`}>Сохранённый текст задания</label><textarea id={`draft-${draft.id}`} readOnly value={draft.text} /></div>
                  </article>)}
                </div>}
              </section>
            </>
          )}

          {state && tab === "links" && <section>
            <div className="pm-section-list-head"><h2>Связи элементов</h2><span className="pm-help">Показываются только прямые соседи; это не полный анализ влияния.</span></div>
            <form onSubmit={(event) => void createRelation(event)} className="pm-form" style={{ marginBottom: 17 }}>
              <div className="pm-modal-grid">
                <div className="pm-field"><label htmlFor="link-from">От элемента</label><select id="link-from" value={relationDraft.from} onChange={(event) => setRelationDraft({ ...relationDraft, from: event.target.value })}><option value="">Выберите элемент</option>{elements.map((el) => <option value={el.id} key={el.id}>{el.scope === "salon_example" ? "Демо-салон · " : ""}{el.title} · {el.id}</option>)}</select></div>
                <div className="pm-field"><label htmlFor="link-to">К элементу</label><select id="link-to" value={relationDraft.to} onChange={(event) => setRelationDraft({ ...relationDraft, to: event.target.value })}><option value="">Выберите элемент</option>{elements.map((el) => <option value={el.id} key={el.id}>{el.scope === "salon_example" ? "Демо-салон · " : ""}{el.title} · {el.id}</option>)}</select></div>
                <div className="pm-field"><label htmlFor="link-label">Смысл связи</label><input id="link-label" value={relationDraft.label} onChange={(event) => setRelationDraft({ ...relationDraft, label: event.target.value })} placeholder="например: требует / создаёт" /></div>
                <div className="pm-footer-actions" style={{ alignSelf: "end" }}><button className="pm-btn primary" type="submit" disabled={saving || !relationDraft.from || !relationDraft.to || !relationDraft.label.trim()}>{relationDraft.id ? <Save size={13} /> : <Plus size={13} />}{relationDraft.id ? "Сохранить связь" : "Добавить связь"}</button>{relationDraft.id && <button className="pm-btn" type="button" onClick={() => setRelationDraft({ from: "", to: "", label: "" })}>Отмена</button>}</div>
              </div>
            </form>
            {(state.relations.length > 0) ? <div className="pm-link-list">{state.relations.map((relation) => {
              const from = elements.find((el) => el.id === relation.from);
              const to = elements.find((el) => el.id === relation.to);
              return <article className="pm-link-card" key={relation.id}>
                <div><div className="pm-link-label">{relation.label}</div><div className="pm-link-nodes">
                  {from ? <button type="button" className="pm-node-link" onClick={() => openElement(from)}>{from.scope === "salon_example" ? "Демо-салон · " : ""}{from.title} <small>{from.id}</small></button> : <span>Отсутствует: {relation.from}</span>}
                  <span aria-hidden="true"> → </span>
                  {to ? <button type="button" className="pm-node-link" onClick={() => openElement(to)}>{to.scope === "salon_example" ? "Демо-салон · " : ""}{to.title} <small>{to.id}</small></button> : <span>Отсутствует: {relation.to}</span>}
                </div></div>
                <div className="pm-footer-actions">
                  <button className="pm-btn small" type="button" disabled={saving} onClick={() => setRelationDraft({ id: relation.id, from: relation.from, to: relation.to, label: relation.label })}>Изменить</button>
                  <button className="pm-btn small danger" type="button" disabled={saving} aria-label={`Удалить связь ${relation.label}`} onClick={() => void submit({ type: "removeRelation", id: relation.id })}><X size={12} /> Удалить</button>
                </div>
              </article>;
            })}</div> : <div className="pm-empty"><strong>Связей пока нет</strong>Добавьте отношения между элементами, чтобы зафиксировать зависимости и переходы.</div>}
            <div className="pm-missing"><h3>Элементы без связей · {orphanElements.length}</h3>{orphanElements.length ? <div className="pm-checklist">{orphanElements.map((el) => <button type="button" className="pm-node-link" key={el.id} onClick={() => openElement(el)}>{el.scope === "salon_example" ? "Демо-салон · " : ""}{el.title} · {el.id}</button>)}</div> : <span className="pm-help">Все элементы уже участвуют хотя бы в одной связи.</span>}</div>
          </section>}

          {state && tab === "documents" && <section>
            <div className="pm-section-list-head"><div><h2>Документы и источники</h2><span className="pm-help">Материалы с URL и привязкой к элементам модели</span></div><button className="pm-btn small" type="button" onClick={() => { setDocumentDraft({ title: "", text: "", url: "", elementIds: [], id: undefined }); setEditingDocument(true); }}><Plus size={12} /> Новый документ</button></div>
            {editingDocument && <form className="pm-doc-card pm-form" onSubmit={(event) => void saveDocument(event)} style={{ marginBottom: 12 }}>
              <div className="pm-field"><label htmlFor="doc-title">Название</label><input id="doc-title" value={documentDraft.title} onChange={(event) => setDocumentDraft({ ...documentDraft, title: event.target.value })} required /></div>
              <div className="pm-field"><label htmlFor="doc-url">Источник или путь</label><input id="doc-url" type="text" value={documentDraft.url} onChange={(event) => setDocumentDraft({ ...documentDraft, url: event.target.value })} placeholder="https://… или /admin/secretary-lab" /></div>
              <div className="pm-field"><label htmlFor="doc-text">Текст / выдержка</label><textarea id="doc-text" value={documentDraft.text} onChange={(event) => setDocumentDraft({ ...documentDraft, text: event.target.value })} /></div>
              <div className="pm-field"><span className="pm-help">Связанные элементы</span><div className="pm-checklist">{elements.map((el) => <label className="pm-check" key={el.id}><input type="checkbox" checked={documentDraft.elementIds.includes(el.id)} onChange={(event) => setDocumentDraft({ ...documentDraft, elementIds: event.target.checked ? [...documentDraft.elementIds, el.id] : documentDraft.elementIds.filter((id) => id !== el.id) })} /><span>{el.scope === "salon_example" ? "Демо-салон · " : ""}{el.title} <small>{el.id}</small></span></label>)}</div></div>
              <div className="pm-footer-actions"><button className="pm-btn primary" disabled={saving} type="submit"><Save size={13} /> Сохранить</button><button className="pm-btn" type="button" disabled={saving} onClick={() => { setEditingDocument(false); setDocumentDraft({ title: "", text: "", url: "", elementIds: [], id: undefined }); }}>Отмена</button></div>
            </form>}
            {state.documents.length ? <div className="pm-doc-list">{state.documents.map((doc) => <DocumentCard key={doc.id} document={doc} elements={elements} saving={saving} onEdit={() => { setDocumentDraft({ id: doc.id, title: doc.title, text: doc.text, url: doc.url, elementIds: [...doc.elementIds] }); setEditingDocument(true); }} />)}</div> : !editingDocument && <div className="pm-empty"><strong>Документы не добавлены</strong>Сохраните источник, заметку или выдержку и свяжите её с узлами модели.</div>}
          </section>}

          {state && tab === "overview" && isFocusedHistory && <section className="pm-section-list">
            <div className="pm-section-list-head"><h2><History size={14} style={{ display: "inline", verticalAlign: "middle", marginRight: 5 }} />История решений</h2><span className="pm-help">{state.decisions.length} событий · {unresolvedCount} элементов требуют проверки</span></div>
            {state.decisions.length ? <div className="pm-history-list">{state.decisions.slice().reverse().map((decision) => <article className="pm-history-card" key={decision.id}>
              <div className="pm-proposal-head"><strong>{decision.action}</strong><span className="pm-help">{dateLabel(decision.at)} · {decision.actor}</span></div>
              {decision.reason && <p className="pm-document-meta">{decision.reason}</p>}
              {decision.elementIds.length > 0 && <p className="pm-document-meta">Элементы: {decision.elementIds.map((id) => elements.find((el) => el.id === id)?.title ?? id).join(" · ")}</p>}
              {decision.before && decision.after && <div className="pm-version-diff"><div><b>До · v{decision.before.version}</b>{decision.before.title}{"\n"}{decision.before.description}</div><div><b>После · v{decision.after.version}</b>{decision.after.title}{"\n"}{decision.after.description}</div></div>}
              <details className="pm-audit-details"><summary>Все снимки и поля записи</summary><pre>{JSON.stringify(decision, null, 2)}</pre></details>
            </article>)}</div> : <div className="pm-empty"><strong>Решений пока нет</strong>История появится после первых сохранений и подтверждений.</div>}
          </section>}
        </main>

        {!isFocusedTasks && !isFocusedHistory && <aside className="pm-panel" aria-label="От разговора к модели">
          <p className="pm-kicker">MANUAL INTAKE</p>
          <h2 className="pm-panel-title">От разговора к модели</h2>
          <p className="pm-panel-subtitle">Ручной перенос контекста и правок. Интеграции с ChatGPT здесь нет — следующий этап требует отдельного подключения и проверки.</p>
          <div className="pm-source-note"><Sparkles size={13} style={{ display: "inline", marginRight: 5 }} />Фрагмент разговора вводит администратор; он не извлекается автоматически.</div>
          <div className="pm-form" style={{ marginTop: 12 }}>
            <div className="pm-field"><label htmlFor="proposal-source">Источник / фрагмент разговора</label><textarea id="proposal-source" value={proposalForm.source} onChange={(event) => setProposalForm({ ...proposalForm, source: event.target.value })} placeholder="Вставьте цитату или укажите источник вручную" /></div>
            <div className="pm-field"><label htmlFor="proposal-target">Изменяемый элемент</label><select id="proposal-target" value={proposalForm.targetId} onChange={(event) => {
              const target = elements.find((el) => el.id === event.target.value);
              setProposalForm({ ...proposalForm, targetId: event.target.value, change: target ? { title: target.title, section: target.section, scope: target.scope, kind: target.kind, description: target.description, contentStatus: target.contentStatus, implementationStatus: target.implementationStatus, details: { ...target.details } } : proposalForm.change });
            }}><option value="">Выберите существующий узел</option>{elements.map((el) => <option key={el.id} value={el.id}>{el.scope === "salon_example" ? "Демо-салон · " : ""}{el.title} · {el.id}</option>)}</select></div>
            <div className="pm-field"><label htmlFor="proposal-title">Предлагаемое название</label><input id="proposal-title" value={proposalForm.change.title} onChange={(event) => setProposalForm({ ...proposalForm, change: { ...proposalForm.change, title: event.target.value } })} placeholder="Коротко и предметно" /></div>
            <div className="pm-field"><label htmlFor="proposal-description">Описание изменения</label><textarea id="proposal-description" value={proposalForm.change.description} onChange={(event) => setProposalForm({ ...proposalForm, change: { ...proposalForm.change, description: event.target.value } })} /></div>
            <div className="pm-modal-grid">
              <div className="pm-field"><label htmlFor="proposal-section">Раздел</label><select id="proposal-section" value={proposalForm.change.section} onChange={(event) => setProposalForm({ ...proposalForm, change: { ...proposalForm.change, section: event.target.value as ElementInput["section"] } })}>{sections.map((item) => <option value={item} key={item}>{item}</option>)}</select></div>
              <div className="pm-field"><label htmlFor="proposal-kind">Тип</label><select id="proposal-kind" value={proposalForm.change.kind} onChange={(event) => setProposalForm({ ...proposalForm, change: { ...proposalForm.change, kind: event.target.value as ElementInput["kind"] } })}>{elementKinds.map((kind) => <option value={kind} key={kind}>{kind}</option>)}</select></div>
              <div className="pm-field"><label htmlFor="proposal-implementation">Статус реализации</label><select id="proposal-implementation" value={proposalForm.change.implementationStatus} onChange={(event) => setProposalForm({ ...proposalForm, change: { ...proposalForm.change, implementationStatus: event.target.value as ElementInput["implementationStatus"] } })}>{Object.entries(implementationStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
              <div className="pm-field"><label htmlFor="proposal-scope">Область</label><select id="proposal-scope" value={proposalForm.change.scope} onChange={(event) => setProposalForm({ ...proposalForm, change: { ...proposalForm.change, scope: event.target.value as ElementInput["scope"] } })}><option value="talkhint">TalkHint</option><option value="salon_example">Демо-салон (пример)</option></select></div>
            </div>
            <div className="pm-field"><label htmlFor="proposal-rationale">Почему это изменение</label><textarea id="proposal-rationale" className="short" value={proposalForm.rationale} onChange={(event) => setProposalForm({ ...proposalForm, rationale: event.target.value })} placeholder="Основание / контекст" /></div>
            <div className="pm-field"><label htmlFor="proposal-status">Статус содержания</label><select id="proposal-status" value={proposalForm.change.contentStatus} onChange={(event) => setProposalForm({ ...proposalForm, change: { ...proposalForm.change, contentStatus: event.target.value as ElementInput["contentStatus"] } })}>{Object.entries(contentStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
            <details className="pm-details"><summary>Подробные поля изменения</summary><div className="pm-detail-grid">{(Object.entries(detailFields) as [keyof typeof detailFields, string][]).map(([key, label]) => <div className="pm-field" key={key}><label htmlFor={`proposal-detail-${key}`}>{label}</label><textarea id={`proposal-detail-${key}`} className="short" value={proposalForm.change.details[key] ?? ""} onChange={(event) => setProposalForm({ ...proposalForm, change: { ...proposalForm.change, details: { ...proposalForm.change.details, [key]: event.target.value } } })} /></div>)}</div></details>
            <div className="pm-field"><span className="pm-help">Затронутые IDs той же области. Проверка связей охватывает только прямых соседей и не является полным анализом влияния.</span><div className="pm-checklist">{proposalScopeElements.filter((el) => el.id !== proposalForm.targetId).map((el) => <label className="pm-check" key={el.id}><input type="checkbox" checked={proposalForm.relatedIds.includes(el.id)} onChange={(event) => setProposalForm({ ...proposalForm, relatedIds: event.target.checked ? [...proposalForm.relatedIds, el.id] : proposalForm.relatedIds.filter((id) => id !== el.id) })} /><span>{el.title}</span></label>)}</div></div>
            <button className="pm-btn" type="button" disabled={!proposalForm.targetId} onClick={() => setProposalEditorOpen(true)}><FileText size={13} /> Открыть все поля предложения</button>
            <button className="pm-btn primary" type="button" disabled={saving || !proposalForm.targetId || !proposalForm.change.title.trim()} onClick={() => void saveProposal()}><Save size={13} /> Сохранить предложение</button>
          </div>
          {currentProposalTarget && <p className="pm-help" style={{ marginTop: 8 }}>Цель: {currentProposalTarget.title} · v{currentProposalTarget.version}</p>}

          <div className="pm-panel-divider" />
          <div className="pm-section-list-head"><h3 className="pm-panel-title" style={{ fontSize: 13 }}>Предложения на разбор</h3><span className="pm-count">{pendingProposals.length}</span></div>
          {pendingProposals.length ? pendingProposals.map((proposal) => <div className="pm-proposal-card" key={proposal.id}>
            <div className="pm-proposal-head"><h4>{proposal.change.title}</h4><span className={`pm-pill ${proposal.status === "clarification" ? "question" : ""}`}>{proposal.status === "clarification" ? "Уточнение" : "Ожидает"}</span></div>
            <p>{proposal.rationale || "Основание не указано"}</p><p>Цель: {elements.find((el) => el.id === proposal.targetId)?.title ?? proposal.targetId} · base v{proposal.baseVersion}</p>
            {proposal.source && <p>Источник: {proposal.source}</p>}
            {proposal.clarification && <p className="pm-conflict">Запрос уточнения: {proposal.clarification}</p>}
            <div className="pm-footer-actions" style={{ marginTop: 9 }}>
              <button className="pm-btn small" type="button" onClick={() => editProposal(proposal)}><FileText size={11} /> Редактировать</button>
              <button className="pm-btn small primary" type="button" disabled={saving} onClick={() => void submit({ type: "approveProposal", id: proposal.id })}><Check size={11} /> Подтвердить</button>
              <button className="pm-btn small" type="button" onClick={() => { setClarifyId(clarifyId === proposal.id ? null : proposal.id); setClarifyNote(""); }}>Уточнить</button>
            </div>
            {clarifyId === proposal.id && <div className="pm-form" style={{ marginTop: 9 }}><div className="pm-field"><label htmlFor={`clarify-${proposal.id}`}>Что нужно уточнить</label><textarea id={`clarify-${proposal.id}`} className="short" value={clarifyNote} onChange={(event) => setClarifyNote(event.target.value)} /></div><button className="pm-btn small" type="button" disabled={saving || !clarifyNote.trim()} onClick={async () => { if (await submit({ type: "clarifyProposal", id: proposal.id, note: clarifyNote.trim() })) { setClarifyId(null); setClarifyNote(""); } }}>Запросить уточнение</button></div>}
          </div>) : <div className="pm-empty" style={{ padding: 17 }}><strong>Новых предложений нет</strong>Изменения подтверждённых узлов проходят только через согласование.</div>}
          <div className="pm-panel-divider" />
          <div className="pm-callout"><ShieldCheck size={13} style={{ display: "inline", marginRight: 5 }} />Crew здесь не запускает агентов. Подготовка задания сохраняет текст и ссылки на версии; выполнять его нужно отдельно.</div>
        </aside>}
      </div>

      {editor && <ElementEditor
        initial={editor.value} id={editor.id} version={elements.find((element) => element.id === editor.id)?.version} busy={saving} mode="element"
        needsReview={elements.find((element) => element.id === editor.id)?.needsReview ?? false}
        onClose={closeElementEditor}
        onSave={(value) => void saveElement(value, editor.id)}
        onReview={async (reason) => {
          if (editor.id && await submit({ type: "reviewElement", id: editor.id, reason })) closeElementEditor();
        }}
      />}
      {proposalEditorOpen && <ElementEditor
        initial={proposalForm.change} busy={saving} mode="proposal" needsReview={false}
        onClose={() => setProposalEditorOpen(false)}
        onSave={(value) => { setProposalForm({ ...proposalForm, change: value }); setProposalEditorOpen(false); }}
      />}
    </div>
  );
}

function ElementEditor({ initial, id, version, busy, needsReview, mode = "element", onClose, onSave, onReview }: {
  initial: ElementInput; id?: string; version?: number; busy: boolean; needsReview: boolean;
  mode?: "element" | "proposal"; onClose: () => void;
  onSave: (value: ElementInput) => void; onReview?: (reason: string) => void;
}) {
  const [value, setValue] = useState<ElementInput>({ ...initial, details: { ...initial.details } });
  const [reviewReason, setReviewReason] = useState("");
  const detailEntries = Object.entries(detailFields) as [keyof typeof detailFields, string][];
  function change<K extends keyof ElementInput>(key: K, next: ElementInput[K]) { setValue((current) => ({ ...current, [key]: next })); }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="pm-modal pm-dialog" aria-describedby="element-editor-description">
      <div className="pm-modal-head"><div><p className="pm-kicker">{mode === "proposal" ? "EDIT PROPOSAL" : id ? "EDIT ELEMENT" : "NEW ELEMENT"} · CONTENT ≠ IMPLEMENTATION</p><DialogTitle id="element-editor-title">{mode === "proposal" ? "Изменение в предложении" : id ? "Карточка элемента" : "Новый элемент модели"}</DialogTitle><DialogDescription id="element-editor-description" className="pm-help">{mode === "proposal" ? "Эти поля изменяют только черновик предложения. Сохранение узла произойдёт только через его согласование." : id ? `Постоянный ID: ${id}${version ? ` · версия ${version}` : ""}` : "ID будет назначен моделью после сохранения."}</DialogDescription></div><button type="button" className="pm-btn small pm-dialog-close" onClick={onClose} aria-label="Закрыть"><X size={14} /></button></div>
      <form className="pm-modal-body" onSubmit={(event) => { event.preventDefault(); onSave(value); }}>
        <div className="pm-modal-grid">
          <div className="pm-field"><label htmlFor="element-title">Название</label><input id="element-title" required value={value.title} onChange={(event) => change("title", event.target.value)} /></div>
          <div className="pm-field"><label htmlFor="element-kind">Тип элемента</label><select id="element-kind" value={value.kind} onChange={(event) => change("kind", event.target.value as ElementInput["kind"])}>{elementKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></div>
          <div className="pm-field"><label htmlFor="element-section">Раздел</label><select id="element-section" value={value.section} onChange={(event) => change("section", event.target.value as ElementInput["section"])}>{sections.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
          <div className="pm-field"><label htmlFor="element-scope">Область</label><select id="element-scope" value={value.scope} onChange={(event) => change("scope", event.target.value as ElementInput["scope"])}><option value="talkhint">TalkHint</option><option value="salon_example">Демо-салон (пример)</option></select><span className="pm-help">Данные салона — отдельный демонстрационный контекст, не факты TalkHint.</span></div>
          <div className="pm-field"><label htmlFor="element-content-status">Статус содержания</label><select id="element-content-status" value={value.contentStatus} onChange={(event) => change("contentStatus", event.target.value as ElementInput["contentStatus"])}>{Object.entries(contentStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
          <div className="pm-field"><label htmlFor="element-implementation-status">Статус реализации</label><select id="element-implementation-status" value={value.implementationStatus} onChange={(event) => change("implementationStatus", event.target.value as ElementInput["implementationStatus"])}>{Object.entries(implementationStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
          <div className="pm-field wide"><label htmlFor="element-description">Описание</label><textarea id="element-description" value={value.description} onChange={(event) => change("description", event.target.value)} /></div>
        </div>
        <details className="pm-details" open>
          <summary>Подробные поля модели <ChevronDown size={13} style={{ verticalAlign: "middle", marginLeft: 4 }} /></summary>
          <div className="pm-detail-grid">{detailEntries.map(([key, label]) => <div className="pm-field" key={key}>
            <label htmlFor={`detail-${key}`}>{label}</label><textarea id={`detail-${key}`} className="short" value={value.details[key] ?? ""} onChange={(event) => setValue({ ...value, details: { ...value.details, [key]: event.target.value } })} />
          </div>)}</div>
        </details>
        {needsReview && <div className="pm-callout" style={{ marginTop: 12 }}>
          <strong>Элемент помечен для проверки.</strong>
          <div className="pm-field" style={{ marginTop: 8 }}><label htmlFor="review-reason">Основание проверки</label><input id="review-reason" value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} placeholder="Что было проверено" /></div>
          <button type="button" className="pm-btn small" style={{ marginTop: 8 }} disabled={busy || !reviewReason.trim() || !onReview} onClick={() => onReview?.(reviewReason.trim())}><Check size={12} /> Отметить проверенным</button>
        </div>}
        <div className="pm-modal-footer">
          <span className="pm-help">{mode === "proposal" ? "Изменения останутся в форме предложения и не будут применены к узлу." : id ? "Сохранение создаст новую версию; ID сохраняется." : "Черновик будет записан в выбранную область."}</span>
          <div className="pm-footer-actions"><button type="button" className="pm-btn" onClick={onClose}>Отмена</button><button type="submit" className="pm-btn primary" disabled={busy || !value.title.trim()}><Save size={13} /> {busy ? "Сохранение…" : mode === "proposal" ? "Внести в предложение" : "Сохранить"}</button></div>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

function DocumentCard({ document, elements, saving, onEdit }: {
  document: ModelDocument; elements: ModelElement[]; saving: boolean; onEdit: () => void;
}) {
  return <article className="pm-doc-card">
    <div className="pm-section-list-head"><div><div className="pm-document-title">{document.title}</div><div className="pm-document-meta">{dateLabel(document.updatedAt)}</div></div><div className="pm-footer-actions"><button className="pm-btn small" type="button" disabled={saving} onClick={onEdit}>Изменить</button></div></div>
    {document.url && <a href={document.url} target="_blank" rel="noreferrer" className="pm-document-meta">{document.url}</a>}
    <div className="pm-doc-text">{document.text || "Текст не добавлен."}</div>
    {document.text && <details className="pm-doc-full"><summary>Показать полный текст</summary><pre>{document.text}</pre></details>}
    <div className="pm-document-meta">Связанные: {document.elementIds.map((id) => {
      const element = elements.find((el) => el.id === id);
      return `${element?.scope === "salon_example" ? "Демо-салон · " : ""}${element?.title ?? "Неизвестный узел"} · ${id}`;
    }).join(" · ") || "нет"}</div>
  </article>;
}
