import type { ModelCommand, ProjectModelState } from "../../../shared/projectModel";
import { emptyWorkNode } from "../../../shared/operatingModelTemplate";
import { defaultRegister } from "../../../shared/actionRegister";
import { actionChainGaps } from "../../../shared/actionChainCoverage";
import { emptyReporting } from "../../../shared/actionReporting";
import { applyHypothesisCommand, readHypothesis } from "../hypotheses";
import { reportStorage, formsRoadmapTitle } from "./benchmarkForms";
import { legalChain, legalActionId, legalResultId, legalForms } from "./legalChainSpec";
export const legalRoleId = "legal-documents-specialist";
export const legalProcessId = "legal-documents-process";
export const legalRoadmapTitle = "TalkHint — единый roadmap работы crew над продуктом — v7 — юридическая работа с документами";
const marker = "<!-- LEGAL-DOCUMENT-ACTION-CHAIN-V1 -->";
export function prepareLegalChain(root: ProjectModelState, actor: string): ProjectModelState {
  const model = readHypothesis(root, "new-country"), rev = model.operatingModel?.revisions.at(-1);
  const roadmaps = model.documents.filter(d => [formsRoadmapTitle, legalRoadmapTitle].includes(d.title));
  if (roadmaps.length > 1) throw Error("Ambiguous roadmap; no parallel roadmap creation");
  const roadmap = roadmaps[0];
  if (!rev || !roadmap) throw Error("Existing model and single roadmap required");
  if (roadmap.text.includes(marker)) return root;
  const data = structuredClone(rev.data);
  const get = (id: string) => {
    const n = data.nodes.find(n => n.id === id); if (!n) throw Error(`Missing existing identity: ${id}`); return n;
  };
  const add = (n: ReturnType<typeof emptyWorkNode>) => {
    if (data.nodes.some(x => x.id === n.id || x.code === n.code)) throw Error(`Identity exists: reconcile, do not duplicate ${n.code}`);
    data.nodes.push(n); return n;
  };
  for (const id of ["dir-control", "head-control", "crew-channel-specialist", "company-action-product-reference",
    "company-action-list-review", "company-action-product-control", "company-action-benchmark-control", "company-action-technical-control"])
    get(id);
  const existing = data.nodes.filter(n => n.kind === "role" && /юрид|правов/i.test(`${n.name} ${n.code}`));
  if (existing.length > 1) throw Error("Multiple legal roles; reconcile explicitly");
  let legal = existing[0];
  if (!legal) {
    legal = add(emptyWorkNode(legalRoleId, "P.LEGAL", "Специалист по правовым вопросам и документам", "role", "dir-control"));
    Object.assign(legal, { managerId: "head-control", level: "operation", status: "proposal", detailState: "described",
      description: "Предложение размещения в T10 под HEAD.10. Это описание AI-роли, не лицензированный юрист и не подключённый исполнитель.",
      clientId: "product-manager-specialist", recipientId: "product-manager-specialist", acceptorId: "owner", executorId: null,
      purpose: "Дать продукту и владельцу прослеживаемые требования к документам/процедурам, границы применимости и вопросы для проверки; конечному пользователю — понятные условия и контролируемые согласия.",
      procedure: "Получать сценарии и версии, собирать и сопоставлять документы, официальные основания и факты реализации; готовить пробелы/проекты, организовывать проверку, передавать согласованное и проверять версию внедрения.",
      rules: "Практика конкурента — материал сравнения, не правовое основание. Сложные правовые выводы требует проверить квалифицированный юрист соответствующей юрисдикции.",
      constraints: "Не выдавать юридическое заключение или гарантию соответствия. Нет делегированного права утверждать, тратить, публиковать, покупать, менять Twilio или передавать данные внешнему лицу.",
      success: "Клиент получил источник/дату/версию/применимость, неизвестное и явный результат уполномоченного рассмотрения; приёмка материала не равна юридическому соответствию.",
      questions: "Размещение роли, уполномоченный за пределами владельца, юрисдикции, ресурсы и профессиональная проверка требуют согласования.",
    });
  }
  const process = add(emptyWorkNode(legalProcessId, "LEG.1", "Правовые вопросы, процедуры и документы", "process", "dir-control"));
  Object.assign(process, { level: "operation", status: "proposal", roleId: legal.id, clientId: "product-manager-specialist",
    recipientId: "product-manager-specialist", acceptorId: "owner",
    description: "Поперечная юридическая функция в T10 — предложенное размещение в существующих десяти направлениях, не одиннадцатое направление. Связи с T01, T06 и T07; подчинение и передача работы различаются.",
    purpose: "Связать официальные основания, документы и согласия с конкретными сценариями и версиями TalkHint.",
    questions: "Это структура обязанностей. Документы, правовые выводы, соответствие и фактическое внедрение пока не проверены.",
  });
  const resourceSpecs = [
    ["sources", "Официальные правовые источники по сценариям и территориям", "Нужны применимые официальные источники, даты/версии и область действия. Набор ещё не проверен; практика конкурента не заменяет основание."],
    ["provider", "Официальные требования Twilio к каналам", "Официальная документация/правила и их применимость; номера, SMS/MMS, регистрация, идентификация и согласия. Не предоставляет доступ к настройкам."],
    ["implementation", "Доказательства фактической реализации TalkHint", "Разрешённые актуальные код, схемы, документы, экраны, тесты и сведения о конфигурации без ключей/персональных данных. Не проведённый аудит."],
    ["qualified-review", "Квалифицированная юридическая проверка при необходимости", "При сложных выводах нужен проверенный квалифицированный юрист применимой юрисдикции; исполнитель, доступ и бюджет не выданы. Внешняя передача/оплата требуют отдельного разрешения."],
  ];
  for (const [key, name, description] of resourceSpecs) {
    const n = add(emptyWorkNode(`legal-resource-${key}`, `RES.LEGAL.${key.toUpperCase()}`, name, "resource", legalProcessId));
    Object.assign(n, { description, roleId: legal.id, resourceState: "required", status: "proposal" });
  }
  legal.resourceIds = Array.from(new Set([...legal.resourceIds, "model-resource", ...resourceSpecs.map(([key]) => `legal-resource-${key}`)]));
  const resolve = (key: string) => key.startsWith("@") ? key.slice(1) : legalActionId(key);
  const input = (key: string) => key.startsWith("@") ? key.slice(1) : legalResultId(key);
  const role = (key: string) => key === "legal" ? legal.id : key;
  const links: typeof data.links = [];
  const link = (from: string, to: string, kind: typeof data.links[number]["kind"], reason: string) => {
    get(from); get(to);
    if (!data.links.some(l => l.from === from && l.to === to && l.kind === kind) &&
      !links.some(l => l.from === from && l.to === to && l.kind === kind))
      links.push({ id: `legal-chain:${kind}:${from}:${to}`, from, to, kind, reason });
  };
  for (const s of legalChain) {
    get(role(s.role)); get(s.parent === "legal" ? legalProcessId : s.parent);
    const n = add(emptyWorkNode(legalActionId(s.key), s.code, s.name, "action", s.parent === "legal" ? legalProcessId : s.parent));
    Object.assign(n, { roleId: role(s.role), executorId: null, level: "operation", status: "proposal", detailState: "described",
      procedure: s.work,
      description: "Обязанность описана по поручению владельца; размещение, подробная карточка и полномочия на обсуждении. Работа не выполнялась, правовое соответствие не установлено.",
      purpose: "Передать конкретному клиенту проверяемый версионный результат с источниками, ограничениями и обратной связью.",
      resourceIds: ["model-resource", "legal-resource-sources", "legal-resource-implementation",
        ...(["provider", "implementation"].includes(s.form) ? ["legal-resource-provider"] : []),
        ...(["collect", "compare", "channels-study"].includes(s.key) ? ["search-resource"] : []),
        ...(["submit", "owner-review", "decision-receive"].includes(s.key) ? ["legal-resource-qualified-review"] : [])],
      inputs: s.inputs.map(k => ({ name: `Источник ${input(k)}; условные ветви проверяются отдельно`,
        sourceId: input(k), freshness: "Указать поставщика, дату, версию, территорию/сценарий и ограничения; отсутствие доказательства не заменять предположением" })),
      nextId: resolve(s.next), storage: reportStorage, delivery: "Передать ссылку и версию; получить явное подтверждение либо адресный возврат.",
      success: "Достаточность для указанного получателя подтверждена явно; источники и версии прослеживаются, факт/предложение/неизвестное разделены; согласование и разрешение выполнения доказаны там, где требуются.",
      rules: "Авторизация клиента ≠ согласие на сообщения ≠ регистрация отправителя. Конкурент не является правовым основанием. Неизвестное не означает отсутствие обязанности или нулевой риск.",
      constraints: "Не выполнять внешние действия, изменение телефонии, публикацию или утверждение документов этим описанием. AI не лицензированный юрист; выводы сложной применимости требуют профессиональной проверки.",
      exceptions: "Недостаточность → адресный возврат поставщику; спор/полномочия → владелец; сложный правовой вывод → квалифицированный юрист через разрешённое рассмотрение. Молчание не приёмка.",
      questions: "Бланк: требуется разработать. Сроки, периодичность, территории, назначение исполнителя и права доступа не согласованы.",
      register: { ...defaultRegister(), approval: "discussion", availability: "Проектируемая обязанность; исполнитель не подключён",
        source: "Поручение владельца: юридическое направление по документам; это не утверждение соответствия",
        estimateBasis: "Объём и длительность неизвестны; расчёт не выполнялся" },
      reporting: { ...emptyReporting(), formName: legalForms[s.form], storage: reportStorage },
    });
    n.schedule.trigger = s.key === "versions" ? "При изменении официальных правил, сценариев, документов или реализации; регулярность согласуется" : "При получении достаточного входа либо возврата; альтернативные ветви только по применимости";
    const out = add(emptyWorkNode(legalResultId(s.key), `${s.code}.R`, s.output, "result", n.id));
    Object.assign(out, { roleId: n.roleId, status: "proposal", storage: reportStorage,
      description: "Требуемый будущий результат, не полученный отчёт, утверждение или доказательство соответствия.", success: n.success });
  }
  const handoff = (source: string, target: string, reason: string) => {
    link(source, target, "handoff", reason);
    const receiver = get(target), producer = get(source);
    link(source, receiver.roleId ?? receiver.id, "acceptance", "Явная достаточность/получение не означает утверждение документов или соответствия");
    if (receiver.kind === "action" && producer.parentId) link(receiver.id, producer.parentId, "return", "Адресный возврат поставщику с причиной и сохранением версии");
  };
  const controller = (roleId: string) => roleId === legal.id ? "head-control"
    : get(roleId).id.startsWith("head-") || roleId === "ai-ceo" ? "owner" : get(roleId).managerId ?? "owner";
  for (const s of legalChain) {
    const n = get(legalActionId(s.key)), out = get(legalResultId(s.key)), receiver = get(n.nextId!);
    n.clientId = receiver.roleId ?? receiver.id; n.recipientId = receiver.id; n.acceptorId = receiver.roleId ?? receiver.id;
    out.recipientId = receiver.id; out.acceptorId = n.acceptorId;
    link(n.id, out.id, "produces", "Будущий проверяемый результат, без утверждения о выполнении");
    link(n.id, controller(n.roleId!), "accountable_to", "Ответственность конечна: контролёр, затем владелец");
    for (const i of n.inputs) link(n.id, i.sourceId!, "requires", "Версионный вход; условные/альтернативные ветви не означают ожидание всех результатов");
    handoff(out.id, receiver.id, "Связанный следующий шаг; при неприменимости ветви записать основание");
    const control = s.role === "legal" ? legalActionId("legal-control")
      : s.role === "product-manager-specialist" ? "company-action-product-control"
      : s.role === "benchmark-role-reference" ? "company-action-benchmark-control"
      : ["crew-channel-specialist", "crew-product-developer", "lg-technical-role", "lg-qa-role"].includes(s.role) ? "company-action-technical-control" : "owner";
    link(out.id, control, "acceptance", "Контроль конкретной передачи и версии; не юридическое утверждение");
    if (get(control).kind === "action") link(control, n.id, "return", "Контролёр возвращает адресные замечания автору без бесконечной цепочки проверок");
  }
  handoff("company-action-product-reference-result", legalActionId("context-receive"), "Дополнительный получатель существующего PRD.1.9; исходная передача бенчмаркингу сохранена");
  handoff(legalResultId("decision-receive"), legalActionId("channels-requirements-send"), "Отдельная ветвь каналов только по применимости и разрешению");
  handoff(legalResultId("compare"), legalActionId("facts-request"), "Если недостаёт фактов — запрос техническому специалисту");
  handoff(legalResultId("postcheck"), legalActionId("product-requirements-receive"), "При расхождении — принимающее действие продукта и повторное версионное рассмотрение");
  handoff(legalResultId("postcheck"), legalActionId("channels-implementation-intake"), "При расхождении каналов — адресное уточнение без автоматического разрешения перенастройки");
  handoff(legalResultId("versions"), legalActionId("context-request"), "Условный повторный разбор при существенном изменении, не включение расписания");
  link(legalResultId("owner-review"), "owner", "acceptance", "Утверждение только явным решением Сергея/доказанно уполномоченного; необходимая квалифицированная проверка не заменяется AI");
  link("owner", legalActionId("owner-review"), "return", "Отказ/уточнение сохраняются; молчание не решение");
  handoff(legalResultId("benchmark-intake"), "company-action-list-review", "При отсутствии утверждённого списка — существующее рассмотрение MKT.2.9, не повторная роль");
  for (const l of links) {
    const target = get(l.to);
    if (["handoff", "acceptance"].includes(l.kind) && target.kind === "action" &&
      !target.inputs.some(i => i.sourceId === l.from)) {
      target.inputs.push({ name: `Условная передача ${get(l.from).code}`, sourceId: l.from,
        freshness: "Источник и версия обязательны; отдельная передача или контроль, не обязательное ожидание всех ветвей" });
      link(target.id, l.from, "requires", "Явный вход принимающего/контролирующего действия");
    }
  }
  data.links.push(...links);
  for (const id of ["company-action-product-control", "company-action-benchmark-control", "company-action-technical-control"]) {
    get(id).procedure += "\nТакже контролировать относящиеся к роли передачи юридической цепочки: источник, версию, разрешения и получателя. Контроль процесса/технических доказательств не является правовым заключением; входы альтернативные, по конкретной работе.";
  }
  get("company-action-product-reference").procedure += "\nДля запроса юридического направления добавить территории, каналы, роли участников, сценарии, фактическое против запланированного и версию; передать также LEG.1.2. Это тот же паспорт продукта.";
  get(legalActionId("legal-control")).procedure += "\nИные входы контроля рассматриваются по конкретной передаче; переход к LEG.1.10 относится только к итоговому пакету проектов, не к каждой служебной проверке.";
  const ids = new Set(legalChain.map(s => legalActionId(s.key)));
  const gaps = actionChainGaps(data, ids);
  if (gaps.length) throw Error(`Legal action contracts incomplete: ${JSON.stringify(gaps)}`);
  get("crew-product-roadmap").questions += "\nДобавлена предложенная юридическая ветвь LEG.1. Следующий её шаг — запрос сценарного паспорта; размещение в T10, роль и полномочия ещё обсуждаются. Предыдущий пункт бенчмаркинга сохранён.";
  data.stageReports.push({ pass: 2, described: `Описана юридическая цепочка: ${ids.size} действий и приёмка межотдельных передач.`,
    boundary: "Только описание обязанностей и будущих результатов; четыре бланка требуют разработки.",
    dependencies: "PRD.1.9, MKT.2.9, факты реализации, P.CHANNELS, решение владельца и при необходимости квалифицированная правовая проверка.",
    gaps: "Не определены все территории, официальные основания, реальные документы, исполнители, доступы, сроки и необходимый квалифицированный проверяющий.",
    next: "Обсудить предложенное размещение роли и получить актуальный сценарный паспорт; бенчмаркинг не объявлен завершённым." });
  const table = legalChain.map(s => {
    const n = get(legalActionId(s.key));
    return `| ${n.code} ${n.name} | ${get(n.roleId!).code} | ${get(legalResultId(s.key)).name} | ${get(n.nextId!).code} |`;
  }).join("\n");
  const appendix = `\n\n${marker}
## Юридическое направление по документам (v7)
Сопоставление с десятью направлениями: отдельной юридической роли в исходной модели ${existing.length ? "обнаружена и переиспользована" : "не было"}. Предложено размещение внутри T10 «Контроль и совершенствование компании» под HEAD.10, не новый одиннадцатый отдел. ${legal.code} «${legal.name}» — проектируемая роль, не лицензированный юрист. Это предложение размещения, не утверждённая реорганизация.
Связи: T01 — список/документы конкурентов; T06 — реальные сценарии, продуктовый смысл и передача требований; T07 — Twilio, реализация и QA; T10 — правовые вопросы/процедуры, происхождение и версии. Подчинение остаётся одним, получение результата не второе подчинение.
**Область:** правила, процедуры и документы TalkHint и выбранных конкурентов. Это описание работы; исследование документов, юридическая проверка и внедрение в этом поручении не выполнялись.
| Действие | Ответственная должность | Требуемый результат | Следующий получатель/действие |
|---|---|---|---|
${table}
У каждой новой строки есть источники/поставщики, ресурсы, проектируемый исполнитель, результат, получатель, контролёр, приёмка и адресный возврат; записи доступны в том же реестре. Контролируют HEAD.10, существующие действия контроля продукта/бенчмаркинга/техники; верхняя граница — владелец. Альтернативные входы и контроль не являются запуском workflow или требованием ждать все ветви.
Список конкурентов идёт с версией/решением от ответственного за список через менеджера продукта к юридической роли. Если утверждённого списка нет, это блокер, а не автоматическое утверждение.
Авторизация клиента, согласие на сообщения и регистрация отправителя — самостоятельные требования. Сценарии/территории и применимость подтверждаются отдельно. Практика конкурента не правовое основание. Правила Twilio не заменяют правовой анализ.
Утверждение требует явного решения владельца или доказанно уполномоченного. AI CEO здесь только предложенный координатор рассмотрения, не делегированный утверждающий. Сложная применимость — квалифицированному юристу соответствующей юрисдикции; если его нет, это конкретный блокер. Платная проверка и внешняя передача требуют отдельного разрешения.
Реализация документов/согласий и настройки каналов — будущие действия после отдельных разрешений; подтверждения получают юридическая роль, продукт и владелец через общую историю. Проверяется версия, а не провозглашается полное юридическое соответствие.
### Бланки
${Object.values(legalForms).map(name => `- **${name}** — требуется разработать; ссылки на несуществующий шаблон нет, согласование не выполнено.`).join("\n")}
Заполненные результаты: ${reportStorage} Ни одной формы или правового документа сейчас не разработано и не утверждено.
### Готовность / пробелы / следующий шаг
Сохранено описание ${ids.size} действий, предложенная роль и межотдельные связи; прежние роли, ID, исследования и документы сохранены. Юридические обязанности не назначают работающего AI-исполнителя. Объёмы, время и периодичность неизвестны; расписание не включено.
Для содержательной работы нужны сценарии/территории и версия описания TalkHint, реально утверждённый список, актуальные официальные источники и доказательства реализации, решение уполномоченного и доступ к квалифицированной проверке при необходимости. Доказательств завершения этих работ пока нет.
Ближайший юридический шаг — LEG.1.1 → PRD.LEG.1 → существующий PRD.1.9 → LEG.1.2. Предыдущий совместный разбор бланка поиска конкурентов не отменён; единый roadmap не объявлен завершённым.
`;
  const text = roadmap.text + appendix;
  if (text.length > 50000) throw Error("Roadmap capacity exceeded; preserve history, do not truncate");
  let next = root;
  for (const command of [
    { type: "saveDocument", id: roadmap.id, title: legalRoadmapTitle, text, url: roadmap.url, elementIds: roadmap.elementIds },
    { type: "saveOperatingModel", baseVersion: rev.version, data },
  ] as ModelCommand[]) next = applyHypothesisCommand(next, "new-country", command, actor);
  return next;
}
