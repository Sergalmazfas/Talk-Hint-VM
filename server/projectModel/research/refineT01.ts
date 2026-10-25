import type { ProjectModelState } from "../../../shared/projectModel";
import { emptyWorkNode } from "../../../shared/operatingModelTemplate";
import { applyHypothesisCommand, readHypothesis } from "../hypotheses";
import { isDeepStrictEqual } from "node:util";

/** Approved structural correction, not research execution or agent activation. */
export function refineT01(root: ProjectModelState, actor: string): ProjectModelState {
  const old = readHypothesis(root, "new-country");
  const revision = old.operatingModel?.revisions.at(-1);
  if (!revision?.data.companyStructureVersion) throw new Error("Saved upper company structure required");
  const data = structuredClone(revision.data);
  const get = (id: string) => {
    const node = data.nodes.find(n => n.id === id);
    if (!node) throw new Error(`Required existing T01 object missing: ${id}`);
    return node;
  };
  const existing = data.nodes.find(n => n.id === "audience-research");
  if (existing) {
    if (existing.code !== "MKT.1" || get("search").parentId !== existing.id ||
        get("business-search").parentId !== existing.id || !data.nodes.some(n => n.id === "offer-decision-customer"))
      throw new Error("Existing research structure differs; reconcile rather than overwrite");
    return root;
  }
  if (data.nodes.some(n => ["MKT.1", "CLI.OFFER"].includes(n.code) || n.id === "offer-decision-customer"))
    throw new Error("Existing owner identity/code collision");
  const research = {
    ...emptyWorkNode("audience-research", "MKT.1", "Общее исследование аудитории: B2C и B2B", "process", "dir-market"),
    level: "operation" as const, detailState: "outlined" as const, workNature: "mixed" as const,
    purpose: "Исследовать аудиторию и потребности; передавать маркетингу и продукту потребности и сегменты с основаниями.",
    description: "Две соседние ветви: B2C и B2B. Это исследование, не привлечение и не подтверждённый спрос.",
    clientId: "dir-acquisition", recipientId: "dir-product", roleId: "head-market",
    inputs: [{ name: "Гипотеза, вопросы аудитории и разрешённые имеющиеся материалы", sourceId: "mission", freshness: "Актуальная версия с датой источника; период проверки предстоит определить" }],
    referenceIds: ["search", "business-search"],
    questions: "Состав результатов, критерии оснований, сроки актуальности, приёмка и ресурсы каждой ветви — следующий проход.",
    constraints: "Действия не детализированы заново; AI-сотрудники, внешние исследования и опросы не запускаются.",
    marketEffect: "Выявленная потребность и предложенный сегмент ещё не подтверждают спрос и готовность платить.",
  };
  data.nodes.push(research, {
    ...emptyWorkNode("offer-decision-customer", "CLI.OFFER", "Ответственный за продуктовое или маркетинговое решение", "client", "dir-market"),
    detailState: "outlined",
    description: "Клиент результата MKT.3. Конкретная ответственная должность для каждого решения ещё не выбрана.",
    questions: "Кто принимает конкретный вариант предложения и план проверки: продукт или маркетинг? Это нужно согласовать, не назначать автоматически.",
    constraints: "Запись клиента результата не создаёт должность, полномочия или автоматическое решение.",
  });
  const b2c = get("search");
  b2c.name = "Исследование аудитории и потребностей";
  b2c.purpose = "Исследовать потребности и сегменты частных пользователей с основаниями; не привлекать клиентов.";
  b2c.description = "Ветвь B2C общего исследования MKT.1. Существующие действия и их ID сохранены.";
  b2c.parentId = research.id;
  delete b2c.level;
  get("business-search").parentId = research.id;
  const audienceOutput = get("decision");
  audienceOutput.name = "Потребности и сегменты с основаниями";
  audienceOutput.parentId = research.id;
  audienceOutput.clientId = "dir-acquisition"; audienceOutput.recipientId = "dir-product";
  audienceOutput.description = "Согласованное описание требуемого общего результата B2C/B2B; не готовое исследование. Код B2C.R сохранён для совместимости.";
  audienceOutput.constraints = "Основания отделяются от предположений; фактические сегменты и спрос не выдуманы.";
  const benchmark = get("competitor-monitor"), benchmarkOutput = get("out-competitor-monitor");
  benchmark.clientId = "dir-acquisition"; benchmark.recipientId = "dir-product";
  benchmarkOutput.name = "Проверенные изменения и сравнение конкурентов";
  benchmarkOutput.clientId = "dir-acquisition"; benchmarkOutput.recipientId = "dir-product";
  benchmarkOutput.description = "Требуемый результат для маркетинга, продукта и финансов. Каждое изменение требует источника, даты и статуса проверки; готовность не заявляется.";
  const offer = get("offer-development"), offerOutput = get("out-offer-development");
  offer.clientId = "offer-decision-customer"; offer.recipientId = "offer-decision-customer";
  offerOutput.name = "Варианты предложения и план проверки";
  offerOutput.clientId = "offer-decision-customer"; offerOutput.recipientId = "offer-decision-customer";
  offerOutput.description = "Варианты и план для ответственного за продуктовое или маркетинговое решение, а не автоматически выбранное предложение.";
  offerOutput.questions = "Конкретный ответственный и критерии приёмки будут согласованы при разборе действий.";
  const link = (from: string, to: string, kind: "produces" | "handoff", reason: string) => {
    if (!data.links.some(l => l.from === from && l.to === to && l.kind === kind))
      data.links.push({ id: `t01:${kind}:${from}:${to}`, from, to, kind, reason });
  };
  link(research.id, audienceOutput.id, "produces", "Общий результат соседних ветвей B2C и B2B");
  link(research.id, "dir-report-market", "produces", "Основание сводного отчёта T01");
  for (const to of ["dir-acquisition", "dir-product"])
    link(audienceOutput.id, to, "handoff", "Клиент результата: маркетинг и продукт");
  for (const to of ["dir-acquisition", "dir-product", "dir-finance"])
    link(benchmarkOutput.id, to, "handoff", "Клиент результата бенчмаркинга; не передача подчинения");
  link(offerOutput.id, "offer-decision-customer", "handoff", "Ответственный за конкретное продуктовое или маркетинговое решение; назначение открыто");
  data.stageReports.push({
    pass: 1, described: "Уточнён T01: общая рамка исследования с соседними B2C/B2B и результаты трёх процессов с клиентами.",
    boundary: "Только структура и требуемые результаты. Подробные действия, навыки и полномочия пока не выводились.",
    dependencies: "Маркетинг и продукт получают потребности; маркетинг, продукт и финансы — сравнение; ответственный за решение — варианты и план.",
    gaps: "Критерии приёмки, источники и ресурсы, исполнители, сроки и конкретный ответственный за решение.",
    next: "Разобрать MKT.1 по цепочке: вход → исполнитель → ресурсы → результат → приёмка → передача. Затем MKT.2 и MKT.3.",
  });
  const next = applyHypothesisCommand(root, "new-country", { type: "saveOperatingModel", baseVersion: revision.version, data }, actor);
  const after = readHypothesis(next, "new-country");
  const strip = ({ operatingModel, revision, decisions, hypothesisContext, ...rest }: ProjectModelState) => rest;
  const stripRoot = ({ alternatives, revision, ...rest }: ProjectModelState) => rest;
  if (!isDeepStrictEqual(strip(old), strip(after)) || !isDeepStrictEqual(stripRoot(root), stripRoot(next)) ||
    !isDeepStrictEqual(old.operatingModel!.revisions, after.operatingModel!.revisions.slice(0, -1)) ||
    !isDeepStrictEqual(old.decisions, after.decisions.slice(0, -1)) ||
    !isDeepStrictEqual(root.alternatives?.filter(a => a.id !== "new-country"), next.alternatives?.filter(a => a.id !== "new-country")))
    throw new Error("T01 preservation guard failed");
  for (const node of revision.data.nodes) {
    if (!data.nodes.some(n => n.id === node.id && n.code === node.code)) throw new Error("Existing identity lost");
    if (!["search", "business-search", "decision", "competitor-monitor", "out-competitor-monitor", "offer-development", "out-offer-development"].includes(node.id) &&
      !isDeepStrictEqual(node, get(node.id))) throw new Error("Unrelated object changed");
  }
  if (!revision.data.links.every(l => data.links.some(after => isDeepStrictEqual(l, after))))
    throw new Error("Existing link lost");
  return next;
}
