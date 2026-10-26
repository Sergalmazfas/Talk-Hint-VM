import type { ModelCommand, ProjectModelState } from "../../../shared/projectModel";
import type { OperatingData } from "../../../shared/operatingModel";
import { emptyWorkNode } from "../../../shared/operatingModelTemplate";
import { defaultRegister } from "../../../shared/actionRegister";
import { actionChainGaps, inputSupplier } from "../../../shared/actionChainCoverage";
import { applyHypothesisCommand, readHypothesis } from "../hypotheses";
import { crewRoadmapId } from "./crewRoadmapContent";
import { registerRoadmapTitle } from "./actionRegister";
import { benchmarkChain, chainId, chainResult } from "./benchmarkChainSpec";
import { benchmarkRoadmap } from "./benchmarkChainDocument";
export const benchmarkRoadmapTitle = "TalkHint — единый roadmap работы crew над продуктом — v5 — связанная цепочка бенчмаркинга";
export const benchmarkMarker = "<!-- BENCHMARK-ACCOUNTABILITY-CHAIN-V1 -->";

export function prepareBenchmarkChain(root: ProjectModelState, actor: string): ProjectModelState {
  const model = readHypothesis(root, "new-country");
  const doc = model.documents.find(d => d.title === benchmarkRoadmapTitle || d.title === registerRoadmapTitle);
  const rev = model.operatingModel?.revisions.at(-1);
  if (!doc || !rev) throw Error("Existing roadmap and operating model required");
  if (doc.text.includes(benchmarkMarker)) return root; // Do not replay over subsequent owner edits.
  const data: OperatingData = structuredClone(rev.data);
  const get = (id: string) => {
    const n = data.nodes.find(n => n.id === id);
    if (!n) throw Error(`Missing existing identity: ${id}`);
    return n;
  };
  const links: OperatingData["links"] = [];
  const link = (from: string, to: string, kind: OperatingData["links"][number]["kind"], reason: string) => {
    if (!links.some(l => l.from === from && l.to === to && l.kind === kind))
      links.push({ id: `bench-chain:${kind}:${from}:${to}`, from, to, kind, reason });
  };
  for (const s of benchmarkChain) {
    get(s.role); get(s.parent);
    let n = data.nodes.find(n => n.id === chainId(s.key));
    if (!n) {
      if (data.nodes.some(n => n.code === s.code)) throw Error(`Code already exists; reconcile, do not duplicate: ${s.code}`);
      n = emptyWorkNode(chainId(s.key), s.code, s.name, "action", s.parent);
      data.nodes.push(n);
    }
    const oldFinding = s.key === "verify" && n.description.includes("\nПример") ? n.description.slice(n.description.indexOf("\nПример")) : "";
    Object.assign(n, {
      name: s.name, parentId: s.parent, level: "operation", detailState: "described",
      status: s.proposed ? "proposal" : "agreed", roleId: s.role, executorId: null,
      purpose: "Передать проверяемый полезный результат конкретному клиенту без потери источников, ответственности и обратной связи.",
      description: `${s.proposed ? "Предложение, не утверждено." : "Согласованы действие и место в цепочке; полная карточка ещё обсуждается."} Проектируемый исполнитель — существующая должность ${get(s.role).code}. Фактический AI-исполнитель не подключён, результат работы не получен.${oldFinding}`,
      resourceIds: ["model-resource", ...(["scan", "verify", "features", "plans"].includes(s.key) ? ["search-resource"] : [])],
      procedure: s.work,
      inputs: s.inputs.map(k => ({
        name: k === "owner" ? "Фактически переданные поручение/границы/решение владельца; не будущие чаты" : `Версия результата ${benchmarkChain.find(r => r.key === k)!.code}`,
        sourceId: k === "owner" ? "owner" : chainResult(k),
        freshness: "Дата, версия, поставщик и ограничения обязательны; условные и альтернативные входы уточнены в процедуре",
      })),
      rules: "Факт, сообщение пользователя, предположение, предложение и подтверждённое решение разделяются. Источник, дата данных, дата проверки и предел доказательства обязательны. Недоступный показатель не равен нулю. Последовательность событий не доказывает причинность роста от функции.",
      constraints: "Описание процесса, не запуск. Сроки исполнения/ответа, часы и часовой пояс пока согласуются. Расходы, внешние действия, выпуск и стратегия остаются Сергею до явного делегирования. Получение, приёмка исследования, продуктовое решение и внедрение — разные события.",
      success: "Вход имеет источник и поставщика; указан проектируемый исполнитель, ресурсы, выход, получатель, контролирующий, приёмка/возврат и следующий шаг. В конкретной работе есть датированное решение принимающего либо явно открытое ожидание, а не молчаливая приёмка.",
      storage: "Общая модель new-country, существующие карточки, документы и ревизии.",
      delivery: "Версионная ссылка, получатель и подтверждение получения; автоматическая рассылка не включена.",
      exceptions: "Недостаточный вход — адресный возврат поставщику. Противоречие/существенный риск — независимая проверка по необходимости. Контроль — самостоятельное действие; верхняя граница владелец/CEO в согласованных пределах, без бесконечных контролёров.",
      questions: `${s.proposed ? "Роль/полномочия этого действия пока предложение. " : ""}Сроки, объём и минуты неизвестны. Бланк: требуется разработать; форма сейчас не разрабатывается и не утверждается.`,
      schedule: { days: [], hours: "", timezone: "", trigger: s.trigger ?? "По получению необходимого входа / при изменении версии; срок согласуется", deadline: "На согласовании" },
      register: {
        ...defaultRegister(), approval: s.proposed ? "draft" : "discussion",
        availability: "Не согласована; регулярный отчёт не означает дежурство 24/7",
        period: s.key.startsWith("weekly-") ? "неделя" : s.key.startsWith("monthly-") ? "месяц" : "на одну входящую работу",
        source: "Переданные через чат договорённости владельца: связанная цепочка бенчмаркинга, продукта, контроля и отчётности",
        estimateBasis: "Объём и время пока не оценены. Согласование перечня действий не является утверждением полной карточки.",
        proposalReason: s.proposed ? "Предложение: принимающая роль/порядок общей отчётности или смежный механизм требуют отдельного решения; не считать полномочие делегированным." : "",
      },
    });
    let r = data.nodes.find(n => n.id === chainResult(s.key));
    if (!r) {
      if (data.nodes.some(n => n.code === `${s.code}.R`)) throw Error("Existing output code requires reconciliation");
      r = emptyWorkNode(chainResult(s.key), `${s.code}.R`, s.output, "result", n.id);
      data.nodes.push(r);
    }
    Object.assign(r, { name: s.output, roleId: s.role, executorId: null,
      status: "proposal", description: "Требуемый результат действия, не доказательство выполнения или приёмки.",
      storage: n.storage, success: n.success, questions: n.questions });
  }
  for (const s of benchmarkChain) {
    const n = get(chainId(s.key)), r = get(chainResult(s.key)), receiver = get(chainId(s.next));
    const receiverRole = receiver.roleId ?? (receiver.kind === "client" ? receiver.id : null);
    if (!receiverRole) throw Error(`Receiving action has no role: ${receiver.id}`);
    const role = get(s.role);
    // A manager's control terminates at owner, not another newly invented control action.
    const controller = role.id.startsWith("head-") || role.id === "ai-ceo" ? "owner" : role.managerId;
    if (!controller) throw Error(`No existing line manager: ${s.role}`);
    Object.assign(n, { clientId: receiverRole, recipientId: receiver.id, acceptorId: receiverRole, nextId: receiver.id });
    Object.assign(r, { clientId: receiverRole, recipientId: receiver.id, acceptorId: receiverRole, nextId: receiver.id });
    const qualifier = s.proposed || benchmarkChain.find(x => x.key === s.next)?.proposed ? "Предлагаемая связь; полномочия и получатель ещё согласуются. " : "";
    link(n.id, r.id, "produces", "Требуемый выход действия; фактический результат ещё не получен");
    link(n.id, controller, "accountable_to", "Контролирующий по существующей ответственности; не вторая подчинённость должности");
    link(r.id, receiver.id, "handoff", `${qualifier}Передача версии результата конкретному получателю`);
    link(r.id, receiver.id, "acceptance", `${qualifier}Получение и содержательная приёмка различаются; факт решения фиксируется отдельно`);
    link(receiver.id, n.id, "return", `${qualifier}Вернуть автору конкретные замечания, сохранить версии и следующий шаг`);
    for (const input of n.inputs) link(n.id, input.sourceId!, "requires", "Датированный источник входа с поставщиком; условность входа указана в процедуре");
    if (n.inputs.some(i => !inputSupplier(data, i.sourceId))) throw Error(`Supplier missing for ${n.code}`);
  }
  // Explicit conditional branches, rather than pretending the chain is one linear list.
  const branch = (from: string, to: string, reason: string) => {
    link(chainResult(from), chainId(to), "handoff", reason);
    link(chainResult(from), chainId(to), "acceptance", reason);
    link(chainId(to), chainId(from), "return", "Адресный возврат по условной ветви; не бесконечный контроль");
  };
  branch("context-check", "product-reference", "При недостаточном описании — запрос менеджеру продукта, а не домысливание аналитиком");
  branch("product-sufficiency", "product-return", "При пробеле — адресный запрос уточнения");
  branch("product-return", "support", "Обращение пользователя возвращается саппорту, не обязательно аналитику");
  branch("product-benefit", "product-decision", "Если техническая оценка не требуется, причина записана");
  branch("technical-control", "product-decision", "После контроля технической оценки по конкретному запросу продукта");
  branch("benchmark-control", "weekly-send", "Только при контроле соответствующей версии недельного отчёта");
  branch("product-notify", "support", "Обратная связь по пользовательскому обращению идёт саппорту");
  branch("monthly-send", "owner", "До согласования координатора конечный получатель — Сергей");
  for (const key of ["product", "product-decision", "product-notify"]) {
    link(chainResult(key), chainId("product-control"), "acceptance", "Руководитель продукта контролирует рассмотрение, не заменяя решение владельца");
    link(chainId("product-control"), chainId(key), "return", "Адресный возврат замечаний руководителя продукта");
  }
  link(chainResult("weekly-receive"), chainId("weekly-send"), "feedback", "Подтверждение получения аналитику");
  link(chainResult("monthly-receive"), chainId("monthly-send"), "feedback", "Подтверждение получения поставщику сводки, роль получателя предложена");
  const actionIds = new Set(benchmarkChain.map(s => chainId(s.key)));
  for (const l of links) if (l.kind === "handoff" && actionIds.has(l.to)) {
    const receiver = get(l.to), source = get(l.from);
    if (!receiver.inputs.some(i => i.sourceId === source.id)) {
      receiver.inputs.push({ name: `Условный вход по связанной передаче: ${source.code}`,
        sourceId: source.id, freshness: "При наличии этой ветви; конкретная версия и поставщик результата обязательны" });
      link(receiver.id, source.id, "requires", "Явный источник условного входа; не обязательное ожидание всех ветвей");
    }
  }
  const focus = new Set(benchmarkChain.flatMap(s => [chainId(s.key), chainResult(s.key)]));
  const same = (a: OperatingData["links"][number], b: OperatingData["links"][number]) => a.from === b.from && a.to === b.to && a.kind === b.kind;
  // Remove only obsolete links owned by the prior register importer; history keeps them.
  data.links = data.links.filter(l => !(l.id.startsWith("register:") && (focus.has(l.from) || focus.has(l.to))) || links.some(w => same(l, w)));
  for (const l of links) if (!data.links.some(old => same(old, l))) data.links.push(l);
  const ids = new Set(benchmarkChain.map(s => chainId(s.key)));
  const gaps = actionChainGaps(data, ids);
  if (gaps.length) throw Error(`Action contract gaps: ${JSON.stringify(gaps)}`);
  const roadmap = get(crewRoadmapId);
  roadmap.nextId = chainId("product-reference");
  roadmap.description = "Roadmap v5. Продолжаем бенчмаркинг до завершения описания; при межотдельной передаче сразу раскрываем принимающие действия. Согласован перечень и связность, не все карточки/формы/сроки. Подключение исполнителей — отдельный будущий этап.";
  roadmap.questions = "Первым уточнить PRD.1.9: какие разрешённые источники дают актуальные аудиторию, задачи, функции, цену и ограничения TalkHint; факты реализации подтверждает ENG.1.1. Формы пока только «требуется разработать».";
  get("crew-roadmap-phase-2").description = "Текущая ветвь MKT.2 связана с принимающими PRD.1/ENG.1 и отчётностью; формальная связность не равна завершению содержательного заполнения. Другие направления и сроки остаются на проработке.";
  get("crew-roadmap-phase-2").nextId = chainId("product-reference");
  data.stageReports.push({ pass: 3, described: "Зафиксирована согласованная цепочка поставщиков, действий, результатов, контроля, приёмки/возврата и обратной связи. Существующие роли и прежние действия переиспользованы.",
    boundary: "Не выполненное исследование и не запущенная команда. Недельный отчёт/месячная сводка согласованы по периодичности; конкретные сроки/формы и общая месячная отчётность ещё согласуются.",
    dependencies: "Актуальное описание TalkHint от продукта и подтверждение реализации техникой; проверка достаточности аналитиком.",
    gaps: "Бланки требуется разработать позже; сроки, объёмы, время, часть принимающих ролей общей отчётности и остальные направления не завершены.",
    next: "Уточнить контракт PRD.1.9/ENG.1.1, затем последовательно закрывать незавершённые карточки этой ветви, не переключаясь на запуск исполнителей." });
  const text = benchmarkRoadmap(data, ids);
  if (text.length > 50000) throw Error("Roadmap document too large; no history will be discarded");
  let next = root;
  const command = (c: ModelCommand) => { next = applyHypothesisCommand(next, "new-country", c, actor); };
  command({ type: "saveDocument", id: doc.id, title: benchmarkRoadmapTitle, text, url: doc.url, elementIds: doc.elementIds });
  command({ type: "saveOperatingModel", baseVersion: rev.version, data });
  return next;
}
