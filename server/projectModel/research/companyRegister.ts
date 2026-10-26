import type { ProjectModelState, ModelCommand } from "../../../shared/projectModel";
import type { OperatingData, WorkNode } from "../../../shared/operatingModel";
import { emptyWorkNode } from "../../../shared/operatingModelTemplate";
import { defaultRegister, actionDirection, actionOutputs } from "../../../shared/actionRegister";
import { actionChainGaps } from "../../../shared/actionChainCoverage";
import { emptyReporting } from "../../../shared/actionReporting";
import { applyHypothesisCommand, readHypothesis } from "../hypotheses";
import { legalRoadmapTitle } from "./legalChain";
import { reportStorage } from "./benchmarkForms";
import { companyActions, companyDirections, proposedPositions, registerSource, reportingPeriods, type CompanyActionSpec } from "./companyRegisterSpec";

export const companyRegisterTitle = "TalkHint — единый roadmap работы crew над продуктом — v8 — связанный реестр и управленческий обзор";
export const companyRegisterMarker = "<!-- COMPANY-ACTION-REGISTER-V8 -->";
export const managementActionId = (key: string) => `management-action-${key}`;
export const managementResultId = (key: string) => `management-result-${key}`;
const commonRules = "План результата → план действий → выполненные действия → факт результата → отклонение → подтверждённая причина либо гипотеза → мера, ответственный, срок и контроль эффекта. Критерий результата задаётся до выполнения. Продажа ≠ оплата ≠ подключение ≠ первый успешный сценарий ≠ удержанный платящий клиент. Источник/версия/период обязательны; неизвестное не равно нулю. Молчание не приёмка.";
const commonDimensions = "Разрезы: направление, B2C/B2B, регион, языковой сегмент, канал, ответственный и связанные ID действий. Неприменимые разрезы явно помечаются, недоступные — нет данных. База, единицы, валюта, период и знаменатели сопоставимы.";
const guardrails = "Это описание работы, не запуск AI, API, рекламы, рассылки, звонков, изменения телефонии/бюджета или публикации. Полномочия/назначения обсуждаются; внешние действия, расходы, выпуск и стратегия остаются Сергею до явного делегирования.";
export const matrixKey = (direction: string, period: string) => `report-${direction}-${period}`;
const reused: Record<string, string> = {
  "report-market-week": "company-action-weekly-prepare",
  "report-market-month": "company-action-monthly-prepare",
  "company-month-intake": "company-action-monthly-receive",
  "company-month-aggregate": "company-action-common-aggregate",
  "company-month-review": "company-action-common-accept",
};
export function companyReportActions(data: OperatingData) {
  return companyDirections.flatMap(([key]) => reportingPeriods.map(([period]) =>
    data.nodes.find(n => n.id === (reused[matrixKey(key, period)] ?? managementActionId(matrixKey(key, period))))!));
}
export function prepareCompanyRegister(root: ProjectModelState, actor: string): ProjectModelState {
  const model = readHypothesis(root, "new-country"), rev = model.operatingModel?.revisions.at(-1);
  const roadmaps = model.documents.filter(d => [legalRoadmapTitle, companyRegisterTitle].includes(d.title));
  if (!rev || roadmaps.length !== 1) throw Error("One current roadmap and existing operating model required");
  const roadmap = roadmaps[0];
  if (roadmap.text.includes(companyRegisterMarker)) return root;
  const data = structuredClone(rev.data), scoped = new Set<string>();
  const get = (id: string): WorkNode => {
    const n = data.nodes.find(n => n.id === id); if (!n) throw Error(`Missing existing identity: ${id}`); return n;
  };
  const add = (n: WorkNode) => {
    if (data.nodes.some(x => x.id === n.id || x.code === n.code)) throw Error(`Reconcile existing identity before adding ${n.code}`);
    data.nodes.push(n); return n;
  };
  const actionId = (key: string) => key.startsWith("@") ? key.slice(1) : reused[key] ?? managementActionId(key);
  const resultId = (key: string) => {
    if (key.startsWith("@")) return key.slice(1);
    if (reused[key]) {
      const outputs = actionOutputs(data, reused[key]);
      if (outputs.length !== 1) throw Error(`Reused action needs exactly one canonical result: ${key}`);
      return outputs[0].id;
    }
    return managementResultId(key);
  };
  const roles = new Map<string, string>();
  for (const [key, code, name, direction, manager] of proposedPositions) {
    const matches = data.nodes.filter(n => n.kind === "role" && (n.code === code || n.name === name));
    if (matches.length > 1) throw Error(`Ambiguous existing position ${code}`);
    const role = matches[0] ?? add(emptyWorkNode(`management-role-${key}`, code, name, "role", `dir-${direction}`));
    if (!matches.length) Object.assign(role, { managerId: manager, level: "operation", detailState: "outlined",
      description: "Предложение Replit: специализированная должность выведена из добавленных действий; не утверждённое назначение и не работающий AI.",
      purpose: "Обслуживать клиентов результатов действий, закреплённых по roleId; перечень обязанностей формируется фильтром реестра.",
      resourceIds: ["model-resource"], constraints: guardrails,
      questions: "Уточнить паспорт, навыки, полномочия, приёмку и доступы после обсуждения действий. Регион/язык — область назначения будущего исполнителя, не отдельный дублирующий каталог." });
    roles.set(key, role.id);
  }
  const resource = add(emptyWorkNode("management-resource-tools", "RES.MGMT.TOOLS", "Средства анализа рынка, веб-технологий и интерфейсов — выбор требуется", "resource", "crew-equipment"));
  Object.assign(resource, { roleId: "head-team", resourceState: "required", description: "Задачи выбора инструмента, стоимости, источников и доступа. Конкретные API не выбраны, не проверены и не подключены.", constraints: guardrails });
  const link = (from: string, to: string, kind: OperatingData["links"][number]["kind"], reason: string) => {
    get(from); get(to);
    if (!data.links.some(l => l.from === from && l.to === to && l.kind === kind))
      data.links.push({ id: `management:${kind}:${from}:${to}`, from, to, kind, reason });
  };
  const create = (s: CompanyActionSpec) => {
    const existing = reused[s.key] ? get(reused[s.key]) : undefined;
    const n = existing ?? add(emptyWorkNode(actionId(s.key), s.code, s.name, "action", s.parent));
    scoped.add(n.id);
    if (!existing) Object.assign(n, {
      level: s.parent === "company-strategy" ? "strategy" :
        ["marketing-plan", "sales-plan", "sales-approval", "sales-distribute", "economics"].includes(s.key) ? "direction" : "operation",
      detailState: "described", roleId: roles.get(s.role) ?? s.role, executorId: null, status: "proposal",
      description: "Перечень требований передан владельцем; подробная карточка/распределение ролей — к обсуждению. Результат работы ещё не получен.",
      purpose: "Дать следующему клиенту прослеживаемый полезный результат с доказательствами, приёмкой и возможностью возврата.",
      resourceIds: ["model-resource"], register: { ...defaultRegister(), approval: "discussion",
        availability: "Часы, часовой пояс и доступность на согласовании; периодичность не означает 24/7 или загрузку",
        period: "на одну работу", source: registerSource,
        estimateBasis: "Объём/минуты неизвестны. Часы = операции × минуты / 60. Аналогия с массажистами не содержание TalkHint.",
        proposalReason: s.proposed ? "Предложение Replit по недостающей связи/контролю; не утверждённое полномочие." : "" },
      storage: reportStorage, rules: commonRules, constraints: guardrails,
      success: "Получатель явно подтвердил достаточность версии результата по заранее заданному критерию либо вернул конкретные замечания. Источники и ограничения прослеживаются. Выполнение действия не заменяет результат.",
      exceptions: "Недостаточный вход — возврат поставщику; неизвестная причина — гипотеза; спор/недостаток полномочий — Сергей. Контроль замыкается владельцем без бесконечной цепочки контролёров.",
      questions: "Форма: требуется разработать отдельно ChatGPT + Сергей; утверждение — Сергей. Оценки объёма/времени, детальные сроки и полномочия на обсуждении.",
      delivery: "Передать версию/ID, подтвердить получение и приёмку либо возврат; автоматическая доставка/исполнение не включены.",
      reporting: { ...emptyReporting(), formName: `Отчёт: ${s.name}`, storage: reportStorage },
    });
    n.procedure += `${n.procedure ? "\n" : ""}${s.work}`;
    if (s.trigger) n.schedule.trigger = s.trigger;
    else if (!n.schedule.trigger) n.schedule.trigger = "По получению относящегося входа или возврата; конкретный срок согласовать";
    if (s.key === "tools") n.resourceIds.push(resource.id);
    for (const key of s.inputs) {
      const source = resultId(key);
      if (!n.inputs.some(i => i.sourceId === source)) n.inputs.push({ name: `Источник ${source}; вход по применимости`,
        sourceId: source, freshness: "Дата, версия, период, поставщик, ограничения; входы альтернативны по конкретной работе, не ждать все события компании" });
    }
    const out = existing ? get(resultId(s.key)) : add(emptyWorkNode(resultId(s.key), `${s.code}.R`, s.output, "result", n.id));
    if (!existing) Object.assign(out, { roleId: n.roleId, storage: reportStorage,
      description: "Будущий требуемый результат, не заполненный отчёт и не доказанная готовность.", status: "proposal" });
    link(n.id, out.id, "produces", "Требуемый результат; фактических данных/исполнения не создаём");
    return n;
  };
  for (const s of companyActions) create(s);
  // Explicit control is an action, with an upper boundary at the owner.
  const controlSpecs: CompanyActionSpec[] = companyDirections.map(([key, code, parent, head]) => ({
    key: `control-${key}`, code: `${code}.REG.CONTROL`, name: `Проверить результаты и передачи ${code}`,
    parent, role: head, next: "@owner", inputs: [], proposed: true,
    work: "Проверить источники, план-факт, получателей, явную приёмку/возврат, разрывы и эффект мер. Проверка руководителя — отдельное действие, верхняя граница Сергей. Не объявлять рассмотрение выполненным без доказательства.",
    output: `Контроль результатов ${code}, возвраты и эскалации`,
  }));
  controlSpecs.forEach(create);
  const sourcesByDirection = new Map(companyDirections.map(([key]) => [key,
    data.nodes.filter(n => n.kind === "action" && !n.id.includes("control-") &&
      actionDirection(data, n)?.id === `dir-${key}`).map(n => n.id)]));
  const reportSpecs: CompanyActionSpec[] = [];
  for (const [direction, code, parent, head, content] of companyDirections) {
    for (const [period, label, unit] of reportingPeriods) {
      const key = matrixKey(direction, period);
      const work = `Требование к содержанию, не готовый бланк. ${content}\n${commonRules}\n${commonDimensions}\n` +
        `${label}: ${period === "day" ? "оперативный обзор состояния и исключений" : period === "week" ? "разбор плана-факта, прогноз и меры" : period === "month" ? "сверенный итог и экономика" : "пересмотр бизнес-плана и предложения изменений, не автоматическое стратегическое решение"}.\n` +
        "Источники: связанные действия/результаты, документы и проверенные события; если источника нет — явно нет данных. Средства: существующий реестр/документы, аналитические подключения не подтверждены. Разработка бланка — отдельная будущая работа ChatGPT + Сергей, утверждение — Сергей; бланк сейчас не разрабатывать.";
      const s: CompanyActionSpec = { key, code: `${code}.REPORT.${period.toUpperCase()}`,
        name: `${label}: управленческий разбор ${code}`, parent, role: head,
        next: `company-${period}-intake`, inputs: (sourcesByDirection.get(direction) ?? []).map(id => `@${actionOutputs(data, id)[0]?.id ?? id}`),
        work, output: `${label} — содержание отчёта ${code} и пробелы`, trigger: `${label}; точные границы периода/часы/часовой пояс согласовать` };
      reportSpecs.push(s);
      const n = create(s);
      n.register ??= defaultRegister();
      n.register.period = unit;
      n.register.source += `\n${registerSource}`;
      // Existing forms and existing report identities are preserved; no blanket approval.
      if (!n.reporting) n.reporting = { ...emptyReporting(), formName: n.name, storage: reportStorage };
      n.questions += "\nТребование к отчётности сохранено; разработка формы не выполнялась. Нужны реальные источники, формулы и согласование Сергея.";
    }
  }
  const corporateSpecs: CompanyActionSpec[] = reportingPeriods.flatMap(([period, label]) => [
    { key: `company-${period}-intake`, code: `CTL.REPORT.${period.toUpperCase()}.1`, name: `${label}: принять отчёты десяти направлений`,
      parent: "goal-review", role: "product-work-coordinator", next: `company-${period}-aggregate`,
      inputs: companyDirections.map(([key]) => matrixKey(key, period)), proposed: true,
      work: "Подтвердить получение версий, проверить достаточность/дубли и вернуть конкретному поставщику. Для существующих недельного/месячного отчётов бенчмаркинга принимать проверенную переданную версию через MKT.2.14/MKT.2.17, не обходить прежнюю проверку. Неполный набор не выдавать за полный; оперативный обзор допускает явные пробелы. Координатор-составитель пока предложен.",
      output: "Реестр принятых входов и недостающих разделов" },
    { key: `company-${period}-aggregate`, code: `CTL.REPORT.${period.toUpperCase()}.2`, name: `${label}: свести единый управленческий обзор компании`,
      parent: "strategy-review", role: "product-work-coordinator", next: `company-${period}-review`,
      inputs: [`company-${period}-intake`, "@company-action-finance-method-result"], proposed: true,
      work: `${commonRules}\n${commonDimensions}\nСоставить единый обзор со ссылками на детали отделов. Уникальные финансовые события и единая методика — без двойного счёта. Не суммировать несовместимые валюты/периоды/показатели. Ежедневный оперативный факт не подменяет месячную прибыль. Готовность: содержание описано, форма/источники/исполнение не готовы.`,
      output: "Единый обзор компании для рассмотрения либо обозначенные пробелы" },
    { key: `company-${period}-review`, code: `CTL.REPORT.${period.toUpperCase()}.3`, name: `${label}: рассмотреть обзор и вернуть решение владельцу`,
      parent: "strategy-review", role: "ai-ceo", next: "@owner",
      inputs: [`company-${period}-aggregate`, "@owner"], proposed: true,
      work: `Проверить достаточность, причины против гипотез, назначение мер, срок и критерий эффекта. Приёмка AI CEO только предложение; конечное явное решение Сергея. ${period === "quarter" ? "Предложения квартального пересмотра бизнес-плана, не автономная смена стратегии." : "Существенные изменения бюджета/прав/продукта требуют отдельного решения."} Вернуть замечания составителю, не считать молчание утверждением.`,
      output: "Решение/возврат/ожидание по обзору компании" },
  ]);
  corporateSpecs.forEach(create);
  const allSpecs = [...companyActions, ...controlSpecs, ...reportSpecs, ...corporateSpecs];
  const handoff = (from: string, to: string) => {
    const out = get(from), receiver = get(to);
    link(from, to, "handoff", "Условная передача по конкретному событию/периоду, не блокирующая зависимость всех входов");
    link(from, to, "acceptance", "Явное получение/достаточность; молчание не приёмка, полномочия не делегированы");
    if (receiver.kind === "action") {
      if (!receiver.inputs.some(i => i.sourceId === from)) receiver.inputs.push({ name: `Передача ${out.code}`, sourceId: from,
        freshness: "Источник, поставщик, дата, версия и период; альтернативный/условный вход" });
      if (out.parentId) link(to, out.parentId, "return", "Вернуть конкретные замечания автору с версией и причиной");
    } else if (out.parentId) link(to, out.parentId, "return", "Владелец возвращает замечания либо явно принимает");
  };
  for (const s of allSpecs) {
    const n = get(actionId(s.key)), out = get(resultId(s.key)), receiver = get(actionId(s.next));
    get(n.roleId!);
    // Keep the existing benchmark review/send path as its primary next step.
    // Its new corporate report handoff is additional, not a bypass of old controls.
    if (!reused[s.key] || !s.key.startsWith("report-market-")) {
      n.nextId = receiver.id; n.clientId = receiver.roleId ?? receiver.id;
      n.recipientId = receiver.id; n.acceptorId = receiver.roleId ?? receiver.id;
      Object.assign(out, { clientId: n.clientId, recipientId: receiver.id, acceptorId: n.acceptorId, nextId: receiver.id });
    }
    handoff(out.id, receiver.id);
    const direction = actionDirection(data, n);
    const controller = direction?.roleId ?? "owner";
    link(n.id, controller, "accountable_to", "Контролирующий по направлению; руководство замыкается владельцем");
    const control = controlSpecs.find(c => c.role === direction?.roleId);
    if (control && control.key !== s.key) handoff(out.id, actionId(control.key));
    for (const input of n.inputs) link(n.id, input.sourceId!, "requires", "Версионный вход с поставщиком; по применимости");
  }
  // Side handoffs have explicit receiving actions, rather than an unlabeled arrow to a department.
  for (const [from, to] of [
    ["marketing-fact", "finance-events"], ["offer", "finance-events"], ["service-events", "finance-events"],
    ["renewals", "finance-events"], ["operations", "finance-events"],
    ["service-issue", "operations"], ["cohorts", "@company-action-product"],
    ["architecture", "frontend"], ["architecture", "mobile"], ["effect-control", "measures"],
  ]) handoff(resultId(from), actionId(to));
  handoff(resultId("effect-control"), actionId("company-day-intake"));
  handoff(resultId("company-day-review"), actionId("measures"));
  handoff(resultId("company-week-review"), actionId("measures"));
  handoff(resultId("company-month-review"), actionId("measures"));
  handoff(resultId("company-quarter-review"), actionId("goals"));
  handoff("company-action-weekly-send-result", actionId("company-week-intake"));
  handoff("company-action-monthly-send-result", actionId("company-month-intake"));
  // Explicit legal/provider visibility, without duplicating LEG.1 or a Twilio catalogue.
  for (const key of ["legal-control", "versions", "channels-study", "postcheck"]) {
    const id = `legal-result-${key}`;
    const canonical = data.nodes.find(n => n.id === id) ?? data.nodes.find(n => n.id === `legal-action-${key}-result`);
    if (!canonical) throw Error(`Existing legal result missing: ${key}`);
    for (const period of reportingPeriods) handoff(canonical.id, actionId(matrixKey(key === "channels-study" ? "engineering" : "control", period[0])));
  }
  const method = get("company-action-finance-method");
  method.procedure += "\n" + commonRules + "\n" + commonDimensions +
    "\nОбщая методика для 4 периодов: выручка, расходы, EBITDA, чистая прибыль, денежный поток раздельно; уникальные события и распределение без двойного счёта. Источники/формулы и версии ещё согласуются.";
  for (const period of reportingPeriods) handoff("company-action-finance-method-result", actionId(`company-${period[0]}-aggregate`));
  get("company-action-scan").procedure += "\nПланировать проверки конкурентов: вопрос, список/объём, период, исполнитель, критерий достаточности и источник; сверять план с фактом проверок/находок, а не с выдуманным ростом. Конкретные сроки/объёмы обсуждаются.";
  const gaps = actionChainGaps(data, scoped);
  if (gaps.length) throw Error(`Incomplete management contracts: ${JSON.stringify(gaps)}`);
  const currentReports = companyReportActions(data);
  if (currentReports.length !== 40 || currentReports.some(n => !n)) throw Error("10 × 4 report requirements must map to real actions");
  const readiness = companyDirections.map(([key, code]) => {
    const actions = data.nodes.filter(n => n.kind === "action" && actionDirection(data, n)?.id === `dir-${key}`);
    const pending = actionChainGaps(data, new Set(actions.map(n => n.id))).length;
    return `| ${code} | ${actions.length} | ${pending} |`;
  }).join("\n");
  const remainingGaps = actionChainGaps(data);
  const gapDetails = Array.from(new Set(remainingGaps.map(g => g.id))).map(id =>
    `${get(id).code}: ${remainingGaps.filter(g => g.id === id).map(g => g.message).join("; ")}`).join("\n");
  // Record proposals, not retroactive acceptance or invented historic handoffs.
  get(actionId("duties")).register!.proposalReason =
    "Предложение Replit: закрыть старые разрывы после обсуждения — определить B2B.1 (роль/вход/ресурс/выход/клиент/приёмка), приёмку/возвраты B2C.1.1–4 и контролирующие действия LG/RM. Не выдавать за согласованное или исполненное.";
  get(actionId("duties")).questions += "\nОбнаруженные формальные пробелы существующих записей, для обсуждения:\n" + gapDetails;
  const appendix = `\n\n${companyRegisterMarker}
## v8. Связанный реестр всей компании — для обсуждения
Источник: ${registerSource}
Существующие ID, история, десять направлений, старые документы и гипотезы сохранены. Это расширение одной модели, не параллельная организация. Ранее сохранённые материалы/бланки не отменены.
### Что хотим видеть
${commonRules}
${commonDimensions}
10 направлений × 4 периода = 40 требований: ежедневно оперативный обзор; еженедельно план-факт/прогноз/меры; ежемесячно итог/экономика; ежеквартально пересмотр бизнес-плана. Описание каждого требования — в соответствующей карточке действия, не второй таблице данных. MKT.2.13 и MKT.2.15, месячный приём/сведение/рассмотрение переиспользованы.
Составитель общего обзора — предложенный существующий координатор; финансовая методика — существующий HEAD.08; AI CEO-принимающий остаётся предложением, конечные решения Сергею. Автоматического отчёта/сбора/расписания нет.
### Покрытие направлений
| Направление | Действий в реестре | Формальных замечаний |
|---|---:|---:|
${readiness}
Ноль формальных замечаний не означает содержательную полноту или готовность исполнителя. Старые пробелы не скрыты. Обязанности — фильтр по должности; часы = объём × минуты / 60, неизвестные оценки пусты. Продажи, оплата, активация, первый успех и удержание не взаимозаменяемы.
Открыты ${remainingGaps.length} прежних формальных замечаний: B2C.1.1–4 (вход/контроль/приёмка/возврат), B2B.1 (карточка и связи), LG.1–9 и RM (контроль, последний переход). Предложения и поимённый список — ORG.REG.1; ничего не утверждено задним числом.
### Согласованное и предложения
Требования содержания/периодичности переданы владельцем; карточки, специализированные должности, контролёры и конкретные полномочия — на обсуждении. Новые предложения Replit отмечены в паспортах ролей/реестре; причина — покрыть специализированную работу и замкнуть передачи. Принимающие действия продукта/поддержки/техники, QA и контроль эффекта связаны.
### Бланки, средства и граница готовности
Новые формы НЕ разработаны. Разработка ChatGPT + Сергей отдельными будущими работами, утверждение Сергей. Средства анализа рынка/веб-технологий/интерфейсов — задача выбора, доступ не подтверждён; API не подключены.
Рынок/доли только по сопоставимым источникам; EBITDA/чистая прибыль/деньги отдельно. Аналогия массажа и числа 3 млн/100 не факты TalkHint.
### Следующий шаг
Продолжаем существующий совместный разбор бенчмаркинга: согласовать действие «Поиск конкурентов» и достаточность результата, затем утверждение списка. Обзор расширенной структуры не означает согласование всех новых карточек. Для управленческого обзора позже согласовать определения результатов, источники/финансовую методику, роли приёмки, границы периодов и формы по одной.
Сначала описание структуры и связей; подключение исполнителей — отдельный будущий этап. Блокеры: не получены строки Excel, оценки нагрузки, реальные источники ежедневных данных, согласованные паспорта/формы/сроки. AI, бюджет, телефония и публикация не запускались.
`;
  const text = roadmap.text + appendix;
  if (text.length > 50000) throw Error(`Roadmap capacity ${text.length}; do not truncate history`);
  get("crew-product-roadmap").questions += "\n" + companyRegisterMarker +
    "\nПереданные требования расширены на все направления/4 периода. Сначала завершение описания и согласование одной карточки бенчмаркинга; запуск сотрудников не следующий шаг. Неполученный Excel и несогласованные карточки явно открыты.";
  data.stageReports.push({ pass: 2, described: `${companyActions.length} новых предметных действий, 40 требований к отчётности и принимающие/контролирующие действия в одной модели.`,
    boundary: "Текстовое поручение, не импорт/сверка 65 строк Excel. Требования к содержанию, не готовые бланки/отчёты.",
    dependencies: "Цели/критерии до выполнения, данные и финансовая методика, фактическая реализация продукта, источники, явные решения Сергея.",
    gaps: `Неполученный Excel; согласование подробных карточек/ролей, сроки/периоды/источники/формы, оценки нагрузки; прежние формальные замечания (${remainingGaps.length}):\n${gapDetails}`,
    next: "Продолжить существующий разбор поиска конкурентов и приёмки результата; следующие карточки по одной, запуск исполнителей отдельно." });
  let next = root;
  for (const command of [
    { type: "saveDocument", id: roadmap.id, title: companyRegisterTitle, text, url: roadmap.url, elementIds: roadmap.elementIds },
    { type: "saveOperatingModel", baseVersion: rev.version, data },
  ] as ModelCommand[]) next = applyHypothesisCommand(next, "new-country", command, actor);
  return next;
}
