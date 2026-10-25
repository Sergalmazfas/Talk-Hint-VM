import type { ProjectModelState } from "../../../shared/projectModel";
import { applyHypothesisCommand, readHypothesis } from "../hypotheses";
import { isDeepStrictEqual } from "node:util";

const standard = `Стандарт результата MKT.1 — «Потребности и сегменты с основаниями»

Назначение: дать маркетингу и продукту материал для выбора аудитории, предложения и следующей проверки. Это состав требуемого результата, не проведённое исследование.

1. Сегмент
Кто эти люди или компании; география, язык, ситуация; критерии включения и исключения.

2. Задача клиента
Что человек хочет сделать, в какой ситуации и какого результата ожидает.

3. Проблема
Что мешает, как часто возникает и какие последствия имеет.

4. Нынешнее решение
Как справляется сейчас, какими альтернативами пользуется, что его не устраивает.

5. Основания
Источники, даты, наблюдения, результаты интервью или тестов; ограничения и противоречия. Непроведённые интервью и тесты не считаются основаниями.

6. Связь с TalkHint
Чем можем помочь; какие возможности уже есть, какие только предполагаются. Готовность возможностей требует проверки, целевая концепция не равна работающей функции.

7. Неизвестное
Что ещё нужно проверить, включая готовность пользоваться и платить.

8. Предложение следующей проверки
Какой вопрос проверяем, каким способом и какой результат поможет принять решение. Предложение проверки не разрешает её запуск.`;
const acceptance = "Источники прослеживаются; факты отделены от предположений; сегмент достаточно конкретен; неизвестное явно обозначено. Отчёт может быть принят и при недостатке доказательств, если честно показывает пробел и предлагает способ проверки. Принятие отчёта не означает доказанность гипотезы, спроса или готовности платить.";
const separation = "Единый стандарт для B2C и B2B; материалы и выводы заполняются отдельно, без смешивания ветвей. Для B2B дополнительно различать пользователя, покупателя и принимающего решение. Пока сохраняется только стандарт; заполненные исследования, интервью, тесты и новые полномочия не создаются.";
const delivery = "Маркетингу — кого искать, в каких ситуациях и какое предложение проверять.\nПродукту — какую задачу решать, какие ограничения учитывать и как измерить пользу.\nНа стратегическое рассмотрение — выводы, которые могут изменить выбранного клиента или гипотезу компании. Только рассмотрение через существующий механизм решений, без автоматической смены стратегии.";

/** Store one agreed specification on the existing result, not duplicate B2C/B2B templates. */
export function defineMkt1Result(root: ProjectModelState, actor: string): ProjectModelState {
  const before = readHypothesis(root, "new-country");
  const previous = before.operatingModel?.revisions.at(-1);
  if (!previous) throw new Error("Saved operating model required");
  const data = structuredClone(previous.data);
  const result = data.nodes.find(n => n.id === "decision");
  const process = data.nodes.find(n => n.id === "audience-research");
  if (!result || !process || result.parentId !== process.id) throw new Error("Corrected MKT.1 structure required");
  if (result.description.startsWith("Стандарт результата MKT.1")) return root;
  if (result.description !== "Согласованное описание требуемого общего результата B2C/B2B; не готовое исследование. Код B2C.R сохранён для совместимости.")
    throw new Error("Result has owner edits; reconcile rather than overwrite");
  Object.assign(result, {
    description: standard, rules: separation, success: acceptance, delivery,
    purpose: "Материал для выбора аудитории, предложения и следующей проверки маркетингом и продуктом.",
    detailState: "described",
    questions: "Фактические материалы B2C и B2B ещё не заполнены. Конкретные источники, исполнители, ресурсы, сроки и процедура приёмки определяются при разборе действий.",
  });
  process.questions = "Состав результата и общие критерии приёмки согласованы в существующей карточке B2C.R. Следом: действия, отдельные исполнители, источники, ресурсы, сроки и процедура приёмки; обязанности, навыки и полномочия выводятся из действий.";
  const feedback = { id: "mkt1:result:strategy-review", from: result.id, to: "strategy-review", kind: "feedback" as const,
    reason: "Условно: вывод может изменить выбранного клиента или гипотезу компании; передать на рассмотрение, не менять автоматически." };
  if (!data.links.some(l => l.from === feedback.from && l.to === feedback.to && l.kind === feedback.kind)) data.links.push(feedback);
  data.stageReports.push({
    pass: 1, described: "Согласован единый восьмичастный стандарт результата MKT.1, разделение B2C/B2B, приёмка и адресная передача.",
    boundary: "Описан стандарт, не заполненное исследование. Действия и должности ещё не декомпозированы; сотрудники не запущены.",
    dependencies: "Маркетинг, продукт и при необходимости стратегическое рассмотрение; общий формат без смешивания материалов.",
    gaps: "Источники, отдельные исполнители, ресурсы и процедура приёмки каждого будущего действия.",
    next: "Разложить производство результата на действия: вход → исполнитель → ресурсы → результат → приёмка → передача. Затем вывести обязанности, навыки и полномочия.",
  });
  const next = applyHypothesisCommand(root, "new-country", { type: "saveOperatingModel", baseVersion: previous.version, data }, actor);
  const after = readHypothesis(next, "new-country");
  const strip = ({ operatingModel, revision, decisions, hypothesisContext, ...rest }: ProjectModelState) => rest;
  const stripRoot = ({ alternatives, revision, ...rest }: ProjectModelState) => rest;
  if (!isDeepStrictEqual(strip(before), strip(after)) || !isDeepStrictEqual(stripRoot(root), stripRoot(next)) ||
      !isDeepStrictEqual(before.operatingModel!.revisions, after.operatingModel!.revisions.slice(0, -1)) ||
      !isDeepStrictEqual(before.decisions, after.decisions.slice(0, -1)) ||
      !isDeepStrictEqual(root.alternatives?.filter(a => a.id !== "new-country"), next.alternatives?.filter(a => a.id !== "new-country")))
    throw new Error("Result specification preservation guard failed");
  for (const n of previous.data.nodes)
    if (!["decision", "audience-research"].includes(n.id) && !isDeepStrictEqual(n, data.nodes.find(row => row.id === n.id)))
      throw new Error("Unrelated operating object changed");
  if (data.nodes.length !== previous.data.nodes.length || !previous.data.links.every(l => data.links.some(row => isDeepStrictEqual(row, l))))
    throw new Error("Existing identity or link lost");
  return next;
}
