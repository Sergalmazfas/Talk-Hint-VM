/**
 * Explicit owner-requested Dev planning update. No model, tool, worker or schedule
 * is configured by this module. Preparation actions are not completion evidence.
 */
import type { ModelCommand, ProjectModelState } from "../../../shared/projectModel";
import type { OperatingData, WorkNode } from "../../../shared/operatingModel";
import { emptyWorkNode } from "../../../shared/operatingModelTemplate";
import { actionOutputs, defaultRegister } from "../../../shared/actionRegister";
import { actionChainGaps } from "../../../shared/actionChainCoverage";
import { emptyReporting } from "../../../shared/actionReporting";
import { applyHypothesisCommand, readHypothesis } from "../hypotheses";
import { companyRegisterTitle } from "./companyRegister";
import { companyDirections } from "./companyRegisterSpec";
import { reportStorage } from "./benchmarkForms";

export const benchmarkReadinessTitle =
  "TalkHint — единый roadmap работы crew над продуктом — v9 — подготовка аналитика бенчмаркинга";
export const benchmarkReadinessMarker = "<!-- BENCHMARK-READINESS-V9 -->";
const source = "Поручение Сергея: управленческое описание подготовки аналитика и подключений; не разрешение запуска или расходов.";
const boundary = "Сейчас описываем задачи. Нет разрешения на запуск AI/пилота/расписания, платные подключения, звонки, SMS, публикацию, изменение телефонии или production. Сроки сдачи и лимиты не утверждены.";
const acceptance = "Готовность подтверждается версионным результатом и повторным чтением, а не наличием ключа или настройки. Получатель явно принимает достаточность либо возвращает замечания; молчание не приёмка. Срок следующего ответа назначается конкретной работе после согласования.";

interface ReadinessSpec {
  id: string; code: string; name: string; role: string; parent: string;
  controller: string; controlAction?: string;
  resource: string; result: string; procedure: string; ready: string; state: string;
}

/** Existing identities are reused for product context and list review. */
export const benchmarkReadinessSpecs: ReadinessSpec[] = [
  {
    id: "company-action-product-reference", code: "PRD.1.9",
    name: "Подготовить и передать актуальное описание TalkHint",
    role: "head-product", parent: "product-hypotheses", controller: "owner",
    resource: "benchmark-resource-description",
    result: "Версионный паспорт TalkHint для сравнения",
    procedure: "HEAD.06 отвечает за передачу, P.PRODUCT готовит материал, техника подтверждает факты реализации. Аудитория, задачи, реально работающие/планируемые функции, цены либо неизвестный тариф, ограничения, территория и дата. Наличие кода не равно живой готовности. Это тот же паспорт продукта для аналитика и юридического направления.",
    ready: "Аналитик подтвердил получение конкретной версии и достаточность; технические утверждения имеют основания, неизвестные тарифы явно неизвестны, уточнения вернулись в эту же цепочку.",
    state: "Частично: концепция TH-PRODUCT v1, клиент TH-CLIENT v2 и сверка кода от 25.10.2026 сохранены. Полный актуальный паспорт и тарифы для сравнения не приняты.",
  },
  {
    id: "company-action-list-review", code: "MKT.2.9",
    name: "Утвердить найденных конкурентов",
    role: "head-market", parent: "competitor-monitor", controller: "owner",
    resource: "benchmark-resource-list",
    result: "Решение по конкретной версии списка исследования",
    procedure: "HEAD.01 рассматривает VocaLingo, Lingvanex Phone Call Translator, AI Call/TaraAI, AI Phone и Guardianly. Quo — отдельная находка, не автоматически шестой участник. Включить/отклонить/уточнить с основанием, источником, ответственным и датой; вернуть недостаточный пакет. Приёмка списка не разрешает расходы, запуск и стратегические решения.",
    ready: "Есть заполненное решение с версией списка, автором и датой, переданное аналитику; черновик бланка и существование карточки не считаются утверждением.",
    state: "Не завершено: пять карточек сохранены; формальный результат MKT.2.9 отсутствует. DOC-BENCH-LIST-DECISION-TEMPLATE — черновик, пакет аналитика v1 awaiting_approval.",
  },
  {
    id: "benchmark-ready-passport", code: "ORG.BENCH.1",
    name: "Собрать обязанности и ресурсный паспорт аналитика",
    role: "head-market", parent: "role-design", controller: "owner",
    resource: "resource-profile-benchmark-role-reference",
    result: "Паспорт P-BENCH к согласованию с ресурсами и получателями",
    procedure: "HEAD.01 совместно с существующим P.COORD собирает обязанности из реестра, полномочия, периодичность, клиентов результатов, ресурсы и обратную связь. Переиспользовать analystPreparation и P-BENCH, не создавать новый каталог. Связать с ORG.REG.1/2/3. Контроль качества, продуктовая приёмка и решение владельца различаются.",
    ready: "Каждое действие имеет вход/поставщика, исполнителя, результат/получателя, контролёра и приёмку/возврат. Сроки, бюджет и назначения не объявлены согласованными без решения Сергея.",
    state: "Частично: паспорт и ресурсный профиль существуют как предложения; экземпляр AI-исполнителя не назначен.",
  },
  {
    id: "benchmark-ready-model", code: "ENG.BENCH.1",
    name: "Подготовить вариант модели через Replit AI Integrations",
    role: "lg-technical-role", parent: "crew-equipment", controller: "head-engineering",
    controlAction: "management-action-control-engineering",
    resource: "resource-profile-lg-technical-role",
    result: "Предложение провайдера, модели и стоимости интеграции",
    procedure: "Предложить поддерживаемую модель OpenAI/Claude/другого поддержанного провайдера через Replit AI Integrations: условия, стоимость входа/выхода и поиска, ограничения, лимиты. Различить текущие прямые ключи и managed-интеграцию. Не подключать услугу и не выполнять платный запрос в рамках этого поручения.",
    ready: "Предложение подтверждено официальной документацией и принято владельцем по расходам; рабочий доступ приложения впоследствии доказан разрешённым ограниченным запросом, а не инструментом Agent.",
    state: "Предстоит: ключи OpenAI/Gemini настроены, но managed-интеграция и модель аналитика не подключены и не проверены.",
  },
  {
    id: "benchmark-ready-reader", code: "ENG.BENCH.2",
    name: "Подготовить безопасное чтение публичных страниц и документов",
    role: "lg-technical-role", parent: "crew-equipment", controller: "head-engineering",
    controlAction: "management-action-control-engineering",
    resource: "management-resource-tools",
    result: "Спецификация и доказательства reader для приложения",
    procedure: "Определить чтение разрешённых HTML/PDF: запрет private IP/SSRF, проверка redirect/DNS, timeout, предел размера и типов, источник/дата/фрагмент, обработка недоступности. OCR, JS и закрытые документы не объявлять прочитанными. Вычислительные и сетевые расходы учитывать отдельно.",
    ready: "После отдельного разрешения приложение действительно читает разрешённую страницу/PDF и сохраняет извлечение с источником; отрицательные тесты блокируют запрещённые адреса. Проверить зависимости в окружении worker.",
    state: "Частично: публичный HTTP из Dev и наличие pdftotext проверены; безопасный инструмент worker и production PDF-путь отсутствуют/не проверены.",
  },
  {
    id: "benchmark-ready-browser", code: "ENG.BENCH.3",
    name: "Подготовить Playwright/Chromium для разрешённых веб-сценариев",
    role: "lg-technical-role", parent: "crew-equipment", controller: "head-engineering",
    controlAction: "management-action-control-engineering",
    resource: "management-resource-tools",
    result: "План браузерного инструмента и границы веб-проверок",
    procedure: "Определить изолированный браузер, разрешённые URL/действия, пределы времени/памяти, очистку сессии, скриншот и наблюдения. Покупки, регистрации, отправки и звонки не разрешены. Playwright/Chromium не дают доступа к установленным iOS/Android-приложениям; App Store не заменяет их проверку.",
    ready: "Будущая разрешённая веб-проверка подтверждена результатом из worker и доказательствами интерфейса; безопасный отказ при ограничениях. Отдельно указаны непроверенные мобильные сценарии.",
    state: "Предстоит: Chromium обнаружен в Dev, Playwright и работающий браузерный адаптер аналитика не подключены.",
  },
  {
    id: "benchmark-ready-search", code: "ENG.BENCH.4",
    name: "Проверить полноценный поиск для работающего приложения",
    role: "lg-technical-role", parent: "crew-equipment", controller: "head-engineering",
    controlAction: "management-action-control-engineering",
    resource: "management-resource-tools",
    result: "Решение о способе поиска либо явный блокер доступа",
    procedure: "Проверить документированную возможность Replit-managed поиска или web_search модели именно из приложения: поддержка, цена, источники и ограничения. Инструменты ChatGPT/Replit Agent не доказательство. Если не поддерживается — выбрать ОДИН SerpAPI либо Serper и передать Сергею безопасное оформление/добавление ключа. Без расходного теста в этом поручении.",
    ready: "После согласования расходов реальный запрос worker возвращает поисковую выдачу с URL и корректно обрабатывает квоту/ошибку. Если доступ отсутствует, есть явный блокер и передача владельцу, а не фиктивный успешный поиск.",
    state: "Не подтверждено: keyless поиск приложения через Replit/модель не проверен; SerpAPI/Serper не подключены.",
  },
  {
    id: "benchmark-ready-storage", code: "ENG.BENCH.5",
    name: "Обеспечить доступ аналитика к общей модели и передачам продукта",
    role: "lg-technical-role", parent: "crew-equipment", controller: "head-engineering",
    controlAction: "management-action-control-engineering",
    resource: "model-resource",
    result: "Ограниченный контракт чтения/записи и доказательство доставки",
    procedure: "Сохранить owner/new-country, существующие ID карточек, документы и ревизии. Чтение входного пакета, запись источников, сравнений и отчёта, версия/operation ID, повторное чтение. Переиспользовать submit_result/review_result и MKT.2.5 → PRD.1.1/1.2 → PRD.1.6/1.7 → MKT.2.6. Получение, приёмка и продуктовое решение различаются; не считать публичный Dev MCP готовой авторизацией production worker.",
    ready: "Разрешённый тестовый результат записан и повторно прочитан в правильной области; повтор не создаёт дубль; другая область недоступна. Продукт явно подтвердил получение/ответ либо виден блокер; молчание не успех.",
    state: "Частично: чтение new-country rev671 через MCP проверено, серверные механизмы сохранения/приёмки есть. Запись и передача от worker не проверены, пять конкурентов заново не проверены.",
  },
  {
    id: "benchmark-ready-runtime", code: "ENG.BENCH.6",
    name: "Подготовить worker, состояние, ограничения и эксплуатацию",
    role: "lg-technical-role", parent: "crew-equipment", controller: "head-engineering",
    controlAction: "management-action-control-engineering",
    resource: "resource-profile-lg-technical-role",
    result: "План runtime, очереди и восстановления к согласованию",
    procedure: "Совместно с P.OPS описать отдельный от Secretary worker, очередь, ручной запуск/отмену, checkpoints в общей модели, логи без секретов, лимиты модели/поиска/времени/бюджета, идемпотентность, ограниченные повторы и сигнал о сбое с получателем. Неизвестный checkpoint — отказ, не новый запуск. Планировщик — отдельный будущий допуск, сейчас выключен. Наличие Dev-сервера не доказывает запас ресурсов production.",
    ready: "Будущие разрешённые проверки подтверждают восстановление после перезапуска, отсутствие повторной записи/расхода при retry, отмену, лимит и доставку сигнала контролёру. Нужны согласованный бюджет и изоляция от телефонии.",
    state: "Предстоит: worker/CrewAI и расписание аналитика отсутствуют; offline fixture не является исполнителем. Установка и запуск не поручены.",
  },
  {
    id: "benchmark-ready-forms", code: "ORG.BENCH.2",
    name: "Подготовить с ChatGPT проекты бланков бенчмаркинга",
    role: "product-work-coordinator", parent: "role-design", controller: "head-team",
    controlAction: "management-action-control-team",
    resource: "model-resource",
    result: "Проекты сравнительной таблицы, ежедневного журнала и план-факта",
    procedure: "ChatGPT готовит проекты; P.COORD отвечает за получение и сохранение версии. Сравнительная таблица, ежедневный журнал, недельный и месячный план-факт со ссылками на карточки/источники, план/действия/результат/отклонения/меры. Это будущая работа: формы сейчас не создавать. ChatGPT — способ подготовки, не назначенный автономный AI-исполнитель.",
    ready: "Черновики сохранены отдельными документами в общей модели и связаны с действиями; неизвестные метрики не нули, сроки сдачи не придуманы, есть передача Сергею.",
    state: "Требуется разработать: требования описаны, эти формы не разработаны и не утверждены. Старые бланки кандидатов/решения списка сохранены.",
  },
  {
    id: "benchmark-ready-forms-review", code: "ORG.BENCH.3",
    name: "Передать бланки Сергею и зафиксировать утверждение или возврат",
    role: "product-work-coordinator", parent: "role-design", controller: "owner",
    resource: "model-resource",
    result: "Явное решение Сергея по конкретным версиям бланков",
    procedure: "P.COORD передаёт проекты и регистрирует решение владельца. Только Сергей утверждает бланки. Записать версии, дату, замечания/возврат и подтверждение аналитиком получения принятой версии. Не подписывать за владельца и не считать отсутствие ответа согласием.",
    ready: "Есть явное решение Сергея по каждой форме либо сохранён открытый возврат/ожидание; сроки сдачи назначаются отдельно.",
    state: "Ожидает проектов и решения Сергея; полномочия и сроки не утверждены.",
  },
  {
    id: "benchmark-ready-search-key", code: "ORG.BENCH.4",
    name: "Передать владельцу условную задачу оформления доступа к поиску",
    role: "product-work-coordinator", parent: "access-review", controller: "owner",
    resource: "management-resource-tools",
    result: "Подтверждение доступа к одному провайдеру либо блокер",
    procedure: "Только если ENG.BENCH.4 подтвердит отсутствие подходящего поиска через Replit/модель: Сергей выбирает/оформляет один SerpAPI или Serper и безопасно добавляет ключ через Secrets. P.COORD фиксирует передачу; технический специалист принимает доступ и проверяет его в ENG.BENCH.4 после разрешения. Не просить ключ в чате и не сохранять значение в модели. Сейчас ничего не регистрировать и не подключать.",
    ready: "Есть решение владельца и подтверждение технике без раскрытия ключа либо явный блокер. Альтернатива не означает обязательную покупку обоих сервисов.",
    state: "Условная ветвь, не активирована: сначала проверка ENG.BENCH.4.",
  },
  {
    id: "benchmark-ready-qa", code: "ENG.BENCH.7",
    name: "Проверить сквозной маршрут на ограниченном пилоте после допуска",
    role: "lg-qa-role", parent: "quality", controller: "head-engineering",
    controlAction: "management-action-control-engineering",
    resource: "resource-profile-lg-qa-role",
    result: "Протокол сквозной проверки с приёмкой или блокерами",
    procedure: "Сначала проверить готовность входов и явный допуск Сергея с лимитами. Затем, только отдельным разрешённым пилотом: пакет → поиск/чтение → факты/сравнение → запись/повторное чтение → передача продукту → получение/приёмка/ответ. Проверить владельцев, версии, retry, лимиты, ошибки и восстановление. Нет готового ресурса или разрешения — blocked, без имитации пилота. Сейчас пилот не запускать.",
    ready: "Ограниченный разрешённый маршрут имеет доказательства результата каждого шага и обратную связь продукта. Неудача/недоступность показаны явно; телефонные звонки и мобильные покупки исключены.",
    state: "Заблокировано: нужны актуальный паспорт, решение по списку, ресурсы, формы и лимиты; QA-пилот не выполнен.",
  },
];

export function prepareBenchmarkReadiness(root: ProjectModelState, actor: string): ProjectModelState {
  const model = readHypothesis(root, "new-country");
  const rev = model.operatingModel?.revisions.at(-1);
  const roadmaps = model.documents.filter(d => [companyRegisterTitle, benchmarkReadinessTitle].includes(d.title));
  if (!rev || roadmaps.length !== 1) throw Error("One current roadmap and existing operating model required");
  const roadmap = roadmaps[0];
  if (roadmap.text.includes(benchmarkReadinessMarker)) return root;
  const data = structuredClone(rev.data), scoped = new Set(benchmarkReadinessSpecs.map(s => s.id));
  const get = (id: string): WorkNode => {
    const n = data.nodes.find(n => n.id === id);
    if (!n) throw Error(`Missing existing identity: ${id}`);
    return n;
  };
  const add = (n: WorkNode) => {
    if (data.nodes.some(x => x.id === n.id || x.code === n.code)) throw Error(`Duplicate identity: ${n.code}`);
    data.nodes.push(n); return n;
  };
  const link = (from: string, to: string, kind: OperatingData["links"][number]["kind"], reason: string) => {
    get(from); get(to);
    if (!data.links.some(l => l.from === from && l.to === to && l.kind === kind))
      data.links.push({ id: `bench-ready:${kind}:${from}:${to}`, from, to, kind, reason });
  };
  const output = (id: string) => {
    const outputs = actionOutputs(data, id);
    if (outputs.length !== 1) throw Error(`Exactly one canonical result required: ${id}`);
    return outputs[0];
  };
  for (const s of benchmarkReadinessSpecs) {
    get(s.role); get(s.parent); get(s.controller); get(s.resource);
    const existing = data.nodes.find(n => n.id === s.id);
    if (existing && existing.code !== s.code) throw Error(`Code mismatch: ${s.id}`);
    const n = existing ?? add(emptyWorkNode(s.id, s.code, s.name, "action", s.parent));
    if (!existing) {
      const r = add(emptyWorkNode(`${s.id}-result`, `${s.code}.R`, s.result, "result", s.id));
      link(n.id, r.id, "produces", "Требуемый результат подготовки, не выполненная работа");
      n.inputs = [{ name: "Поручение и согласуемые границы", sourceId: "owner", freshness: source }];
      n.resourceIds = [s.resource];
    }
    n.roleId = s.role;
    n.level ??= "operation";
    n.status = "proposal";
    n.description += `\n${benchmarkReadinessMarker}\nСостояние: ${s.state}`;
    n.procedure += `\n${s.procedure}\n${boundary}`;
    n.success += `\n${s.ready}\n${acceptance}`;
    n.questions += "\nКонкретные сроки/стоимость/допуск/назначения требуют явного согласования. " + s.state;
    n.register ??= defaultRegister();
    n.register.approval = "discussion";
    n.register.source += "\n" + source;
    n.register.availability ||= "Подготовка по поручению; регулярная доступность не согласована";
    n.register.period ||= "По готовности зависимостей, точные сроки не согласованы";
    n.schedule.trigger ||= "Поручение владельца и готовность входов; никакое расписание не включено";
    n.resourceIds = Array.from(new Set([...n.resourceIds, s.resource, "model-resource"]));
    n.reporting ??= { ...emptyReporting(), storage: reportStorage, formName: `Запись подготовки: ${s.result}` };
    const r = output(n.id);
    r.roleId = n.roleId;
    if (!existing) {
      r.status = "proposal";
      r.description = "Требование к будущему результату. Факт выполнения и приёмки отсутствует.";
      r.storage = reportStorage;
    }
    data.links = data.links.filter(l => !(l.from === n.id && l.kind === "accountable_to"));
    link(n.id, s.controller, "accountable_to", "Контролирующий; верхняя граница — владелец");
  }
  const handoff = (fromAction: string, toAction: string, condition = "По готовности входа; не факт передачи") => {
    const from = get(fromAction), result = output(fromAction), receiver = get(toAction);
    link(result.id, receiver.id, "handoff", condition);
    link(result.id, receiver.id, "acceptance", acceptance);
    link(receiver.id, from.id, "return", "Адресный возврат с причиной, версией и ожидаемым уточнением");
    if (!receiver.inputs.some(i => i.sourceId === result.id))
      receiver.inputs.push({ name: `Результат ${from.code}; ${condition}`, sourceId: result.id,
        freshness: "Версия, дата, поставщик и доказательство готовности; требуемый результат не равен фактическому" });
    if (!from.nextId) from.nextId = receiver.id;
    if (!from.recipientId) from.recipientId = receiver.id;
    if (!from.clientId) from.clientId = receiver.roleId ?? receiver.id;
    if (!from.acceptorId) from.acceptorId = receiver.roleId ?? receiver.id;
    if (!result.recipientId) Object.assign(result, { recipientId: receiver.id,
      clientId: receiver.roleId ?? receiver.id, acceptorId: receiver.roleId ?? receiver.id, nextId: receiver.id });
    link(receiver.id, result.id, "requires", "Версионный вход с поставщиком; условность описана в передаче");
  };
  // Use the established product/list recipients, not another acceptance workflow.
  handoff("company-action-product-reference", "company-action-context-receive");
  handoff("company-action-list-review", "company-action-verify");
  handoff("company-action-product-reference", "benchmark-ready-passport");
  handoff("company-action-list-review", "benchmark-ready-passport");
  handoff("management-action-duties", "benchmark-ready-passport", "Общий перечень обязанностей, специализация P-BENCH");
  for (const id of ["model", "reader", "browser", "search", "storage", "runtime"])
    handoff("benchmark-ready-passport", `benchmark-ready-${id}`);
  handoff("benchmark-ready-passport", "benchmark-ready-forms");
  handoff("benchmark-ready-forms", "benchmark-ready-forms-review");
  handoff("benchmark-ready-forms-review", "benchmark-ready-passport", "Явное решение Сергея или возврат, не автоматическое утверждение");
  for (const s of benchmarkReadinessSpecs) {
    if (s.id === "benchmark-ready-qa" || s.id === "benchmark-ready-search-key") continue;
    handoff(s.id, "benchmark-ready-qa", "Только после готовности; QA-пилот отдельно разрешает Сергей с лимитами");
    if (s.controlAction) handoff(s.id, s.controlAction, "Контроль подготовки в существующем направлении");
  }
  // Conditional branch: do not make external search registration a universal gate.
  // The successful search path already points to QA, not to a compulsory key purchase.
  handoff("benchmark-ready-search", "benchmark-ready-search-key", "Только при доказанной необходимости внешнего провайдера");
  handoff("benchmark-ready-search-key", "benchmark-ready-search", "Решение/безопасный доступ возвращаются на техническую проверку");
  handoff("benchmark-ready-qa", "company-action-product", "Разрешённый протокол QA либо явные блокеры; без повторного сбора фактов");
  handoff("benchmark-ready-qa", "management-action-control-engineering");
  const formsReview = get("benchmark-ready-forms-review");
  Object.assign(formsReview, { acceptorId: "owner", clientId: "owner", recipientId: "owner" });
  Object.assign(output(formsReview.id), { acceptorId: "owner", clientId: "owner", recipientId: "owner" });
  link(output(formsReview.id).id, "owner", "handoff", "Проекты бланков передаются владельцу для явного решения");
  link(output(formsReview.id).id, "owner", "acceptance", "Только явное решение Сергея по версии; не решение координатора");
  link("owner", formsReview.id, "return", "Замечания владельца возвращаются координатору для адресной доработки");
  formsReview.procedure += "\nПолучатель и утверждающий — Сергей; координатор не подменяет его решение.";
  get("resource-profile-benchmark-role-reference").description +=
    "\nПодготовка — действия ORG.BENCH.1–4 и ENG.BENCH.1–7; это тот же ресурсный паспорт. Ничего не подключено этой правкой.";
  get("management-action-duties").procedure +=
    "\nДля аналитика отдельная конкретизация ORG.BENCH.1; её результаты не подменяют обязанности остальных должностей.";
  get("management-action-tools").procedure +=
    "\nКонкретизация ресурсов аналитика ENG.BENCH.1–6; наличие задачи не означает рабочее подключение.";
  get("crew-product-roadmap").questions +=
    "\n" + benchmarkReadinessMarker + "\nТекущий фокус — управление подготовкой P-BENCH, а не повторный ручной аудит конкурентов. После входов — описание ресурсов, затем отдельный будущий допуск пилота.";
  const gaps = actionChainGaps(data, scoped);
  if (gaps.length) throw Error(`Incomplete preparation contracts: ${JSON.stringify(gaps)}`);
  const rows = benchmarkReadinessSpecs.map(s =>
    `| ${s.code} | ${s.name} | ${get(s.role).code} | ${s.state} |`).join("\n");
  const directions = companyDirections.map(([, code, , , content]) => `- **${code}** — ${content}`).join("\n");
  // The previous document is close to the 50k limit. saveDocument retains its
  // COMPLETE before-image in decisions/history; the current edition indexes
  // canonical action cards instead of duplicating every earlier appendix.
  const text = `# TalkHint — единый roadmap, v9 — для обсуждения
${benchmarkReadinessMarker}
${source}
Существующий документ и ID сохранены. Полный текст v8 сохранён в истории изменения этого документа; прежние приложения не удалены из истории. Карточки, роли, исследования, отчёты проходов и исходная гипотеза не заменены.

## Порядок всей работы
1. Полностью описать структуру через действия, клиентов и результаты: руководство/CEO, стратегия, тактика, десять направлений и клиентский путь.
2. По каждому действию связать источник/поставщика, исполнительную должность, ресурсы, результат/клиента, контролёра, приёмку/возврат и следующий шаг. Обязанности — фильтр по должности; роль, экземпляр AI и запуск различаются.
3. Обсудить и явно принять описание Сергеем. Готовность описания не требует работающего AI.
4. Отдельный будущий допуск: инструменты/worker → ограниченный пилот → приёмка результата → решение о регулярной работе. Никакая настройка/частота в карточке сама не запускает работу.

## Сохранённый охват — все десять направлений
${directions}
Полная техническая цепочка сохранена: требования → архитектура → backend/frontend/mobile → QA → выпуск/эксплуатация, с участием Replit как технического средства, не автономного сотрудника. Организационное подчинение отдельно от передач результатов. B2C/B2B не смешиваются; исследование, привлечение, оплата, активация, первый успех и удержание — разные результаты.
Критерий готовности направления: конкретные действия и их договоры, покрытие должностями/ресурсами, явные входы/выходы и приёмка, решения/неизвестное с основаниями. Черновик, к обсуждению и утверждение Сергеем не взаимозаменяемы.

## Текущая управленческая очередь подготовки аналитика
| Код | Действие | Ответственная должность | Фактическое состояние |
|---|---|---|---|
${rows}
У каждого пункта в существующем реестре указаны ресурс, результат, получатель, контролёр, приёмка/возврат и следующий шаг. Результаты этих задач пока требования, не выполненные подключения. Координатор получает проекты ChatGPT, Сергей утверждает формы. Сроки сдачи конкретно не согласованы; оценки операций/времени неизвестны, не нули.

## Факты текущего ручного пакета
- Получен new-country rev671; сохранены пять карточек: VocaLingo, Lingvanex, TaraAI, AI Phone, Guardianly. В текущем проходе заново не перепроверены.
- В MKT.2.9 нет заполненного формального решения; пакет analystPreparation v1 awaiting_approval, URL pending. Согласованная область исследования не разрешает запуск и не утверждает все сведения.
- Quo — отдельная находка INFO-LG-QUO: официальная инструкция transfer описывает выход Sona. Совместный разговор втроём не доказан; UI/звонок не тестировались. Автономные MMS/фото третьему номеру и прохождение чужого IVR не подтверждены.
- Рост/отток и причинность влияния функций не установлены.
- Сервер и чтение пакета есть. Ключ/Chromium/pdftotext, инструмент Agent/ChatGPT и документ с процедурой не доказывают готовность worker. Сохранение/повторное чтение/доставка результата будущим worker должны проверяться отдельно.

## Отчётность и бланки — требования, не готовые формы
Сохранены 40 требований: десять направлений × ежедневно/еженедельно/ежемесячно/ежеквартально. Единый обзор: цель/план результата → план действий → факт действий → факт результата → отклонение → подтверждённая причина либо гипотеза → мера/ответственный/срок/контроль эффекта.
Разрезы: отдел, B2C/B2B, регион, язык, канал, ответственный и ID действий; источник, период, единицы и знаменатель обязательны. Маркетинг/продажи/обслуживание/продукт/техника/юридические документы/Twilio/финансы сохраняют свои карточки и принимающие действия. Выручка, EBITDA, чистая прибыль и движение денег раздельно; двойной счёт исключается. Изменение бюджета не автоматическое.
Старые бланки кандидатов и решения списка остаются черновиками. Новые сравнительная таблица/дневник/недельный и месячный план-факт — будущая подготовка ChatGPT, утверждение Сергеем, без разработки форм сейчас.

## Проверка полноты и незакрытое
Текущие карточки являются источником истины; их история и прежние коды сохранены. Формальная полнота не равна достаточности содержания или запуску AI. Для действий этого пакета проверяются ссылки, источники/поставщики, результаты/получатели, контроль и возврат.
Прежние пробелы B2C.1.1–4, B2B.1 и LG/RM не объявлены закрытыми. Сохраняются задачи уточнения паспортов, приёмки, источников данных, нагрузок и бланков. Двоичный Excel не передан; его 65 строк не объявлены импортированными. Неизвестные мощности/тарифы/готовность отмечаются, не выдумываются.

## Следующий конкретный шаг
HEAD.06/P.PRODUCT передаёт актуальную версию паспорта PRD.1.9; HEAD.01 рассматривает список по MKT.2.9. Затем HEAD.01 и P.COORD согласуют P-BENCH и предложения ресурсов. Далее технические подготовительные действия; QA только после готовности и отдельного допуска Сергея с лимитами.
${acceptance}
${boundary}
`;
  if (text.length > 50000) throw Error("Roadmap document limit exceeded");
  data.stageReports.push({ pass: 2, described: "Управленческие действия подготовки P-BENCH и подключений в единой модели; PRD.1.9/MKT.2.9 переиспользованы.",
    boundary, dependencies: "Актуальный паспорт, явный список, ресурсный профиль, формы/доступы, бюджет и отдельный допуск QA.",
    gaps: "Подготовка и проверки инструментов не выполнены; расписание/модель/worker не подключены. Пять карточек не перепроверены; по Quo transfer, не совместный разговор.",
    next: "Получить паспорт PRD.1.9 и решение списка MKT.2.9, затем согласовать P-BENCH и ресурсы." });
  let next = root;
  for (const command of [
    { type: "saveDocument", id: roadmap.id, title: benchmarkReadinessTitle, text, url: roadmap.url, elementIds: roadmap.elementIds },
    { type: "saveOperatingModel", baseVersion: rev.version, data },
  ] as ModelCommand[]) next = applyHypothesisCommand(next, "new-country", command, actor);
  return next;
}
