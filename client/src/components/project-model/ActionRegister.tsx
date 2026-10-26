import React, { useMemo, useState } from "react";
import type { OperatingData, WorkNode } from "@shared/operatingModel";
import { actionDirection, actionOutputs, effortMinutes, levelNames } from "@shared/actionRegister";
import type { ModelDocument } from "@shared/projectModel";
import { reportingStatusLabels, templateDownloadPath } from "@shared/actionReporting";

type Props = {
  data: OperatingData;
  documents?: ModelDocument[];
  selectedId: string | null;
  search: string;
  onSelect: (id: string) => void;
};

const days = ["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const minutesLabel = (value: number | null) => value === null ? "Не оценено" : `${value} мин`;

export default function ActionRegister({ data, documents = [], selectedId, search, onSelect }: Props) {
  const [roleFilter, setRoleFilter] = useState("all");
  const [proposalOnly, setProposalOnly] = useState(false);
  const nodesById = useMemo(() => new Map(data.nodes.map((node) => [node.id, node])), [data.nodes]);
  const actions = useMemo(() => data.nodes.filter((node) => node.kind === "action"), [data.nodes]);
  const roles = useMemo(() => data.nodes.filter((node) => node.kind === "role").sort((a, b) => a.name.localeCompare(b.name, "ru")), [data.nodes]);
  const query = search.trim().toLocaleLowerCase("ru");
  const filtered = actions.filter((node) => {
    const register = node.register;
    const proposal = !!register?.proposalReason?.trim();
    return (roleFilter === "missing" ? !node.roleId || !nodesById.has(node.roleId) : roleFilter === "all" || node.roleId === roleFilter)
      && (!proposalOnly || proposal)
      && (!query || `${node.code} ${node.name} ${node.description} ${node.schedule.trigger} ${register?.availability ?? ""} ${register?.source ?? ""} ${register?.proposalReason ?? ""}`.toLocaleLowerCase("ru").includes(query));
  });
  const duties = roleFilter === "missing" ? actions.filter((node) => !node.roleId || !nodesById.has(node.roleId))
    : roleFilter === "all" ? actions
      : actions.filter((node) => node.roleId === roleFilter);
  const unknownEstimates = duties.filter((node) => effortMinutes(node) === null).length;
  const periods = new Set(duties.map((node) => node.register?.period.trim()).filter(Boolean));

  const rowSummary = (node: WorkNode) => {
    const role = node.roleId ? nodesById.get(node.roleId) : undefined;
    const direction = actionDirection(data, node);
    const outputs = actionOutputs(data, node.id);
    const estimate = effortMinutes(node);
    return { role, direction, outputs, estimate };
  };

  return <section className="om-action-register" aria-label="Реестр действий">
    <div className="om-action-register-heading">
      <div><p className="pm-kicker">ACTION REGISTER / OWNER WORKSPACE</p><h3>Реестр действий</h3>
        <p>Одна строка — одно действие модели. Оценки описывают план, а не фактическую загрузку или запуск.</p></div>
      <span>{filtered.length} из {actions.length}</span>
    </div>
    <div className="om-action-filters">
      <label><span>Ответственная роль</span><select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
        <option value="all">Все роли</option><option value="missing">Роль не назначена</option>
        {roles.map((role) => <option value={role.id} key={role.id}>{role.code} · {role.name}</option>)}
      </select></label>
      <label className="om-action-proposal-filter"><input type="checkbox" checked={proposalOnly} onChange={(event) => setProposalOnly(event.target.checked)} /><span>Предложения Replit с причиной</span></label>
      {(roleFilter !== "all" || proposalOnly) && <button type="button" onClick={() => { setRoleFilter("all"); setProposalOnly(false); }}>Сбросить фильтры</button>}
    </div>
    <aside className="om-duty-summary" aria-live="polite">
      <div><span>Обязанности {roleFilter === "missing" ? "без роли" : roleFilter === "all" ? "в выборке" : `роли «${nodesById.get(roleFilter)?.name ?? "не найдена"}»`}</span><b>{duties.length} действий</b></div>
      <p>{duties.length
        ? `В выборке ${unknownEstimates} ${unknownEstimates === 1 ? "действие без оценки" : "действий без оценки"}.`
        : "Для выбранной роли действий пока нет."}
        {periods.size > 1 ? ` Периоды оценок различаются (${Array.from(periods).join(", ")}); общий итог времени не рассчитывается.` : ""}
        {periods.size <= 1 && duties.length && unknownEstimates < duties.length ? " Суммарная нагрузка не выводится: часть оценок может быть неполной." : ""}
      </p>
      {!!duties.length && <div className="om-duty-list" aria-label="Все обязанности роли">{duties.map((node) =>
        <button type="button" key={node.id} onClick={() => onSelect(node.id)}><code>{node.code || "—"}</code>{node.name || "Без названия"}</button>)}</div>}
    </aside>
    {filtered.length ? <>
      <div className="om-action-table-scroll"><table className="om-action-table">
         <thead><tr><th>Действие</th><th>Направление</th><th>Уровень</th><th>Роль</th><th>Триггер и окно</th><th>Доступность</th><th>Частота × длительность</th><th>Оценка</th><th>Выходы</th><th>Отчётная форма</th><th>Статус решения</th></tr></thead>
        <tbody>{filtered.map((node) => {
          const { role, direction, outputs, estimate } = rowSummary(node);
          const schedule = node.schedule;
          const register = node.register;
          const reporting = node.reporting;
          const template = reporting?.templateDocumentId
            ? documents.find((document) => document.id === reporting.templateDocumentId)
            : undefined;
          const isProposal = !!(register?.proposalReason?.trim() || register?.source?.trim());
          return <tr className={selectedId === node.id ? "is-selected" : ""} key={node.id} onClick={() => onSelect(node.id)}>
            <th scope="row"><button type="button" className="om-action-open" onClick={() => onSelect(node.id)}><code>{node.code || "без кода"}</code><b>{node.name || "Без названия"}</b></button>
              <small>{node.status === "agreed" ? "Статус узла: согласовано" : "Статус узла: предложение"}{isProposal ? " · основание предложения" : ""}</small>
              {isProposal && <small className="om-action-proposal-note">{register?.proposalReason || register?.source}</small>}
            </th>
            <td>{direction ? <>{direction.code} · {direction.name}</> : <span className="om-table-empty">Не определено</span>}</td>
            <td>{node.level ? levelNames[node.level] : "Не определён"}</td>
            <td>{role ? <>{role.code} · {role.name}</> : <span className="om-action-missing">Не назначена</span>}</td>
            <td>{schedule.trigger || "Без триггера"}<small>{schedule.days.length ? schedule.days.map((day) => days[day] ?? String(day)).join(", ") : "Дни не заданы"} · {schedule.hours || "часы не заданы"} · {schedule.timezone || "часовой пояс не задан"}</small></td>
            <td>{register?.availability || "Не определена"}</td>
            <td>{register?.operationsPerPeriod ?? "—"} × {register?.minutesPerOperation === null || register?.minutesPerOperation === undefined ? "неизвестно" : `${register.minutesPerOperation} мин`}
              <small>{register?.period || "Период не указан"}{register?.estimateBasis ? ` · ${register.estimateBasis}` : ""}</small></td>
            <td>{minutesLabel(estimate)}{estimate !== null && register?.period ? <small>за {register.period}</small> : ""}</td>
            <td>{outputs.length ? outputs.map((output) => <span className="om-action-output" key={output.id}>{output.code} · {output.name}</span>) : <span className="om-table-empty">Не связаны</span>}</td>
            <td>
              {!reporting ? <span className="om-table-empty">Отчётность не уточнена</span> : <>
                <b>{reporting.formName || (reporting.required ? "Форма не названа" : "Форма не указана")}</b>
                <small>{reporting.required ? "Форма обязательна" : "Форма не обязательна"}</small>
                {reporting.templateDocumentId ? template
                  ? <a className="om-report-template-link" href={templateDownloadPath(template.id)} onClick={(event) => event.stopPropagation()}>{template.title} · скачать</a>
                  : <small className="om-action-missing">Шаблон отсутствует в документах гипотезы</small>
                  : reporting.required && <small className="om-action-missing">Требуется разработать шаблон</small>}
                <small>Версия: {reporting.templateVersion || "не указана"} · Хранение результата: {reporting.storage || "не указано"}</small>
                <span className={`om-action-approval om-report-status is-${reporting.formStatus}`}>{reportingStatusLabels[reporting.formStatus]}</span>
                {reporting.formStatus === "approved" && reporting.approvalEvidence && <small>Основание: {reporting.approvalEvidence}</small>}
              </>}
            </td>
            <td><span className={`om-action-approval is-${register?.approval ?? "draft"}`}>{register?.approval === "approved" ? "Утверждено" : register?.approval === "discussion" ? "К обсуждению" : "Черновик"}</span></td>
          </tr>;
        })}</tbody>
      </table></div>
      <div className="om-action-mobile-list">{filtered.map((node) => {
        const { role, direction, outputs, estimate } = rowSummary(node);
        const register = node.register;
        const reporting = node.reporting;
        const template = reporting?.templateDocumentId
          ? documents.find((document) => document.id === reporting.templateDocumentId)
          : undefined;
        const isProposal = !!(register?.proposalReason?.trim() || register?.source?.trim());
        return <article key={node.id} className={`om-action-mobile-card ${selectedId === node.id ? "is-selected" : ""}`}>
          <button type="button" className="om-action-mobile-title" onClick={() => onSelect(node.id)}><code>{node.code}</code><b>{node.name}</b></button>
          <span className="om-action-mobile-meta">{direction?.name ?? "Направление не определено"} · {node.level ? levelNames[node.level] : "Уровень не определён"}</span>
          <span className="om-action-mobile-meta">Роль: {role?.name ?? "не назначена"} · {register?.availability || "доступность не задана"}</span>
          <span className="om-action-mobile-meta">Ритм: {node.schedule.trigger || "без триггера"} · {node.schedule.days.length ? node.schedule.days.map((day) => days[day] ?? String(day)).join(", ") : "дни не заданы"} · {node.schedule.hours || "часы не заданы"}</span>
          <span className="om-action-mobile-meta">Оценка: {minutesLabel(estimate)}{estimate !== null && register?.period ? ` / ${register.period}` : ""} · Выходы: {outputs.length || "не заданы"}</span>
          <span className="om-action-mobile-reporting">
            <b>Отчётная форма</b>
            {!reporting ? <span>Отчётность не уточнена</span> : <>
              <span>{reporting.formName || (reporting.required ? "Форма не названа" : "Форма не указана")} · {reporting.required ? "обязательна" : "не обязательна"}</span>
              {reporting.templateDocumentId ? template
                ? <a href={templateDownloadPath(template.id)} onClick={(event) => event.stopPropagation()}>{template.title} · скачать</a>
                : <span className="om-action-missing">Шаблон отсутствует в документах гипотезы</span>
                : reporting.required && <span className="om-action-missing">Требуется разработать шаблон</span>}
              <span>Версия: {reporting.templateVersion || "не указана"} · Хранение результата: {reporting.storage || "не указано"}</span>
              <span className={`om-action-approval om-report-status is-${reporting.formStatus}`}>{reportingStatusLabels[reporting.formStatus]}</span>
              {reporting.formStatus === "approved" && reporting.approvalEvidence && <span>Основание: {reporting.approvalEvidence}</span>}
            </>}
          </span>
          <span className="om-action-mobile-foot">{node.status === "agreed" ? "Узел согласован" : "Узел — предложение"} · Решение: {register?.approval === "approved" ? "утверждено" : register?.approval === "discussion" ? "к обсуждению" : "черновик"}{isProposal ? " · предложение" : ""}</span>
        </article>;
      })}</div>
    </> : <div className="om-empty"><strong>{actions.length ? "По фильтру действий нет" : "Действий пока нет"}</strong>{actions.length ? "Снимите фильтр или измените поисковый запрос." : "Добавьте узел типа «Действие», чтобы описать обязанности компании."}</div>}
  </section>;
}
