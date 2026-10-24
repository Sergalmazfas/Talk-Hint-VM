import { isDeepStrictEqual } from "node:util";
import { pilotBenchmarkSteps, type ElementInput, type ModelCommand, type ModelElement, type ProjectModelState } from "../../shared/projectModel";
import { applyCommand } from "./domain";
import { pilotCompetitor, pilotDecisionDate, pilotElement, pilotSegment, pilotSource, pilotSources, pilotValue } from "./pilotContent";
import { pilotAssessment, pilotFindings } from "./pilotAssessments";

export const pilotMarker = "Решение владельца 23.10.2026 · пилот независимых массажистов · основные конкуренты";
export function inputOf(e: ModelElement): ElementInput {
  const { id, version, needsReview, updatedAt, ...input } = e; return input;
}
export function findPilotCompetitor(state: ProjectModelState, key: "massagebook" | "clinicsense") {
  const matches = state.elements.filter(e => e.scope === "talkhint" && (e.details.benchmarkType === "competitor" || (e.kind === "research" && !e.details.benchmarkType)) && (
    e.title.toLowerCase().replace(/[\s-]/g, "").includes(key) ||
    (e.details.benchmarkSubject ?? "").replace(/-/g, "").toLowerCase() === key ||
    (e.details.source ?? "").includes(key === "massagebook" ? "pro.massagebook.com/" : "clinicsense.com/")));
  if (matches.length > 1) throw new Error("Multiple existing competitor cards match; resolve explicitly without deleting");
  return matches[0];
}
export function assertPilotPreservation(before: ProjectModelState, after: ProjectModelState) {
  for (const kind of ["elements", "relations", "documents", "proposals", "decisions", "taskDrafts"] as const)
    for (const record of before[kind]) if (!after[kind].some(e => e.id === record.id)) throw new Error(`Lost existing ${kind} ID`);
  if (!isDeepStrictEqual(after.decisions.slice(0, before.decisions.length), before.decisions)) throw new Error("Existing decision history changed");
  for (const doc of before.documents) if (!after.documents.find(d => d.id === doc.id)!.text.includes(doc.text)) throw new Error("Existing source/document text lost");
  for (const old of before.elements.filter(e => e.scope === "salon_example" || (e.details.benchmarkType === "assessment" && e.details.benchmarkSuite !== "pilot"))) {
    const current = after.elements.find(e => e.id === old.id)!;
    if (!isDeepStrictEqual(inputOf(current), inputOf(old))) throw new Error("Existing example/benchmark assessment changed");
  }
}
export function applyPilotUpdate(before: ProjectModelState, owner: string): ProjectModelState {
  if (before.documents.some(d => d.title === pilotMarker)) return before;
  if (!before.elements.some(e => e.id === "TH-SEGMENT")) throw new Error("Existing project model required");
  let state = before;
  const recheckedAt = new Date().toISOString().slice(0, 10);
  const command = (c: ModelCommand) => { state = applyCommand(state, c, owner); };
  function put(id: string, input: ElementInput) {
    const old = state.elements.find(e => e.id === id);
    const next = old ? { ...inputOf(old), ...input, details: { ...old.details, ...input.details } } : input;
    if (!old) command({ type: "createElement", id, element: { ...next, contentStatus: next.contentStatus === "confirmed" ? "proposal" : next.contentStatus } });
    if (next.contentStatus === "confirmed" || old?.contentStatus === "confirmed") {
      command({ type: "saveProposal", targetId: id, source: pilotSource,
        rationale: "Явное поручение владельца; дата бизнес-решения 23.10.2026 сохранена отдельно от фактического времени внесения. Не доказательство прибыли/превосходства/готовности.", relatedIds: [], change: next });
      command({ type: "approveProposal", id: state.proposals.at(-1)!.id });
    } else if (old) command({ type: "saveElement", id, element: next });
  }
  const link = (from: string, to: string, label: string) => {
    if (!state.relations.some(r => r.from === from && r.to === to && r.label === label))
      command({ type: "saveRelation", from, to, label });
  };
  put("TH-SEGMENT", pilotElement("Первый сегмент — пилот", "Бизнес-модель", pilotSegment, {
    decisionDate: pilotDecisionDate, region: "Miami-Dade / Broward / Palm Beach, Южная Флорида, США",
    buyer: "Независимый лицензированный массажист с собственной небольшой практикой, без администратора",
    segment: pilotSegment, alternatives: "MassageBook и ClinicSense — основные конкуренты стартового сегмента",
    rules: "Выбор сегмента для проверки; не доказательство прибыльности/отсутствия конкуренции. Не наследовать вымышленный салон, столы, штат, аренду или формулу цены.",
    evidence: pilotSource, unknown: "Готовность платить, привлечение, удержание и себестоимость TalkHint неизвестны.",
  }, "confirmed", "context"));
  put("TH-PILOT-DECISION", pilotElement("Подтверждённое решение владельца: сегмент пилота", "История решений", pilotSegment, {
    decisionDate: pilotDecisionDate, evidence: pilotSource,
    rules: "Широкое видение AI-управляющего/Crew сохраняется. Старые сегменты, конкуренты, исследования и история не удаляются.",
  }, "confirmed", "rule"));
  put("TH-PILOT-VALUE", pilotElement("Гипотеза ценности частной практики", "Бизнес-модель", pilotValue, {
    hypothesis: "Возможное отличие — меньше настройки и времени владельца на управление. Не доказанное преимущество.",
    metrics: "Замер времени подключения/владельца, TCO и фактических результатов на одинаковых сценариях", unknown: "Нет практического подтверждения выигрыша" }));
  put("TH-MBLEX-CHANNEL", pilotElement("MBLEx — потенциальный канал доступа к аудитории", "Бизнес-модель", "MBLEx — потенциальный канал, не готовая подтверждённая база покупателей.", {
    acquisition: "Проверить возможность и законный способ доступа к целевой аудитории", unknown: "Соответствие собственной практике/лицензии, согласия, конверсия и стоимость привлечения не установлены",
  }));
  put("TH-PILOT-UNKNOWNS", pilotElement("Неизвестные экономики и спроса пилота", "Экономика", "Готовность платить, привлечение, удержание и себестоимость TalkHint остаются неизвестными.", {
    unknown: "Нет утверждённого тарифа/прогноза, доказанного CAC/retention/unit cost или гарантии прибыльности.",
    hypothesis: "Меньше настройки и времени владельца — проверяемая гипотеза, не результат.", decisionDate: pilotDecisionDate,
  }, "question", "research"));

  // Change relationship meaning without deleting any old edge or its history.
  for (const r of state.relations.filter(r => r.to === "TH-SEGMENT" || r.from === "TH-SEGMENT")) {
    let label = r.label;
    if (r.from === "TH-CLIENT" && r.to === "TH-SEGMENT") label = "Подтверждённый сегмент пилота; остальные кандидаты сохранены";
    if (r.to === "TH-CLEANING-VALUE") label = "Сохранённая гипотеза другого сегмента, не текущий пилот";
    if (r.to.startsWith("SALON-")) label = "Независимый иллюстративный клиент, НЕ параметры и не основание выбора пилота";
    if (label !== r.label) command({ type: "saveRelation", id: r.id, from: r.from, to: r.to, label });
  }
  const companies: Record<string, { id: string; subject: string }> = {};
  for (const key of ["massagebook", "clinicsense"] as const) {
    const existing = findPilotCompetitor(state, key);
    const id = existing?.id ?? `COMP-${key.toUpperCase()}`;
    const desired = pilotCompetitor(key);
    const subject = existing?.details.benchmarkSubject || key;
    desired.details.benchmarkSubject = subject;
    desired.details.recheckedAt = recheckedAt;
    if (existing?.details.source) desired.details.source = Array.from(new Set([...existing.details.source.split("\n"), ...desired.details.source!.split("\n")])).join("\n");
    if (existing?.details.unknown) desired.details.unknown = `${existing.details.unknown}\nДополнение пилота: ${desired.details.unknown}`;
    put(id, desired);
    companies[key] = { id, subject };
  }
  for (const e of state.elements.filter(e => e.details.benchmarkType === "competitor" && !Object.values(companies).some(c => c.id === e.id))) {
    const wellness = /mangomint|mira|vagaro|vera|mindbody/i.test(`${e.title} ${e.details.benchmarkSubject ?? ""}`);
    put(e.id, { ...inputOf(e), details: { ...e.details, competitorPriority: wellness ? "adjacent-wellness" : "general",
      prioritySegmentId: "TH-SEGMENT", decisionDate: pilotDecisionDate } });
  }
  const req = "REQ-PILOT-COMPARE";
  put(req, { ...pilotElement("Проверить пилот: TalkHint / MassageBook / ClinicSense", "Задания Replit",
    "Одинаковые 8 сценариев; отдельные замеры времени подключения, времени владельца, полной стоимости и реальных результатов.",
    { acceptance: "Настройка практики; обращение; согласование/запись; напоминание/перенос; оплата; повторная запись; голосовое поручение; отчёт владельцу. Одинаковые синтетические данные и объём. Фиксировать время, ручные шаги, план/лимиты/доплаты, результат/ошибки. Практические испытания не проводились. Реальные звонки/отправки/оплаты/подключения требуют отдельного разрешения.",
      benchmarkSuite: "pilot", unknown: "Willingness-to-pay, привлечение, удержание и себестоимость TalkHint неизвестны.",
    }, "confirmed", "requirement"), implementationStatus: "planned" });
  link("TH-PILOT-DECISION", "TH-SEGMENT", "Решение владельца от 23.10.2026");
  link("TH-PILOT-VALUE", "TH-SEGMENT", "Гипотеза ценности выбранного сегмента");
  link("TH-MBLEX-CHANNEL", "TH-SEGMENT", "Потенциальный канал, не база покупателей");
  link(req, "TH-SEGMENT", "Одинаковые критерии практической проверки");
  link("TH-PILOT-UNKNOWNS", req, "Необходимые замеры вместо обещаний");
  for (const key of ["massagebook", "clinicsense"] as const) {
    link("TH-SEGMENT", companies[key].id, "Основной конкурент стартового сегмента");
    link("BM-METHOD", companies[key].id, "Сохранён в общем бенчмаркинге");
    link(companies[key].id, req, "Проверка по одинаковым сценариям");
  }
  for (const rawSubject of Object.keys(pilotFindings) as Array<keyof typeof pilotFindings>) {
    const subject = rawSubject === "talkhint" ? "talkhint" : companies[rawSubject].subject;
    for (const step of Object.keys(pilotBenchmarkSteps) as Array<keyof typeof pilotBenchmarkSteps>) {
      const existing = state.elements.find(e => e.details.benchmarkType === "assessment" && e.details.benchmarkSuite === "pilot" && e.details.benchmarkSubject === subject && e.details.benchmarkStep === step);
      const id = existing?.id ?? `PILOT-${rawSubject.toUpperCase()}-${step.toUpperCase()}`;
      const value = pilotAssessment(rawSubject, step, subject); value.details.recheckedAt = recheckedAt;
      put(id, value);
      link(rawSubject === "talkhint" ? "TH-PRODUCT" : companies[rawSubject].id, id, "Пилот: документальное основание, не практический результат");
      link(id, req, "Нужны одинаковые практические замеры");
    }
  }
  for (const source of pilotSources) {
    const ids = [companies[source.key].id, ...state.elements.filter(e => e.details.benchmarkSuite === "pilot" && e.details.benchmarkSubject === companies[source.key].subject).map(e => e.id)];
    const old = state.documents.find(d => d.url === source.url);
    const text = `Документальная проверка: 23.10.2026 (дата материалов владельца). Повторное чтение: ${recheckedAt}.\n${source.summary}\nПрактические испытания не проводились. AI/тарифы/лимиты/подключения требуют отдельной проверки.`;
    command({ type: "saveDocument", ...(old ? { id: old.id } : {}), title: old?.title || source.title, url: source.url,
      text: old ? `${old.text}\n\nДополнение пилота:\n${text}` : text, elementIds: Array.from(new Set([...(old?.elementIds ?? []), ...ids])) });
  }
  command({ type: "reviewElement", id: req, reason: "Подтверждён только объём будущей проверки. Ни один сценарий не испытан практически." });
  command({ type: "prepareTask", title: "Пилот частной практики — сопоставимые проверки", elementIds: [req], acceptance: state.elements.find(e => e.id === req)!.details.acceptance! });
  command({ type: "saveDocument", title: pilotMarker, url: "/admin/project-model?view=benchmark&suite=pilot&filter=primary",
    text: `${pilotSource}\nДата решения: ${pilotDecisionDate}; время внесения — фактическая дата истории, не задним числом.\n${pilotSegment}\n${pilotValue}\nТолько гипотеза: меньше настройки и времени владельца. MBLEx — потенциальный канал, не база покупателей. Готовность платить, привлечение, удержание, себестоимость неизвестны. Салон с двумя столами/четырьмя мастерами/$20 остаётся отдельным примером.\nШирокое видение управляющего/Crew сохраняется. Все предыдущие конкуренты, источники, исследования и история сохранены.`,
    elementIds: ["TH-SEGMENT", "TH-PILOT-DECISION", "TH-PILOT-VALUE", "TH-MBLEX-CHANNEL", "TH-PILOT-UNKNOWNS", ...Object.values(companies).map(c => c.id)] });
  assertPilotPreservation(before, state);
  return state;
}
