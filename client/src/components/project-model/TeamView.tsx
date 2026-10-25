import React, { useEffect, useMemo, useState } from "react";
import {
  Background, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider,
  useReactFlow, type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import { ArrowDownRight, ChevronDown, ChevronRight, LocateFixed, Search, X } from "lucide-react";
import type { OperatingData, WorkNode } from "@shared/operatingModel";
import type { ProjectModelState } from "@shared/projectModel";
import {
  buildTeamSnapshot, extractTeamPassportSections, getLinkedTeamDocuments,
  teamLinkIssueLabel,
} from "./teamView";

type Props = { data: OperatingData | null; state: ProjectModelState };
type CardData = { item: WorkNode; count?: number; expanded?: boolean; onToggle?: (id: string) => void; onSelect: (id: string) => void; selected: boolean };
type TeamFlowNode = Node<CardData, "teamRole" | "teamDirection" | "teamOwner">;

function RoleCard({ data }: NodeProps<TeamFlowNode>) {
  const role = data.item;
  return <div className={`team-flow-card team-role-card ${data.selected ? "is-selected" : ""} ${role.status === "proposal" ? "is-proposed" : ""}`} onClick={() => data.onSelect(role.id)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") data.onSelect(role.id); }}>
    <Handle type="target" position={Position.Left} />
    <span className="team-card-mark">AI</span>
    <span className="team-card-copy"><b>{role.name}</b><small>{role.code || "без кода"} · {role.status === "proposal" ? "Предложение" : "Согласовано в модели"}</small></span>
    <Handle type="source" position={Position.Right} />
  </div>;
}

function OwnerCard({ data }: NodeProps<TeamFlowNode>) {
  return <div className={`team-flow-card team-owner-card ${data.selected ? "is-selected" : ""}`} onClick={() => data.onSelect(data.item.id)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") data.onSelect(data.item.id); }}>
    <Handle type="target" position={Position.Left} />
    <span className="team-owner-initial">{data.item.name.trim().charAt(0) || "С"}</span>
    <span className="team-card-copy"><small>ВЛАДЕЛЕЦ · ЧЕЛОВЕК</small><b>{data.item.name}</b></span>
    <Handle type="source" position={Position.Right} />
  </div>;
}

function DirectionCard({ data }: NodeProps<TeamFlowNode>) {
  const open = !!data.expanded;
  return <div className={`team-direction-card ${data.selected ? "is-selected" : ""}`}>
    <div className="team-direction-card-top">
      <button type="button" className="team-direction-open" onClick={() => data.onSelect(data.item.id)}><code>{data.item.code}</code><b>{data.item.name}</b></button>
      <button type="button" className="team-branch-toggle" aria-label={`${open ? "Свернуть" : "Раскрыть"} роли направления ${data.item.name}`} aria-expanded={open} onClick={() => data.onToggle?.(data.item.id)}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
    </div>
    <div className="team-direction-meta"><span>{data.count} {data.count === 1 ? "роль" : "ролей"}</span><span>Группа состава · не руководитель</span></div>
    <Handle type="target" position={Position.Left} />
  </div>;
}

const nodeTypes = { teamRole: RoleCard, teamDirection: DirectionCard, teamOwner: OwnerCard };
const valueOrNoData = (value?: string | null) => value?.trim() || "Нет данных";

function FlowToolbar({ onFit, onExpand, onCollapse }: { onFit: () => void; onExpand: () => void; onCollapse: () => void }) {
  const { zoomIn, zoomOut } = useReactFlow();
  return <div className="team-flow-tools" aria-label="Управление схемой">
    <button type="button" onClick={() => void zoomIn()} aria-label="Приблизить">+</button>
    <button type="button" onClick={() => void zoomOut()} aria-label="Отдалить">−</button>
    <button type="button" onClick={onFit}><LocateFixed size={14} /> Вписать</button>
    <span aria-hidden="true" />
    <button type="button" onClick={onExpand}>Раскрыть группы</button>
    <button type="button" onClick={onCollapse}>Свернуть группы</button>
  </div>;
}

function TeamCanvas({ data, state }: Props) {
  const snapshot = useMemo(() => data ? buildTeamSnapshot(data) : null, [data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [activeWorkId, setActiveWorkId] = useState<string | null>(null);
  const { fitView } = useReactFlow();
  const query = search.trim().toLocaleLowerCase("ru");
  useEffect(() => {
    if (!selectedId || !window.matchMedia("(max-width: 700px)").matches) return;
    const frame = requestAnimationFrame(() => document.querySelector(".team-detail")?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [selectedId, activeWorkId]);
  useEffect(() => {
    if (!selectedId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setSelectedId(null); setActiveWorkId(null); }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedId]);
  const docSections = useMemo(() => state.documents.flatMap((doc) =>
    extractTeamPassportSections(doc.text).map((section) => ({ ...section, document: doc })),
  ), [state.documents]);

  if (!snapshot || !data) return <section className="team-empty-state">
    <p className="pm-kicker">PERSISTED OPERATING MODEL</p><h3>Сохранённой структуры пока нет</h3>
    <p>Представление команды строится только из последней сохранённой ревизии операционной модели. Чистый шаблон и локальный черновик здесь не показываются.</p>
  </section>;

  const roleSearchText = (role: WorkNode) => {
    const linked = data.nodes.filter((node) => [node.roleId, node.executorId, node.recipientId, node.acceptorId].includes(role.id));
    const resourceNodes = role.resourceIds.map((id) => snapshot?.byId.get(id)).filter((node): node is WorkNode => !!node);
    const refs = new Set([
      ...role.referenceIds, ...linked.flatMap((node) => node.referenceIds),
      ...resourceNodes.flatMap((resource) => resource.referenceIds),
    ]);
    const roleCode = role.code.trim().toLocaleLowerCase("ru");
    const roleSections = docSections.filter(({ document, heading }) =>
      refs.has(document.id) && !!roleCode && heading.toLocaleLowerCase("ru").startsWith(roleCode));
    const linkedReferences = Array.from(refs).join(" ");
    const passport = role.id.toLocaleLowerCase("ru").includes("analyst") ? state.analystPreparation?.revisions.at(-1)?.data : undefined;
    return [
      role.code, role.name, role.description, role.purpose, role.procedure, role.rules, role.constraints,
      role.success, role.questions, linked.map((node) => `${node.code} ${node.name} ${node.purpose} ${node.description} ${node.procedure} ${node.success}`).join(" "),
      linkedReferences, passport ? Object.values(passport.passport).join(" ") : "",
      roleSections.map((section) => `${section.heading} ${section.text}`).join(" "),
    ].join(" ").toLocaleLowerCase("ru");
  };
  const matchRole = (role: WorkNode) => !query || roleSearchText(role).includes(query);
  const visibleRoles = snapshot.roles.filter(matchRole);
  const visibleRoleIds = new Set(visibleRoles.map((role) => role.id));
  const visibleDirections = snapshot.directions.filter((direction) => !query ||
    directionSearchText(direction, snapshot.roles, roleSearchText).includes(query) ||
    snapshot.roles.some((role) => visibleRoleIds.has(role.id) && snapshot.groupForRole.get(role.id) === direction.id));
  const groupedRoleCount = (directionId: string) => snapshot.roles.filter((role) => snapshot.groupForRole.get(role.id) === directionId && visibleRoleIds.has(role.id)).length;
  const visibleGroupIds = new Set(visibleDirections.map((direction) => direction.id));
  const openForSearch = (id: string) => query && snapshot.roles.some((role) => visibleRoleIds.has(role.id) && snapshot.groupForRole.get(role.id) === id);

  const flowNodes: TeamFlowNode[] = [];
  const directionPosition = new Map<string, { x: number; y: number; height: number }>();
  visibleDirections.forEach((direction, index) => {
    const roles = snapshot.roles.filter((role) => snapshot.groupForRole.get(role.id) === direction.id && visibleRoleIds.has(role.id));
    const isOpen = !collapsed.has(direction.id) || !!openForSearch(direction.id);
    const height = 95 + (isOpen ? roles.length : 0) * 76;
    const x = (index % 3) * 340 + 35;
    const y = 185 + Math.floor(index / 3) * 350;
    directionPosition.set(direction.id, { x, y, height });
    flowNodes.push({
      id: direction.id, type: "teamDirection", position: { x, y }, data: {
        item: direction, count: groupedRoleCount(direction.id), expanded: isOpen,
        onToggle: (id) => setCollapsed((current) => { const next = new Set(current); isOpen ? next.add(id) : next.delete(id); return next; }),
        onSelect: (id) => { setSelectedId(id); setActiveWorkId(null); }, selected: selectedId === direction.id,
      }, style: { width: 292, height }, zIndex: 0,
    });
    if (isOpen) roles.forEach((role, roleIndex) => flowNodes.push({
      id: role.id, type: "teamRole", parentId: direction.id, extent: "parent",
      position: { x: 16, y: 77 + roleIndex * 76 }, data: {
        item: role, onSelect: (id) => { setSelectedId(id); setActiveWorkId(null); }, selected: selectedId === role.id,
      }, style: { width: 258, height: 58 }, zIndex: 2,
    }));
  });
  const ungrouped = visibleRoles.filter((role) => !snapshot.groupForRole.get(role.id) || !visibleGroupIds.has(snapshot.groupForRole.get(role.id)!));
  ungrouped.forEach((role, index) => flowNodes.push({
    id: role.id, type: "teamRole", position: { x: 1100, y: 190 + index * 76 }, data: {
      item: role, onSelect: (id) => { setSelectedId(id); setActiveWorkId(null); }, selected: selectedId === role.id,
    }, style: { width: 258, height: 58 }, zIndex: 2,
  }));
  if (snapshot.owner) flowNodes.push({
    id: snapshot.owner.id, type: "teamOwner", position: { x: 570, y: 24 }, data: {
      item: snapshot.owner, onSelect: (id) => { setSelectedId(id); setActiveWorkId(null); }, selected: selectedId === snapshot.owner.id,
    }, style: { width: 250, height: 66 }, zIndex: 3,
  });
  const roleVisible = new Set(flowNodes.map((node) => node.id));
  const unresolvedRoleIds = new Set(snapshot.managerIssues.map((issue) => issue.roleId));
  const flowEdges: Edge[] = snapshot.roles.flatMap((role) => {
    const managerId = role.managerId;
    if (!managerId || !roleVisible.has(role.id) || !roleVisible.has(managerId) || managerId === role.id) return [];
    return [{
      id: `manager:${role.id}:${managerId}`, source: role.id, target: managerId,
      type: "smoothstep", label: "managerId", labelStyle: { fill: "#547267", fontSize: 9 },
      labelBgStyle: { fill: "#f5f7f1", fillOpacity: 0.94 },
      style: { stroke: unresolvedRoleIds.has(role.id) ? "#b9754e" : "#6f8c7f", strokeWidth: unresolvedRoleIds.has(role.id) ? 1.7 : 1.35, strokeDasharray: unresolvedRoleIds.has(role.id) ? "5 4" : undefined },
      markerEnd: { type: "arrowclosed" as const, color: unresolvedRoleIds.has(role.id) ? "#b9754e" : "#6f8c7f" }, animated: false,
    }];
  });

  const selected = selectedId ? snapshot.byId.get(selectedId) : undefined;
  const currentAnalyst = state.analystPreparation?.revisions.at(-1);
  const linkedWork = selected && (selected.kind === "role" || selected.id === snapshot.owner?.id)
    ? data.nodes.filter((node) => node.id !== selected.id && [node.roleId, node.executorId, node.recipientId, node.acceptorId].includes(selected.id))
      .concat(data.links.filter((link) => link.from === selected.id || link.to === selected.id)
        .map((link) => snapshot.byId.get(link.from === selected.id ? link.to : link.from))
        .filter((node): node is WorkNode => !!node && node.id !== selected.id))
    : [];
  const uniqueLinkedWork = Array.from(new Map(linkedWork.map((node) => [node.id, node])).values());
  const relationScope = new Set([selected?.id ?? "", ...uniqueLinkedWork.map((node) => node.id)]);
  const linkedNeeds = selected ? data.nodes.filter((node) => node.kind === "need" && (
    selected.inputs.some((input) => input.sourceId === node.id) ||
    data.links.some((link) => (relationScope.has(link.from) && link.to === node.id) || (relationScope.has(link.to) && link.from === node.id))
  )) : [];
  const selectedWork = activeWorkId ? snapshot.byId.get(activeWorkId) : undefined;
  const issuesForSelected = snapshot.managerIssues.filter((issue) => issue.roleId === selected?.id);
  const linkedRefIds = new Set(uniqueLinkedWork.flatMap((node) => node.referenceIds));
  const acceptanceLinks = data.links.filter((link) => link.kind === "acceptance" &&
    (relationScope.has(link.from) || relationScope.has(link.to)));
  const selectedResources = selected?.resourceIds.map((id) => snapshot.byId.get(id)).filter((node): node is WorkNode => !!node) ?? [];
  const sourceReferenceIds = new Set([
    ...(selected?.referenceIds ?? []), ...Array.from(linkedRefIds), ...selectedResources.flatMap((resource) => resource.referenceIds),
  ]);
  const linkedDocuments = getLinkedTeamDocuments(state, sourceReferenceIds);
  const linkedDocumentIds = new Set(linkedDocuments.map((document) => document.id));
  const showAnalystPassport = !!currentAnalyst && (selected?.kind === "role" &&
    (selected.referenceIds.includes("analyst-preparation") || selectedResources.some((resource) => resource.referenceIds.includes("analyst-preparation"))));
  const roleCodePrefix = (selected?.code ?? "").trim().toLocaleLowerCase("ru");
  const relevantDocSections = docSections.filter(({ heading, document }) =>
    linkedDocumentIds.has(document.id) && !!roleCodePrefix && heading.split(/\s*·\s*/)[0].trim().toLocaleLowerCase("ru") === roleCodePrefix);
  const documentedField = (labels: string[]) => relevantDocSections.flatMap(({ text, document }) =>
    text.split("\n").flatMap((line) => {
      const match = line.match(/^-\s+([^:]+):\s*(.+)$/);
      return match && labels.includes(match[1].trim())
        ? [`${match[2]} — источник: ${document.title} (описание из документа, не новое согласование)`] : [];
    })).join("\n\n");
  const clientName = (node: WorkNode) => node.clientId ? snapshot.byId.get(node.clientId)?.name ?? `ID не найден: ${node.clientId}` : "";
  const resourceNames = (node: WorkNode) => node.resourceIds.map((id) => snapshot.byId.get(id)?.name ?? `ID не найден: ${id}`);

  return <section className="team-view">
    <header className="team-view-heading">
      <div><p className="pm-kicker">TEAM MAP / PLANNING ONLY</p><h3>Команда и линия управления</h3>
        <p>Снимок v{state.operatingModel?.revisions.at(-1)?.version ?? "—"} · направления группируют роли; руководитель определяется только по managerId.</p></div>
      <div className="team-state-key"><span><i className="planned" />Запланированная роль</span><span><i className="assigned" />Назначение в модели</span><span><i className="evidence" />Подтверждённый запуск: нет данных</span></div>
    </header>
    <div className="team-safety-strip"><b>Только планирование</b><span>Назначенный исполнитель, включая replit-current-dev-session, сам по себе не является запущенным агентом. Общая модель не содержит подтверждённых событий запуска.</span></div>
    <div className="team-toolbar">
      <label className="team-search"><Search size={15} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти роль, работу или паспорт…" aria-label="Поиск команды" />{search && <button type="button" onClick={() => setSearch("")} aria-label="Очистить поиск"><X size={14} /></button>}</label>
      <span className="team-count">{visibleRoles.length} из {snapshot.roles.length} ролей · {visibleDirections.length} направлений</span>
    </div>
    <details className="team-role-index">
      <summary>Выбрать роль списком · {visibleRoles.length}</summary>
      <div>{visibleRoles.map((role) => <button type="button" key={role.id} onClick={() => { setSelectedId(role.id); setActiveWorkId(null); }}>
        <code>{role.code}</code><span>{role.name}</span>
      </button>)}</div>
    </details>
    <div className="team-workspace">
      <div className="team-canvas" aria-label="Схема команды">
        <ReactFlow nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.12, maxZoom: 0.95 }}
          minZoom={0.18} maxZoom={1.6} nodesDraggable nodesConnectable={false} elementsSelectable
          onPaneClick={() => {}} onNodeClick={(_, node) => { if (node.type === "teamRole" || node.type === "teamOwner" || node.type === "teamDirection") { setSelectedId(node.id); setActiveWorkId(null); } }}
          proOptions={{ hideAttribution: true }}>
          <Background color="#d9e2d8" gap={22} size={1} />
          <MiniMap pannable zoomable nodeColor={(node) => node.type === "teamDirection" ? "#dfe8dc" : node.type === "teamOwner" ? "#315d52" : "#f6f7f1"} maskColor="rgb(233 239 230 / 65%)" />
          <Controls showInteractive={false} />
          <FlowToolbar onFit={() => void fitView({ padding: 0.12, duration: 220 })}
            onExpand={() => setCollapsed(new Set())}
            onCollapse={() => setCollapsed(new Set(snapshot.directions.map((direction) => direction.id)))} />
        </ReactFlow>
        {!snapshot.owner && <div className="team-unresolved-banner">Узел владельца отсутствует в сохранённой модели. Владелец не добавлен автоматически.</div>}
      </div>
      <aside className="team-detail" aria-live="polite" aria-label="Паспорт выбранной роли или работы">
        {selectedWork ? <WorkDetail node={selectedWork} byId={snapshot.byId} links={data.links} onBack={() => setActiveWorkId(null)} onClose={() => { setActiveWorkId(null); setSelectedId(null); }} /> : selected
          ? <div className="team-detail-content">
            <div className="team-detail-top"><span className={`team-kind-label ${selected.id === snapshot.owner?.id ? "is-owner" : ""}`}>{selected.id === snapshot.owner?.id ? "Человек · владелец" : selected.kind === "role" ? "AI-роль · планируется" : "Направление · контейнер"}</span><span className={`team-status ${selected.status}`}>{selected.status === "proposal" ? "Требует решения" : "Согласовано в модели"}</span><button type="button" className="team-detail-close" onClick={() => { setSelectedId(null); setActiveWorkId(null); }} aria-label="Закрыть паспорт"><X size={15} /></button></div>
            <p className="team-code">{selected.code || "без кода"} · {selected.id}</p><h4>{selected.name}</h4>
            {selected.kind === "role" && <p className="team-manager-line"><ArrowDownRight size={14} /> Руководитель по managerId: <b>{selected.managerId ? snapshot.byId.get(selected.managerId)?.name ?? `Нет данных · ${selected.managerId}` : "Не указан"}</b></p>}
            {issuesForSelected.map((issue) => <p className="team-unresolved" key={issue.roleId}>{teamLinkIssueLabel(issue, snapshot.byId)} · связь не исправлялась автоматически.</p>)}
            <dl className="team-passport">
              <Fact label="Клиент" value={selected.clientId ? clientName(selected) : documentedField(["Клиент результата", "Клиент"]) || "Нет данных"} />
              <Fact label="Связанная потребность" value={linkedNeeds.map((need) => `${need.code} · ${need.name}`).join("; ") || "Нет данных"} />
              <Fact label="Назначение / описание" value={valueOrNoData(selected.purpose || selected.description)} />
              <Fact label="Обязанности" value={valueOrNoData(selected.procedure || selected.rules || documentedField(["Действия", "Делает", "Обязанности"]))} />
              <Fact label="Обещанный / описанный результат" value={valueOrNoData(selected.success || documentedField(["Обязательный выход", "Отдаёт"]))} />
              <Fact label="Ресурсы" value={resourceNames(selected).join(", ") || "Нет данных"} />
              <Fact label="Полномочия и ограничения" value={valueOrNoData(selected.constraints)} />
              <Fact label="Приёмка" value={selected.acceptorId ? snapshot.byId.get(selected.acceptorId)?.name ?? `ID не найден: ${selected.acceptorId}` : "Нет данных"} />
              <Fact label="Назначенный исполнитель" value={selected.executorId ? snapshot.byId.get(selected.executorId)?.name ?? selected.executorId : "Нет данных"} />
            </dl>
            <p className="team-source-meta">Источник: сохранённый снимок v{state.operatingModel?.revisions.at(-1)?.version ?? "—"} · ID {selected.id}. Дополнительно показаны явно подписанные выдержки связанных документов. Исторические различия не разрешаются автоматически; отсутствие сведений отмечено отдельно.</p>
            {linkedWork.some((work) => !!work.executorId) && <p className="team-assignment-note"><b>Назначение в модели</b>{linkedWork.filter((work) => !!work.executorId).map((work) => `${work.name}: ${snapshot.byId.get(work.executorId!)?.name ?? work.executorId}`).join(" · ")}. Это запись назначения, не свидетельство запуска.</p>}
            <p className="team-no-run"><b>Состояние выполнения</b>Подтверждённых событий запуска в источнике нет. Здесь показаны план и назначение, не работающий агент.</p>
            {acceptanceLinks.length > 0 && <section className="team-source-block"><div className="team-section-title"><b>Явные связи приёмки</b><span>{acceptanceLinks.length}</span></div>{acceptanceLinks.map((link) => <p className="team-acceptance-link" key={link.id}><b>{snapshot.byId.get(link.from)?.name ?? link.from}</b> → <b>{snapshot.byId.get(link.to)?.name ?? link.to}</b><small>{link.reason || "Условие приёмки в связи не описано"}</small></p>)}</section>}
            {uniqueLinkedWork.length > 0 && <section className="team-linked-works"><div className="team-section-title"><b>Связанные работы модели</b><span>{uniqueLinkedWork.length}</span></div>{uniqueLinkedWork.map((work) => <button type="button" key={work.id} onClick={() => setActiveWorkId(work.id)}><code>{work.code}</code><span><b>{work.name}</b><small>{work.status === "proposal" ? "Предложение · требует решения" : "Сохранено в модели"} · {work.kind}</small></span><ChevronRight size={15} /></button>)}</section>}
            {showAnalystPassport && currentAnalyst && <section className="team-source-block"><div className="team-section-title"><b>Существующий паспорт аналитика</b><span>версия {currentAnalyst.version}</span></div><p className="team-source-meta">Источник: подготовка аналитика · {currentAnalyst.status} · согласование не выполнено</p>
              {Object.entries(currentAnalyst.data.passport).map(([key, value]) => <Fact key={key} label={analystFieldLabel(key)} value={value} />)}
              <p className="team-source-guard">Паспорт остаётся в своей записи. Он не создаёт сотрудника, задачу или исполнение.</p></section>}
            {relevantDocSections.length > 0 && <section className="team-source-block"><div className="team-section-title"><b>Фрагменты связанного roadmap</b><span>сохранённый документ</span></div>
              <p className="team-source-meta">Различия и исторические версии показаны отдельно; выбор актуальной версии здесь не делается.</p>
              {relevantDocSections.map(({ heading, text, document }, index) => <article className="team-source-section" key={`${document.id}-${heading}-${index}`}><small>{document.title} · {document.id} · обновлён {document.updatedAt || "дата не указана"}</small><h5>{heading}</h5><pre>{text}</pre></article>)}
            </section>}
            {selectedResources.length > 0 && <section className="team-source-block"><div className="team-section-title"><b>Источники из узлов-ресурсов</b><span>{selectedResources.length}</span></div>{selectedResources.map((resource) => <article className="team-resource-source" key={resource.id}><b>{resource.name}</b><small>{resource.code} · {resource.id} · снимок v{state.operatingModel?.revisions.at(-1)?.version ?? "—"}</small><p>{valueOrNoData(resource.description || resource.purpose)}</p><p>Основания: {resource.referenceIds.join(", ") || "Нет данных"}</p></article>)}</section>}
            {selected.id === snapshot.owner?.id && <p className="team-owner-source">Имя владельца взято из узла сохранённой модели; роль владельца не дублируется.</p>}
          </div>
          : <div className="team-detail-empty"><span>01 / PASSPORT</span><h4>Выберите роль или направление</h4><p>Паспорт откроет сохранённые сведения, связанные работы и явно отмеченные пробелы.</p><div><b>Никаких KPI и обещаний из предположений</b><small>Пустые поля остаются «Нет данных».</small></div></div>}
      </aside>
    </div>
    {snapshot.managerIssues.length > 0 && <section className="team-exceptions"><div><p className="pm-kicker">UNRESOLVED MANAGER LINKS</p><h4>Связи, требующие проверки</h4><span>{snapshot.managerIssues.length} нерешённых случаев · ничего не перестроено</span></div>
      <div>{snapshot.managerIssues.map((issue) => <button type="button" key={`${issue.roleId}-${issue.kind}`} onClick={() => { setSelectedId(issue.roleId); setActiveWorkId(null); }}>{issue.roleName}<small>{teamLinkIssueLabel(issue, snapshot.byId)}</small></button>)}</div>
    </section>}
    <footer className="team-footer"><b>Иерархия направления ≠ линия подчинения.</b><span>На схеме стрелки руководства строятся только по фактическому managerId. Группировка по parentId служит контейнером структуры.</span></footer>
  </section>;
}

function directionSearchText(direction: WorkNode, roles: WorkNode[], roleText: (role: WorkNode) => string) {
  return `${direction.code} ${direction.name} ${direction.purpose} ${roles.filter((role) => role.parentId === direction.id).map(roleText).join(" ")}`.toLocaleLowerCase("ru");
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="team-fact"><dt>{label}</dt><dd>{value}</dd></div>;
}

function WorkDetail({ node, byId, onBack, onClose, links }: { node: WorkNode; byId: Map<string, WorkNode>; onBack: () => void; onClose: () => void; links: OperatingData["links"] }) {
  const resources = node.resourceIds.map((id) => byId.get(id)?.name ?? `ID не найден: ${id}`).join(", ");
  const acceptance = links.filter((link) => link.kind === "acceptance" && (link.from === node.id || link.to === node.id));
  return <div className="team-detail-content team-work-detail">
    <div className="team-work-detail-actions"><button type="button" className="team-back" onClick={onBack}><ChevronRight size={14} /> Назад к паспорту роли</button><button type="button" className="team-detail-close" onClick={onClose} aria-label="Закрыть паспорт"><X size={15} /></button></div>
    <p className="team-code">{node.code} · связанная работа</p><h4>{node.name}</h4>
    <span className={`team-status ${node.status}`}>{node.status === "proposal" ? "Предложение · требует решения" : "Согласовано в модели"}</span>
    <dl className="team-passport">
      <Fact label="Клиент результата" value={node.clientId ? byId.get(node.clientId)?.name ?? `ID не найден: ${node.clientId}` : "Нет данных"} />
      <Fact label="Потребность из входа" value={node.inputs.map((input) => input.sourceId ? byId.get(input.sourceId) : undefined).filter((item): item is WorkNode => item?.kind === "need").map((need) => `${need.code} · ${need.name}`).join("; ") || "Нет данных"} />
      <Fact label="Назначение / описание" value={valueOrNoData(node.purpose || node.description)} />
      <Fact label="Обязанности / процедура" value={valueOrNoData(node.procedure)} />
      <Fact label="Результат из записи" value={valueOrNoData(node.success)} />
      <Fact label="Ресурсы" value={resources || "Нет данных"} />
      <Fact label="Ограничения / полномочия" value={valueOrNoData(node.constraints)} />
      <Fact label="Назначенный исполнитель" value={node.executorId ? byId.get(node.executorId)?.name ?? node.executorId : "Нет данных"} />
      <Fact label="Приёмка" value={node.acceptorId ? byId.get(node.acceptorId)?.name ?? `ID не найден: ${node.acceptorId}` : "Нет данных"} />
      <Fact label="Условие приёмки из связей" value={acceptance.map((link) => link.reason || `${byId.get(link.from)?.name ?? link.from} → ${byId.get(link.to)?.name ?? link.to}`).join("; ") || "Нет данных"} />
      <Fact label="Вопросы записи" value={valueOrNoData(node.questions)} />
    </dl>
    <p className="team-source-guard">Сведения приведены из существующего узла без вывода о фактическом исполнении.</p>
  </div>;
}

function analystFieldLabel(key: string) {
  return ({ purpose: "Назначение", duties: "Обязанности", inputs: "Входы", outputs: "Результаты", frequency: "Частота", quality: "Качество", handoff: "Передача" } as Record<string, string>)[key] ?? key;
}

export default function TeamView(props: Props) {
  return <ReactFlowProvider><TeamCanvas {...props} /></ReactFlowProvider>;
}
