import { createHash } from "node:crypto";
import { z } from "zod";
import type { ModelCommand, ProjectModelState } from "../../shared/projectModel";
import { ModelError } from "../projectModel/modelError";

const txt = z.string().trim().min(1).max(1200);
const partySchema = z.object({ key: txt, roleId: z.string().max(120).nullable(),
  name: txt, planned: z.boolean(), result: txt }).strict();
const dutySchema = z.object({
  code: z.enum(["PRD.1", "PRD.2", "PRD.3", "PRD.4", "PRD.5"]),
  title: txt, does: txt, trigger: txt, result: txt,
  clientId: z.literal("owner"), acceptorId: z.literal("owner"),
}).strict();
export const mariaResponsibilitiesSchema = z.object({
  format: z.literal("talkhint.product-lead.responsibilities"),
  version: z.literal(1), roleId: z.literal("head-product"), managerId: z.literal("owner"),
  clients: z.array(partySchema).length(6), inputs: z.array(partySchema).length(7),
  duties: z.array(dutySchema).length(5),
  prohibitions: z.array(txt).length(6), urgentRule: txt,
  metrics: z.object({ plan: z.null(), fact: z.null(), planStatus: z.literal("не задан владельцем"),
    factStatus: z.literal("не измерено") }).strict(),
  acceptanceNote: txt,
}).strict().refine(p => new Set(p.duties.map(d => d.code)).size === 5, "Нужны все пять разных обязанностей");

/** Owner's requested description, never a scheduler, runtime prompt or role activation. */
export function mariaResponsibilities(roles: { id: string; code: string; managerId?: string | null }[],
  documents: { text: string }[] = []) {
  const actual = (code: string) => {
    const found = roles.filter(r => r.code === code);
    if (found.length !== 1) throw new ModelError(409, `Неоднозначная роль ${code}; ID не выдуман.`);
    return found[0].id;
  };
  const projects = [
    { key: "project_hint", roleId: actual("P.PRODUCT"), name: "Паша — руководитель проекта Hint", planned: false },
    ...["secretary", "copilot", "translator"].map(mode => {
      const matches = documents.flatMap(d => {
        try {
          const p = JSON.parse(d.text), id = p.visualPassport?.roleId;
          return p.mode === mode && roles.some(r => r.id === id && r.managerId === "head-product") ? [id] : [];
        } catch { return []; }
      });
      if (matches.length > 1) throw new ModelError(409, "Несколько руководителей одного проекта.");
      return { key: `project_${mode}`, roleId: matches[0] ?? null,
        name: `Будущий руководитель проекта ${mode === "secretary" ? "Секретарь" : mode === "copilot" ? "Copilot" : "Переводчик"}`,
        planned: !matches.length };
    }),
  ];
  const duties = [
    { code: "PRD.1", title: "Паспорт всего продукта",
      does: "Держит паспорт актуальным, видит Hint, Секретаря, Copilot и Переводчик целиком.",
      trigger: "Изменение целей, решений, функций или границ любого режима.",
      result: "Актуальная версия паспорта: рабочее, проверенное, планируемое и ограничения разделены." },
    { code: "PRD.2", title: "Приёмка и разбор бенчмарка",
      does: "Принимает все материалы P-BENCH, сортирует по продуктам, решает, что берём и что нет, записывает причины и передаёт руководителям проектов.",
      trigger: "Новый материал или уточнение P-BENCH; срочный продуктовый материал — без ожидания сводки.",
      result: "Версия материала, решение «берём / не берём» с причиной, продукт и следующий руководитель." },
    { code: "PRD.3", title: "Приоритеты проектов",
      does: "Ставит руководителям проектов задачи и порядок, не поручает напрямую Замирам, Фомам и другим исполнителям.",
      trigger: "Цель или решение владельца, принятая находка бенчмарка либо проблема продукта.",
      result: "Приоритет и задача соответствующему руководителю проекта, ожидаемый результат и проверка." },
    { code: "PRD.4", title: "Итоги лабораторий и команд",
      does: "Собирает итоги через руководителей проектов и выборочно контролирует результат по факту.",
      trigger: "Новый итог лаборатории или команды, заявленное улучшение либо противоречие.",
      result: "«Было → стало», доказательства, проблемы и следующий шаг; непроверенное явно отмечено." },
    { code: "PRD.5", title: "Сводка владельцу",
      does: "Коротко сообщает, что делают конкуренты, что берём и что нужно решить.",
      trigger: "Нужна контрольная точка или решение владельца; периодичность отдельно не установлена.",
      result: "Короткая продуктовая и конкурентная сводка, решения на «да/нет»." },
  ].map(d => ({ ...d, clientId: "owner", acceptorId: "owner" }));
  return mariaResponsibilitiesSchema.parse({
    format: "talkhint.product-lead.responsibilities", version: 1, roleId: "head-product", managerId: "owner",
    clients: [
      { key: "owner", roleId: "owner", name: "Владелец", planned: false,
        result: "Короткая сводка по продукту и конкурентам, решения на «да/нет»." },
      ...projects.map(p => ({ ...p, result: "Приоритеты и задачи своего проекта." })),
      { key: "hr", roleId: actual("P.ORG"), name: "Нина Кадрова", planned: false,
        result: "Уроки продукта для книжек знаний; это не включение урока." },
    ],
    inputs: [
      { key: "benchmark", roleId: actual("P-BENCH"), name: "P-BENCH — аналитик конкурентов", planned: false,
        result: "Все материалы бенчмарка; единственный принимающий материала — Мария." },
      ...projects.map(p => ({ ...p, result: "Итоги, «было → стало», проблемы своего проекта." })),
      { key: "duty", roleId: actual("P.OPS"), name: "Тихон — дежурный компании", planned: false,
        result: "Сбои, влияющие на продукт." },
      { key: "owner", roleId: "owner", name: "Владелец", planned: false, result: "Цели и решения." },
    ],
    duties,
    prohibitions: ["Не принимает свою же работу.",
      "Не ставит задачи исполнителям в обход руководителей проектов.",
      "Не включает агентов.", "Не тратит деньги.",
      "Не меняет личность сотрудников и промпты: это владелец и отдел кадров по утверждённым правилам.",
      "Не публикует."],
    urgentRule: "Срочное по одному продукту: P-BENCH отправляет Марии и копию руководителю проекта. Копия не приёмка; решение за Марией.",
    metrics: { plan: null, fact: null, planStatus: "не задан владельцем", factStatus: "не измерено" },
    acceptanceNote: "Заказчик и принимающий собственных пяти обязанностей Марии — владелец, которому она подчиняется. Мария принимает вход P-BENCH, а не собственный результат. Это описание контроля, не авто-приёмка и не требование владельцу подтверждать каждое обычное действие.",
  });
}

export function mariaProfileCommands(state: ProjectModelState, a: {
  sourceVersion: number; profileHash: string;
}): { commands: ModelCommand[]; roleId: string; targetId: string } {
  const role = state.operatingModel!.revisions.at(-1)!.data.nodes.find(n => n.id === "head-product" && n.kind === "role");
  if (!role || role.code !== "HEAD.06" || role.managerId !== "owner")
    throw new ModelError(409, "Нужна существующая Мария HEAD.06 под владельцем.");
  const source = state.elements.find(e => e.coordination?.kind === "role_passport" && e.coordination.roleId === role.id);
  const doc = state.documents.find(d => d.id === "DOC-TEAM-HEAD06");
  if (!source || source.version !== a.sourceVersion || !doc ||
      createHash("sha256").update(doc.text).digest("hex") !== a.profileHash)
    throw new ModelError(409, "Паспорт или основная анкета изменились; перечитайте обе версии.");
  let responsibilities: z.infer<typeof mariaResponsibilitiesSchema>, p: any;
  try { responsibilities = mariaResponsibilitiesSchema.parse(JSON.parse(source.details.procedure ?? ""));
    p = JSON.parse(doc.text); } catch { throw new ModelError(409, "Нет полного структурированного паспорта Марии."); }
  if (p.visualPassport?.roleId !== role.id || !Number.isSafeInteger(p.version) || p.version < 1)
    throw new ModelError(409, "Формат основной анкеты Марии не подтверждён.");
  // Re-resolve current IDs and require the same owner-requested definition:
  // stale references and invented future employee IDs never enter the profile.
  const expected = mariaResponsibilities(state.operatingModel!.revisions.at(-1)!.data.nodes.filter(n => n.kind === "role"), state.documents);
  if (JSON.stringify(responsibilities) !== JSON.stringify(expected))
    throw new ModelError(409, "Описание отличается от текущего согласованного состава; нужна новая сверка.");
  p.version++; p.productResponsibilities = responsibilities;
  p.productResponsibilitiesSource = { recordId: source.id, version: source.version };
  // Do not replace personality, existing prompt, permissions, portrait or graph.
  return { commands: [{ type: "saveDocument", id: doc.id, title: doc.title,
    text: JSON.stringify(p, null, 2), url: doc.url, elementIds: doc.elementIds }],
    roleId: role.id, targetId: doc.id };
}
