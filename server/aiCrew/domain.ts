import { randomUUID } from "node:crypto";
import { z } from "zod";
import { closeStalledHintPilot, HINT_AGENTS, pilotReviewComplete, prepareHintPilot, startHintPilot,
  STALLED_PILOT_OUTCOME, type HintPilot } from "./hintPilot";
import type { HintEvidence } from "./hintEvidence";
import type { HintSeriesCompletion } from "./finalizeHintSeries";
import { configureSecretary, secretaryReviewComplete, SECRETARY_AGENTS, type SecretaryReview, type SecretarySettings, type SecretaryBudget } from "./secretaryReview";

export const phases = ["problem", "analysis", "owner_decision", "code", "verification", "outcome"] as const;
const text = z.string().trim().min(1).max(4000);
export const commandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("secretary_review_config"), enabled: z.boolean(),
    monthlyLimitMicroUsd: z.number().int().min(0).max(1e11),
    dailyLimitMicroUsd: z.number().int().min(1).max(1e11).optional() }).strict(),
  z.object({ kind: z.literal("hint_pilot_prepare"), candidate: z.enum(["latency", "usefulness", "unavailable"]),
    ratesConfirmed: z.literal(true) }).strict(),
  z.object({ kind: z.literal("hint_pilot_start"), taskId: z.string().uuid(), ownerApproved: z.literal(true) }).strict(),
  z.object({ kind: z.literal("hint_pilot_close_stalled"), taskId: z.string().uuid(), ownerApproved: z.literal(true) }).strict(),
  z.object({ kind: z.literal("control"), enabled: z.boolean(), dailyLimitMicroUsd: z.number().int().min(0).max(1e11),
    staleHours: z.number().int().min(1).max(8760) }).strict(),
  z.object({ kind: z.literal("task"), title: text, holder: text, problem: text }).strict(),
  z.object({ kind: z.literal("advance"), taskId: z.string().uuid(), holder: text, note: text,
    expectation: text.optional(), approved: z.boolean().optional(), commit: z.string().regex(/^[a-f0-9]{7,40}$/).optional(),
    testedCommit: z.string().regex(/^[a-f0-9]{7,40}$/).optional(), actual: text.optional(), met: z.boolean().optional(),
    laboratoryActor: text.optional(), reviewerActor: text.optional() }).strict(),
  z.object({ kind: z.literal("publication"), taskId: z.string().uuid(), commit: z.string().regex(/^[a-f0-9]{7,40}$/), fixes: text }).strict(),
  z.object({ kind: z.literal("agent"), agentId: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),
    modelId: z.string().min(1).max(160), inputMicroUsdPerToken: z.number().int().positive().max(10000),
    outputMicroUsdPerToken: z.number().int().positive().max(10000) }).strict(),
  z.object({ kind: z.literal("enqueue"), taskId: z.string().uuid(), agentId: z.string().max(100),
    eventId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("schedule"), taskId: z.string().uuid(), agentId: z.string().max(100),
    everyMinutes: z.number().int().min(5).max(43200), nextAt: z.string().datetime() }).strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export type Task = { id: string; title: string; phase: typeof phases[number]; closed: boolean; hintPilot?: HintPilot;
  secretaryReview?: SecretaryReview;
  testSeriesId?: string;
  steps: { phase: typeof phases[number]; holder: string; updatedAt: string; note: string; actor: string;
    expectation?: string; approved?: boolean; commit?: string; testedCommit?: string; actual?: string; met?: boolean;
    laboratoryActor?: string; reviewerActor?: string }[] };
export type Agent = { agentId: string; modelId: string; inputMicroUsdPerToken: number; outputMicroUsdPerToken: number };
export type Run = { id: string; taskId: string; agentId: string; eventId: string; status: "queued" | "running" | "done" | "unknown" | "discarded";
  testSeriesId?: string; startedAt?: string;
  legacyUnknownWriteoff?: { at: string; actor: "replit-test"; seriesId: string;
    amountMicroUsd: number; providerOutcome: "unknown"; reason: "owner_emergency_off" };
  at: string; day?: string; epoch?: number; reserved?: number; cost?: number; usage?: { input_tokens: number; output_tokens: number };
  modelId?: string; completedAt?: string; secretaryMonth?: string };
export type CrewState = {
  hintSeriesCompletion?: HintSeriesCompletion;
  secretarySettings?: SecretarySettings; secretaryBudget?: SecretaryBudget;
  version: 1; revision: number; control: { enabled: boolean; epoch: number; dailyLimitMicroUsd: number; staleHours: number; testSeriesId?: string };
  testGrant?: { id: string; keyHash: string; createdAt: string; expiresAt: string; revokedAt?: string;
    lastUsedAt?: string; limit: number; spent: number; reserved: number };
  structureReports?: { day: string; at: string; modelRevision: number; findings: { status: "ok" | "problem"; where: string; check: string }[] }[];
  agents: Agent[]; tasks: Task[]; runs: Run[];
  schedules: { taskId: string; agentId: string; everyMinutes: number; nextAt: string }[];
  budget: Record<string, { spent: number; reserved: number }>;
  journal: { id: string; at: string; actor: string; kind: string; detail: unknown }[];
  documents: { id: string; taskId: string; runId: string; agentId: string; at: string; text: string; status: "proposed" }[];
  publications: { taskId: string; commit: string; fixes: string; at: string; actor: string }[];
  probe: { status: "started" | "done" | "unknown"; modelId: string; at: string; usage?: unknown } | null;
};
export const initialState = (): CrewState => ({ version: 1, revision: 0,
  control: { enabled: false, epoch: 0, dailyLimitMicroUsd: 0, staleHours: 24 },
  agents: [], tasks: [], runs: [], schedules: [], budget: {}, journal: [], documents: [], publications: [], probe: null });
export function log(s: CrewState, actor: string, kind: string, detail: unknown, at: string) {
  s.journal.push({ id: randomUUID(), at, actor, kind, detail });
  const taskId = (detail as any)?.taskId;
  const task = typeof taskId === "string" ? s.tasks.find(t => t.id === taskId) : null;
  if (task && !task.closed) task.steps.at(-1)!.updatedAt = at;
}
export function applyOwnerCommand(s: CrewState, command: Command, actor: string, at: string, availableModels: string[] = [], evidence?: HintEvidence) {
  const c = commandSchema.parse(command);
  if (c.kind === "secretary_review_config") {
    configureSecretary(s, c.enabled, c.monthlyLimitMicroUsd, actor, at, availableModels, c.dailyLimitMicroUsd);
    log(s, actor, "secretary_review_config", { ...s.secretarySettings, ownerAcceptance: false }, at);
  } else if (c.kind === "hint_pilot_prepare") {
    if (!evidence) throw Error("SERVER_EVIDENCE_REQUIRED");
    const task = prepareHintPilot(s, c.candidate, evidence, actor, at, availableModels);
    log(s, actor, "hint_pilot_prepared", { taskId: task.id, evidenceHash: task.hintPilot!.evidenceHash,
      ratesConfirmed: true, agentsStarted: false }, at);
  } else if (c.kind === "control") {
    s.control = { ...c, epoch: s.control.epoch + 1 };
    delete (s.control as any).kind;
    log(s, actor, "control", s.control, at);
  } else if (c.kind === "task") {
    const task: Task = { id: randomUUID(), title: c.title, phase: "problem", closed: false,
      steps: [{ phase: "problem", holder: c.holder, updatedAt: at, note: c.problem, actor }] };
    s.tasks.push(task); log(s, actor, "task_created", { taskId: task.id }, at);
  } else if (c.kind === "agent") {
    if (SECRETARY_AGENTS.some(a => a.agentId === c.agentId) && s.tasks.some(t => t.secretaryReview && !t.closed))
      throw Error("SECRETARY_RATES_AND_MODELS_FROZEN");
    if (HINT_AGENTS.some(a => a.agentId === c.agentId) && s.tasks.some(t => t.hintPilot && !t.closed))
      throw Error("PILOT_RATES_AND_MODELS_FROZEN");
    if (!availableModels.includes(c.modelId)) throw Error("MODEL_NOT_VERIFIED");
    const { kind, ...agent } = c;
    s.agents = [...s.agents.filter(a => a.agentId !== c.agentId), agent];
    log(s, actor, "agent_description", agent, at);
  } else {
    const task = s.tasks.find(t => t.id === c.taskId);
    if (!task) throw Error("TASK_NOT_FOUND");
    if (c.kind === "hint_pilot_start") {
      startHintPilot(s, task, actor, at);
      log(s, actor, "hint_pilot_start_authorized", { taskId: task.id }, at);
    } else if (c.kind === "hint_pilot_close_stalled") {
      const closed = closeStalledHintPilot(s, task, actor, at);
      for (const runId of closed.discardedRunIds)
        log(s, actor, "run_discarded_without_execution", { taskId: task.id, runId,
          costMicroUsd: 0, reason: STALLED_PILOT_OUTCOME }, at);
      log(s, actor, "hint_pilot_closed_stalled", { taskId: task.id, outcome: STALLED_PILOT_OUTCOME,
        ...closed, dailyLimitMicroUsd: 0, costMicroUsd: 0, enabled: false, agentsStarted: false }, at);
    } else if (c.kind === "publication") {
      const code = [...task.steps].reverse().find(x => x.phase === "code" && x.commit === c.commit);
      if (!code) throw Error("PUBLICATION_WITHOUT_RECORDED_CODE");
      s.publications.push({ taskId: task.id, commit: c.commit, fixes: c.fixes, at, actor });
      log(s, actor, "publication", c, at);
    } else if (c.kind === "advance") {
      if (task.closed) throw Error("TASK_CLOSED");
      // The command records the completed current phase and hands off to the next.
      if (task.phase === "analysis" && (!c.laboratoryActor || !c.reviewerActor || c.laboratoryActor === c.reviewerActor))
        throw Error("INDEPENDENT_REVIEW_REQUIRED");
      if (task.phase === "analysis" && task.hintPilot && (!pilotReviewComplete(s, task) ||
          c.laboratoryActor !== HINT_AGENTS[0].agentId || c.reviewerActor !== HINT_AGENTS[1].agentId))
        throw Error("PILOT_TWO_COMPLETED_EXECUTORS_REQUIRED");
      if (task.phase === "analysis" && task.secretaryReview && (!secretaryReviewComplete(s, task) ||
          c.laboratoryActor !== SECRETARY_AGENTS[0].agentId || c.reviewerActor !== SECRETARY_AGENTS[1].agentId))
        throw Error("SECRETARY_INDEPENDENT_EXECUTORS_REQUIRED");
      if (task.phase === "owner_decision" && (!c.approved || !c.expectation)) throw Error("OWNER_EXPECTATION_REQUIRED");
      if (task.phase === "code" && !c.commit) throw Error("CODE_COMMIT_REQUIRED");
      if (task.phase === "verification") {
        const code = [...task.steps].reverse().find(x => x.phase === "code" && x.commit);
        if (!c.testedCommit || c.testedCommit !== code?.commit) throw Error("NEW_VERSION_NOT_VERIFIED");
      }
      if (task.phase === "outcome" && (!c.actual || c.met === undefined)) throw Error("OUTCOME_REQUIRED");
      const expectation = [...task.steps].reverse().find(x => x.phase === "owner_decision" && x.approved)?.expectation;
      if (task.phase === "outcome" && !expectation) throw Error("OWNER_EXPECTATION_REQUIRED");
      const completed = task.steps.at(-1)!;
      Object.assign(completed, { updatedAt: at, note: c.note, actor,
        ...(c.expectation ? { expectation: c.expectation } : {}), ...(c.approved !== undefined ? { approved: c.approved } : {}),
        ...(c.commit ? { commit: c.commit } : {}), ...(c.testedCommit ? { testedCommit: c.testedCommit } : {}),
        ...(c.actual ? { actual: c.actual } : {}), ...(c.met !== undefined ? { met: c.met } : {}) });
      if (c.laboratoryActor) completed.laboratoryActor = c.laboratoryActor;
      if (c.reviewerActor) completed.reviewerActor = c.reviewerActor;
      if (task.phase === "outcome") completed.expectation = expectation;
      if (task.phase === "outcome" && c.met) task.closed = true;
      else {
        task.phase = task.phase === "outcome" ? "analysis" : phases[phases.indexOf(task.phase) + 1];
        task.steps.push({ phase: task.phase, holder: c.holder, updatedAt: at, note: "Передано на следующий шаг", actor });
      }
      log(s, actor, "task_step", { taskId: task.id, completed, currentPhase: task.phase, closed: task.closed }, at);
    } else {
      if (task.hintPilot) throw Error("PILOT_USES_DEDICATED_START_NOT_GENERIC_QUEUE");
      if (task.closed || task.phase !== "analysis") throw Error("ANALYSIS_TASK_REQUIRED");
      if (!s.agents.some(a => a.agentId === c.agentId)) throw Error("AGENT_NOT_CONFIGURED");
      if (c.kind === "schedule") {
        s.schedules = [...s.schedules.filter(x => x.taskId !== c.taskId || x.agentId !== c.agentId),
          { taskId: c.taskId, agentId: c.agentId, everyMinutes: c.everyMinutes, nextAt: c.nextAt }];
      } else if (!s.runs.some(r => r.eventId === c.eventId)) {
        s.runs.push({ id: randomUUID(), taskId: c.taskId, agentId: c.agentId, eventId: c.eventId, status: "queued", at });
      }
      log(s, actor, c.kind, c, at);
    }
  }
}
export function staleTasks(s: CrewState, now: number) {
  return s.tasks.filter(t => !t.closed && now - Date.parse(t.steps.at(-1)!.updatedAt) > s.control.staleHours * 3600000)
    .map(t => ({ taskId: t.id, phase: t.phase, holder: t.steps.at(-1)!.holder, lastEntryAt: t.steps.at(-1)!.updatedAt }));
}
