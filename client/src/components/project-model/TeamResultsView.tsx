import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownRight, ChevronRight, Search, X } from "lucide-react";
import { kindLabels, linkLabels, type OperatingData, type WorkLink, type WorkNode } from "@shared/operatingModel";
import type { ProjectModelState } from "@shared/projectModel";
import { buildResultsProjection, isResultRelation, resultEndpointLabel, resultRelationLabels } from "./teamResults";

type Props = { data: OperatingData | null; state: ProjectModelState; onHierarchy: () => void };
type FilterKey = "all" | WorkLink["kind"];

const noData = "Нет данных";

export default function TeamResultsView({ data, state, onHierarchy }: Props) {
  const projection = useMemo(() => data ? buildResultsProjection(data) : null, [data]);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<FilterKey>("all");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const originRef = useRef<HTMLElement | null>(null);
  const query = search.trim().toLocaleLowerCase("ru");
  useEffect(() => {
    if ((!selectedNodeId && !selectedLinkId) || !window.matchMedia("(max-width: 700px)").matches) return;
    detailRef.current?.scrollIntoView({ block: "start" });
    detailRef.current?.focus({ preventScroll: true });
  }, [selectedNodeId, selectedLinkId]);
  const closeDetails = () => {
    setSelectedNodeId(null);
    setSelectedLinkId(null);
    originRef.current?.focus();
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closeDetails(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!projection || !data) return <section className="team-results-empty">
    <p className="pm-kicker">PERSISTED OPERATING MODEL / RESULTS</p>
    <h3>Сохранённых передач пока нет</h3>
    <p>Здесь показываются только узлы и связи последней сохранённой ревизии. Черновик не подменяет снимок.</p>
  </section>;

  const matchingLinks = projection.links.filter((link) => {
    const from = projection.byId.get(link.from);
    const to = projection.byId.get(link.to);
    const text = `${link.id} ${link.from} ${link.to} ${link.kind} ${link.reason} ${from?.code ?? ""} ${from?.name ?? ""} ${from?.referenceIds.join(" ") ?? ""} ${to?.code ?? ""} ${to?.name ?? ""} ${to?.referenceIds.join(" ") ?? ""}`.toLocaleLowerCase("ru");
    return (type === "all" || link.kind === type) && (!query || text.includes(query));
  });
  const relatedNodeIds = new Set(matchingLinks.flatMap((link) => [link.from, link.to]));
  const matchingNodes = projection.nodes.filter((node) => {
    const text = `${node.id} ${node.code} ${node.name} ${node.referenceIds.join(" ")} ${node.kind} ${node.purpose} ${node.description} ${node.success} ${node.executorId ?? ""} ${node.recipientId ?? ""} ${node.acceptorId ?? ""}`.toLocaleLowerCase("ru");
    return (!query || text.includes(query)) && (type === "all" || relatedNodeIds.has(node.id));
  });
  const highlightedKinds = ["handoff", "depends_on", "acceptance", "return", "escalation"] as const;
  const selectedLink = selectedLinkId ? projection.links.find((link) => link.id === selectedLinkId) : undefined;
  const selectedNode = selectedNodeId ? projection.byId.get(selectedNodeId) : undefined;
  const initialQuoWork = projection.initialWorkId ? projection.byId.get(projection.initialWorkId) : undefined;
  const initialQuoResult = projection.initialResultId ? projection.byId.get(projection.initialResultId) : undefined;
  const quolinks = projection.links.filter((link) =>
    (initialQuoWork && (link.from === initialQuoWork.id || link.to === initialQuoWork.id)) ||
    (initialQuoResult && (link.from === initialQuoResult.id || link.to === initialQuoResult.id)));

  const openNode = (id: string) => { setSelectedNodeId(id); setSelectedLinkId(null); };
  const endpoint = (node: WorkNode | undefined, id: string) => <button type="button" className="team-results-endpoint" onClick={() => openNode(id)}>
    <span>{node ? kindLabels[node.kind] : "Недоступный endpoint"}</span>
    <b>{resultEndpointLabel(node, id)}</b>
  </button>;
  const metaValue = (id: string | null | undefined) => id
    ? projection.byId.get(id) ? resultEndpointLabel(projection.byId.get(id), id) : `ID не найден: ${id}`
    : noData;

  return <section className="team-view team-results-view" aria-label="Передача результатов" onClickCapture={(event) => {
    const button = (event.target as HTMLElement).closest("button");
    if (button && !detailRef.current?.contains(button)) originRef.current = button;
  }}>
    <header className="team-results-heading">
      <div><p className="pm-kicker">OPERATING MODEL / TYPED RELATIONS</p>
        <h3>Передача результатов</h3>
        <p>Работы, результаты и явные отношения модели. Это не линия руководства и не журнал фактических событий.</p>
      </div>
      <button className="team-results-switch" type="button" onClick={onHierarchy}>Подчинение и состав</button>
    </header>
    <div className="team-results-caveat"><b>Плановая схема</b><span>Связь «Приёмка» означает только запланированную связь. Подтверждённых событий передачи или приёмки в этой модели нет.</span></div>

    <section className="team-results-example" aria-labelledby="team-results-quo-title">
      <div className="team-results-example-mark"><span>НАВИГАЦИОННЫЙ ПРИМЕР</span><b>QUO</b></div>
      <div className="team-results-example-body">
        <p className="team-results-example-code">INFO-LG-QUO / RM.W.QUO</p>
        <h4 id="team-results-quo-title">{initialQuoWork?.name ?? "Работа RM.W.QUO отсутствует в снимке"}</h4>
        {initialQuoWork
          ? <p>Узел найден в сохранённой модели. Основание INFO-LG-QUO — ссылка/источник, не отдельная работа и не доказательство завершения.</p>
          : <p>Код показан как ориентир roadmap; соответствующий узел не найден. Работа и связи не создаются автоматически.</p>}
      </div>
      <div className="team-results-quo-endpoints">
        {initialQuoWork && endpoint(initialQuoWork, initialQuoWork.id)}
        {initialQuoResult
          ? endpoint(initialQuoResult, initialQuoResult.id)
          : <span className="team-results-absent"><small>Ожидаемый код результата</small><b>RM.W.QUO.R · Нет данных в модели</b></span>}
      </div>
      <div className="team-results-quo-links">
        <span>{quolinks.length} сохранённых связей, затрагивающих найденные узлы</span>
        {quolinks.length ? quolinks.map((link) => <button type="button" key={link.id} onClick={() => { setSelectedLinkId(link.id); setSelectedNodeId(null); }}>
          <b>{linkLabels[link.kind]}</b><span>{resultEndpointLabel(projection.byId.get(link.from), link.from)} → {resultEndpointLabel(projection.byId.get(link.to), link.to)}</span>
        </button>) : <small>Связи не найдены; значения не предполагаются.</small>}
      </div>
    </section>

    <div className="team-results-toolbar">
      <label className="team-search"><Search size={15} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти узел, связь или endpoint…" aria-label="Поиск передач результатов" />
        {search && <button type="button" onClick={() => setSearch("")} aria-label="Очистить поиск"><X size={14} /></button>}</label>
      <label className="team-results-filter"><span>Тип связи</span><select value={type} onChange={(event) => setType(event.target.value as FilterKey)}>
        <option value="all">Все типы</option>
        {data.links.reduce<WorkLink["kind"][]>((types, link) => types.includes(link.kind) ? types : [...types, link.kind], []).sort().map((kind) =>
          <option key={kind} value={kind}>{isResultRelation(kind) ? resultRelationLabels[kind] : linkLabels[kind]}</option>)}
      </select></label>
      <span className="team-count">{matchingLinks.length} связей · {matchingNodes.length} узлов</span>
    </div>

    <div className="team-results-layout">
      <section className="team-results-relations" aria-label="Связи модели">
        <div className="team-results-section-title"><div><p className="pm-kicker">LINKS / NO BOSS EDGES</p><h4>Связанные отношения</h4></div><span>{matchingLinks.length}</span></div>
        {matchingLinks.length ? <div className="team-results-link-list">{matchingLinks.map((link) => {
          const from = projection.byId.get(link.from);
          const to = projection.byId.get(link.to);
          const emphasized = highlightedKinds.includes(link.kind as typeof highlightedKinds[number]);
          return <article className={`team-results-link ${emphasized ? `relation-${link.kind}` : ""} ${selectedLinkId === link.id ? "is-selected" : ""}`} key={link.id}>
            <button type="button" className="team-results-link-main" onClick={() => { setSelectedLinkId(link.id); setSelectedNodeId(null); }}>
              <span className="team-results-relation-type">{isResultRelation(link.kind) ? resultRelationLabels[link.kind] : linkLabels[link.kind]}</span>
              <span className="team-results-link-endpoints"><b>{resultEndpointLabel(from, link.from)}</b><ArrowDownRight size={15} aria-hidden="true" /><b>{resultEndpointLabel(to, link.to)}</b></span>
              <small>{link.reason || "Причина связи: Нет данных"}</small>
            </button>
            <div className="team-results-link-actions">{endpoint(from, link.from)}<ChevronRight size={14} aria-hidden="true" />{endpoint(to, link.to)}</div>
          </article>;
        })}</div> : <div className="team-results-no-matches"><b>Связей по этому фильтру нет</b><span>Пустой результат не означает, что связь существует.</span></div>}
      </section>

      <aside ref={detailRef} tabIndex={-1} className="team-results-detail" aria-live="polite" aria-label="Сведения об узле или связи">
        {(selectedNodeId || selectedLinkId) && <button type="button" className="team-results-switch" onClick={closeDetails}>Закрыть сведения и вернуться</button>}
        {selectedLink ? <div className="team-results-detail-inner">
          <span className="team-results-detail-kicker">СВЯЗЬ · {selectedLink.kind}</span>
          <h4>{isResultRelation(selectedLink.kind) ? resultRelationLabels[selectedLink.kind] : linkLabels[selectedLink.kind]}</h4>
          <dl><ResultFact label="Откуда" value={resultEndpointLabel(projection.byId.get(selectedLink.from), selectedLink.from)} />
            <ResultFact label="Куда" value={resultEndpointLabel(projection.byId.get(selectedLink.to), selectedLink.to)} />
            <ResultFact label="Причина / условие" value={selectedLink.reason || noData} /></dl>
          {selectedLink.kind === "acceptance" && <p className="team-results-planning-note">Это запланированная связь приёмки, не событие и не подтверждение принятого результата.</p>}
          <p className="team-results-id">ID связи · {selectedLink.id}</p>
        </div> : selectedNode ? <div className="team-results-detail-inner">
          <span className="team-results-detail-kicker">{kindLabels[selectedNode.kind]} · {selectedNode.status === "proposal" ? "предложение" : "согласовано в модели"}</span>
          <h4>{selectedNode.name}</h4><p className="team-results-id">{selectedNode.code || "без кода"} · {selectedNode.id}</p>
          <dl>
            <ResultFact label="Назначенная роль" value={metaValue(selectedNode.roleId)} />
            <ResultFact label="Исполнитель" value={metaValue(selectedNode.executorId)} />
            <ResultFact label="Получатель" value={metaValue(selectedNode.recipientId)} />
            <ResultFact label="Принимающий" value={metaValue(selectedNode.acceptorId)} />
            <ResultFact label="Описанный результат" value={selectedNode.success.trim() || noData} />
            <ResultFact label="Назначение / работа" value={selectedNode.purpose.trim() || selectedNode.description.trim() || noData} />
            <ResultFact label="Связанные основания" value={selectedNode.referenceIds.join(", ") || noData} />
          </dl>
          <div className="team-results-neighbors"><b>Связи узла</b>{projection.links.filter((link) => link.from === selectedNode.id || link.to === selectedNode.id).map((link) =>
            <button type="button" key={link.id} onClick={() => { setSelectedLinkId(link.id); setSelectedNodeId(null); }}>
              <span>{isResultRelation(link.kind) ? resultRelationLabels[link.kind] : linkLabels[link.kind]}</span>
              <small>{link.from === selectedNode.id ? "→ " : "← "}{resultEndpointLabel(projection.byId.get(link.from === selectedNode.id ? link.to : link.from), link.from === selectedNode.id ? link.to : link.from)}</small>
            </button>)}
            {!projection.links.some((link) => link.from === selectedNode.id || link.to === selectedNode.id) && <small>Связи не заданы.</small>}
          </div>
          <p className="team-results-planning-note">Показаны поля сохранённой модели. Назначение, получатель и принимающий не подтверждают запуск или фактическую передачу.</p>
        </div> : selectedNodeId ? <div className="team-results-detail-empty"><h4>Узел не найден</h4><p className="team-results-id">{selectedNodeId}</p><p>Связь сохранена, но её endpoint отсутствует в этом снимке. Узел не создаётся автоматически.</p></div> : <div className="team-results-detail-empty">
          <span>02 / RESULT FLOW</span><h4>Выберите узел или связь</h4>
          <p>Откройте endpoint, чтобы увидеть роль, работу, результат, получателя и принимающего из сохранённых полей.</p>
          <b>Пустое поле останется «Нет данных».</b>
        </div>}
      </aside>
    </div>
    <section className="team-results-node-index" aria-label="Узлы сохранённой модели">
      <div className="team-results-section-title"><div><p className="pm-kicker">SAVED NODES / SAME IDENTITIES</p><h4>Узлы модели</h4></div><span>{matchingNodes.length}</span></div>
      {matchingNodes.length ? <div>{matchingNodes.map((node) => <button type="button" key={node.id} onClick={() => openNode(node.id)} className={selectedNodeId === node.id ? "is-selected" : ""}>
        <code>{node.code || "без кода"}</code><span><b>{node.name}</b><small>{kindLabels[node.kind]} · {node.status === "proposal" ? "предложение" : "сохранено"}</small></span><ChevronRight size={15} />
      </button>)}</div> : <p>Нет узлов по выбранному фильтру.</p>}
    </section>
    <footer className="team-results-footer"><b>Связь ≠ подчинение.</b><span>Для передачи результата используются только явные типизированные связи и поля той же OperatingData модели. Источник снимка: v{state.operatingModel?.revisions.at(-1)?.version ?? "—"}.</span></footer>
  </section>;
}

function ResultFact({ label, value }: { label: string; value: string }) {
  return <div className="team-results-fact"><dt>{label}</dt><dd>{value}</dd></div>;
}
