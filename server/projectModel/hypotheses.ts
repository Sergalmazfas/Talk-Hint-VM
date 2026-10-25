import { randomUUID } from "node:crypto";
import { projectPackageBlocks, type ModelCommand, type ModelElement, type ProjectModelState } from "../../shared/projectModel";
import { applyCommand, ModelError } from "./domain";

export const originalHypothesisTitle = "TalkHint — AI-управляющий малого бизнеса с командой ролей";
export const newCountryHypothesisTitle = "TalkHint — помощник для жизни и малого бизнеса в новой стране";

export function readHypothesis(root: ProjectModelState, id = "original"): ProjectModelState {
  const selected = id === "original" ? root : root.alternatives?.find(item => item.id === id)?.model;
  if (!selected) throw new ModelError(404, "Гипотеза не найдена; другая модель не подставлена.");
  return {
    ...selected,
    // One owner-row revision protects concurrent changes in either alternative.
    revision: root.revision,
    hypothesisContext: {
      selectedId: id,
      options: [{ id: "original", title: originalHypothesisTitle },
        ...(root.alternatives ?? []).map(({ id, title }) => ({ id, title }))],
      primaryId: root.primaryHypothesisId ?? null,
    },
  };
}

export function applyHypothesisCommand(root: ProjectModelState, id: string,
  command: ModelCommand, actor: string): ProjectModelState {
  if (["saveCompetitor", "captureCompetitorQuarter", "saveTalkHintResearch"].includes(command.type) && id !== "new-country")
    throw new ModelError(409, "Новый справочник доступен только в отдельной гипотезе new-country; прежние исследования не изменены.");
  if (id === "original") return applyCommand(root, command, actor);
  const index = root.alternatives?.findIndex(item => item.id === id) ?? -1;
  if (index < 0) throw new ModelError(404, "Гипотеза не найдена.");
  const next = structuredClone(root);
  const alternative = next.alternatives![index];
  alternative.model = applyCommand(alternative.model, command, actor);
  next.revision++;
  if (JSON.stringify(next).length > 5_000_000)
    throw new ModelError(413, "Модель превысила допустимый размер.");
  return next;
}

/** Explicit Dev correction, never a startup migration or a synthetic recovery. */
export function splitProductHypotheses(root: ProjectModelState, actor: string,
  now = new Date().toISOString()): ProjectModelState {
  const current = root.elements.find(item => item.id === "TH-PRODUCT");
  const history = [...root.decisions].reverse().find(decision =>
    decision.before?.id === "TH-PRODUCT" &&
    decision.before.description.includes("AI-управляющий") &&
    decision.after?.id === "TH-PRODUCT" &&
    decision.after.description.includes("в новой стране"));
  if (!current || !history?.before || !history.after)
    throw new ModelError(409, "Исходная редакция «Продукта» не найдена в истории. Восстановление не выполнено.");
  if (root.alternatives?.some(item => item.id === "new-country")) {
    const { version: _v1, updatedAt: _t1, ...actual } = current;
    const { version: _v2, updatedAt: _t2, ...original } = history.before;
    if (JSON.stringify(actual) !== JSON.stringify(original))
      throw new ModelError(409, "Новая гипотеза уже существует, но исходный блок отличается. Автозамена запрещена.");
    return root;
  }
  if (current.version !== history.after.version ||
      JSON.stringify(current) !== JSON.stringify(history.after))
    throw new ModelError(409, "После прежней правки блок менялся; автоматическое восстановление остановлено.");
  if (projectPackageBlocks.some(block => !root.elements.some(element => element.id === block.id)))
    throw new ModelError(409, "Исходный пакет неполон; разделение остановлено.");

  const next = structuredClone(root);
  const restored = { ...structuredClone(history.before), version: current.version + 1, updatedAt: now };
  next.elements[next.elements.findIndex(item => item.id === "TH-PRODUCT")] = restored;
  const product: ModelElement = {
    ...structuredClone(history.after), version: 1, updatedAt: now, needsReview: false,
    contentStatus: "hypothesis", implementationStatus: "planned",
    description: history.after.description.replace("многоязычный AI-помощник", "многоязычная AI-помощница"),
    details: {
      ...history.after.details,
      provenance: "Отдельная альтернатива по уточнению владельца. Исходная гипотеза сохранена. Основная гипотеза не выбрана.",
      rules: "Целевая концепция, не заявление о готовности функций. WhatsApp — последующий этап. Команды маркетинговых ролей в этой гипотезе нет. Остальные девять разделов ещё не проработаны.",
      source: "Уточнённое согласованное поручение владельца: две сохранённые альтернативы вместо замены.",
    },
  };
  const model: ProjectModelState = {
    schema: 1, revision: 0,
    elements: projectPackageBlocks.map(block => block.id === "TH-PRODUCT" ? product : ({
      id: block.id, title: block.title, section: "Бизнес-модель", scope: "talkhint",
      kind: "context", description: "", contentStatus: "question",
      implementationStatus: "not_started", details: {}, version: 1, updatedAt: now, needsReview: false,
    })),
    relations: [], documents: [], proposals: [], taskDrafts: [],
    decisions: [{ id: `DEC-${randomUUID()}`, at: now, actor,
      action: "Создана отдельная гипотеза", reason: "Заполнен только «Продукт». Основная гипотеза не выбрана.",
      elementIds: ["TH-PRODUCT"], after: structuredClone(product) }],
  };
  next.alternatives = [...(next.alternatives ?? []), { id: "new-country", title: newCountryHypothesisTitle, model }];
  next.primaryHypothesisId = null;
  next.decisions.push({ id: `DEC-${randomUUID()}`, at: now, actor,
    action: "Восстановлена исходная гипотеза",
    reason: "Восстановлено содержание «Продукта» из истории. Другие девять блоков и исследования не изменены. Новая концепция сохранена отдельно.",
    elementIds: ["TH-PRODUCT"], before: structuredClone(current), after: structuredClone(restored) });
  next.revision++;
  return next;
}
