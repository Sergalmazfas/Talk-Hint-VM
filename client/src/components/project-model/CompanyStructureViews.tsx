import React, { useMemo, useState } from "react";
import { companyCoverage, kindLabels, linkLabels, type OperatingData, type WorkLink, type WorkNode } from "@shared/operatingModel";
import companyStructureGuide from "../../../../docs/talkhint-company-structure.md?raw";

type Props = {
  view: "company" | "management" | "journey";
  data: OperatingData;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onPatchPath: (id: string, patch: Partial<NonNullable<OperatingData["customerPath"]>[number]>) => void;
};

const detailLabel = (node: WorkNode) => node.detailState === "described" ? "Описано" : "Набросок";
const nameOf = (nodes: Map<string, WorkNode>, id: string | null | undefined) => id ? nodes.get(id)?.name ?? "Узел не найден" : "Не определено";
const natureLabel = (node: WorkNode) => node.workNature === "deterministic" ? "Детерминированная" : node.workNature === "probabilistic" ? "Вероятностная" : node.workNature === "mixed" ? "Смешанная" : "Не определена";

function Maturity({ node }: { node: WorkNode }) {
  return <span className={`om-maturity ${node.detailState === "described" ? "is-described" : ""}`}>{detailLabel(node)}</span>;
}

export default function CompanyStructureViews({ view, data, selectedId, onOpen, onPatchPath }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const nodes = useMemo(() => new Map(data.nodes.map((node) => [node.id, node])), [data.nodes]);
  const directions = useMemo(() => data.nodes.filter((node) => node.level === "direction").sort((a, b) => a.code.localeCompare(b.code, "ru")), [data.nodes]);
  const strategies = useMemo(() => data.nodes.filter((node) => node.level === "strategy").sort((a, b) => a.code.localeCompare(b.code, "ru")), [data.nodes]);
  const operationCount = useMemo(() => data.nodes.filter((node) => node.level === "operation" && node.kind === "process").length, [data.nodes]);
  const roles = useMemo(() => data.nodes.filter((node) => node.kind === "role").sort((a, b) => a.code.localeCompare(b.code, "ru")), [data.nodes]);
  const children = (id: string) => data.nodes.filter((node) => node.parentId === id).sort((a, b) => a.code.localeCompare(b.code, "ru"));
  const descendants = (id: string, seen = new Set<string>()): WorkNode[] => {
    if (seen.has(id)) return [];
    seen.add(id);
    return children(id).flatMap((child) => [child, ...descendants(child.id, seen)]);
  };
  const outputsFor = (id: string) => data.links.filter((link) => link.from === id && link.kind === "produces").map((link) => nodes.get(link.to)).filter((node): node is WorkNode => !!node);
  const neighborsFor = (id: string): { id: string; kind: WorkLink["kind"]; reason: string; direction: string }[] => {
    const found: { id: string; kind: WorkLink["kind"]; reason: string; direction: string }[] = [];
    const add = (targetId: string, kind: WorkLink["kind"], reason: string, direction: string) => {
      if (targetId !== id && nodes.has(targetId) && !found.some((item) => item.id === targetId && item.kind === kind && item.direction === direction))
        found.push({ id: targetId, kind, reason, direction });
    };
    const traversable = new Set<WorkLink["kind"]>(["handoff", "depends_on", "feedback"]);
    data.links.filter((link) => traversable.has(link.kind)).forEach((link) => {
      if (link.from === id) add(link.to, link.kind, link.reason, "out");
      if (link.to === id) add(link.from, link.kind, link.reason, "in");
    });
    outputsFor(id).forEach((output) => data.links.filter((link) => link.from === output.id && traversable.has(link.kind))
      .forEach((link) => add(link.to, link.kind, link.reason, "through output")));
    nodes.get(id)?.inputs.forEach((input) => { if (input.sourceId) add(input.sourceId, "requires", input.name, "input"); });
    return found;
  };
  const unknownFor = (node: WorkNode) => {
    const missing = [
      !node.purpose && "Назначение",
      !node.clientId && "Клиент результата",
      !node.roleId && "Ответственная должность",
      !node.inputs.length && "Входы",
      !outputsFor(node.id).length && "Выход",
    ].filter(Boolean);
    return [node.questions && `Открытый вопрос: ${node.questions}`, missing.length && `Не заполнено: ${missing.join(", ")}`].filter(Boolean).join(" · ") || "Открытые вопросы в узле не записаны.";
  };
  const structureRows = directions.flatMap((direction) => [
    direction,
    ...descendants(direction.id).filter((node) => node.kind === "process" && node.level === "operation"),
  ]);
  const toggleAll = (open: boolean) => setExpanded(open ? new Set(data.nodes.map((node) => node.id)) : new Set());
  const coverageIssues = companyCoverage(data);

  if (view === "company") return <section className="om-structure-view">
    <header className="om-structure-heading"><div><p className="pm-kicker">COMPANY HIERARCHY / PLAN</p><h3>Компания как система работы</h3><p>Три уровня: стратегия → 10 направлений → {operationCount} крупных процессов. Действия прежней модели сохранены в отдельных представлениях и поиске, но не считаются отделами или направлением.</p></div>
      <div className="om-structure-actions"><a href={`data:text/markdown;charset=utf-8,${encodeURIComponent(companyStructureGuide)}`} download="talkhint-company-structure.md">Скачать пояснение</a><div className="om-expand-controls"><button type="button" onClick={() => toggleAll(true)}>Раскрыть всё</button><button type="button" onClick={() => toggleAll(false)}>Свернуть всё</button></div></div></header>
    <div className="om-level-key"><span><b>01</b> Стратегия</span><span><b>02</b> Направления</span><span><b>03</b> Операции</span></div>
    {directions.length === 0 && <div className="om-empty"><strong>Направления ещё не внесены</strong>Добавьте уровни направления в узлах модели; здесь нет отдельного списка карточек.</div>}
    {strategies.length > 0 && <div className="om-strategy-band"><span>СТРАТЕГИЧЕСКИЙ УРОВЕНЬ</span>{strategies.map((strategy) => <button type="button" key={strategy.id} onClick={() => onOpen(strategy.id)}><code>{strategy.code}</code><b>{strategy.name}</b><small>{strategy.purpose || strategy.description || "Назначение не описано"}</small></button>)}</div>}
    {directions.map((direction, index) => {
      const strategy = direction.parentId ? nodes.get(direction.parentId) : undefined;
      const contained = descendants(direction.id).filter((node) => node.kind === "process" || node.level === "operation");
      const hasChildren = contained.length > 0;
      const open = expanded.has(direction.id);
      const output = outputsFor(direction.id);
      const client = nameOf(nodes, direction.clientId);
      const responsible = nameOf(nodes, direction.roleId);
      const inputs = direction.inputs.map((input) => input.name || "Вход без названия").join(", ");
      const neighbors = neighborsFor(direction.id);
      const gaps = [
        !direction.purpose && "Назначение",
        !direction.clientId && "Клиент результата",
        !direction.roleId && "Ответственная роль",
        !direction.inputs.length && "Входы",
        !output.length && "Выход",
      ].filter(Boolean);
      return <article className={`om-direction ${selectedId === direction.id ? "is-selected" : ""}`} key={direction.id}>
        <div className="om-direction-top">
          <button type="button" className="om-direction-title" onClick={() => onOpen(direction.id)}><span className="om-direction-index">{String(index + 1).padStart(2, "0")}</span><span><code>{direction.code}</code><b>{direction.name}</b></span></button>
          <Maturity node={direction} />
          <button type="button" className={`om-expand-one ${open ? "is-open" : ""}`} aria-expanded={open} aria-label={`${open ? "Свернуть" : "Раскрыть"} ${direction.name}`} onClick={() => setExpanded((current) => { const next = new Set(current); open ? next.delete(direction.id) : next.add(direction.id); return next; })}>›</button>
        </div>
        <div className="om-direction-summary"><p>{direction.purpose || "Назначение пока не описано."}{direction.marketEffect && <em>Эффект рынка · {direction.marketEffect}</em>}{strategy?.level === "strategy" && <button type="button" onClick={() => onOpen(strategy.id)}>Стратегия · {strategy.name}</button>}</p><span>{contained.length} процессов / операций</span></div>
        <div className="om-direction-facts">
          <div><small>Клиент результата</small><button type="button" onClick={() => direction.clientId && onOpen(direction.clientId)}>{client}</button></div>
          <div><small>Входы</small><span>{inputs || "Не определены"}</span></div>
          <div><small>Выход</small>{output.length ? output.map((node) => <button type="button" key={node.id} onClick={() => onOpen(node.id)}>{node.name}</button>) : <span>Не определён</span>}</div>
          <div><small>Ответственная роль</small><button type="button" onClick={() => direction.roleId && onOpen(direction.roleId)}>{responsible}</button></div>
          <div><small>Связи с соседями</small><span>{neighbors.length ? neighbors.map((item) => `${nameOf(nodes, item.id)} · ${linkLabels[item.kind]}`).join("; ") : "Явных связей рядом нет"}</span></div>
          <div><small>Неизвестное / открытые вопросы</small><span className={gaps.length || direction.questions ? "om-gap-copy" : ""}>{unknownFor(direction)}</span></div>
        </div>
        {open && <div className="om-process-list"><div className="om-process-head"><b>Процессы направления</b><span>{contained.length} в текущей модели</span></div>
          {contained.length ? contained.map((process) => {
            const owner = nameOf(nodes, process.roleId);
            const nextLinks = neighborsFor(process.id).filter((link) => link.kind === "handoff" || link.kind === "depends_on");
            return <button type="button" className="om-process-row" key={process.id} onClick={() => onOpen(process.id)}>
              <span><code>{process.code}</code><b>{process.name}</b><small>{process.purpose || process.description || "Назначение не описано"}</small></span><span><small>Роль</small>{owner}</span><span><small>Соседняя связь</small>{nextLinks.length ? nextLinks.map((link) => nameOf(nodes, link.id)).join(", ") : "Явных связей рядом нет"}</span><span><small>Природа работы</small>{natureLabel(process)}</span><Maturity node={process} />
            </button>;
          }) : <p className="om-muted">Процессы пока не вложены в это направление.</p>}
        </div>}
      </article>;
    })}
    <section className="om-company-table-wrap"><div className="om-process-head"><b>Таблица направлений и крупных процессов</b><span>{structureRows.length} записей из текущих узлов</span></div>
      <div className="om-company-table-scroll"><table className="om-company-table"><thead><tr><th>Уровень / узел</th><th>Назначение</th><th>Клиент</th><th>Входы</th><th>Выход</th><th>Ответственная роль</th><th>Соседние передачи и связи</th><th>Неизвестное / пробелы</th></tr></thead>
        <tbody>{structureRows.map((node) => {
          const isDirection = node.level === "direction";
          const outputs = outputsFor(node.id);
          const neighbors = neighborsFor(node.id);
          return <tr key={node.id} className={`${isDirection ? "is-direction" : "is-process"} ${selectedId === node.id ? "is-selected" : ""}`}>
            <th scope="row"><button type="button" onClick={() => onOpen(node.id)}><code>{node.code}</code><b>{node.name}</b></button><small>{isDirection ? "Направление" : `Крупный процесс · ${natureLabel(node)}`}</small><Maturity node={node} /></th>
            <td>{node.purpose || node.description || "Назначение не описано"}{node.marketEffect && <small className="om-company-effect">Эффект рынка · {node.marketEffect}</small>}</td>
            <td>{node.clientId ? <button type="button" className="om-company-ref" onClick={() => onOpen(node.clientId!)}>{nameOf(nodes, node.clientId)}</button> : "Не определён"}</td>
            <td>{node.inputs.length ? node.inputs.map((input) => <span className="om-company-line" key={`${node.id}-${input.name}`}>{input.name}{input.sourceId && <button type="button" className="om-company-ref" onClick={() => onOpen(input.sourceId!)}>← {nameOf(nodes, input.sourceId)}</button>}</span>) : "Не определены"}</td>
            <td>{outputs.length ? outputs.map((target) => <button type="button" className="om-company-ref" key={target.id} onClick={() => onOpen(target.id)}>{target.name}</button>) : "Не определён"}</td>
            <td>{node.roleId ? <button type="button" className="om-company-ref" onClick={() => onOpen(node.roleId!)}>{nameOf(nodes, node.roleId)}</button> : "Не определена"}</td>
            <td>{neighbors.length ? neighbors.map((item) => <span className="om-company-line" key={`${node.id}-${item.id}-${item.kind}`}><button type="button" className="om-company-ref" onClick={() => onOpen(item.id)}>{item.direction === "in" ? "← " : "→ "}{nameOf(nodes, item.id)}</button><small>{linkLabels[item.kind]}{item.reason ? ` · ${item.reason}` : ""}</small></span>) : "Явных связей рядом нет"}</td>
            <td className="om-company-unknown">{unknownFor(node)}</td>
          </tr>;
        })}</tbody></table></div>
    </section>
    <footer className="om-structure-foot"><b>{coverageIssues.length ? `${coverageIssues.length} замечаний покрытия` : "Структура покрыта по текущим правилам"}</b><span>{coverageIssues.slice(0, 4).join(" · ") || "Проверки описывают полноту модели, не готовность к запуску."}</span></footer>
  </section>;

  if (view === "management") {
    const roleIds = new Set(roles.map((role) => role.id));
    const owner = nodes.get("owner");
    const reports = new Map<string, WorkNode[]>();
    roles.forEach((role) => {
      if (role.managerId && (roleIds.has(role.managerId) || role.managerId === owner?.id))
        reports.set(role.managerId, [...(reports.get(role.managerId) ?? []), role]);
    });
    reports.forEach((items) => items.sort((a, b) => a.code.localeCompare(b.code, "ru")));
    const renderedRoles = new Set<string>();
    const renderRole = (role: WorkNode, depth = 0, path = new Set<string>()): React.ReactNode => {
      if (path.has(role.id) || renderedRoles.has(role.id)) return null;
      renderedRoles.add(role.id);
      const nextPath = new Set(path); nextPath.add(role.id);
      return <React.Fragment key={role.id}><div className={`om-manager-row ${role.status === "proposal" ? "is-proposed" : ""}`} style={{ "--depth": depth } as React.CSSProperties}>
        <button type="button" onClick={() => onOpen(role.id)}><code>{role.code}</code><b>{role.name}</b><small>{kindLabels[role.kind]} · {role.status === "proposal" ? "Предложенная роль" : "Согласованный элемент"}</small></button>
        <span>{reports.get(role.id)?.length ?? 0} прямых подчинённых</span>
      </div>{(reports.get(role.id) ?? []).map((child) => renderRole(child, depth + 1, nextPath))}</React.Fragment>;
    };
    const renderOwner = (node: WorkNode): React.ReactNode => <><div className="om-manager-owner"><button type="button" onClick={() => onOpen(node.id)}><code>{node.code}</code><b>{node.name}</b><small>Владелец · стратегические решения</small></button><span>Единственный корень владельца</span></div>{(reports.get(node.id) ?? []).map((role) => renderRole(role, 1))}</>;
    const unassigned = roles.filter((role) => !role.managerId);
    const unknownManagers = roles.filter((role) => role.managerId && role.managerId !== owner?.id && !roleIds.has(role.managerId));
    const reachableRoles = new Set<string>();
    const markReachable = (managerId: string, path = new Set<string>()) => (reports.get(managerId) ?? []).forEach((role) => {
      if (path.has(role.id) || reachableRoles.has(role.id)) return;
      reachableRoles.add(role.id);
      const nextPath = new Set(path); nextPath.add(role.id);
      markReachable(role.id, nextPath);
    });
    if (owner) markReachable(owner.id);
    const cyclicOrUnreachable = roles.filter((role) => role.managerId && roleIds.has(role.managerId) && !reachableRoles.has(role.id));
    return <section className="om-structure-view">
      <header className="om-structure-heading"><div><p className="pm-kicker">LINE MANAGEMENT / MANAGER ID</p><h3>Линия управления</h3><p>Руководитель определяется только полем managerId. parentId и связи модели в схему подчинения не попадают.</p></div></header>
      <div className="om-safety-note"><b>Проектируемая схема</b><span>Роли и доступы здесь только предложены. Они не создают учётные записи, разрешения или автоматическое управление.</span></div>
      <div className="om-manager-tree">{owner ? renderOwner(owner) : <div className="om-empty"><strong>Узел владельца не найден</strong>Вершина владельца не выводится из вложенности или связей; задайте её в модели.</div>}</div>
      {unassigned.length > 0 && <section className="om-manager-exceptions"><h4>Роли без managerId</h4><p>Не включены в основную линию; назначьте непосредственного руководителя в карточке должности.</p>{unassigned.map((role) => <button type="button" key={role.id} onClick={() => onOpen(role.id)}>{role.name}<small>{role.code} · без руководителя</small></button>)}</section>}
      {unknownManagers.map((role) => <button type="button" className="om-orphan-manager" key={role.id} onClick={() => onOpen(role.id)}>{role.name}: managerId «{role.managerId}» не разрешается в существующего руководителя</button>)}
      {cyclicOrUnreachable.length > 0 && <section className="om-manager-exceptions"><h4>Циклические / недостижимые роли</h4><p>Связь не перестраивалась по parentId; проверьте managerId.</p>{cyclicOrUnreachable.map((role) => <button type="button" key={role.id} onClick={() => onOpen(role.id)}>{role.name}<small>{role.code} · managerId {role.managerId}</small></button>)}</section>}
    </section>;
  }

  const path = data.customerPath ?? [];
  const pathProcessIds = new Set(path.flatMap((stage) => [stage.processId, stage.b2bProcessId].filter((id): id is string => !!id)));
  const pathGaps = coverageIssues.filter((issue) => /этап|B2C\/B2B|B2B-процесса|передач/i.test(issue));
  const journeyLinks = data.links.filter((link) => link.kind === "handoff" && pathProcessIds.has(link.from) && pathProcessIds.has(link.to));
  const financeLinks = data.links.filter((link) => link.kind === "finance_event");
  const stageForProcess = (id: string) => path.find((stage) => stage.processId === id || stage.b2bProcessId === id);
  return <section className="om-structure-view">
    <header className="om-structure-heading"><div><p className="pm-kicker">CUSTOMER JOURNEY / HANDOFFS</p><h3>Путь клиента и передачи</h3><p>Девять крупных этапов. Сверяйте клиентскую работу с процессами и финансовыми событиями.</p></div></header>
    <div className="om-safety-note"><b>Переходы следуют связям модели</b><span>Позиция этапа в списке не означает последовательность. Здесь нет автоматического перехода; развилки и циклы показаны только по существующим handoff-связям.</span></div>
    <section className="om-journey-transitions"><div><b>Передачи и альтернативы</b><span>{journeyLinks.length} связей handoff</span></div>
      {journeyLinks.length ? journeyLinks.map((link) => <div className="om-journey-edge" key={link.id}><button type="button" onClick={() => onOpen(link.from)}>{nameOf(nodes, link.from)}</button><i>→</i><button type="button" onClick={() => onOpen(link.to)}>{nameOf(nodes, link.to)}</button><small>{link.reason || "Передача без описанного условия"}</small></div>) : <p>Явных переходов между этапами пути нет.</p>}
    </section>
    <div className="om-safety-note"><b>Обратная связь не запускает пересмотр стратегии</b><span>Связи feedback возвращают наблюдение в существующий процесс принятия решений. Автоматического изменения стратегии нет.</span></div>
    {path.length ? <div className="om-journey">
      {path.map((stage, index) => {
        const process = nodes.get(stage.processId);
        const stageProcessIds = [stage.processId, stage.b2bProcessId].filter((id): id is string => !!id);
        const finance = data.links.filter((link) => link.kind === "finance_event" && (stageProcessIds.includes(link.from) || stageProcessIds.includes(link.to)));
        const feedback = data.links.filter((link) => link.kind === "feedback" && (stageProcessIds.includes(link.from) || stageProcessIds.includes(link.to)));
        const condition = stage.condition || "";
        return <article className="om-journey-stage" key={stage.id}>
          <div className="om-journey-marker"><b>{String(index + 1).padStart(2, "0")}</b></div>
          <div className="om-journey-card">
            <div className="om-journey-title"><label><span>ЭТАП {String(index + 1).padStart(2, "0")}</span><input aria-label={`Название этапа ${index + 1}`} value={stage.name} onChange={(event) => onPatchPath(stage.id, { name: event.target.value })} /></label>
              <select aria-label={`Процесс этапа ${index + 1}`} value={stage.processId} onChange={(event) => onPatchPath(stage.id, { processId: event.target.value })}><option value="">Выбрать процесс</option>{data.nodes.filter((node) => node.kind === "process").map((node) => <option value={node.id} key={node.id}>{node.code} · {node.name}</option>)}</select>
            </div>
            {process ? <button type="button" className="om-journey-process" onClick={() => onOpen(process.id)}><code>{process.code}</code><b>{process.name}</b><Maturity node={process} /></button> : <div className="om-journey-missing">Связанный процесс не найден — выберите его выше</div>}
            {(stage.id === "acquire" || stage.b2bProcessId) && <div className="om-b2b-alternative"><label><span>ОТДЕЛЬНЫЙ ПРОЦЕСС B2B</span><select value={stage.b2bProcessId ?? ""} onChange={(event) => onPatchPath(stage.id, { b2bProcessId: event.target.value || undefined })}><option value="">Не задан</option>{data.nodes.filter((node) => node.kind === "process").map((node) => <option value={node.id} key={node.id}>{node.code} · {node.name}</option>)}</select></label>{stage.b2bProcessId && <button type="button" onClick={() => onOpen(stage.b2bProcessId!)}>{nameOf(nodes, stage.b2bProcessId)} · открыть карточку</button>}</div>}
            <div className="om-journey-audiences"><label><span>B2C</span><textarea rows={2} value={stage.b2c} placeholder="Как проходит этап для частного клиента" onChange={(event) => onPatchPath(stage.id, { b2c: event.target.value })} /></label><label><span>B2B</span><textarea rows={2} value={stage.b2b} placeholder="Как проходит этап для бизнес-клиента" onChange={(event) => onPatchPath(stage.id, { b2b: event.target.value })} /></label></div>
            <label className="om-condition"><span>Условие / развилка</span><input value={condition} placeholder="Например: оплата при переходе к покупке" onChange={(event) => onPatchPath(stage.id, { condition: event.target.value })} /></label>
            <div className="om-event-bands"><div><b>Финансовые события</b><span>{finance.length ? finance.map((link) => <button key={link.id} type="button" onClick={() => onOpen(link.from === stage.processId ? link.to : link.from)}>{link.reason || nameOf(nodes, link.from === stage.processId ? link.to : link.from)}</button>) : "События на этапе не связаны"}</span></div>
              <div><b>Обратная связь</b><span>{feedback.length ? feedback.map((link) => <button key={link.id} type="button" onClick={() => onOpen(link.from === stage.processId ? link.to : link.from)}>{link.reason || nameOf(nodes, link.from === stage.processId ? link.to : link.from)}</button>) : "Связь с процессом решения не указана"}</span></div></div>
          </div>
        </article>;
      })}
    </div> : <div className="om-empty"><strong>Путь клиента пока не описан</strong>Добавьте customerPath в текущую модель; этапы не создаются из отдельного дублирующего списка.</div>}
    <section className="om-path-coverage"><div><b>Покрытие пути</b><span>{pathGaps.length ? `${pathGaps.length} пробелов` : "Замечаний по этапам нет"}</span></div>{pathGaps.length ? <ul>{pathGaps.map((gap) => <li key={gap}>{gap}</li>)}</ul> : <p>Проверены этапы, B2C/B2B-описания и передачи между соседними процессами.</p>}</section>
    <div className="om-journey-bookends"><div><small>ДО ПОКУПКИ</small><b>Интерес · выбор · решение</b><span>Расходы до первой покупки показываются по своим finance_event-связям.</span></div><div><small>ВОЗВРАТ ИЛИ ПОВТОР</small><b>Разные финансовые события</b><span>Возврат денег, повторное использование и удержание не предполагают линейный порядок друг за другом.</span></div></div>
    <section className="om-finance-ledger"><div><b>Финансовые события по связям модели</b><span>{financeLinks.length} finance_event</span></div>
      {financeLinks.length ? financeLinks.map((link) => {
        const sourceId = link.from === "finance-reconcile" ? link.to : link.from;
        const source = nodes.get(sourceId);
        const stage = stageForProcess(sourceId);
        const timing = /до покупки|pre.purchase/i.test(link.reason) ? "До покупки" : /возврат|после ухода|refund/i.test(link.reason) ? "Возврат / после ухода" : stage?.name ?? "Вне пути клиента";
        return <div className="om-finance-row" key={link.id}><span>{timing}</span><button type="button" onClick={() => onOpen(sourceId)}>{source?.code} · {source?.name ?? "Неизвестный источник"}</button><small>{link.reason || "Условие события не описано"}</small></div>;
      }) : <p>Финансовые события ещё не связаны с процессами.</p>}
    </section>
    <footer className="om-structure-foot"><b>Условные этапы</b><span>Оплата, возврат и повторное использование зависят от условий конкретной модели; различия B2C/B2B редактируются по этапам.</span></footer>
  </section>;
}
