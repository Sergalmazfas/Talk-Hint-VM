import type { ProjectModelState } from "../../shared/projectModel";
import { recordedCallVersion } from "../codeVersion";
import { log } from "./domain";
import type { StateStore } from "./store";
import { secretaryCharacters, secretaryEvidence, secretaryHash, queueSecretaryReview } from "./secretaryReview";

type Binding = { store: () => StateStore; model: () => Promise<ProjectModelState>; environment: string };
let binding: Binding | undefined;
export function bindSecretaryAutomation(value: Binding) { binding = value; }
export type SecretaryOutcome = null | { pending: true } | {
  pending: false; succeeded: string[]; failed: string[]; needsOwner: string[];
  taskId?: string; costMicroUsd: number; tokens: { input: number; output: number };
};
/** Runs only for the existing owner-authorized call-lab source and existing mail outbox. */
export async function reviewSecretaryCall(call: any, task: any, ownerId: string,
  environment: string, now = new Date(), dependencies = binding): Promise<SecretaryOutcome> {
  if (!dependencies || environment !== "production" || dependencies.environment !== "production") return null;
  const store = dependencies.store();
  let state;
  try { state = await store.read(); } catch { return null; } // No initialization or activation here.
  const cfg = state.secretarySettings;
  if (!cfg) return null; // Preserve the released informational report while unconfigured.
  const unavailable = (reason: string): Exclude<SecretaryOutcome, null | { pending: true }> =>
    ({ pending: false, succeeded: [], failed: [reason], needsOwner: ["Авторазбор не подтверждён; изменений продукта не делалось"],
      costMicroUsd: 0, tokens: { input: 0, output: 0 } });
  if (cfg.ownerId !== ownerId || String(call?.user_id) !== ownerId || String(task?.user_id) !== ownerId ||
      task?.call_sid !== call?.call_sid || !call.ended_at || call.lab_mode !== "secretary")
    return unavailable("SECRETARY_SOURCE_SCOPE_REJECTED");
  const ref = secretaryHash([ownerId, call.call_sid]);
  let existing = state.tasks.find(t => t.secretaryReview?.callRef === ref);
  const ended = new Date(call.ended_at).getTime();
  if (!existing && (!cfg.enabled || !Number.isFinite(ended) || ended < Date.parse(cfg.activatedAt))) return null;
  if (!existing) {
    if (!cfg.monthlyLimitMicroUsd) return unavailable("SECRETARY_MONTHLY_BUDGET_ZERO");
    if (!state.control.enabled || !state.control.dailyLimitMicroUsd || state.control.testSeriesId)
      return unavailable("CREW_OFF_OR_HINT_PILOT_ACTIVE");
    let evidence, characters;
    try {
      if (typeof task.instruction !== "string") throw Error();
      evidence = secretaryEvidence(task.instruction, task.transcript_turns,
        recordedCallVersion(call)?.commit ?? "unknown");
      characters = secretaryCharacters(await dependencies.model());
    } catch { return unavailable("SECRETARY_SOURCE_OR_OWNER_CHARACTER_UNAVAILABLE"); }
    await store.change(s => {
      const queued = queueSecretaryReview(s, ownerId, call.call_sid, evidence, characters, now.toISOString());
      log(s, "call-lab", "secretary_call_queued", { taskId: queued.id, callRef: ref,
        evidenceHash: queued.secretaryReview!.evidenceHash, ownerAcceptance: false }, now.toISOString());
    });
    return { pending: true };
  }
  const p = existing.secretaryReview!, runs = state.runs.filter(r => r.taskId === existing!.id);
  const spent = runs.reduce((n, r) => n + (r.cost ?? (r.status === "unknown" ? r.reserved ?? 0 : 0)), 0);
  const tokens = { input: runs.reduce((n, r) => n + (r.usage?.input_tokens ?? 0), 0),
    output: runs.reduce((n, r) => n + (r.usage?.output_tokens ?? 0), 0) };
  const cost = { taskId: existing.id, costMicroUsd: spent, tokens };
  const month = now.toISOString().slice(0, 7), monthly = state.secretaryBudget?.[month];
  const committed = (monthly?.spent ?? 0) + state.runs.filter(r => r.secretaryMonth === month && r.status === "unknown")
    .reduce((n, r) => n + (r.reserved ?? 0), 0);
  const warning = committed >= cfg.monthlyLimitMicroUsd * .8;
  if (runs.some(r => r.status === "running")) {
    const stale = runs.filter(r => r.status === "running" && r.startedAt && +now - Date.parse(r.startedAt) > 300000);
    if (stale.length) await store.change(s => {
      for (const id of stale.map(r => r.id)) {
        const run = s.runs.find(r => r.id === id)!;
        if (run.status === "running") {
          run.status = "unknown"; run.completedAt = now.toISOString();
          log(s, run.agentId, "secretary_stale_unknown", { taskId: run.taskId, runId: id,
            reservationRetained: true }, now.toISOString());
        }
      }
    });
    return { pending: true }; // Settle/retain the paid reservation before reporting a price.
  }
  if (runs.some(r => r.status === "unknown" || r.status === "discarded") || p.status === "blocked") {
    const result = unavailable(p.error ?? "RUN_UNKNOWN_OR_DISCARDED_NO_RETRY");
    result.failed.push(`Учтено под лимитом: $${(spent / 1e6).toFixed(6)}; неизвестный расход считается полным резервом, это не счёт провайдера`);
    if (warning) result.needsOwner.push("Достигнуто 80% месячного лимита отдела, включая unknown");
    return { ...result, ...cost };
  }
  if (p.status !== "reported") {
    if (!state.control.enabled) {
      await store.change(s => {
        const t = s.tasks.find(t => t.id === existing!.id)!;
        t.secretaryReview!.status = "blocked"; t.secretaryReview!.error = "OWNER_STOPPED";
        for (const run of s.runs.filter(r => r.taskId === t.id && r.status === "queued")) {
          run.status = "discarded"; run.cost = 0; run.completedAt = now.toISOString();
        }
        log(s, "call-lab", "secretary_stopped", { taskId: t.id, unknownNotRetried: true }, now.toISOString());
      });
      return { ...unavailable("OWNER_STOPPED"), ...cost };
    }
    return { pending: true };
  }
  const doc = (id?: string) => state.documents.find(d => d.id === id && d.taskId === existing!.id)?.text;
  // These are proposals/QA, never owner acceptance or evidence that code/product changed.
  let summary: any, author: any, review: any;
  try { summary = JSON.parse(doc(p.summaryId) ?? "null"); } catch {}
  try { author = JSON.parse(doc(p.authorId) ?? "null"); } catch {}
  try { review = JSON.parse(doc(p.reviewId) ?? "null"); } catch {}
  const summaryText = p.error || !summary ? "Формат сводки не подтверждён"
    : `${summary.outcome}; договорено: ${p.verdict === "confirmed" ? JSON.stringify(summary.agreed) : "не подтверждено"}; осталось: ${JSON.stringify(summary.remaining)}; не проверено: ${JSON.stringify(summary.unverified)}`;
  return { pending: false, ...cost,
    succeeded: [`Лёва: запрос разбора выполнен; ${p.authorValid ? "ссылки на цитаты проверены" : "формат/доказательства не подтверждены"}`,
      ...(p.authorValid ? author.points.map((r: any) => `Пункт ${r.index + 1}: ${r.status}; цитата ${r.turn}: ${r.quote ?? "не проверено"}; ${r.reason}`) : []),
      `Тома: ${p.verdict === "confirmed" ? "разбор подтверждён" : "разбор не подтверждён"}; другая модель, не приёмка продукта`,
      `Тома — расхождения: ${JSON.stringify(review?.disagreements ?? ["формат не подтверждён"])}`,
      `Сева → Мария и владелец (предложение, не приёмка): ${summaryText}`,
      `Стоимость разбора: $${(spent / 1e6).toFixed(6)}; токены вход/выход: ${tokens.input}/${tokens.output}`,
      `Бюджет Секретаря за месяц: $${((monthly?.spent ?? 0) / 1e6).toFixed(6)} / $${(cfg.monthlyLimitMicroUsd / 1e6).toFixed(2)}`],
    failed: [...(p.verdict !== "confirmed" ? ["Выводы не подтверждены независимой проверкой"] : []),
      `Язык начала (оценка по тексту): ${author?.openingLanguage ?? "не измерено"}; ошибки распознавания/не проверено: ${JSON.stringify(author?.recognitionIssues ?? [])} / ${JSON.stringify(author?.unverified ?? [])}`,
      "Аудио, акцент и длительность пауз этим текстовым разбором не проверены",
      ...(p.error ? [p.error] : []),
      ...(warning ? ["Достигнуто 80% месячного лимита отдела, включая unknown"] : [])],
    needsOwner: ["Мария получает результат; изменения продукта и приёмка остаются за владельцем"] };
}
