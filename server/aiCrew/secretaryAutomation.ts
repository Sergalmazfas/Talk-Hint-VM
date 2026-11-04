import type { ProjectModelState } from "../../shared/projectModel";
import { recordedCallVersion } from "../codeVersion";
import { log } from "./domain";
import type { StateStore } from "./store";
import { secretaryCharacters, secretaryEvidence, secretaryHash, queueSecretaryReview } from "./secretaryReview";
import { claimCReview, rolloutState } from "../secretary/phoneRollout";
import { phoneMetrics } from "../secretary/phoneMetrics";
import { RetellApi } from "../secretaryLab/retellApi";
import { confirmedSecretaryOwnerName } from "../secretary/ownerIdentity";
import { selectCallExpectations, callExpectation } from "./expectations";
import type { CrewState } from "./domain";

/** Per-call, not first-five-only; receipt lives with the task, not a prunable journal row. */
export function recordSecretaryCallFact(s: CrewState, taskId: string, at: string, details: Record<string, unknown>) {
  const current = s.tasks.find(t => t.id === taskId)?.secretaryReview;
  if (!current || current.factRecordedAt) return;
  current.factRecordedAt = at;
  log(s, "secretary-qa", "katya_c_call_plan_fact_reported", {
    ...details, taskId, ownerAcceptance: false,
  }, at, callExpectation(current.evidence.expectations));
}

type Binding = { store: () => StateStore; model: () => Promise<ProjectModelState>; environment: string };
let binding: Binding | undefined;
export function bindSecretaryAutomation(value: Binding) { binding = value; }
export type SecretaryOutcome = null | { pending: true } | {
  pending: false; succeeded: string[]; failed: string[]; needsOwner: string[];
  taskId?: string; costMicroUsd: number; tokens: { input: number; output: number };
  summaryTop?: { learned: string; wentWrong: string; nextAction: string };
  checklist?: any[]; metrics?: any;
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
  const cCall = call.metadata?.retellPhone?.variant === "C";
  if (cCall && !rolloutState(state).reviews.some(r => r.callRef === ref) &&
      rolloutState(state).reviews.length < 5) {
    await store.change(s => { claimCReview(s, ref); });
    state = await store.read();
  }
  const cSelection = rolloutState(state).reviews.find(r => r.callRef === ref);
  let existing = state.tasks.find(t => t.secretaryReview?.callRef === ref);
  const ended = new Date(call.ended_at).getTime();
  if (!existing && (!cfg.enabled || !Number.isFinite(ended) || (!cSelection && ended < Date.parse(cfg.activatedAt))))
    return cSelection ? unavailable("C_REVIEW_PENDING_OWNER_ENABLE_OR_VALID_END") : null;
  if (!existing) {
    if (!cfg.monthlyLimitMicroUsd) return unavailable("SECRETARY_MONTHLY_BUDGET_ZERO");
    if (!state.control.enabled || !state.control.dailyLimitMicroUsd || state.control.testSeriesId)
      return unavailable("CREW_OFF_OR_HINT_PILOT_ACTIVE");
    let evidence, characters;
    try {
      if (typeof task.instruction !== "string") throw Error();
      const identity = confirmedSecretaryOwnerName(ownerId);
      const ownerNames = [identity?.en, identity?.ruGenitive].filter((s): s is string => !!s)
        .flatMap(s => [s, ...s.split(/\s+/)]);
      evidence = secretaryEvidence(task.instruction, task.transcript_turns,
        recordedCallVersion(call)?.commit ?? "unknown", [], ownerNames);
      const model = await dependencies.model();
      characters = secretaryCharacters(model);
      evidence.expectations = selectCallExpectations(model, call.started_at);
    } catch { return unavailable("SECRETARY_SOURCE_OR_OWNER_CHARACTER_UNAVAILABLE"); }
    if (cCall) {
      const engine = call.metadata.secretaryEngine ?? call.metadata.retellPhone.engine;
      let measurements = phoneMetrics(engine);
      const providerId = call.metadata.retellPhone.callId;
      if (/^call_[A-Za-z0-9_-]{1,110}$/.test(providerId ?? "")) {
        try { measurements = phoneMetrics(engine, await new RetellApi().request(`/v2/get-call/${providerId}`)); }
        catch { /* No fabricated audio latency; missing evidence stays explicit. */ }
      }
      evidence.measurements = measurements;
      if (cSelection) evidence.cRollout = { ordinal: cSelection.ordinal, measurements };
    }
    await store.change(s => {
      const queued = queueSecretaryReview(s, ownerId, call.call_sid, evidence, characters, now.toISOString());
      const selected = rolloutState(s).reviews.find(r => r.callRef === ref);
      if (selected) selected.taskId = queued.id;
      log(s, "call-lab", "secretary_call_queued", { taskId: queued.id, callRef: ref,
        evidenceHash: queued.secretaryReview!.evidenceHash, ownerAcceptance: false,
        expectationSnapshot: evidence.expectations }, now.toISOString(), callExpectation(evidence.expectations));
      log(s, "production-server", "preparation_assessment_proposed", { taskId: queued.id,
        recipient: "P.PREP", preparedBy: "deterministic checklist audit, not an AI Gleb run",
        assessment: evidence.preparation, status: "proposed", ownerAcceptance: false }, now.toISOString());
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
    if (cCall) await store.change(s => recordSecretaryCallFact(s, existing!.id, now.toISOString(), {
      callRef: ref, expected: p.evidence.expectations, fact: "не измерено",
      comparison: "не проверено: разбор заблокирован или расход unknown", verdict: "not_confirmed",
    }));
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
  const selected = rolloutState(state).reviews.find(r => r.callRef === ref);
  if (selected && !selected.reported) await store.change(s => {
    const current = rolloutState(s).reviews.find(r => r.callRef === ref);
    if (!current || current.reported) return;
    current.reported = true;
    log(s, "secretary-qa", "katya_c_first_five_review_reported", {
      ordinal: current.ordinal, taskId: existing!.id, verdict: p.verdict ?? "not_confirmed",
      authorId: p.authorId, reviewId: p.reviewId, summaryId: p.summaryId,
      measurements: p.evidence.cRollout?.measurements, ownerAcceptance: false,
      expectations: p.evidence.expectations,
    }, now.toISOString(), callExpectation(p.evidence.expectations));
  });
  const doc = (id?: string) => state.documents.find(d => d.id === id && d.taskId === existing!.id)?.text;
  // These are proposals/QA, never owner acceptance or evidence that code/product changed.
  let summary: any, author: any, review: any;
  try { summary = JSON.parse(doc(p.summaryId) ?? "null"); } catch {}
  try { author = JSON.parse(doc(p.authorId) ?? "null"); } catch {}
  try { review = JSON.parse(doc(p.reviewId) ?? "null"); } catch {}
  if (cCall && !p.factRecordedAt) await store.change(s => recordSecretaryCallFact(s, existing!.id, now.toISOString(), {
      callRef: ref, taskId: existing!.id, expected: p.evidence.expectations,
      author: author?.expectationChecks ?? [], independentReview: review?.expectationChecks ?? [],
      verdict: p.verdict, measurements: p.evidence.measurements ?? p.evidence.cRollout?.measurements,
      comparison: p.evidence.expectations?.targets.length ? "см. независимую сверку по каждой норме" : "не проверено: ожидание до звонка не зафиксировано",
      ownerAcceptance: false,
    }));
  const future = (text: unknown) => /(?:звонк[а-я]*|calls?)\s*2\s*[-–—]\s*5/i.test(String(text));
  const gaps = (items: any) => Array.isArray(items) ? items.filter(x => !future(x)) : [];
  const summaryText = p.error || !summary ? "Формат сводки не подтверждён"
    : `${summary.outcome}; договорено: ${p.verdict === "confirmed" ? JSON.stringify(summary.agreed) : "не подтверждено"}; осталось: ${JSON.stringify(gaps(summary.remaining))}; не проверено: ${JSON.stringify(gaps(summary.unverified))}`;
  const brief = (value: unknown, fallback: string) => typeof value === "string" && value.trim() && !future(value) ?
    value.replace(/[\r\n]+/g, " ").slice(0, 300) : fallback;
  return { pending: false, ...cost,
    checklist: author?.dialogue?.checklist?.map((r: any) => ({ ...r, item: p.evidence.points[r.index] })),
    metrics: { expected: p.evidence.expectations?.targets ?? [],
      author: author?.expectationChecks ?? [], reviewer: review?.expectationChecks ?? [] },
    summaryTop: {
      learned: brief(summary?.learned, p.verdict === "confirmed" ? summary?.outcome ?? "Разбор завершён" : "Результаты требуют проверки: разбор не подтверждён"),
      wentWrong: brief(p.error ?? (p.verdict !== "confirmed" ? "Тома не подтвердила разбор Лёвы" : summary?.wentWrong), "Подтверждённых проблем не отмечено"),
      nextAction: brief(summary?.nextAction, "Проверить расхождения по расшифровке; не менять продукт без решения владельца"),
    },
    succeeded: [`Лёва: запрос разбора выполнен; ${p.authorValid ? "ссылки на цитаты проверены" : "формат/доказательства не подтверждены"}`,
      ...(p.authorValid ? author.points.map((r: any) => `Пункт ${r.index + 1}: ${r.status}; цитата ${r.turn}: ${r.quote ?? "не проверено"}; ${r.reason}`) : []),
      `Тома: ${p.verdict === "confirmed" ? "разбор подтверждён" : "разбор не подтверждён"}; другая модель, не приёмка продукта`,
      `Тома — расхождения: ${JSON.stringify(gaps(review?.disagreements ?? ["формат не подтверждён"]))}`,
      `Манера — Лёва: ${JSON.stringify(author?.manners ?? "не измерено")}; Тома: ${JSON.stringify(review?.manners ?? "не проверено")}`,
      `Ожидание из журнала: ${JSON.stringify(p.evidence.expectations ?? "не зафиксировано до звонка")}`,
      ...(p.evidence.expectations?.targets.length ?
        [`Ожидание → факт → сошлось/не сошлось/почему: Лёва ${JSON.stringify(author?.expectationChecks ?? [])}; Тома ${JSON.stringify(review?.expectationChecks ?? [])}`] :
        [`Сверка ожидания: не проверено — нет доступного числового ожидания, зафиксированного до звонка (${p.evidence.expectations?.status ?? "старая запись без снимка"}). Порог не выдумывался.`]),
      `Пункт → тип (say=сказать, ask=спросить, unknown=не определено) → ответ/произнесено → закрыт: ${JSON.stringify(author?.dialogue?.checklist ?? "не проверено")}`,
      `Реплики Кати / лишние: ${author?.dialogue?.katyaTurns ?? "не измерено"} / ${author?.dialogue?.excessTurns ?? "не измерено"}`,
      `Идеальная короткая версия (гипотеза): ${JSON.stringify(author?.dialogue?.ideal ?? [])}; независимая версия Томы: ${JSON.stringify(review?.dialogue ?? "не проверено")}`,
      `Предложения Лёвы/Севы, принимает только владелец: ${JSON.stringify([...(author?.proposals ?? []), ...(summary?.proposals ?? [])])}`,
      ...(p.evidence.cRollout ? [`Наблюдение C: звонок ${p.evidence.cRollout.ordinal}/5. ` +
        (p.evidence.cRollout.ordinal < 5 ? `Следующие звонки ${p.evidence.cRollout.ordinal + 1}–5 — будущие наблюдения, не пробел данных текущего звонка.` :
          "Пять наблюдений собраны; качество каждого проверяется отдельно.")] : []),
      `Сева → Мария и владелец (предложение, не приёмка): ${summaryText}`,
      `Стоимость разбора: $${(spent / 1e6).toFixed(6)}; токены вход/выход: ${tokens.input}/${tokens.output}`,
      `Бюджет Секретаря за месяц: $${((monthly?.spent ?? 0) / 1e6).toFixed(6)} / $${(cfg.monthlyLimitMicroUsd / 1e6).toFixed(2)}`],
    failed: [...(p.verdict !== "confirmed" ? ["Выводы не подтверждены независимой проверкой"] : []),
      `Язык начала (оценка по тексту): ${author?.openingLanguage ?? "не измерено"}; ошибки распознавания/не проверено: ${JSON.stringify(author?.recognitionIssues ?? [])} / ${JSON.stringify(gaps(author?.unverified))}`,
      "Аудио, акцент и длительность пауз этим текстовым разбором не проверены",
      ...(p.error ? [p.error] : []),
      ...(warning ? ["Достигнуто 80% месячного лимита отдела, включая unknown"] : [])],
    needsOwner: ["Мария получает результат; изменения продукта и приёмка остаются за владельцем"] };
}
