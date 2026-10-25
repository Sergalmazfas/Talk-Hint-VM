import React, { useEffect, useMemo, useRef, useState } from "react";
import { defaultOperatingModel, emptyWorkNode } from "@shared/operatingModelTemplate";
import {
  kindLabels, linkLabels, workGaps, workKinds, workLinks,
  type OperatingData, type WorkKind, type WorkLink, type WorkNode,
} from "@shared/operatingModel";
import type { ModelCommand, ProjectModelState } from "@shared/projectModel";
import { strategyEntries } from "@shared/projectStrategy";
import operatingGuide from "../../../../docs/talkhint-operating-model.md?raw";
import CompanyStructureViews from "./CompanyStructureViews";
import companyStructureGuide from "../../../../docs/talkhint-company-structure.md?raw";
import TeamView from "./TeamView";

type Props = { state: ProjectModelState; submit?: (command: ModelCommand) => Promise<boolean>; saving?: boolean };
type ViewKey = "overview" | "company" | "management" | "journey" | "actions" | "process" | "client" | "crew" | "team" | "objects" | "tools" | "gaps" | "history" | "coverage" | "docs";
const views: { id: ViewKey; label: string; kinds?: WorkKind[] }[] = [
  { id: "overview", label: "Обзор" }, { id: "company", label: "Компания" }, { id: "management", label: "Подчинение" }, { id: "journey", label: "Путь клиента" },
  { id: "actions", label: "Действия", kinds: ["action"] },
  { id: "process", label: "Процессы", kinds: ["process", "capability", "need", "context"] },
  { id: "client", label: "Клиенты", kinds: ["client", "result", "report"] },
  { id: "crew", label: "Crew и роли", kinds: ["role", "department", "crew"] }, { id: "team", label: "Команда" },
  { id: "objects", label: "Объекты", kinds: ["resource", "report", "result"] },
  { id: "tools", label: "Инструменты", kinds: ["resource"] },
  { id: "gaps", label: "Пробелы" }, { id: "coverage", label: "Покрытие" },
  { id: "docs", label: "Документы" }, { id: "history", label: "История" },
];
const weekdays: { day: number; label: string }[] = [
  { day: 1, label: "Пн" }, { day: 2, label: "Вт" }, { day: 3, label: "Ср" },
  { day: 4, label: "Чт" }, { day: 5, label: "Пт" }, { day: 6, label: "Сб" }, { day: 7, label: "Вс" },
];
const stableSnapshot = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableSnapshot).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSnapshot(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
};
const selectedHypothesis = (state: ProjectModelState) =>
  state.hypothesisContext?.selectedId || (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("hypothesis") : null);
const uuid = () => globalThis.crypto?.randomUUID?.() ?? `work-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const dateLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });
};
const documentFilename = (title: string) => {
  const safe = title.normalize("NFKD").replace(/[^\w\u0400-\u04FF._ -]+/g, "").replace(/[\s.]+$/g, "").trim();
  return `${(safe || "saved-document").slice(0, 100)}.md`;
};

function Field({ label, value, onChange, multiline = false, hint }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; hint?: string }) {
  return <label className="om-field"><span>{label}</span>{multiline
    ? <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={3} />
    : <input value={value} onChange={(event) => onChange(event.target.value)} />}
    {hint && <small>{hint}</small>}</label>;
}

export default function OperatingModelView({ state, submit, saving = false }: Props) {
  const revision = state.operatingModel?.revisions.at(-1);
  const [draft, setDraft] = useState<OperatingData>(() => structuredClone(revision?.data ?? defaultOperatingModel()));
  const [baseVersion, setBaseVersion] = useState(revision?.version ?? 0);
  const [activeView, setActiveView] = useState<ViewKey>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("workView") === "team" ? "team" : "overview",
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newLink, setNewLink] = useState<{ from: string; to: string; kind: WorkLink["kind"]; reason: string }>({ from: "", to: "", kind: "requires", reason: "" });
  const submittedSnapshot = useRef<string | null>(null);
  const saveSignal = useRef(0);
  const openedWorkQuery = useRef(false);
  const [signal, setSignal] = useState(0);
  const switchView = (view: ViewKey) => {
    setActiveView(view);
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (view === "team") params.set("workView", "team");
      else { params.delete("workView"); params.delete("teamView"); }
      window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
    }
  };

  useEffect(() => {
    if (!revision || !submittedSnapshot.current) return;
    if (stableSnapshot(revision.data) === submittedSnapshot.current) {
      setBaseVersion(revision.version);
      submittedSnapshot.current = null;
    }
  }, [revision, signal]);

  const nodeMap = useMemo(() => new Map(draft.nodes.map((node) => [node.id, node])), [draft.nodes]);
  const strategyReferences = useMemo(() => strategyEntries(state), [state]);
  const availableReferenceIds = useMemo(() => new Set([
    ...draft.nodes.map((node) => node.id),
    ...state.elements.map((element) => element.id),
    ...state.documents.map((document) => document.id),
    ...strategyReferences.map((entry) => entry.key),
    ...(state.analystPreparation?.revisions.length ? ["analyst-preparation"] : []),
  ]), [draft.nodes, state.elements, state.documents, state.analystPreparation, strategyReferences]);
  const selected = selectedId ? nodeMap.get(selectedId) : undefined;
  const gaps = useMemo(() => workGaps(draft), [draft]);
  const visibleNodes = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ru");
    const kinds = views.find((view) => view.id === activeView)?.kinds;
    if (activeView === "gaps") return draft.nodes.filter((node) => gaps.some((gap) => gap.id === node.id) &&
      (!query || `${node.code} ${node.name} ${gaps.filter((gap) => gap.id === node.id).map((gap) => gap.message).join(" ")}`.toLocaleLowerCase("ru").includes(query)));
    if (activeView === "docs") return draft.nodes.filter((node) =>
      (node.referenceIds.length > 0 || node.description || node.questions) &&
      (!query || `${node.code} ${node.name} ${node.referenceIds.join(" ")} ${node.description} ${node.questions}`.toLocaleLowerCase("ru").includes(query)));
    return draft.nodes.filter((node) => (!kinds || kinds.includes(node.kind)) &&
      (!query || `${node.code} ${node.name} ${node.description} ${kindLabels[node.kind]}`.toLocaleLowerCase("ru").includes(query)));
  }, [activeView, draft.nodes, gaps, search]);
  const visibleIds = useMemo(() => {
    const result = new Set(visibleNodes.map((node) => node.id));
    visibleNodes.forEach((node) => {
      let parent = node.parentId;
      const visited = new Set<string>([node.id]);
      while (parent && nodeMap.has(parent) && !visited.has(parent)) {
        visited.add(parent);
        result.add(parent);
        parent = nodeMap.get(parent)?.parentId ?? null;
      }
    });
    return result;
  }, [visibleNodes, nodeMap]);
  const childrenByParent = useMemo(() => {
    const groups = new Map<string | null, WorkNode[]>();
    draft.nodes.forEach((node) => groups.set(node.parentId, [...(groups.get(node.parentId) ?? []), node]));
    groups.forEach((children) => children.sort((a, b) => a.code.localeCompare(b.code, "ru")));
    return groups;
  }, [draft.nodes]);
  const patchNode = (id: string, patch: Partial<WorkNode>) =>
    setDraft((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === id ? { ...node, ...patch } : node) }));
  const patchCustomerPath = (id: string, patch: Partial<NonNullable<OperatingData["customerPath"]>[number]>) =>
    setDraft((current) => ({ ...current, customerPath: (current.customerPath ?? []).map((stage) => stage.id === id ? { ...stage, ...patch } : stage) }));
  const patchSchedule = (key: keyof WorkNode["schedule"], value: string | number[]) => {
    if (!selected) return;
    patchNode(selected.id, { schedule: { ...selected.schedule, [key]: value } });
  };
  const addNode = (kind: WorkKind) => {
    const id = uuid();
    const parentId = selected?.id ?? null;
    const code = `${kind.toUpperCase().slice(0, 3)}-${String(draft.nodes.length + 1).padStart(2, "0")}`;
    const node = emptyWorkNode(id, code, `Новый элемент · ${kindLabels[kind]}`, kind, parentId);
    setDraft((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedId(id);
    setExpanded((current) => { const next = new Set(current); if (parentId) next.add(parentId); return next; });
    setError(""); setNotice("");
  };
  const removeNode = (node: WorkNode) => {
    if (!window.confirm(`Удалить «${node.name}» из текущего черновика? Связанные ссылки и поля будут очищены.`)) return;
    setDraft((current) => ({
      ...current,
      nodes: current.nodes.filter((item) => item.id !== node.id).map((item) => ({
        ...item,
        parentId: item.parentId === node.id ? null : item.parentId,
        managerId: item.managerId === node.id ? null : item.managerId,
        clientId: item.clientId === node.id ? null : item.clientId,
        roleId: item.roleId === node.id ? null : item.roleId,
        executorId: item.executorId === node.id ? null : item.executorId,
        recipientId: item.recipientId === node.id ? null : item.recipientId,
        acceptorId: item.acceptorId === node.id ? null : item.acceptorId,
        nextId: item.nextId === node.id ? null : item.nextId,
        resourceIds: item.resourceIds.filter((id) => id !== node.id),
        inputs: item.inputs.map((input) => input.sourceId === node.id ? { ...input, sourceId: null } : input),
        referenceIds: item.referenceIds.filter((id) => id !== node.id),
      })),
      links: current.links.filter((link) => link.from !== node.id && link.to !== node.id),
      customerPath: current.customerPath?.map((stage) => stage.processId === node.id ? { ...stage, processId: "" } : stage),
    }));
    setSelectedId(null);
  };
  const addLink = () => {
    if (!newLink.from || !newLink.to || newLink.from === newLink.to) return;
    const link: WorkLink = { id: uuid(), ...newLink };
    setDraft((current) => ({ ...current, links: [...current.links, link] }));
    setNewLink((current) => ({ ...current, reason: "" }));
  };
  const validationMessage = () => {
    const codes = draft.nodes.map((node) => node.code.trim().toLocaleLowerCase("ru")).filter(Boolean);
    if (new Set(codes).size !== codes.length) return "Коды узлов должны быть уникальными.";
    const ids = new Set(draft.nodes.map((node) => node.id));
    if (ids.size !== draft.nodes.length) return "Найдены повторяющиеся ID узлов.";
    const linkKeys = draft.links.map((link) => `${link.from}\u0000${link.to}\u0000${link.kind}`);
    if (new Set(linkKeys).size !== linkKeys.length) return "В модели есть повторяющиеся типизированные связи.";
    const parents = new Map(draft.nodes.map((node) => [node.id, node.parentId]));
    for (const node of draft.nodes) {
      const visited = new Set<string>([node.id]);
      let parent = node.parentId;
      while (parent) {
        if (visited.has(parent)) return `Цикл вложенности обнаружен у «${node.name}».`;
        visited.add(parent);
        parent = parents.get(parent) ?? null;
      }
      const references = [node.parentId, node.managerId ?? null, node.clientId, node.roleId, node.executorId, node.recipientId, node.acceptorId, node.nextId, ...node.resourceIds, ...node.inputs.map((input) => input.sourceId)];
      if (references.some((id) => id !== null && !ids.has(id))) return `В узле «${node.name}» осталась ссылка на отсутствующий ID.`;
      if (node.referenceIds.some((reference) => reference && !availableReferenceIds.has(reference))) return `В основаниях узла «${node.name}» есть неизвестный ID. Выберите существующий элемент, документ, стратегию или подготовку аналитика.`;
      if (node.schedule.days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) return `В расписании узла «${node.name}» есть день вне диапазона 1–7. Исправьте его перед сохранением.`;
    }
    if (draft.links.some((link) => !ids.has(link.from) || !ids.has(link.to))) return "Связь ссылается на отсутствующий узел.";
    return "";
  };
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!submit) { setError("Сохранение недоступно: команда модели не подключена."); return; }
    setError(""); setNotice("");
    const validation = validationMessage();
    if (validation) { setError(validation); return; }
    const snapshot = structuredClone(draft);
    const ok = await submit({ type: "saveOperatingModel", baseVersion, data: snapshot });
    if (ok) {
      submittedSnapshot.current = stableSnapshot(snapshot);
      saveSignal.current += 1;
      setSignal(saveSignal.current);
      setNotice("Команда принята. Черновик останется несохранённым, пока новая ревизия не появится в данных модели.");
    } else setError("Сохранение отклонено или конфликт версий. Черновик и основание не изменены; обновите данные и сверьте историю.");
  };
  const relatedUsage = selected ? draft.nodes.filter((node) =>
    node.clientId === selected.id || node.roleId === selected.id || node.executorId === selected.id ||
    node.recipientId === selected.id || node.acceptorId === selected.id || node.resourceIds.includes(selected.id) ||
    node.parentId === selected.id || node.managerId === selected.id || node.nextId === selected.id) : [];
  const referenceLinks = draft.links.filter((link) => link.from === selected?.id || link.to === selected?.id);
  const selectNode = (id: string) => {
    setSelectedId(id);
    setExpanded((current) => {
      const next = new Set(current);
      let parent = nodeMap.get(id)?.parentId;
      const visited = new Set<string>([id]);
      while (parent && !visited.has(parent)) {
        visited.add(parent);
        next.add(parent);
        parent = nodeMap.get(parent)?.parentId ?? null;
      }
      return next;
    });
  };
  const openNode = (id: string) => { selectNode(id); switchView("overview"); };
  useEffect(() => {
    if (openedWorkQuery.current || typeof window === "undefined") return;
    const workId = new URLSearchParams(window.location.search).get("work");
    if (!workId || !nodeMap.has(workId)) return;
    openedWorkQuery.current = true;
    openNode(workId);
  }, [nodeMap]);
  const renderTree = (parentId: string | null, depth = 0, ancestors = new Set<string>()): React.ReactNode => (childrenByParent.get(parentId) ?? [])
    .filter((node) => visibleIds.has(node.id))
    .map((node) => {
      if (ancestors.has(node.id)) return null;
      const hasChildren = (childrenByParent.get(node.id) ?? []).some((child) => visibleIds.has(child.id));
      const isOpen = expanded.has(node.id) || (!!search && hasChildren);
      const descendantAncestors = new Set(ancestors);
      descendantAncestors.add(node.id);
      return <React.Fragment key={node.id}>
        <button type="button" className={`om-tree-row ${selectedId === node.id ? "is-selected" : ""}`} style={{ "--depth": depth } as React.CSSProperties} onClick={() => selectNode(node.id)}>
          <span className={`om-tree-chevron ${hasChildren ? "" : "is-empty"} ${isOpen ? "is-open" : ""}`} onClick={(event) => {
            if (!hasChildren) return;
            event.stopPropagation();
            setExpanded((current) => { const next = new Set(current); isOpen ? next.delete(node.id) : next.add(node.id); return next; });
          }}>›</span>
          <code>{node.code || "без кода"}</code><span className="om-tree-name">{node.name || "Без названия"}</span>
          <i className={`om-state-dot ${node.status}`} title={node.status === "agreed" ? "Согласовано" : "Предложение"} />
        </button>
        {hasChildren && isOpen && renderTree(node.id, depth + 1, descendantAncestors)}
      </React.Fragment>;
    });
  const renderedTableNodeIds = new Set<string>();
  const reachableHierarchyIds = new Set<string>();
  const markHierarchyReachable = (nodes: WorkNode[]) => nodes.forEach((node) => {
    if (reachableHierarchyIds.has(node.id)) return;
    reachableHierarchyIds.add(node.id);
    markHierarchyReachable(childrenByParent.get(node.id) ?? []);
  });
  markHierarchyReachable(childrenByParent.get(null) ?? []);
  const orphanHierarchyRoots = visibleNodes.filter((node) => !reachableHierarchyIds.has(node.id));
  const renderModelRows = (nodes: WorkNode[], depth = 0, ancestors = new Set<string>()): React.ReactNode => nodes
    .filter((node) => visibleIds.has(node.id))
    .map((node) => {
      if (ancestors.has(node.id) || renderedTableNodeIds.has(node.id)) return null;
      renderedTableNodeIds.add(node.id);
      const children = childrenByParent.get(node.id) ?? [];
      const hasChildren = children.some((child) => visibleIds.has(child.id) && !ancestors.has(child.id));
      const isOpen = expanded.has(node.id) || (!!search && hasChildren);
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(node.id);
      const client = node.clientId ? nodeMap.get(node.clientId) : undefined;
      const role = node.roleId ? nodeMap.get(node.roleId) : undefined;
      const crew = node.executorId ? nodeMap.get(node.executorId) : undefined;
      const produced = draft.links.filter((link) => link.from === node.id && link.kind === "produces").map((link) => nodeMap.get(link.to)).filter((item): item is WorkNode => !!item);
      const resultNodes = produced.filter((item) => item.kind === "result");
      const reportNodes = draft.links.filter((link) => (link.from === node.id || link.to === node.id) && nodeMap.get(link.from === node.id ? link.to : link.from)?.kind === "report")
        .map((link) => nodeMap.get(link.from === node.id ? link.to : link.from)).filter((item): item is WorkNode => !!item);
      const refButton = (target: WorkNode | undefined) => target
        ? <button type="button" className="om-table-link" onClick={(event) => { event.stopPropagation(); openNode(target.id); }}>{target.code} · {target.name}</button>
        : <span className="om-table-empty">—</span>;
      const resourceTargets = node.resourceIds.map((id) => nodeMap.get(id)).filter((item): item is WorkNode => !!item);
      return <React.Fragment key={node.id}>
        <tr className={`om-table-row ${selectedId === node.id ? "is-selected" : ""}`} onClick={() => openNode(node.id)}>
          <td className="om-table-code"><code>{node.code || "—"}</code></td>
          <th scope="row" className="om-table-name" style={{ paddingLeft: `${10 + depth * 17}px` }}>
            <span className="om-table-name-inner">
              <button type="button" className={`om-table-toggle ${hasChildren ? "" : "is-empty"} ${isOpen ? "is-open" : ""}`} aria-label={`${isOpen ? "Свернуть" : "Развернуть"} ${node.name}`} aria-expanded={hasChildren ? isOpen : undefined} onClick={(event) => {
                event.stopPropagation();
                if (hasChildren) setExpanded((current) => { const next = new Set(current); isOpen ? next.delete(node.id) : next.add(node.id); return next; });
              }}>›</button>
              <span><button type="button" className="om-table-open" onClick={(event) => { event.stopPropagation(); openNode(node.id); }}>{node.name || "Без названия"}</button><small>{kindLabels[node.kind]} · {node.status === "agreed" ? "согласовано" : "предложение"}</small></span>
            </span>
          </th>
          <td>{refButton(client)}</td><td>{refButton(role)}</td><td>{refButton(crew)}</td>
          <td>{resourceTargets.length ? resourceTargets.map((target) => <span className="om-table-resource" key={target.id}>{refButton(target)}<small>{target.resourceState === "connected" ? "Подключено" : target.resourceState === "approved" ? "Одобрено" : target.resourceState === "required" ? "Требуется" : "Не задано"}</small></span>) : <span className="om-table-empty">—</span>}</td>
          <td>{node.schedule.days.length ? node.schedule.days.map((day) => weekdays.find((item) => item.day === day)?.label ?? String(day)).join(", ") : "—"}</td>
          <td>{node.schedule.hours || "—"}</td><td>{node.schedule.timezone || "—"}</td>
          <td>{resultNodes.length ? resultNodes.map((target) => <React.Fragment key={target.id}>{refButton(target)}</React.Fragment>) : node.success || (node.kind === "result" ? node.name : "—")}</td>
          <td>{reportNodes.length ? reportNodes.map((target) => <React.Fragment key={target.id}>{refButton(target)}</React.Fragment>) : node.kind === "report" ? node.name : "—"}</td>
          <td>{refButton(node.acceptorId ? nodeMap.get(node.acceptorId) : undefined)}</td>
        </tr>
        {hasChildren && isOpen && renderModelRows(children, depth + 1, nextAncestors)}
      </React.Fragment>;
    });

  const stats = {
    actions: draft.nodes.filter((node) => node.kind === "action").length,
    agreed: draft.nodes.filter((node) => node.status === "agreed").length,
    proposed: draft.nodes.filter((node) => node.status === "proposal").length,
    connected: draft.nodes.filter((node) => node.kind === "resource" && node.resourceState === "connected").length,
  };

  return <section className="om-shell" id="operating-model" aria-labelledby="om-title">
    <header className="om-hero">
      <div><p className="pm-kicker">OWNER MODEL / NEW-COUNTRY · PLANNING ONLY</p><h2 id="om-title">Операционная модель компании</h2>
        <p>Компания через конкретную работу и принятые результаты. Это редактор проектируемой структуры — без запуска исполнителей и расписаний.</p></div>
      <div className="om-hero-count"><span>{String(activeView === "team" ? revision?.data.nodes.length ?? 0 : draft.nodes.length).padStart(2, "0")}</span><small>{activeView === "team" ? "узлов снимка" : "узлов модели"}</small><b>{revision ? `Основание v${revision.version}` : activeView === "team" ? "Нет сохранённого снимка" : "Новая модель"}</b></div>
    </header>
    <div className="om-toolbar"><div className="om-view-tabs" role="tablist" aria-label="Представления модели">{views.map((view) =>
      <button type="button" role="tab" aria-selected={activeView === view.id} className={activeView === view.id ? "active" : ""} key={view.id} onClick={() => switchView(view.id)}>{view.label}{view.id === "gaps" && <i>{gaps.length}</i>}</button>)}</div>
      <div className="om-toolbar-actions">{!["company", "management", "journey", "team"].includes(activeView) && <div className="om-toolbar-expand"><button type="button" onClick={() => setExpanded(new Set(draft.nodes.map((node) => node.id)))}>Раскрыть всё</button><button type="button" onClick={() => setExpanded(new Set())}>Свернуть всё</button></div>}{!["company", "management", "journey", "team"].includes(activeView) && <label className="om-search"><span>Поиск</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Название, код…" /></label>}
        {!["team"].includes(activeView) && <details className="om-add-menu"><summary>Добавить узел <span>+</span></summary><div>{workKinds.map((kind) => <button key={kind} type="button" onClick={() => addNode(kind)}>{kindLabels[kind]}</button>)}</div></details>}
      </div>
    </div>
    {error && <p className="om-alert" role="alert">{error}</p>}{notice && <p className="om-notice" role="status">{notice}</p>}
    {!submit && <p className="om-alert">Режим чтения: команда сохранения не подключена.</p>}
    {revision && <div className="om-revision"><span><b>Последняя сохранённая</b> v{revision.version}</span><span>{dateLabel(revision.at)} · {revision.actor}</span><span className="om-proposal-tag">Черновик не означает согласование</span></div>}
    {!revision && <div className="om-revision">{activeView === "team" ? <><span><b>Нет сохранённого снимка</b> · шаблон не показывается как команда</span><span>Команда появится после существующей сохранённой ревизии операционной модели</span></> : <><span><b>Шаблон не сохранён</b> · показан чистый черновик</span><span>Сохранение создаст первую ревизию</span></>}</div>}

    {activeView === "team" ? <TeamView data={revision?.data ?? null} state={state} /> : ["company", "management", "journey"].includes(activeView) ? <CompanyStructureViews
      view={activeView as "company" | "management" | "journey"} data={draft} selectedId={selectedId} onOpen={openNode} onPatchPath={patchCustomerPath}
    /> : activeView === "history" ? <section className="om-history"><div className="om-section-title"><div><p className="pm-kicker">IMMUTABLE SNAPSHOTS</p><h3>История ревизий</h3></div><span>{state.operatingModel?.revisions.length ?? 0} версий</span></div>
      {state.operatingModel?.revisions.length ? [...state.operatingModel.revisions].reverse().map((item) => <details key={item.version}><summary><b>v{item.version}</b><span>{dateLabel(item.at)} · {item.actor}</span><i>{item.data.nodes.length} узлов · {item.data.links.length} связей</i></summary><div className="om-history-content">
        <p>Согласовано: {item.data.nodes.filter((node) => node.status === "agreed").length} · Предложено: {item.data.nodes.filter((node) => node.status === "proposal").length}</p>
        <pre>{JSON.stringify(item.data, null, 2)}</pre></div></details>) : <div className="om-empty"><strong>Сохранённых ревизий пока нет</strong>Текущая модель остаётся локальным черновиком до принятия команды сохранения.</div>}
    </section> : activeView === "coverage" ? <section className="om-coverage"><div className="om-section-title"><div><p className="pm-kicker">MODEL COVERAGE</p><h3>Покрытие рабочего контура</h3></div><span>{draft.nodes.length} узлов</span></div>
      <div className="om-metrics"><article><b>{stats.actions}</b><span>действий в модели</span></article><article><b>{stats.agreed}</b><span>согласовано</span></article><article><b>{stats.proposed}</b><span>предложено</span></article><article><b>{gaps.length}</b><span>открытых пробелов</span></article></div>
      <div className="om-coverage-layout"><div><h4>Связность модели</h4><p>{draft.links.length} явных связей между узлами. Иерархия и связи — отдельные понятия.</p><div className="om-kind-bars">{workKinds.map((kind) => {
        const count = draft.nodes.filter((node) => node.kind === kind).length;
        return <div key={kind}><span>{kindLabels[kind]}</span><b>{count}</b><i><em style={{ width: `${draft.nodes.length ? Math.max(3, (count / draft.nodes.length) * 100) : 0}%` }} /></i></div>;
      })}</div></div><div><h4>Состояние ресурсов</h4>{(["required", "approved", "connected"] as const).map((status) => <p className="om-resource-count" key={status}><span>{status === "required" ? "Требуется" : status === "approved" ? "Одобрено" : "Подключено"}</span><b>{draft.nodes.filter((node) => node.kind === "resource" && node.resourceState === status).length}</b></p>)}<p className="om-muted">Подключение не выполняется этим представлением.</p></div></div>
    </section> : <>
      <section className="om-operating-table" aria-label="Иерархическая операционная таблица">
        <div className="om-operating-table-heading"><div><p className="pm-kicker">OPERATING MAP / HIERARCHICAL TABLE</p><h3>Работа, ответственность и плановые окна</h3><p>Нажмите на строку для карточки; раскройте ветвь кнопкой. Ссылки в ячейках открывают связанный узел.</p></div><span>{visibleNodes.length} строк</span></div>
        {draft.nodes.length ? <div className="om-operating-table-scroll"><table className="om-operating-table-grid">
          <thead><tr><th scope="col">Код</th><th scope="col">Узел</th><th scope="col">Клиент</th><th scope="col">Должность</th><th scope="col">Crew</th><th scope="col">Ресурсы</th><th scope="col">Дни</th><th scope="col">Часы</th><th scope="col">Часовой пояс</th><th scope="col">Результат</th><th scope="col">Отчёт</th><th scope="col">Принимающий</th></tr></thead>
          <tbody>{renderModelRows(childrenByParent.get(null) ?? [])}{renderModelRows(orphanHierarchyRoots)}</tbody>
        </table></div> : <div className="om-empty"><strong>Операционная карта пуста</strong>Добавьте первый узел, чтобы собрать таблицу ответственности и результатов.</div>}
      </section>
      <div className="om-workspace">
      <aside className="om-tree-panel"><div className="om-tree-head"><div><p className="pm-kicker">{activeView.toUpperCase()} / STRUCTURE</p><strong>Рабочая карта</strong></div><span>{visibleNodes.length}</span></div>
        {draft.nodes.length ? <div className="om-tree">{renderTree(null)}</div> : <div className="om-empty"><strong>Пока нет узлов</strong>Добавьте первую часть будущей компании.</div>}
        <div className="om-legend"><span><i className="agreed" />Согласовано</span><span><i className="proposal" />Предложение</span></div>
      </aside>
      <main className="om-detail-panel">
        {activeView === "gaps" && <section className="om-gaps"><div className="om-section-title"><div><p className="pm-kicker">WORK GAPS</p><h3>Что ещё не определено</h3></div><span>{gaps.length} пунктов</span></div>{gaps.length ? gaps.map((gap, index) => {
          const node = nodeMap.get(gap.id);
          return <button type="button" className="om-gap-row" key={`${gap.id}-${gap.message}`} onClick={() => node && openNode(node.id)}><code>{node?.code}</code><span>{gap.message}</span><i>{node?.name}</i><small>{String(index + 1).padStart(2, "0")}</small></button>;
        }) : <div className="om-empty"><strong>Пробелов по текущим правилам нет</strong>Это не подтверждает операционную готовность или запуск.</div>}
          <div className="om-stage-reports"><div className="om-sublist-head"><h4>Отчёты этапов</h4><button type="button" onClick={() => setDraft((current) => {
            const pass = ([1, 2, 3] as const).find((candidate) => !current.stageReports.some((item) => item.pass === candidate));
            return pass ? { ...current, stageReports: [...current.stageReports, { pass, described: "", boundary: "", dependencies: "", gaps: "", next: "" }] } : current;
          })} disabled={draft.stageReports.length >= 3}>Добавить этап +</button></div>
            {draft.stageReports.length ? draft.stageReports.map((report, index) => <article key={`stage-${index}`}><div className="om-stage-report-top"><b>Этап {report.pass}</b><button type="button" onClick={() => setDraft((current) => ({ ...current, stageReports: current.stageReports.filter((_, row) => row !== index) }))}>Убрать этап</button></div>
              <div className="om-form-grid">{([
                ["described", "Что описано"], ["boundary", "Граница"], ["dependencies", "Зависимости"], ["gaps", "Пробелы"], ["next", "Следующий шаг"],
              ] as const).map(([key, label]) => <Field key={key} label={label} multiline value={report[key]} onChange={(value) => setDraft((current) => ({ ...current, stageReports: current.stageReports.map((item, row) => row === index ? { ...item, [key]: value } : item) }))} />)}</div>
            </article>) : <p className="om-muted">Отчёты этапов не описаны.</p>}</div>
        </section>}
        {activeView === "docs" && <section className="om-gaps"><div className="om-section-title"><div><p className="pm-kicker">REFERENCES</p><h3>Документы и основания</h3></div></div>{visibleNodes.length ? visibleNodes.map((node) => <button className="om-doc-row" type="button" key={node.id} onClick={() => openNode(node.id)}><code>{node.code}</code><span><b>{node.name}</b><small>{node.referenceIds.length ? `Ссылки: ${node.referenceIds.join(", ")}` : "Текстовое основание"}</small></span><i>{node.description || node.questions}</i></button>) : <div className="om-empty"><strong>Ссылки не указаны</strong>Добавьте основания в карточку узла. Каталог стратегии и аналитика остаются в своих существующих представлениях.</div>}
          <article className="om-human-doc"><div className="om-section-title"><div><p className="pm-kicker">OPERATING MODEL / READER</p><h3>Как читать эту модель</h3></div><a href={`data:text/markdown;charset=utf-8,${encodeURIComponent(operatingGuide)}`} download="talkhint-operating-model.md">Скачать руководство</a></div>
            <p className="om-doc-lead">TalkHint проектируется как компания через конкретные действия и клиентов их результатов. Эта карта описывает планируемую работу, а не доказывает, что поиск, команда или продажи уже состоялись.</p>
            <div className="om-doc-columns">
              <section><h4>Модель начинается с результата</h4><p>Проследите цепочку: контекст и клиентская потребность → способность → процесс → конкретное действие → результат и следующий потребитель. Клиент результата, ответственная должность, исполнитель Crew и принимающий — четыре разные назначения.</p></section>
              <section><h4>Вложенность не равна связи</h4><p>Родитель задаёт структуру иерархии. Типизированная связь отдельно обозначает требование, производство, передачу, зависимость, подотчётность, приёмку, возврат или эскалацию. Код можно менять: внутренний ID остаётся устойчивым.</p></section>
              <section><h4>Согласовано и предложено</h4><p>Метка «согласовано» — статус утверждения узла в модели владельца. Предложение остаётся гипотезой. Статус ресурса («требуется», «одобрено», «подключено») также является записью планирования, а не живой проверкой доступа к API.</p></section>
              <section><h4>Ресурсы, расписание и приёмка</h4><p>Уточняйте вход и его источник/актуальность, необходимые ресурсы, дни, часы и часовой пояс, процедуру, правила, ограничения, успех, хранение и доставку. Пустое поле — не разрешение придумать срок. Сохранение модели не запускает расписание или workflow.</p></section>
              <section><h4>Пробелы — подсказки для следующего решения</h4><p>Пробелы показывают незаполненные клиентские, ответственные, ресурсные и приёмочные связи, неполные входы и отсутствующие процедуры. Неполнота допускает черновик; повреждённые ссылки, повторные коды и циклы вложенности блокируются до сохранения.</p></section>
              <section><h4>Три прохода</h4><p>Первый описывает сквозную работу и клиентов результата; второй — должности, Crew, ресурсы, входы и отчёт; третий — типы взаимодействия и границы. У каждого отчёта этапа редактируются содержание, граница, зависимости, пробелы и следующий шаг.</p></section>
              <section><h4>Роли выводятся из работы</h4><p>Должности, отделы и обязанности уточняются после конкретных действий. Обратный список показывает, где используется роль, ресурс или клиент. Подготовленный паспорт AI-аналитика остаётся в своём представлении; здесь нет его копии и нет созданных сотрудников.</p></section>
              <section><h4>Основания и сохранение</h4><p>Используйте существующие ID стратегии, документов и элементов как ссылки, не как дублирующий каталог. Каждое сохранение создаёт снимок модели поверх текущей ревизии. Уведомление о принятой команде не заменяет подтверждения новой сохранённой ревизии.</p></section>
            </div>
            <div className="om-doc-guard">Граница: проектирование только в выбранной гипотезе Dev. Никаких агентов, внешних действий, рассылок, платных API, реального подключения или запуска расписаний.</div>
            <details className="om-company-guide"><summary>Пояснение к трёхуровневой структуре и пути клиента</summary><a href={`data:text/markdown;charset=utf-8,${encodeURIComponent(companyStructureGuide)}`} download="talkhint-company-structure.md">Скачать talkhint-company-structure.md</a><pre>{companyStructureGuide}</pre></details>
          </article>
          <div className="om-crossrefs"><h4>Связанные рабочие представления</h4><a href={`/admin/project-model?hypothesis=${encodeURIComponent(selectedHypothesis(state) ?? "new-country")}&view=overview#competitive-analyst`}>Подготовка аналитика конкурентов <span>Открыть существующий паспорт →</span></a><a href={`/admin/project-model?hypothesis=${encodeURIComponent(selectedHypothesis(state) ?? "new-country")}&view=overview#project-strategy-focus`}>Стратегия новой страны <span>Открыть существующую стратегию →</span></a></div>
        </section>}
        {!["gaps", "docs"].includes(activeView) && (selected ? <form className="om-editor" onSubmit={(event) => event.preventDefault()}>
          <div className="om-editor-top"><div><p className="pm-kicker">{kindLabels[selected.kind].toUpperCase()} / NODE DETAIL</p><h3>{selected.name || "Без названия"}</h3><span className={`om-status ${selected.status}`}>{selected.status === "agreed" ? "Согласовано" : "Предложение"}</span></div><button type="button" className="om-delete" onClick={() => removeNode(selected)}>Удалить узел</button></div>
          <section className="om-field-section"><h4>Идентичность и назначение</h4><div className="om-form-grid">
            <Field label="Код" value={selected.code} onChange={(value) => patchNode(selected.id, { code: value })} hint="Код — метка, не идентификатор." />
            <Field label="Название" value={selected.name} onChange={(value) => patchNode(selected.id, { name: value })} />
            <label className="om-field"><span>Тип</span><select value={selected.kind} onChange={(event) => patchNode(selected.id, { kind: event.target.value as WorkKind, resourceState: event.target.value === "resource" ? selected.resourceState ?? "required" : null })}>{workKinds.map((kind) => <option key={kind} value={kind}>{kindLabels[kind]}</option>)}</select></label>
            <label className="om-field"><span>Статус</span><select value={selected.status} onChange={(event) => patchNode(selected.id, { status: event.target.value as WorkNode["status"] })}><option value="proposal">Предложение</option><option value="agreed">Согласовано</option></select><small>Статус отражает только запись модели.</small></label>
            <label className="om-field"><span>Родительский узел · состав</span><select value={selected.parentId ?? ""} onChange={(event) => patchNode(selected.id, { parentId: event.target.value || null })}><option value="">Без родителя</option>{draft.nodes.filter((node) => node.id !== selected.id).map((node) => <option key={node.id} value={node.id}>{node.code} · {node.name}</option>)}</select><small>Определяет вложенность, но не подчинение.</small></label>
            {selected.kind === "role" && <label className="om-field"><span>Непосредственный руководитель</span><select value={selected.managerId ?? ""} onChange={(event) => patchNode(selected.id, { managerId: event.target.value || null })}><option value="">Не назначен</option>{draft.nodes.filter((node) => node.id !== selected.id && (node.kind === "role" || node.id === "owner")).map((node) => <option key={node.id} value={node.id}>{node.id === "owner" ? "Владелец · " : ""}{node.code} · {node.name}</option>)}</select><small>Для должностей; отдельная линия через managerId. Не редактирует доступы.</small></label>}
            <label className="om-field"><span>Уровень планирования</span><select value={selected.level ?? ""} onChange={(event) => patchNode(selected.id, { level: (event.target.value || undefined) as WorkNode["level"] })}><option value="">Не задан</option><option value="strategy">Стратегия</option><option value="direction">Направление</option><option value="operation">Операция</option></select></label>
            <label className="om-field"><span>Зрелость описания</span><select value={selected.detailState ?? "outlined"} onChange={(event) => patchNode(selected.id, { detailState: event.target.value as WorkNode["detailState"] })}><option value="outlined">Набросок</option><option value="described">Описано</option></select><small>«Набросок» означает, что содержание ещё не проработано.</small></label>
            {(selected.kind === "process" || selected.kind === "action") && <label className="om-field"><span>Природа работы</span><select value={selected.workNature ?? "unspecified"} onChange={(event) => patchNode(selected.id, { workNature: event.target.value as WorkNode["workNature"] })}><option value="unspecified">Не определена</option><option value="deterministic">Детерминированная</option><option value="probabilistic">Вероятностная</option><option value="mixed">Смешанная</option></select><small>Поле относится только к процессам и действиям.</small></label>}
            <Field label="Эффект на рынке" value={selected.marketEffect ?? ""} onChange={(value) => patchNode(selected.id, { marketEffect: value })} multiline />
            <Field label="Назначение" value={selected.purpose} onChange={(value) => patchNode(selected.id, { purpose: value })} />
            <Field label="Описание" multiline value={selected.description} onChange={(value) => patchNode(selected.id, { description: value })} />
          </div></section>
          <section className="om-field-section"><h4>Клиент, ответственность и передача</h4><div className="om-form-grid">
            {([
              ["clientId", "Клиент результата"], ["roleId", "Ответственная должность"], ["executorId", "Crew / исполнитель (проект)"],
              ["recipientId", "Получатель"], ["acceptorId", "Принимающий"], ["nextId", "Следующий шаг"],
            ] as const).map(([key, label]) => <label className="om-field" key={key}><span>{label}</span><select value={selected[key] ?? ""} onChange={(event) => patchNode(selected.id, { [key]: event.target.value || null } as Partial<WorkNode>)}><option value="">Не определён</option>{draft.nodes.filter((node) => node.id !== selected.id && (key !== "roleId" || node.kind === "role") && (key !== "executorId" || node.kind === "crew" || node.kind === "client")).map((node) => <option key={node.id} value={node.id}>{node.code} · {node.name}</option>)}</select></label>)}
            <label className="om-field"><span>Ресурсы</span><select multiple value={selected.resourceIds} onChange={(event) => patchNode(selected.id, { resourceIds: Array.from(event.target.selectedOptions, (option) => option.value) })}>{draft.nodes.filter((node) => node.kind === "resource").map((node) => <option key={node.id} value={node.id}>{node.code} · {node.name}</option>)}</select></label>
          </div></section>
          <section className="om-field-section"><h4>Рабочее соглашение</h4><div className="om-form-grid">
            <Field label="Процедура" multiline value={selected.procedure} onChange={(value) => patchNode(selected.id, { procedure: value })} />
            <Field label="Правила" multiline value={selected.rules} onChange={(value) => patchNode(selected.id, { rules: value })} />
            <Field label="Ограничения" multiline value={selected.constraints} onChange={(value) => patchNode(selected.id, { constraints: value })} />
            <Field label="Критерии успеха" multiline value={selected.success} onChange={(value) => patchNode(selected.id, { success: value })} />
            <Field label="Хранение" multiline value={selected.storage} onChange={(value) => patchNode(selected.id, { storage: value })} />
            <Field label="Доставка" multiline value={selected.delivery} onChange={(value) => patchNode(selected.id, { delivery: value })} />
            <Field label="Исключения" multiline value={selected.exceptions} onChange={(value) => patchNode(selected.id, { exceptions: value })} />
            <Field label="Открытые вопросы" multiline value={selected.questions} onChange={(value) => patchNode(selected.id, { questions: value })} />
          </div></section>
          <section className="om-field-section"><h4>Ресурсы и плановое окно <small>Планирование не запускает расписание.</small></h4><div className="om-form-grid">
            {selected.kind === "resource" && <label className="om-field"><span>Состояние ресурса</span><select value={selected.resourceState ?? "required"} onChange={(event) => patchNode(selected.id, { resourceState: event.target.value as WorkNode["resourceState"] })}><option value="required">Требуется</option><option value="approved">Одобрено</option><option value="connected">Подключено</option></select></label>}
            <fieldset className="om-weekdays"><legend>Дни недели · 1 = Пн, 7 = Вс</legend>{weekdays.map(({ day, label }) => <label key={day}><input type="checkbox" checked={selected.schedule.days.includes(day)} onChange={(event) => patchSchedule("days", event.target.checked ? Array.from(new Set([...selected.schedule.days, day])).sort((a, b) => a - b) : selected.schedule.days.filter((item) => item !== day))} /><span>{label}</span></label>)}
              {selected.schedule.days.filter((day) => !Number.isInteger(day) || day < 1 || day > 7).map((day, index) => <button type="button" className="om-invalid-day" key={`invalid-day-${index}`} onClick={() => patchSchedule("days", selected.schedule.days.filter((item) => item !== day))}>Удалить некорректный день {day}</button>)}
            </fieldset>
            <Field label="Часы" value={selected.schedule.hours} onChange={(value) => patchSchedule("hours", value)} />
            <Field label="Часовой пояс" value={selected.schedule.timezone} onChange={(value) => patchSchedule("timezone", value)} />
            <Field label="Триггер" value={selected.schedule.trigger} onChange={(value) => patchSchedule("trigger", value)} />
            <Field label="Дедлайн" value={selected.schedule.deadline} onChange={(value) => patchSchedule("deadline", value)} />
          </div>
            <div className="om-sublist-head"><b>Входные данные</b><button type="button" onClick={() => patchNode(selected.id, { inputs: [...selected.inputs, { name: "", sourceId: null, freshness: "" }] })}>Добавить вход +</button></div>
            {selected.inputs.map((input, index) => <div className="om-input-row" key={`${selected.id}-input-${index}`}><Field label="Имя входа" value={input.name} onChange={(value) => patchNode(selected.id, { inputs: selected.inputs.map((item, row) => row === index ? { ...item, name: value } : item) })} />
              <label className="om-field"><span>Источник</span><select value={input.sourceId ?? ""} onChange={(event) => patchNode(selected.id, { inputs: selected.inputs.map((item, row) => row === index ? { ...item, sourceId: event.target.value || null } : item) })}><option value="">Не определён</option>{draft.nodes.filter((node) => node.id !== selected.id).map((node) => <option key={node.id} value={node.id}>{node.code} · {node.name}</option>)}</select></label>
              <Field label="Актуальность" value={input.freshness} onChange={(value) => patchNode(selected.id, { inputs: selected.inputs.map((item, row) => row === index ? { ...item, freshness: value } : item) })} />
              <button type="button" className="om-remove-inline" onClick={() => patchNode(selected.id, { inputs: selected.inputs.filter((_, row) => row !== index) })}>Убрать</button></div>)}
            <div className="om-sublist-head"><b>Основания / ссылки</b><button type="button" onClick={() => patchNode(selected.id, { referenceIds: [...selected.referenceIds, ""] })}>Добавить ссылку +</button></div>
            {selected.referenceIds.map((reference, index) => <div className="om-inline-reference" key={`${selected.id}-ref-${index}`}><input aria-label="Идентификатор основания" value={reference} onChange={(event) => patchNode(selected.id, { referenceIds: selected.referenceIds.map((item, row) => row === index ? event.target.value : item) })} /><button type="button" onClick={() => patchNode(selected.id, { referenceIds: selected.referenceIds.filter((_, row) => row !== index) })}>Убрать</button></div>)}
            {selected.referenceIds.filter(Boolean).length > 0 && <div className="om-reference-jumps"><b>Перейти к основанию</b>{selected.referenceIds.filter(Boolean).map((reference, index) => {
              const linkedNode = nodeMap.get(reference);
              const strategy = strategyReferences.find((entry) => entry.key === reference || entry.key === `element:${reference}`);
              const document = state.documents.find((item) => item.id === reference);
              const element = state.elements.find((item) => item.id === reference);
              const safeDocumentUrl = (() => {
                if (!document?.url) return "";
                try { const url = new URL(document.url); return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : ""; }
                catch { return ""; }
              })();
              return linkedNode ? <button type="button" key={`${reference}-${index}`} onClick={() => openNode(linkedNode.id)}>{linkedNode.code} · {linkedNode.name}</button>
                : reference === "analyst-preparation" ? <a key={`${reference}-${index}`} href={`/admin/project-model?hypothesis=${encodeURIComponent(selectedHypothesis(state) ?? "new-country")}&view=overview#competitive-analyst`}>Паспорт AI-аналитика</a>
                  : strategy ? <a key={`${reference}-${index}`} href={strategy.href}>{strategy.title}</a>
                 : document ? <div className="om-saved-document" key={`${reference}-${index}`} style={{ width: "100%", minWidth: 0 }}>
                   <div><b>{document.title}</b><small>Сохранённый документ · обновлён {dateLabel(document.updatedAt)}</small></div>
                   <div className="om-saved-document-actions">
                     {safeDocumentUrl && <a href={safeDocumentUrl} target="_blank" rel="noreferrer">Открыть источник</a>}
                     <a href={`data:text/markdown;charset=utf-8,${encodeURIComponent(`# ${document.title}\n\n${document.text}`)}`} download={documentFilename(document.title)}>Скачать Markdown</a>
                   </div>
                   <details><summary>Читать сохранённый текст</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "28rem", overflow: "auto" }}>{document.text}</pre></details>
                 </div>
                      : element ? <a key={`${reference}-${index}`} href={`/admin/project-model?hypothesis=${encodeURIComponent(selectedHypothesis(state) ?? "new-country")}&view=overview&element=${encodeURIComponent(element.id)}`}>{element.title}</a>
                        : <span key={`${reference}-${index}`}>{reference} · основание не найдено</span>;
            })}</div>}
          </section>
          <section className="om-field-section"><h4>Связи и обратное использование</h4><div className="om-link-create">
            <label>От<select value={newLink.from} onChange={(event) => setNewLink({ ...newLink, from: event.target.value })}><option value="">Выбрать узел</option>{draft.nodes.map((node) => <option key={node.id} value={node.id}>{node.code} · {node.name}</option>)}</select></label>
            <label>Тип<select value={newLink.kind} onChange={(event) => setNewLink({ ...newLink, kind: event.target.value as WorkLink["kind"] })}>{workLinks.map((kind) => <option key={kind} value={kind}>{linkLabels[kind]}</option>)}</select></label>
            <label>К<select value={newLink.to} onChange={(event) => setNewLink({ ...newLink, to: event.target.value })}><option value="">Выбрать узел</option>{draft.nodes.map((node) => <option key={node.id} value={node.id}>{node.code} · {node.name}</option>)}</select></label>
            <input aria-label="Причина связи" placeholder="Основание связи" value={newLink.reason} onChange={(event) => setNewLink({ ...newLink, reason: event.target.value })} />
            <button type="button" onClick={addLink} disabled={!newLink.from || !newLink.to || newLink.from === newLink.to}>Добавить</button>
          </div>
            {referenceLinks.length ? <div className="om-links-list">{referenceLinks.map((link) => { const other = nodeMap.get(link.from === selected.id ? link.to : link.from); return <div key={link.id}><span>{link.from === selected.id ? "Отсюда" : "Сюда"} · {linkLabels[link.kind]}</span><button type="button" onClick={() => other && openNode(other.id)}>{other?.code} · {other?.name}</button><small>{link.reason}</small><button type="button" aria-label="Удалить связь" onClick={() => setDraft((current) => ({ ...current, links: current.links.filter((item) => item.id !== link.id) }))}>×</button></div>; })}</div> : <p className="om-muted">Явных связей для этого узла пока нет.</p>}
            {relatedUsage.length > 0 && <div className="om-usage"><b>Использование этого узла · обратный список</b>{relatedUsage.map((node) => <button type="button" key={node.id} onClick={() => openNode(node.id)}><code>{node.code}</code>{node.name}<small>{node.roleId === selected.id ? "Ответственная должность" : node.executorId === selected.id ? "Crew / исполнитель" : node.clientId === selected.id ? "Клиент результата" : node.resourceIds.includes(selected.id) ? "Использует ресурс" : node.managerId === selected.id ? "Непосредственный подчинённый" : node.parentId === selected.id ? "Дочерний узел" : node.nextId === selected.id ? "Следующий шаг" : "Связано в модели"}</small></button>)}</div>}
          </section>
        </form> : <div className="om-empty om-no-selection"><span className="om-empty-index">01</span><strong>Выберите узел рабочей карты</strong><p>Код, имя, клиент, роль, Crew, ресурсы, расписание и критерии результата остаются отдельными редактируемыми полями.</p><button type="button" onClick={() => addNode("process")}>Создать первый процесс</button></div>)}
      </main>
    </div></>}
    {activeView !== "history" && activeView !== "coverage" && activeView !== "team" && <div className="om-stage-strip"><span>STAGE REPORTS</span>{draft.stageReports.length ? draft.stageReports.map((report) => <button key={report.pass} type="button" onClick={() => switchView("gaps")}>Этап {report.pass} · {report.gaps}</button>) : <i>Отчётов этапов нет</i>}</div>}
    {activeView !== "team" && <form className="om-savebar" onSubmit={(event) => void save(event)}><div><b>Только проектирование</b><span>Не создаются исполнители, расписания выполнения или подключённые инструменты.</span></div><span className="om-save-base">Основание v{baseVersion} · {draft.nodes.length} узлов</span><button type="submit" disabled={!submit || saving}>{saving ? "Сохраняем…" : "Сохранить черновик"}</button></form>}
  </section>;
}
