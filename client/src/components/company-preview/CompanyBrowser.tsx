import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowRight, BriefcaseBusiness, Check, ChevronRight, CircleHelp,
  ClipboardList, FileText, LockKeyhole, Network, Package, ShieldCheck, UserRound,
} from "lucide-react";
import type { WorkNode } from "@shared/operatingModel";
import type { ProjectModelState } from "@shared/projectModel";
import { Button } from "@/components/ui/button";
import "./CompanyBrowser.css";

type Props = { model: ProjectModelState };
type RouteState = { department: string | null; role: string | null; action: string | null };
const readRoute = (): RouteState => {
  const query = new URLSearchParams(window.location.search);
  return { department: query.get("department"), role: query.get("role"), action: query.get("action") };
};
const value = (text?: string | null) => text?.trim() || "";
const displayName = (node: WorkNode) => node.name.trim().replace(/\s*[-—–]\s*существующий\s+паспорт\s*$/i, "");
const statusLabel = (status: WorkNode["status"]) => status === "proposal" ? "Предложение · не согласовано" : "Согласовано в модели";
const resourceStateLabel = (state: WorkNode["resourceState"]) => state === "connected" ? "Подключён по записи" : state === "approved" ? "Одобрен в модели" : state === "required" ? "Требуется" : "Статус не указан";
const formLabels = { required: "Требуется разработать", draft: "Черновик", discussion: "На обсуждении", approved: "Согласована в модели" };

export default function CompanyBrowser({ model }: Props) {
  const [route, setRoute] = useState<RouteState>(() => readRoute());
  const revision = model.operatingModel?.revisions.at(-1);
  const data = revision?.data;
  const nodes = data?.nodes ?? [];
  const links = data?.links ?? [];
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const departments = useMemo(() => nodes.filter((node) => node.kind === "department" && node.level === "direction")
    .slice().sort((a, b) => a.code.localeCompare(b.code, "ru")), [nodes]);
  const roles = useMemo(() => nodes.filter((node) => node.kind === "role"), [nodes]);

  useEffect(() => {
    const onPopState = () => setRoute(readRoute());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = (next: RouteState) => {
    const params = new URLSearchParams();
    if (next.department) params.set("department", next.department);
    if (next.role) params.set("role", next.role);
    if (next.action) params.set("action", next.action);
    const query = params.toString();
    window.history.pushState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    setRoute(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const findDepartmentForRole = (role: WorkNode) => {
    let parent = role.parentId;
    const seen = new Set([role.id]);
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const node = byId.get(parent);
      if (!node) return undefined;
      if (node.kind === "department" && node.level === "direction") return node;
      parent = node.parentId;
    }
    return undefined;
  };
  const department = route.department ? departments.find((node) => node.id === route.department) : undefined;
  const selectedRole = route.role ? roles.find((node) => node.id === route.role) : undefined;
  const action = route.action ? nodes.find((node) => node.id === route.action && node.kind === "action") : undefined;
  const noModel = !revision;
  const brokenRoute = !!route.department && !department
    || (!!route.role && (!selectedRole || findDepartmentForRole(selectedRole)?.id !== route.department))
    || (!!route.action && (!action || action.roleId !== route.role));

  const roleForDepartment = (dept: WorkNode) => dept.roleId ? byId.get(dept.roleId) : undefined;
  const rolesForDepartment = (dept: WorkNode) => roles.filter((role) => findDepartmentForRole(role)?.id === dept.id)
    .slice().sort((a, b) => a.code.localeCompare(b.code, "ru"));
  const actionOutputs = (item: WorkNode) => links.filter((link) => link.from === item.id && link.kind === "produces")
    .map((link) => byId.get(link.to)).filter((node): node is WorkNode => !!node);
  const resourcesFor = (item: WorkNode) => item.resourceIds.map((id) => byId.get(id)).filter((node): node is WorkNode => !!node);
  const renderValue = (text?: string | null) => text?.trim() ? <div className="cb-rich">{text.trim()}</div> : <span className="cb-no-data">Нет данных</span>;
  const actionName = (item: WorkNode) => item.name || "Действие без названия";

  const Fact = ({ icon: Icon, label, children, wide = false }: { icon: typeof FileText; label: string; children: React.ReactNode; wide?: boolean }) => (
    <section className={`cb-fact${wide ? " wide" : ""}`}>
      <div className="cb-fact-label"><Icon size={14} />{label}</div>
      <div className="cb-fact-value">{children}</div>
    </section>
  );

  const renderTop = () => <header className="cb-topbar">
    <div className="cb-brand"><span className="cb-brand-mark"><Network size={19} /></span><span>TalkHint <span className="cb-brand-sub">company browser</span></span></div>
    <span className="cb-readonly"><LockKeyhole size={14} /> Только чтение</span>
  </header>;

  const renderNotFound = () => <div className="cb-not-found">
    <div className="cb-empty-icon"><CircleHelp size={22} /></div>
    <h2>Не удалось найти этот раздел</h2>
    <p>Ссылка может относиться к другой версии структуры. Ничего не подставлено автоматически.</p>
    <Button type="button" className="cb-primary-button" onClick={() => navigate({ department: null, role: null, action: null })}><ArrowLeft size={16} /> К отделам</Button>
  </div>;

  const renderOverview = () => <main>
    <div className="cb-hero">
      <div><p className="cb-eyebrow">Структура компании · Dev</p><h1>Компания TalkHint</h1>
        <p>Отдел → должность → обязанности. Текущая модель без смешивания гипотез и документов.</p></div>
      {revision && <div className="cb-snapshot">Снимок модели · v{revision.version}</div>}
    </div>
    {byId.get("owner") && <details className="cb-disclosure"><summary>Владелец и руководство</summary><div className="cb-disclosure-body cb-info-strip"><span>Владелец: <strong>{byId.get("owner")!.name}</strong></span>
      {byId.get("ai-ceo") && <span>Руководство: <strong>{byId.get("ai-ceo")!.name}</strong> · {statusLabel(byId.get("ai-ceo")!.status)}</span>}</div></details>}
    {noModel ? <div className="cb-empty"><div className="cb-empty-icon"><BriefcaseBusiness size={21} /></div><h2>Сохранённая структура пока не найдена</h2><p>Этот обзор использует только последнюю сохранённую ревизию операционной модели. Черновики и другие модели здесь не показываются.</p></div> :
      departments.length === 0 ? <div className="cb-empty"><div className="cb-empty-icon"><BriefcaseBusiness size={21} /></div><h2>Отделы не описаны</h2><p>В последней сохранённой модели нет направлений компании.</p></div> :
        <>
          <div className="cb-section-label"><h2>Направления компании</h2><span>Выберите направление, чтобы увидеть роли</span></div>
          <div className="cb-department-list">
            {departments.map((dept) => {
              const deptRoles = rolesForDepartment(dept);
              const head = roleForDepartment(dept);
              const ready = !!value(dept.purpose) && !!dept.clientId && dept.inputs.length > 0;
              const isT01 = dept.code.trim().toLocaleUpperCase("ru") === "T01";
              return <Button variant="ghost" type="button" key={dept.id} onClick={() => navigate({ department: dept.id, role: null, action: null })}
                className={`cb-department-card${isT01 ? " cb-featured" : ""}`}>
                <span className="cb-department-number">{dept.code || "—"}</span>
                <span className="cb-department-copy"><strong>{dept.name}</strong>
                  <span className="cb-department-meta">
                    <span><UserRound size={13} />{head ? `${head.status === "proposal" ? "Предложен: " : ""}${head.name}` : "Ответственный: нет данных"}</span>
                    <span><i className={`cb-status-dot${ready ? " ready" : ""}`} />{ready ? "Описание есть" : "Есть неуточнённые сведения"}</span>
                    {deptRoles.length > 0 && <span>{deptRoles.length} {deptRoles.length === 1 ? "роль" : "ролей"}</span>}
                  </span>
                </span><ChevronRight className="cb-arrow" size={19} />
              </Button>;
            })}
          </div>
          <div className="cb-note"><ShieldCheck size={17} /><span><strong>Модель — это план, не штат и не работающий AI.</strong> Назначения показывают записи в модели. Они не подтверждают найм, доступ к ресурсам или запуск исполнителя.</span></div>
        </>}
  </main>;

  const renderDepartment = (dept: WorkNode) => {
    const deptRoles = rolesForDepartment(dept);
    const responsible = roleForDepartment(dept);
    const client = dept.clientId ? byId.get(dept.clientId)?.name : "";
    return <main>
      <div className="cb-hero"><div><p className="cb-eyebrow">Направление · {dept.code || "код не указан"}</p><h1>{dept.name}</h1>
        <p>Область ответственности, внутренняя потребность и связанные роли из сохранённой модели.</p></div>
        <div className="cb-snapshot">{statusLabel(dept.status)}</div></div>
      <section className="cb-panel">
        <div className="cb-dept-intro"><div><h2>Зачем существует направление</h2><div>{renderValue(dept.purpose || dept.description)}</div></div>
          <div className="cb-head-chip"><UserRound size={17} /><span>Ответственный<strong>{responsible?.name ?? "Нет данных"}</strong></span></div>
        </div>
        <div className="cb-grid">
          <Fact icon={UserRound} label="Клиент результата">{client || <span className="cb-no-data">Нет данных</span>}</Fact>
          <Fact icon={ClipboardList} label="Контекст направления">{renderValue(dept.description)}</Fact>
          <Fact icon={Package} label="Входы и источники" wide>{dept.inputs.length ? dept.inputs.map((input, index) => <div key={`${input.name}-${index}`}><strong>{input.name || "Вход"}</strong>{input.sourceId ? ` · ${byId.get(input.sourceId)?.name ?? "Источник не найден"}` : " · источник не указан"}{input.freshness ? ` · актуальность: ${input.freshness}` : ""}</div>) : <span className="cb-no-data">Нет данных</span>}</Fact>
          <Fact icon={Check} label="Описанный результат" wide>{renderValue(dept.success || dept.delivery)}</Fact>
        </div>
      </section>
      <div className="cb-section-label"><h2>Роли направления</h2><span>Состав в модели · не подтверждение найма</span></div>
      {deptRoles.length ? <div className="cb-role-list">{deptRoles.map((role) => <Button variant="ghost" type="button" className="cb-role-card" key={role.id} aria-label={role.name}
        onClick={() => navigate({ department: dept.id, role: role.id, action: null })}>
        <span><strong>{displayName(role)}</strong><small>{role.purpose || role.description || "Назначение роли пока не описано."}</small><small className={`cb-role-status${role.status === "agreed" ? " agreed" : ""}`}>{statusLabel(role.status)}</small></span><ChevronRight size={18} /></Button>)}</div>
        : <div className="cb-empty"><div className="cb-empty-icon"><UserRound size={20} /></div><h2>Роли не найдены</h2><p>В модели нет ролей, чья родительская цепочка ведёт к этому направлению.</p></div>}
      <div className="cb-callout">Руководитель по линии управления задаётся отдельно через managerId. Он не определяется клиентом результата и не выводится из группировки роли по отделу.</div>
    </main>;
  };

  const renderRole = (role: WorkNode, dept: WorkNode) => {
    const ownedActions = nodes.filter((node) => node.kind === "action" && node.roleId === role.id);
    const reports = nodes.filter((node) => node.kind === "report" && node.roleId === role.id);
    const roleResources = resourcesFor(role);
    const manager = role.managerId ? byId.get(role.managerId)?.name : "";
    const passport = model.elements.find((element) => element.coordination?.kind === "role_passport" && element.coordination.roleId === role.id);
    return <main>
      <div className="cb-hero"><div><p className="cb-eyebrow">{dept.code || "Отдел"} / {dept.name}</p>
        <div className="cb-role-title"><div><h1>{displayName(role)}</h1><p>{role.code ? `${role.code} · ` : ""}Паспорт роли</p></div><span className={`cb-status-pill${role.status === "agreed" ? " agreed" : ""}`}>{statusLabel(role.status)}</span></div>
      </div></div>
      <div className="cb-info-strip">
        <span><UserRound size={16} />Непосредственный руководитель: <strong>{manager || "Нет данных"}</strong></span>
        <span><ShieldCheck size={16} />Исполнитель: <strong>{role.executorId ? byId.get(role.executorId)?.name ?? "Назначение не разрешено" : "Не назначен"}</strong> — запись назначения, не запуск</span>
      </div>
      <section className="cb-panel">
        <div className="cb-section-label" style={{ marginTop: 0 }}><h2>Назначение и обязанности</h2><span>Сохранённые факты модели</span></div>
        <div className="cb-grid">
          <Fact icon={UserRound} label="Клиент результата">{role.clientId ? byId.get(role.clientId)?.name ?? "Клиент не найден" : <span className="cb-no-data">Нет данных</span>}</Fact>
          <Fact icon={FileText} label="Зачем нужна роль">{renderValue(role.purpose || role.description)}</Fact>
          <Fact icon={Check} label="Ожидаемый результат">{renderValue(role.success)}</Fact>
          <Fact icon={ShieldCheck} label="Кто принимает">{role.acceptorId ? byId.get(role.acceptorId)?.name ?? "Принимающий не найден" : <span className="cb-no-data">Нет данных</span>}</Fact>
        </div>
      </section>
      {passport && <details className="cb-disclosure"><summary>Существующий паспорт роли</summary><div className="cb-disclosure-body">
        <p className="cb-fact-value">{passport.title}</p>
        {Object.entries(passport.details ?? {}).filter(([, entry]) => !!entry?.trim()).map(([key, entry]) => <div className="cb-fact" key={key} style={{ marginTop: 8 }}><div className="cb-fact-label">{key}</div><div className="cb-fact-value">{entry}</div></div>)}
        <div className="cb-callout">Показаны только поля существующего паспорта, связанного с этой ролью. Статус элемента: {passport.contentStatus === "confirmed" ? "подтверждено" : passport.contentStatus === "proposal" ? "предложение" : passport.contentStatus === "hypothesis" ? "гипотеза" : "открытый вопрос"}.</div>
      </div></details>}
      <div className="cb-section-label"><h2>Должностные обязанности</h2><span>{ownedActions.length ? `${ownedActions.length} действий · открыть процедуру` : "Нет описанных действий"}</span></div>
      {ownedActions.length ? <div className="cb-action-list">{ownedActions.map((item) => <Button variant="ghost" key={item.id} type="button" className="cb-action-link"
        onClick={() => navigate({ department: dept.id, role: role.id, action: item.id })}>
        <span><strong>{item.name}</strong><small>{item.status === "proposal" ? "Предложение · не согласовано" : "Описание сохранено в модели"}{item.clientId ? ` · клиент: ${byId.get(item.clientId)?.name ?? "нет данных"}` : ""}</small></span><ChevronRight size={17} /></Button>)}</div>
        : <div className="cb-callout">Действия и фактические показатели не представлены. Это не означает нулевую загрузку или отсутствие работы.</div>}
      <details className="cb-disclosure"><summary>Регламент, полномочия и ресурсы</summary><div className="cb-disclosure-body">
        <Fact icon={ClipboardList} label="Общий регламент">{renderValue(role.procedure || role.rules)}</Fact>
        <Fact icon={ShieldCheck} label="Ограничения и полномочия">{renderValue(role.constraints)}</Fact>
        <Fact icon={Package} label="Ресурсы роли">{roleResources.length ? roleResources.map(resource => <div className="cb-resource" key={resource.id}>
          <span>{resource.name}</span><span className="cb-resource-state">{resourceStateLabel(resource.resourceState)}</span></div>) : "Нет данных о ресурсах роли"}</Fact>
        {role.resourceIds.some(id => !byId.has(id)) && <p>Часть связей с ресурсами не разрешена в текущем снимке.</p>}
      </div></details>
      {reports.length > 0 && <details className="cb-disclosure"><summary>Отчётность роли · {reports.length}</summary><div className="cb-disclosure-body">{reports.map((report) => <div className="cb-fact" key={report.id} style={{ marginBottom: 9 }}>
        <div className="cb-fact-label"><FileText size={14} />{report.name}</div>
        <div className="cb-fact-value">{renderValue(report.purpose)}<p>Форма: {report.reporting?.formName || "не указана"} · статус: {report.reporting ? formLabels[report.reporting.formStatus] : "нет данных"}{report.reporting?.approvalEvidence ? ` · основание согласования: ${report.reporting.approvalEvidence}` : ""}</p>
          <p>Хранение: {report.reporting?.storage || report.storage || "Нет данных"} · шаблон: {report.reporting?.templateDocumentId ? model.documents.find((doc) => doc.id === report.reporting?.templateDocumentId)?.title ?? "Шаблон не найден" : "Нет данных"}</p></div>
      </div>)}</div></details>}
      <div className="cb-callout"><strong>План-факт исполнения.</strong> Этот образец не подключён к журналу фактической работы. Из описания должности нельзя вывести выполненный план, стоимость или эффективность; принятые результаты нужно проверять отдельно.</div>
    </main>;
  };

  const renderAction = (item: WorkNode, role: WorkNode, dept: WorkNode) => {
    const outputs = actionOutputs(item);
    const resources = resourcesFor(item);
    const recipient = item.recipientId ? byId.get(item.recipientId)?.name : "";
    const acceptor = item.acceptorId ? byId.get(item.acceptorId)?.name : "";
    return <main>
      <div className="cb-hero"><div><p className="cb-eyebrow">{dept.name} / {displayName(role)}</p><h1>Процедура</h1><p>Детали одного действия, сохранённые в модели.</p></div></div>
      <div className="cb-action-head"><p className="cb-eyebrow">{item.code || "Действие"} · {item.status === "proposal" ? "предложение, не согласовано" : "согласовано в модели"}</p>
        <h2>{actionName(item)}</h2><p>{value(item.purpose) || value(item.description) || "Назначение не описано."}</p></div>
      <div className="cb-grid">
        <Fact icon={UserRound} label="Клиент результата">{item.clientId ? byId.get(item.clientId)?.name ?? "Клиент не найден" : <span className="cb-no-data">Нет данных</span>}</Fact>
        <Fact icon={UserRound} label="Исполнитель">{item.executorId ? byId.get(item.executorId)?.name ?? "Назначение не разрешено" : <span className="cb-no-data">Не назначен</span>}</Fact>
        <Fact icon={ClipboardList} label="Процедура" wide>{renderValue(item.procedure)}</Fact>
        <Fact icon={Package} label="Входы и свежесть" wide>{item.inputs.length ? item.inputs.map((input, index) => <div key={`${input.name}-${index}`}><strong>{input.name || "Вход"}</strong> · {input.sourceId ? byId.get(input.sourceId)?.name ?? "Источник не найден" : "Источник не указан"} · актуальность: {input.freshness || "не указана"}</div>) : <span className="cb-no-data">Нет данных</span>}</Fact>
        <Fact icon={Check} label="Результаты" wide>{outputs.length ? outputs.map((out) => <div key={out.id}><strong>{out.name}</strong>{out.purpose ? ` · ${out.purpose}` : ""}</div>) : <span className="cb-no-data">Нет данных: связь «производит» не указана</span>}</Fact>
        <Fact icon={ArrowRight} label="Получатель">{recipient || <span className="cb-no-data">Нет данных</span>}</Fact>
        <Fact icon={ShieldCheck} label="Принимающий">{acceptor || <span className="cb-no-data">Нет данных</span>}</Fact>
        <Fact icon={Package} label="Ресурсы и доступ" wide>{resources.length ? resources.map((resource) => <div className="cb-resource" key={resource.id}><span><strong>{resource.name}</strong><small>{resource.description || resource.purpose || "Описание отсутствует"}</small></span><span className={`cb-resource-state ${resource.resourceState ?? ""}`}>{resourceStateLabel(resource.resourceState)}</span></div>) : <span className="cb-no-data">Нет данных о требуемых ресурсах</span>}</Fact>
        <Fact icon={ClipboardList} label="Условия успеха">{renderValue(item.success)}</Fact>
        <Fact icon={ShieldCheck} label="Правила и ограничения">{renderValue([item.rules, item.constraints].filter(Boolean).join("\n\n"))}</Fact>
        <Fact icon={CircleHelp} label="Исключения и открытые вопросы" wide>{renderValue([item.exceptions, item.questions].filter(Boolean).join("\n\n"))}</Fact>
        <Fact icon={FileText} label="Сроки / триггер" wide>{[item.schedule.trigger, item.schedule.deadline, item.schedule.hours, item.schedule.timezone].filter(Boolean).join(" · ") || <span className="cb-no-data">Нет данных</span>}</Fact>
        <Fact icon={ShieldCheck} label="Контроль">{links.filter(link => link.from === item.id && link.kind === "accountable_to").map(link => byId.get(link.to)?.name ?? "Контролирующий не найден").join("; ") || "Нет данных"}</Fact>
        <Fact icon={FileText} label="Отчётность и хранение" wide>{item.reporting?.required ? <>
          <strong>{item.reporting.formName || "Название формы не указано"}</strong>
          <p>Статус формы: {formLabels[item.reporting.formStatus]}. Хранение: {item.reporting.storage || item.storage || "не указано"}.</p>
          {item.reporting.templateDocumentId && (() => {
            const document = model.documents.find(doc => doc.id === item.reporting?.templateDocumentId);
            return document ? <details className="cb-disclosure"><summary>Читать связанный шаблон</summary><div className="cb-disclosure-body">
              <strong>{document.title}</strong><p>Обновлено: {new Date(document.updatedAt).toLocaleDateString("ru-RU")}; наличие шаблона не подтверждает утверждение.</p><div className="cb-rich">{document.text}</div></div></details> : <p>Связанный шаблон не найден.</p>;
          })()}
        </> : <span className="cb-no-data">Отчётность не описана или не требуется; см. правила действия.</span>}</Fact>
        <Fact icon={ArrowRight} label="Следующий шаг" wide>{(() => {
          const next = item.nextId ? byId.get(item.nextId) : undefined;
          const nextRole = next?.roleId ? byId.get(next.roleId) : undefined;
          const nextDepartment = nextRole ? findDepartmentForRole(nextRole) : undefined;
          return next && next.kind === "action" && nextRole && nextDepartment ? <Button variant="ghost" className="cb-action-link" onClick={() => navigate({ department: nextDepartment.id, role: nextRole.id, action: next.id })}>{next.name}<ChevronRight size={16} /></Button> : next?.name || "Нет данных";
        })()}</Fact>
      </div>
      <div className="cb-callout">Наличие процедуры или ресурса в модели не запускает работу и не предоставляет доступ. Решение о приёмке здесь не создаётся.</div>
    </main>;
  };

  const breadcrumb = <nav className="cb-breadcrumb" aria-label="Навигационная цепочка">
    <Button variant="ghost" type="button" onClick={() => navigate({ department: null, role: null, action: null })}>Компания</Button>
    {department && <><ChevronRight size={14} /><Button variant="ghost" type="button" onClick={() => navigate({ department: department.id, role: null, action: null })}>{department.name}</Button></>}
    {selectedRole && department && !brokenRoute && <><ChevronRight size={14} /><Button variant="ghost" type="button" aria-label={selectedRole.name} onClick={() => navigate({ department: department.id, role: selectedRole.id, action: null })}>{displayName(selectedRole)}</Button></>}
    {action && !brokenRoute && <><ChevronRight size={14} /><span>{action.name}</span></>}
  </nav>;

  return <div className="company-browser"><div className="cb-shell">
    {renderTop()}
    {(route.department || route.role || route.action) && breadcrumb}
    {brokenRoute ? renderNotFound() : action && selectedRole && department ? renderAction(action, selectedRole, department)
      : selectedRole && department ? renderRole(selectedRole, department)
        : department ? renderDepartment(department) : renderOverview()}
    <footer className="cb-footer">DEV sample · только чтение · источник: последняя сохранённая ревизия операционной модели{revision ? ` v${revision.version}` : ""}. Значения «нет данных» не заменяются предположениями.</footer>
  </div></div>;
}
