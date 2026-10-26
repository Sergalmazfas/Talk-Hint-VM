import type { ModelCommand, ProjectModelState } from "../../../shared/projectModel";
import type { WorkNode } from "../../../shared/operatingModel";
import { emptyWorkNode } from "../../../shared/operatingModelTemplate";
import { defaultRegister } from "../../../shared/actionRegister";
import { actionChainGaps } from "../../../shared/actionChainCoverage";
import { applyHypothesisCommand, readHypothesis } from "../hypotheses";
import { passportRoadmapTitle, productPassportId } from "./productPassport";

export const ownershipDocumentId = "DOC-BENCHMARK-OWNERSHIP-HANDOFF";
export const ownershipMarker = "<!-- BENCHMARK-OWNERSHIP-V1 -->";
export const ownershipRoadmapTitle = "TalkHint — единый roadmap работы crew над продуктом — v11 — продуктовые паспорта и сообщения аналитика";
const pm = "product-manager-specialist", analyst = "benchmark-role-reference";
const source = "Новое поручение Сергея: паспорта конкурентов ведёт продуктовый менеджер; аналитик сообщает проверенные изменения. Последнее распределение заменяет прежнюю единоличную ответственность аналитика.";
const boundary = "Описание обязанностей, не запуск AI и не утверждение бланков. Расходы, выпуск и внешние действия не делегированы. Инструменты ChatGPT не являются ресурсами worker.";
const acceptance = "Указаны версия, источник, дата проверки, степень подтверждения, конкретный получатель и вопрос. Получатель явно принимает достаточность либо возвращает точный пробел/источник/следующий шаг. Молчание не приёмка; сроки отдельно согласуются.";
const history = "Один паспорт на продукт: что было/стало, источник, автор изменения, дата обнаружения/проверки и принявший либо «не принят». Первое обнаружение не дата выпуска; неизвестную дату не выдумывать. Предыдущие версии доступны.";
export const newOwnershipActions = [
  ["criteria", "PRD.1.11", "Определить параметры сравнения с TalkHint", pm, "product-hypotheses", "Описание TalkHint и потребности клиентов; сценарии, ограничения и неизвестные цены", "Параметры сравнения с версией TalkHint"],
  ["initial-passport", "PRD.1.12", "Подготовить первоначальный паспорт конкурента", pm, "product-hypotheses", "Результат исследования и параметры сравнения; сохранить существующий ID конкурента", "Черновик паспорта конкурента с источниками на контроль продукта"],
  ["update-passport", "PRD.1.13", "Обновить паспорт конкурента по достаточному сообщению", pm, "product-hypotheses", "Принятое по достаточности сообщение аналитика и предыдущая версия", "Новая версия того же паспорта с историей изменений и статусом приёмки"],
  ["dispatch", "PRD.1.14", "Передать разрешённое продуктовое задание исполнителю", pm, "product-hypotheses", "Решение исследовать/проверить/изменить; согласованные границы, ресурсы и разрешения", "Задание с адресатом, входами, результатом и запросом подтверждения"],
  ["dispatch-receipt", "PRD.1.15", "Получить подтверждение исполнителя либо адресный возврат", pm, "product-hypotheses", "Переданное задание и явный ответ принимающего действия исполнителя", "Зафиксированное получение, блокер либо возврат; исполнение отдельно от получения"],
  ["daily-journal", "MKT.2.18", "Вести ежедневный журнал проверок и статусов решений", analyst, "competitor-monitor", "Источники, сообщения, ответы продукта и открытые вопросы", "Ежедневный журнал фактических проверок и ожиданий для недельного отчёта"],
] as const;
const actionId = (key: string) => `company-action-${key}`;
const resultId = (id: string) => `${id}-result`;

export function prepareBenchmarkOwnership(root: ProjectModelState, actor: string): ProjectModelState {
  const m = readHypothesis(root, "new-country"), revision = m.operatingModel?.revisions.at(-1);
  const roadmaps = m.documents.filter(d => [passportRoadmapTitle, ownershipRoadmapTitle].includes(d.title));
  if (!revision || roadmaps.length !== 1 || !m.analystPreparation?.revisions.length) throw Error("Existing model, analyst passport and unique current roadmap required");
  const roadmap = roadmaps[0];
  if (roadmap.text.includes(ownershipMarker)) return root;
  if (m.documents.some(d => d.id === ownershipDocumentId)) throw Error("Unreconciled ownership document; no duplicate or overwrite");
  const cards = m.competitorDirectory?.records.filter(r => r.revisions.at(-1)!.snapshot.appStore.includes("/id1367461351")) ?? [];
  if (cards.length !== 1) throw Error("Exactly one existing Lingvanex identity required");
  const card = cards[0], prior = card.revisions.at(-1)!;
  const data = structuredClone(revision.data), touched: string[] = [];
  const get = (id: string) => {
    const n = data.nodes.find(n => n.id === id);
    if (!n) throw Error(`Missing existing identity ${id}`);
    return n;
  };
  const link = (from: string, to: string, kind: typeof data.links[number]["kind"], reason: string) => {
    if (!data.links.some(l => l.from === from && l.to === to && l.kind === kind))
      data.links.push({id:`ownership:${kind}:${from}:${to}`,from,to,kind,reason});
  };
  const edit = (key: string, name: string, work: string, form?: string) => {
    const n = get(actionId(key)); if (!touched.includes(n.id)) touched.push(n.id);
    n.name = name;
    n.procedure = work;
    n.rules = `${n.rules}\nАктуальное распределение: ${source}\n${history}`;
    n.constraints = `${n.constraints}\n${boundary}`;
    n.success = acceptance;
    n.referenceIds = Array.from(new Set([...n.referenceIds, ownershipDocumentId]));
    n.register ??= defaultRegister();
    n.register.approval = "discussion";
    n.register.source += `\n${source}`;
    n.questions += "\nБланки: разработка ChatGPT с Сергеем, утверждение Сергей; срок и полнота паспорта ещё обсуждаются.";
    if (form) n.reporting = {required:true,formName:form,templateDocumentId:null,templateVersion:"",
      storage:"Существующие документы/карточки new-country с версиями и привязкой к действию.",formStatus:"required",approvalEvidence:""};
    return n;
  };
  for (const [key,code,name,role,parent,input,output] of newOwnershipActions) {
    const id = actionId(key);
    if (data.nodes.some(n => n.id === id || n.code === code)) throw Error(`Reconcile existing ${code}; no duplicate`);
    const n = emptyWorkNode(id,code,name,"action",parent);
    Object.assign(n,{roleId:role,level:"operation",detailState:"described",status:"agreed",executorId:null,
      description:"Согласован перечень обязанностей; карточка на обсуждении, фактический исполнитель не подключён.",
      purpose:"Полезный версионный результат для следующего клиента процесса.",
      resourceIds:["model-resource"],inputs:[{name:input,sourceId:"owner",freshness:"Переданное поручение, дата, версия и ограничения"}],
      storage:"Единое хранилище модели new-country; не второй каталог.",delivery:"Версионная ссылка и запрос явного ответа.",
      exceptions:"Нет входа/доступа/полномочия — адресный запрос поставщику, ожидание; не имитировать выполнение.",
      schedule:{days:[],hours:"",timezone:"",trigger:key==="daily-journal"?"Ежедневный журнал, когда выполнены проверки; расписание не включено":"По готовности входа/изменении",deadline:"На согласовании"},
      register:{...defaultRegister(),approval:"discussion",source,estimateBasis:"Объём и время неизвестны; не считать нулём или измеренной загрузкой."},
    });
    data.nodes.push(n);
    const r = emptyWorkNode(resultId(id),`${code}.R`,output,"result",id);
    Object.assign(r,{roleId:role,status:"proposal",description:"Требуемый результат, не доказательство исполнения/приёмки.",storage:n.storage});
    data.nodes.push(r); link(n.id,r.id,"produces","Версионный выход действия");
    const form = key==="daily-journal" ? "Ежедневный журнал" : key==="criteria" ? "Параметры сравнения"
      : key==="dispatch" ? "Задание исполнителю" : key==="dispatch-receipt" ? "Подтверждение получения задания" : "Паспорт конкурента";
    edit(key,name,input+" → "+output+". "+acceptance,form);
  }
  edit("verify","Получить задание исследования, собрать и проверить сообщения источников",
    "Регулярно читать разрешённые источники и новости; принять задание продукта, подтвердить получение либо вернуть конкретный вопрос. Проверенные сведения передать, не переписывая продуктовый паспорт от имени его владельца. "+history);
  edit("features","Проверить функции и доступные показатели конкурентов",
    "Проверять функции, цены, сценарии, публичные планы и доступные показатели аудитории/оттока с периодами и источниками. Недоступное явно неизвестно. Заявление источника не живой тест; корреляция релиза и роста не доказывает причинность.");
  edit("plans","Отслеживать публичные планы, новости и выпущенные изменения",
    "Регулярно искать и читать новости/релизы; отделять планы от заявленного выпуска, дату обнаружения от даты выпуска. Точные часы и периодичность мониторинга ещё согласуются; не включать расписание.");
  const compare = edit("compare","Сравнить проверенные данные с TalkHint для продуктового паспорта",
    "Продуктовый менеджер сравнивает по параметрам PRD.1.11 и версии TalkHint; аналитик предоставляет доказательства и вопросы. Первоначальный паспорт создаёт PRD.1.12, следующие изменения — PRD.1.13; аналитик не единоличный владелец.", "Сравнение");
  compare.roleId = pm; compare.parentId = "product-hypotheses"; get(resultId(compare.id)).roleId = pm;
  // Reassignment is responsibility, not a second reporting line.
  data.links = data.links.filter(l => !(l.from === compare.id && l.kind === "accountable_to"));
  edit("propose","Подготовить проверенное сообщение об изменении",
    "Аналитик передаёт продукту источник/дату/описание было→стало, степень подтверждения, неизвестное и связанный сценарий. Возможное продуктовое предложение отделить от факта. Не выдавать публикацию о вмешательстве за совместный разговор.", "Сообщение об изменении");
  edit("benchmark-control","Принять либо вернуть доказательства и полноту сообщения аналитика",
    "Руководитель бенчмаркинга планирует проверки и контролирует доказательства, полноту и неизвестное; явно принимает/возвращает сообщение и отчёт. Не ведёт второй паспорт и не принимает продуктовое решение вместо продукта.");
  edit("product","Получить и зарегистрировать сообщение аналитика либо обращение",
    "Записать поставщика, источник, дату, версию, потребность и конкретного получателя. Исследования и обращения пользователей — самостоятельные входы; не считать запись приёмкой.", "Сообщение об изменении");
  edit("product-sufficiency","Проверить достаточность сообщения для паспорта и решения",
    "Продуктовый менеджер проверяет доказательства и контекст; при нехватке возвращает конкретный вопрос поставщику через PRD.1.3. Достаточное сообщение направляет PRD.1.13. Недостаток доказательств допускает честное решение исследовать, но не выдуманный факт.");
  edit("product-return","Вернуть поставщику адресный вопрос и получить уточнение",
    "Указать недостающий источник, вопрос, требуемый результат и срок на согласовании. Аналитику — запрос проверки; технике — запрос актуальности; после ответа снова PRD.1.1/1.2. Не создавать новый паспорт.");
  edit("product-benefit","Оценить значение находки для клиентов и TalkHint",
    "Продуктовый менеджер связывает новую версию паспорта с потребностью клиента, гипотезой пользы и ограничениями. При необходимости запросить техоценку. Цель — продуктовое решение, не автоматически разрешённое изменение.");
  edit("product-decision","Записать решение по находке и границы его исполнения",
    "Зафиксировать исследовать/проверить/изменить/отложить/отклонить, основание, автора и принявшего либо ожидание. Продуктовый менеджер готовит и регистрирует; содержание и решения контролирует HEAD.06. Расходы, выпуск, стратегия и внешние действия требуют Сергея до явного делегирования. Передавать только разрешённое задание; при отсутствии разрешения — ожидание.");
  edit("product-notify","Вернуть решение аналитику и включить в план-факт",
    "Передать ссылку на решение и статус поручения/ожидания; запросить ответ аналитика MKT.2.6. Внести план действий, факт, отклонение и следующий контроль в существующую отчётность продукта. Наличие решения не равно выполнению.");
  edit("followup","Получить решение продукта и обновить статус сообщения",
    "Аналитик подтверждает получение конкретной версии решения, связывает с сообщением, обновляет журнал статуса. Нет ответа — запросить статус и эскалировать HEAD.01, не считать молчание приёмкой.");
  edit("product-control","Проконтролировать содержание паспортов и продуктовые решения",
    "HEAD.06 принимает/возвращает содержание первоначального и обновлённого паспорта, достаточность решения, передачу исполнителю и план-факт. Не подменяет HEAD.01 в проверке исследования. Верхняя граница эскалации — владелец.");
  edit("technical-assessment","Принять запрос продукта и подтвердить техническую оценку",
    "Принять конкретное задание PRD.1.5/1.14 в пределах технической оценки, подтвердить получение либо вернуть вопрос/блокер PRD.1.15. Выпуск, изменение телефонии или платные действия не разрешены этим описанием. Проверить фактические материалы и вернуть оценку с ограничениями.");
  edit("weekly-prepare","Подготовить недельный план-факт аналитика",
    "Собрать ежедневный журнал: план проверок, фактические источники, сообщения и решения, отклонения, неизвестное, запросы и меры. Передать HEAD.01 на контроль и подготовить материалы месячного отчёта.", "Недельный план-факт");
  edit("monthly-prepare","Подготовить месячную сводку бенчмаркинга",
    "HEAD.01 собирает материалы аналитика и решения продукта; проверяет полноту и подтверждения. Недоступные рост/отток неизвестны. Передаёт существующей цепочке месячного контроля, не дублируя паспорта.", "Месячный отчёт");
  get(actionId("product-reference")).roleId = "head-product"; // Initial TalkHint passport stays with HEAD.06.
  const wire = (from: string, to: string, primary = true) => {
    const n = get(from), receiver = get(to), r = get(resultId(from));
    if (primary) for (const x of [n,r]) Object.assign(x,{clientId:receiver.roleId ?? receiver.id,recipientId:to,acceptorId:receiver.roleId ?? receiver.id,nextId:to});
    if (!receiver.inputs.some(i=>i.sourceId===r.id)) receiver.inputs.push({name:`Версия результата ${n.code}`,sourceId:r.id,freshness:"Источник, версия, дата и статус; условные входы не блокируют остальные маршруты"});
    link(r.id,to,"handoff","Условие в процедуре: явная передача версии, не доказательство приёмки");
    link(r.id,to,"acceptance",acceptance); link(to,from,"return","Конкретный вопрос автору; новая версия без нового каталога");
  };
  const destinations: Record<string,string> = {
    criteria:actionId("compare"), "initial-passport":actionId("product-control"), "update-passport":actionId("product-control"),
    dispatch:actionId("technical-assessment"), "dispatch-receipt":actionId("product-notify"), "daily-journal":actionId("weekly-prepare"),
  };
  for (const [key,to] of Object.entries(destinations)) wire(actionId(key),to);
  // Preserve old links as explicit conditional routes, never rewrite their identities/history.
  const branch = (a:string,b:string) => wire(actionId(a),actionId(b),false);
  branch("product-reference","criteria"); branch("features","compare"); branch("features","initial-passport");
  branch("compare","initial-passport"); branch("product-sufficiency","update-passport");
  branch("initial-passport","product-benefit"); branch("update-passport","product-benefit");
  branch("product-decision","dispatch"); branch("dispatch","verify"); branch("dispatch","dispatch-receipt");
  branch("technical-assessment","dispatch-receipt"); branch("verify","dispatch-receipt");
  branch("followup","daily-journal"); branch("plans","daily-journal");
  for (const id of touched) {
    const n = get(id), role = get(n.roleId!);
    link(n.id,role.id.startsWith("head-")?"owner":role.managerId!,"accountable_to","Контроль в пределах существующей роли, без новых полномочий");
    for (const i of n.inputs) if (i.sourceId) link(n.id,i.sourceId,"requires","Датированный вход и поставщик");
    const out = get(resultId(id));
    out.roleId = n.roleId; out.referenceIds = Array.from(new Set([...out.referenceIds,ownershipDocumentId]));
  }
  for (const n of data.nodes.filter(n=>n.kind==="action" && n.code.startsWith("T06.REPORT."))) {
    n.procedure += "\nВключить версии паспортов, сообщения аналитика, достаточность/возвраты, решения, назначенные действия, подтверждение исполнителя и обратную связь. План/факт/отклонение/причина или гипотеза/следующий контроль раздельно.";
    n.referenceIds=Array.from(new Set([...n.referenceIds,ownershipDocumentId]));
    const r=get(data.links.find(l=>l.from===n.id && l.kind==="produces")?.to ?? "missing-report-output");
    for(const key of ["product-notify","dispatch-receipt"]) {
      const result=get(resultId(actionId(key)));
      if(!n.inputs.some(i=>i.sourceId===result.id))n.inputs.push({name:"Версия продуктового решения/подтверждения",sourceId:result.id,freshness:"Период отчёта, ссылка и статус; не выдумывать событие"});
      link(n.id,result.id,"requires","Источник продуктового план-факта");
    }
    r.referenceIds=Array.from(new Set([...r.referenceIds,ownershipDocumentId]));
  }
  const roleDuties: Record<string,string> = {
    [pm]:"Параметры сравнения; первоначальный и обновляемый единый паспорт конкурента; получение сообщений/проверка достаточности/адресный возврат; клиентская значимость; проект и регистрация решения; передача разрешённого задания и получение ответа; обратная связь аналитику; план-факт. Клиенты — продуктовые решения и конечный пользователь TalkHint; контроль HEAD.06.",
    [analyst]:"Регулярный поиск и чтение источников/новостей/релизов; проверка функций/цен/сценариев/публичных планов и доступных показателей. Проверенное сообщение продукту; получение решения/обновление статуса; ежедневный журнал, недельный план-факт, материалы месяца. Клиент — P.PRODUCT, которому нужны доказательства для паспорта и следующего решения. Не единственный владелец паспортов.",
    "head-market":"План проверок, контроль доказательств и полноты сообщения, приёмка/возврат аналитику. Клиент — продукт, которому нужен проверяемый материал; не дублировать продуктовый паспорт.",
    "head-product":"Исходный паспорт TalkHint и его согласование; контроль содержания паспортов конкурентов и продуктовых решений, обратной связи и план-факта. Клиенты — принимающие решения и аналитик; не объявлять Сергея автоматически согласовавшим документ.",
  };
  for (const [id,duties] of Object.entries(roleDuties)) {
    const n=get(id); n.procedure += `\nАктуальное распределение: ${duties}`;
    n.rules += `\n${source}\n${history}`;
    n.constraints += `\n${boundary}`;
    n.referenceIds=Array.from(new Set([...n.referenceIds,ownershipDocumentId]));
  }
  const gaps = actionChainGaps(data,new Set(touched));
  if(gaps.length) throw Error(`Incomplete changed contracts: ${JSON.stringify(gaps)}`);
  const s=structuredClone(prior.snapshot);
  const urls=["https://lingvanex.com/products/phone-call-translator/","https://apps.apple.com/us/app/live-ai-phone-call-translator/id1367461351"];
  const observed="Переданный владельцем снимок проверки официальных заявлений 25.10.2026: перевод звонков; исходящий AI Companion с возможностью вмешаться; второй номер US/Canada с Premium; перевод SMS; история транскрипций/суммари. Живого теста не было. Механизм вмешательства и одновременное участие человека+AI не установлены. Рост и отток по этому исследованию не установлены. Дата выпуска и первого обнаружения не установлены; дата проверки не дата появления.";
  s.limitations += `\n\nСНИМОК НА ПРИЁМКЕ / ЧЕРНОВИК. ${observed} Автор передачи — Сергей; структурирование — Replit; принявший — не подтверждён. Владелец содержания — P.PRODUCT, контроль HEAD.06. Связь: ${ownershipDocumentId}, PRD.1.12/1.13. Существующие внешние оценки установок — отдельные метрики, не доказательство роста, удержания или оттока.`;
  if(!s.dossier)throw Error("Existing six-section Lingvanex dossier required");
  s.dossier.offerFacts.push({id:"intake-20261025-passport",title:"Исходный снимок для продуктового паспорта — на приёмке",
    value:observed,evidence:{status:"official_claim",note:"Проверка заявлений передана текущим поручением; новая независимая проверка Replit и живой тест сейчас не выполнялись. Приёмка продукта не подтверждена.",sourceUrls:urls,checkedAt:"2026-10-25"}});
  const preparation=structuredClone(m.analystPreparation!.revisions.at(-1)!.data);
  preparation.passport.purpose="Обеспечивать P.PRODUCT проверенными сообщениями и источниками для единого продуктового паспорта конкурента и следующего решения, полезного клиентам TalkHint.";
  preparation.passport.duties=roleDuties[analyst];
  preparation.passport.inputs="Актуальный паспорт TalkHint от HEAD.06, параметры сравнения P.PRODUCT, рассматриваемый список и задания проверок, первичные источники. Недостающий вход — адресный вопрос поставщику.";
  preparation.passport.outputs="Проверенные сообщения продукту, ежедневный журнал, недельный план-факт, материалы месячного отчёта. Паспорт конкурента ведёт P.PRODUCT.";
  preparation.passport.frequency="Регулярный мониторинг; точная частота/часы пока на согласовании. Ежедневный журнал, недельный план-факт, материалы месячного отчёта; расписание не включено.";
  preparation.passport.quality=acceptance+" Дата обнаружения не дата выпуска. Нет источника — неизвестно. Рост/отток и причинность не выдумывать.";
  preparation.passport.handoff=acceptance+" Клиент P.PRODUCT; контроль источников HEAD.01, контроль продуктового содержания HEAD.06.";
  preparation.approvalNotes += `\n${source} Перечень уточнён владельцем, полная карточка/бланки не утверждены. ${boundary}`;
  data.stageReports.push({pass:3,described:"Уточнены обязанности 4 существующих ролей, действия/парные передачи, единый паспорт Lingvanex; добавлены только отсутствующие шаги.",
    boundary:"Подготовка структуры и сохранение переданного исследования, без исполнения crew и новых проверок сервиса.",
    dependencies:"Согласование бланков и карточек, достаточность паспорта TalkHint, решение по Lingvanex и ресурсы worker.",
    gaps:"Нет приёмки Lingvanex; механизм вмешательства/совместный разговор/рост/отток не установлены; сроки и лимиты не утверждены.",
    next:"Остаёмся на P.PRODUCT: рассмотреть первоначальный снимок Lingvanex и сформулировать один адресный вопрос при недостатке входа."});
  const text=`# Паспорта конкурентов и сообщения аналитика — v1\nСтатус: распределение обязанностей передано Сергеем; детальные карточки и бланки на обсуждении. Не протокол исполненной работы.\n${ownershipMarker}\n\n${source}\n\n## Существующие роли\n${Object.entries(roleDuties).map(([id,d])=>`- ${get(id).code} (${id}): ${d}`).join("\n")}\n\n## Изменённые действия и парные передачи\n${[...touched].map(id=>{const n=get(id);return `- ${n.code} / ${n.id}: ${n.name}; исполнитель ${get(n.roleId!).code}; результат ${resultId(id)}; получатель ${n.recipientId}; контролёр ${data.links.filter(l=>l.from===id&&l.kind==="accountable_to").map(l=>l.to).join(", ")}.`;}).join("\n")}\n\nПри смене ответственности исторические версии сохранены, старые ID связей не удалены; существующие маршруты условные. Первоначальные исследования ведут к PRD.1.11/1.12; достаточное сообщение — к PRD.1.13; дальше контроль содержания, оценка/решение. Отложить/отклонить не запускает исполнение. Для исследования принимающее действие MKT.2.2, для технической оценки ENG.1.2; иной тип поручения требует описанного принимающего действия, его нельзя считать доступным автоматически. Ответ исполнителя получает PRD.1.15. Продукт включает решение в существующий план-факт; аналитик получает его через MKT.2.6.\n\n## История и приёмка\n${history}\n${acceptance}\nПередача, доставка, приёмка содержания и исполнение — разные события. Автор и дата правки записываются в ревизии; принявший записывается только по реальному решению, не из наличия документа.\n\n## Lingvanex\nЕдиный ID ${card.id}; версия ${prior.version} → ${prior.version+1}. ${observed}\nИсточники: ${urls.join(" ; ")}.\nЭто переданный владельцем материал, сохранённый вручную Replit. Снимок — черновик/на приёмке; P.PRODUCT подготавливает первоначальный паспорт по PRD.1.12, HEAD.06 контролирует содержание, конкретный принявший пока не установлен. Предыдущие цены/шесть разделов/оценки/источники не удалены. Требуемые уточнения: как именно вмешивается владелец; AI остаётся или выходит; что действительно доступно в интерфейсе. Нет утверждения о выпуске 25.10.\n\n## Quo\nСохранить различие: официально описанный transfer с выходом Sona, а не подтверждённый совместный разговор втроём. Нет доказанных UI/телефонных тестов и роста/оттока. Не расширять выводы исходной находки.\n\n## Бланки и ручная проработка\nПаспорт конкурента, сообщение об изменении, сравнение, ежедневный журнал, недельный/месячный отчёт: разработка ChatGPT с Сергеем, утверждение Сергей. Требуется разработать; старые черновики списков не становятся утверждёнными. Хранение — существующие карточки/Документы new-country; заполненный результат не перезаписывает шаблон.\nОстаёмся в одной должности до конкретного результата; при недостатке входа адресный запрос поставщику, затем обсуждение только одной следующей должности. Автоматического доступа к будущим чатам нет — следующие решения надо реально передать через подключение или Replit.\n\n## Ресурсы и следующий шаг\nМодель через Replit, чтение сайтов, браузер, поиск, запись/передача, worker/расписание/повторы/лимиты — существующие незакрытые задачи подготовки; здесь не подключены и не выполнены. ${boundary}\nСледующий шаг — P.PRODUCT принимает достаточность исходного снимка Lingvanex либо возвращает один точный вопрос. Содержание бланков, сроки, расходы и полноценный механизм вмешательства не согласованы.`;
  let next=root;
  const apply=(c:ModelCommand)=>{next=applyHypothesisCommand(next,"new-country",c,actor);};
  apply({type:"saveCompetitor",id:card.id,baseVersion:prior.version,reason:"Переданный снимок 25.10.2026 на продуктовую приёмку; не новый релиз, не живой тест; сохранено вручную Replit",snapshot:s});
  apply({type:"saveAnalystPreparation",baseVersion:m.analystPreparation!.revisions.at(-1)!.version,preparation});
  apply({type:"createDocument",id:ownershipDocumentId,title:"TalkHint — распределение паспортов и передача изменений — v1 — для обсуждения",text,url:"",elementIds:["TH-PRODUCT","TH-PILOT-COMPETITORS"]});
  apply({type:"saveDocument",id:roadmap.id,title:ownershipRoadmapTitle,
    text:roadmap.text+`\n\n## v11 — актуальное распределение и одна должность за проход\n${ownershipMarker}\nРанее сохранённые материалы выше — история этапов; текущее распределение заменено согласно новому поручению.\n${source}\nСводка: /api/product-crew/documents/${ownershipDocumentId}/download ; исходный паспорт TalkHint ${productPassportId} остаётся v1 на согласовании у HEAD.06.\nLingvanex ${card.id} v${prior.version+1} — черновик на приёмке продукта, не выполненное поручение AI. Бланки ChatGPT+Сергей, утверждает Сергей. Отсутствие исполнителя не блокирует готовность описания. Задачи worker остаются открытыми.\nСледующее: в P.PRODUCT проверить достаточность исходного снимка Lingvanex; если входа недостаточно — один адресный вопрос. Затем только одна следующая должность. Полнота структуры/приёмка результатов/запуск исполнителей — отдельные статусы.\n`,
    url:roadmap.url,elementIds:roadmap.elementIds});
  apply({type:"saveOperatingModel",baseVersion:revision.version,data});
  return next;
}
