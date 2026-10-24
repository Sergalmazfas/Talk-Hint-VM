import { isDeepStrictEqual } from "node:util";
import type { ElementInput, ModelCommand, ProjectModelState } from "../../shared/projectModel";
import { applyCommand } from "./domain";
import { findPilotCompetitor, inputOf } from "./pilotUpdate";
import { packageElements, packageSources, packageSource, axes, difference, validation } from "./packageContent";
import { marketPackageElements } from "./packageMarket";
import { clinicSensePricing, massageBookPricing, priceEvidence } from "./packagePricing";
import { differenceAssessments } from "./packageAssessments";
export const packageMarker = "Согласованный пакет TalkHint · удобство и доход после расходов · 24.10.2026";

export function assertPackagePreservation(before: ProjectModelState, after: ProjectModelState) {
  for (const collection of ["elements", "documents", "relations", "proposals", "decisions", "taskDrafts"] as const)
    for (const record of before[collection]) if (!after[collection].some(r => r.id === record.id)) throw new Error(`Existing ${collection} lost`);
  if (!isDeepStrictEqual(after.decisions.slice(0, before.decisions.length), before.decisions)) throw new Error("Prior history changed");
  for (const doc of before.documents)
    if (!after.documents.find(d => d.id === doc.id)!.text.includes(doc.text)) throw new Error("Prior document text lost");
  for (const element of before.elements.filter(e => e.scope === "salon_example" || e.details.benchmarkType === "assessment")) {
    if (!isDeepStrictEqual(inputOf(after.elements.find(e => e.id === element.id)!), inputOf(element))) throw new Error("Old example/benchmark changed");
  }
}
export function applyProjectPackage(before: ProjectModelState, owner: string) {
  if (before.documents.some(d => d.title === packageMarker)) return before;
  const mb = findPilotCompetitor(before, "massagebook"), cs = findPilotCompetitor(before, "clinicsense");
  if (!mb || !cs || !before.elements.some(e => e.id === "TH-SEGMENT")) throw new Error("Existing pilot model required");
  let state = before;
  const command = (c: ModelCommand) => { state = applyCommand(state, c, owner); };
  function put(id: string, input: ElementInput) {
    const old = state.elements.find(e => e.id === id);
    const change = old ? { ...inputOf(old), ...input, implementationStatus: old.implementationStatus, details: { ...old.details, ...input.details } } : input;
    if (!old) command({ type: "createElement", id, element: { ...change, contentStatus: change.contentStatus === "confirmed" ? "proposal" : change.contentStatus } });
    if (change.contentStatus === "confirmed" || old?.contentStatus === "confirmed") {
      command({ type: "saveProposal", targetId: id, source: packageSource, rationale: "Владелец согласовал пакет/исправление. Согласование содержания не означает реализацию, интервью, испытания или доказанное преимущество.", relatedIds: [], change });
      command({ type: "approveProposal", id: state.proposals.at(-1)!.id });
    } else if (old) command({ type: "saveElement", id, element: change });
  }
  const link = (from: string, to: string, label: string) => {
    if (!state.relations.some(r => r.from === from && r.to === to && r.label === label)) command({ type: "saveRelation", from, to, label });
  };
  [...packageElements, ...marketPackageElements].forEach(({ id, input }) => put(id, input));
  const oldUnknown = state.elements.find(e => e.id === "TH-PILOT-UNKNOWNS");
  if (oldUnknown) put(oldUnknown.id, { ...inputOf(oldUnknown), details: { ...oldUnknown.details, hypothesis: axes, provenance: packageSource } });
  // Preserve the exact approved offer and the 23 October pilot decision unchanged.
  for (const company of [mb, cs]) {
    const key = company.id === mb.id ? "massagebook" : "clinicsense";
    put(company.id, { ...inputOf(company), details: { ...company.details,
      source: Array.from(new Set([...(company.details.source || "").split("\n"), ...packageSources.filter(s => s.key === key).map(s => s.url)])).filter(Boolean).join("\n"),
      pricing: key === "massagebook" ? massageBookPricing : clinicSensePricing,
      comparison: `[Подтверждено описаниями] Маркетинг, возвраты, документы, запись и оплаты уже есть.\n[Гипотеза TalkHint] ${difference}\n[Не установлено] Полная цепочка монтажа исходного видео, встроенного ведения платной Meta-рекламы и связи расходов с оплаченной записью через единый разговор в изученных материалах не найдена; отсутствие не доказано.\n[Требует практического теста] ${axes}`,
      contentEditing: "В изученных материалах не установлено, отсутствие не доказано.",
      paidAdvertising: "Book Now и инструкции Ads Manager описаны; они не доказывают встроенное управление платной рекламой.",
      attribution: "Сквозная связь расходов с оплаченной записью/повторами через один разговор не установлена; ROI не измерен.",
      convenience: "Не измерено", netIncome: "Не измерено", measurement: validation,
      unknown: "Нет практических испытаний, измерений удобства/дохода после расходов и полного TCO. AI/подключения не установлены. Для MassageBook остаётся ценовое противоречие; для ClinicSense опубликованные помесячные условия сохранены отдельно от комиссий/annual.",
      proofStatus: "Описанные функции/условия опубликованы; полная гипотеза отличия и результаты не установлены",
      provenance: packageSource, recheckedAt: "2026-10-24",
    } });
  }
  const subjects = { massagebook: mb.details.benchmarkSubject || "massagebook", clinicsense: cs.details.benchmarkSubject || "clinicsense" };
  const assessments = differenceAssessments(subjects);
  for (const row of [...priceEvidence, ...assessments]) {
    const input = { ...row.input, details: { ...row.input.details } };
    const canonicalSubject = input.details.benchmarkSubject as keyof typeof subjects;
    if (canonicalSubject in subjects) input.details.benchmarkSubject = subjects[canonicalSubject];
    put(row.id, input);
  }
  const relations = [
    ["TH-CLIENT", "TH-PROBLEM", "Клиент → гипотеза боли, интервью нужны"],
    ["TH-PROBLEM", "TH-PILOT-VALUE", "Боль → ценность"],
    ["TH-PILOT-VALUE", "TH-PRODUCT", "Ценность → целевая функция, не готовность"],
    ["TH-PRODUCT", "TH-DIFFERENTIATION", "Функция → гипотеза сравнения"],
    ["TH-DIFFERENTIATION", "TH-CONTENT-PIPELINE", "Целевой процесс, не запуск"],
    ["TH-DIFFERENTIATION", "TH-POSITIONING", "Две оси без рейтингов"],
    ["TH-DIFFERENTIATION", "TH-VALIDATION", "Необходимые проверки"],
    ["TH-SEGMENT", "TH-PILOT-COMPETITORS", "Основные конкуренты сегмента"],
    ["TH-PILOT-COMPETITORS", mb.id, "Сохранённая карточка конкурента"],
    ["TH-PILOT-COMPETITORS", cs.id, "Сохранённая карточка конкурента"],
    ["TH-MARKET", "TH-SEGMENT", "Выбранный пилот"],
    ["TH-SEGMENT", "TH-SAM-SOM", "Отдельный расчёт покупателей"],
    ["TH-SAM-SOM", "TH-TAM", "Все подходящие практики США"],
    ["TH-SAM-SOM", "TH-SAM", "Обслуживаемая часть"],
    ["TH-SAM-SOM", "TH-SOM", "Воронка/удержание/возможности подключения"],
    ["TH-SOM", "TH-ACQUISITION", "Требуются наблюдения конверсий"],
    ["TH-ECONOMICS", "TH-POSITIONING", "Денежный эффект не равен удобству"],
    ["TH-TEAM", "TH-CONTENT-PIPELINE", "Разделение обязанностей и согласований"],
  ];
  relations.forEach(([from, to, label]) => link(from, to, label));
  for (const row of priceEvidence) {
    link(row.input.details.benchmarkSubject === "massagebook" ? mb.id : cs.id, row.id, "Опубликованный план с условиями, не полный TCO");
    link(row.id, "TH-ECONOMICS", "Сопоставлять полную стоимость, не только подписку");
  }
  for (const row of assessments) {
    const subject = row.input.details.benchmarkSubject;
    link(subject === "talkhint" ? "TH-PRODUCT" : subject === subjects.massagebook ? mb.id : cs.id, row.id, "Конкретный шаг сравнения");
    link(row.id, "TH-DIFFERENTIATION", "Документальное основание гипотезы, не преимущество");
    link(row.id, "TH-VALIDATION", "Нужна практическая проверка");
  }
  for (const source of packageSources) {
    const subject = subjects[source.key], companyId = source.key === "massagebook" ? mb.id : cs.id;
    const relatedIds = [companyId, "TH-DIFFERENTIATION", "TH-VALIDATION", ...assessments.filter(r => r.input.details.benchmarkSubject === subject).map(r => r.id)];
    if (source.url.endsWith("/pricing")) relatedIds.push(...priceEvidence.filter(p => p.input.details.benchmarkSubject === source.key).map(p => p.id));
    const existing = state.documents.find(d => d.url === source.url);
    const text = `Пакет: документальные материалы 23.10.2026; повторное чтение 24.10.2026.\n${source.text}\nПрактически не испытано. Не найдено не означает отсутствия; маркетинговый материал поставщика не независимый результат.`;
    command({ type: "saveDocument", ...(existing ? { id: existing.id } : {}), title: existing?.title || source.title, url: source.url,
      text: existing ? `${existing.text}\n\nДополнение согласованного пакета:\n${text}` : text,
      elementIds: Array.from(new Set([...(existing?.elementIds || []), ...relatedIds])) });
  }
  command({ type: "saveDocument", title: packageMarker, url: "/admin/project-model?view=overview",
    text: `${packageSource}\nИсправление владельца: «Мы не делаем меньше участия владельца, мы делаем удобный инструмент. Это разные вещи».\n${axes}\n10 кратких блоков; отдельные страницы сегмента, TAM/SAM/SOM и гипотезы отличия. Никаких запусков. Старые формулировки остаются историей, не текущей целью. Точный оффер и решение о пилоте от 23.10 сохранены. ChatGPT-интеграция модели — следующий этап.`,
    elementIds: [...packageElements, ...marketPackageElements].map(e => e.id) });
  assertPackagePreservation(before, state);
  return state;
}
