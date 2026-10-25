import { archiveModel, ensureModelHistory, unpackModel } from "./history";
/**
 * Explicit, one-off OWNER-APPROVED Dev content import. Not called at server boot.
 * No provider, telephone, calendar or notification transports.
 */
import type { Pool } from "pg";
import { isDeepStrictEqual } from "node:util";
import type { ModelCommand, ProjectModelState } from "../../shared/projectModel";
import { applyCommand } from "./domain";
import { initialModel } from "./seed";
import { discussionElements, competitorElements, marketElements, ownerSource, type MaterialElement } from "./materialContent";
import { benchmarkElements, benchmarkRequirements } from "./benchmarkContent";
import { materialSources, researchDate, recheckedAt } from "./materialSources";

export const materialMarker = "Материалы обсуждения и benchmark · 23.10.2026 · согласованный импорт";
export const approvedMaterial = [...discussionElements, ...competitorElements, ...marketElements, ...benchmarkElements, ...benchmarkRequirements];
export function applyApprovedMaterial(initial: ProjectModelState, owner: string) {
  if (initial.documents.some(d => d.title === materialMarker)) return initial;
  let s = initial;
  const command = (c: ModelCommand) => { s = applyCommand(s, c, owner); };
  function put({ id, input, approved }: MaterialElement) {
    const existing = s.elements.find(e => e.id === id);
    const draft = { ...input, contentStatus: approved ? "proposal" as const : input.contentStatus };
    if (!existing) command({ type: "createElement", id, element: draft });
    else if (!discussionElements.some(e => e.id === id)) throw new Error("Stable material ID already exists without import marker; manual review required.");
    if (approved || existing?.contentStatus === "confirmed") {
      command({ type: "saveProposal", targetId: id, source: input.details.provenance || ownerSource,
        rationale: approved
          ? "Владелец поручил сохранить согласованное решение / документальное наблюдение. Подтверждение не означает реализацию или практический тест."
          : "Владелец уточнил границы; рыночная/финансовая гипотеза остаётся гипотезой, не фактом.",
        relatedIds: [], change: input });
      command({ type: "approveProposal", id: s.proposals.at(-1)!.id });
    } else if (existing) command({ type: "saveElement", id, element: draft });
  }
  approvedMaterial.forEach(put);
  const link = (from: string, to: string, label: string) => {
    if (!s.relations.some(r => r.from === from && r.to === to && r.label === label))
      command({ type: "saveRelation", from, to, label });
  };
  link("TH-PRODUCT", "TH-OFFER", "Целевой оффер, не готовность функций");
  link("TH-CLIENT", "TH-SEGMENT", "Кандидаты, победитель не выбран");
  link("TH-MARKET", "TH-SAM-SOM", "Ограничения расчёта рынка");
  link("TH-SEGMENT", "TH-CLEANING-VALUE", "Гипотеза следующего исследования");
  link("TH-MARKET", "BM-METHOD", "Конкурентное исследование отдельно от размеров рынка");
  for (const c of competitorElements) {
    link("BM-METHOD", c.id, "Участник одинакового benchmark");
    link(c.id, "TH-PRODUCT", "Сравнение реального продукта с видением TalkHint");
    link(c.id, "REQ-BENCH-TCO", "Нужна сопоставимая полная стоимость");
    link(c.id, "REQ-BENCH-AI", "Нужно проверить AI и полномочия");
  }
  for (const note of marketElements) {
    link("TH-MARKET", note.id, "Предварительная вторичная заметка, не TAM/SAM/SOM");
    link(note.id, "REQ-MARKET-VERIFY", "Требует первичной сверки");
  }
  for (const e of benchmarkElements) {
    const companyId = { jobber: "COMP-JOBBER", "housecall-pro": "COMP-HOUSECALL-PRO", zenmaid: "COMP-ZENMAID", talkhint: "TH-PRODUCT" }[e.input.details.benchmarkSubject!];
    if (!companyId) throw new Error("Missing benchmark subject");
    link(companyId, e.id, "Документальное наблюдение по одинаковому сценарию");
    link(e.id, ["voice", "marketing", "analytics", "coordination", "approval"].includes(e.input.details.benchmarkStep!)
      ? "REQ-BENCH-AI" : "REQ-BENCH-FLOW", "Практическая проверка ещё не проведена");
  }
  for (const source of materialSources) {
    const company = source.subjects[0];
    const subject = company === "COMP-JOBBER" ? "jobber" : company === "COMP-HOUSECALL-PRO" ? "housecall-pro" : company === "COMP-ZENMAID" ? "zenmaid" : undefined;
    const ids = [...source.subjects, ...benchmarkElements.filter(e => subject && e.input.details.benchmarkSubject === subject && e.input.details.source?.includes(source.url)).map(e => e.id)];
    command({ type: "saveDocument", title: source.title, url: source.url,
      text: `Тип: ${source.type}.\nИсходная дата проверки из обсуждения: ${researchDate}.\nПовторное чтение: ${source.type === "primary-to-check" ? "Первичные выгрузки не проверены; HealthSource portal открыт, не данные лицензий." : recheckedAt}.\n${source.summary}\nПрактический тест: не проводился.`, elementIds: Array.from(new Set(ids)) });
  }
  command({ type: "saveDocument", title: "Решения владельца и границы импортированных материалов", url: "/admin/project-model",
    text: `${ownerSource}\n${discussionElements.map(e => `${e.id}: ${e.input.description}\n${Object.values(e.input.details).join("\n")}`).join("\n\n")}\nАвтоматическая связь с ChatGPT не реализована. Записи внесены по прямому поручению владельца, не извлечены автоматически из чата.`,
    elementIds: discussionElements.map(e => e.id) });
  for (const req of benchmarkRequirements) {
    command({ type: "reviewElement", id: req.id, reason: "Проверен объём согласованного задания и связи с источниками. Это не результат практического теста; выполнение не начато." });
    command({ type: "prepareTask", title: req.input.title, elementIds: [req.id], acceptance: req.input.details.acceptance! });
  }
  // Last marker and all modifications are committed together, never partially.
  command({ type: "saveDocument", title: materialMarker, url: "/admin/project-model?view=benchmark",
    text: `Согласованный импорт бизнес-решений и исследований; сохранён ${recheckedAt}. Практических испытаний нет. Повторный запуск не меняет записи и не создаёт дубликатов.`,
    elementIds: ["BM-METHOD", ...competitorElements.map(e => e.id)] });
  return s;
}

export async function persistApprovedMaterial(pool: Pool, owner: string) {
  return persistModelUpdate(pool, owner, state => applyApprovedMaterial(state, owner));
}

/** Reuse the same locked JSONB transaction for narrow, explicitly approved updates. */
export async function persistModelUpdate(pool: Pool, owner: string, transform: (state: ProjectModelState) => ProjectModelState, existingOnly = false) {
  const client = await pool.connect();
  let next: ProjectModelState;
  try {
    await client.query("BEGIN");
    if (!existingOnly)
      await client.query("INSERT INTO talkhint_project_models(owner_key,revision,state) VALUES($1,0,$2::jsonb) ON CONFLICT(owner_key) DO NOTHING", [owner, JSON.stringify(initialModel())]);
    const row = await client.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1 FOR UPDATE", [owner]);
    if (!row.rows.length) throw new Error("Existing model required; no new namespace created");
    const before = await unpackModel(client, owner, row.rows[0].state);
    next = transform(before);
    if (next !== before) {
      await ensureModelHistory(client);
      await archiveModel(client, owner, before);
      const stored = await archiveModel(client, owner, next);
      await client.query("UPDATE talkhint_project_models SET state=$2::jsonb,revision=$3,updated_at=now() WHERE owner_key=$1", [owner, JSON.stringify(stored), next.revision]);
    }
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
  const read = await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", [owner]);
  const persisted = await unpackModel(pool, owner, read.rows[0].state);
  // jsonb changes property order; semantic comparison covers ALL saved fields,
  // sources, relations and audit snapshots rather than checking counts alone.
  if (!isDeepStrictEqual(persisted, JSON.parse(JSON.stringify(next)))) throw new Error("Full material readback mismatch (possibly concurrent update)");
  return persisted;
}
