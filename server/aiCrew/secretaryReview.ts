import { createHash, randomUUID } from "node:crypto";
import type { CrewState, Task } from "./domain";
import type { ProjectModelState } from "../../shared/projectModel";
import { HINT_AGENTS } from "./hintPilot";

export const SECRETARY_AGENTS = [
  { ...HINT_AGENTS[0], agentId: "secretary-lab-engineer" },
  { ...HINT_AGENTS[1], agentId: "secretary-qa" },
  { ...HINT_AGENTS[0], agentId: "secretary-project-head" },
] as const;
export type SecretaryEvidence = {
  version: 1; points: string[]; transcript: { speaker: string; text: string }[];
  codeVersion: string; limitations: string[];
};
export type SecretaryReview = {
  ownerId: string; callRef: string; evidence: SecretaryEvidence; evidenceHash: string;
  characters: Record<string, { traits: string[]; motto: string }>;
  status: "author" | "review" | "summary" | "reported" | "blocked";
  authorId?: string; reviewId?: string; summaryId?: string;
  verdict?: "confirmed" | "not_confirmed"; authorValid?: boolean; error?: string;
};
export type SecretarySettings = { ownerId: string; enabled: boolean; activatedAt: string;
  monthlyLimitMicroUsd: number };
export type SecretaryBudget = Record<string, { spent: number; reserved: number; warning: boolean }>;
function sorted(v: any): any {
  return Array.isArray(v) ? v.map(sorted) : v && typeof v === "object"
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v;
}
export const secretaryHash = (v: unknown) => createHash("sha256").update(JSON.stringify(sorted(v))).digest("hex");

/** Deliberately conservative: reject unsupported text shapes; never send raw task objects. */
export function secretaryEvidence(goal: string, transcript: unknown, codeVersion: string,
  names: string[] = []): SecretaryEvidence {
  const aliases = new Map<string, string>();
  const businessWords = new Set(("yes no okay ok new used available availability price tomorrow today tire tires " +
    "trailer truck wire wires installation tax taxes warranty cash card dollars usd am pm fuel restaurant parking " +
    "booking reservation ask call confirm please we you the this that hello thanks sure").split(" "));
  const alias = (s: string) => {
    const key = s.toLocaleLowerCase();
    if (!aliases.has(key)) aliases.set(key, `[ENTITY_${aliases.size + 1}]`);
    return aliases.get(key)!;
  };
  const redact = (s: string) => {
    for (const name of names.filter(n => n.trim().length > 1).sort((a, b) => b.length - a.length))
      s = s.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu"), alias);
    return s.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, alias)
      .replace(/(?:https?:\/\/|www\.)[^\s]+/gi, alias)
      .replace(/(?<!\d)(?:\+?\d[\s().-]*){7,}(?!\d)/g, alias)
      .replace(new RegExp("\\b(?:my name is|this is|speaking with|i am|i'm)\\s+[\\p{L}'-]+(?:\\s+[\\p{L}'-]+)?", "giu"), "[INTRODUCTION]")
      .replace(new RegExp("меня зовут\\s+[\\p{L}'-]+(?:\\s+[\\p{L}'-]+)?", "giu"), "[INTRODUCTION]")
      .replace(new RegExp("\\b(?:ask for|speak to|talk to|his name is|her name is|thanks)\\s+[\\p{L}'-]+", "giu"), "[NAME_REFERENCE]")
      .replace(new RegExp("\\b\\d{1,6}\\s+(?:[\\p{L}.-]+\\s+){1,4}(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|blvd|court|ct)\\b", "giu"), alias)
      .replace(new RegExp("(?<![\\p{L}_\\[])(?:\\p{Lu}\\p{Ll}+|\\p{Lu}{2,})(?![\\p{L}_\\]])", "gu"),
        match => businessWords.has(match.toLowerCase()) ? match : alias(match));
  };
  if (!goal.trim() || goal.length > 4000 || !Array.isArray(transcript) ||
      transcript.length === 0 || transcript.length > 150) throw Error("SECRETARY_SOURCE_UNAVAILABLE");
  if (/\b(?:password|social security|credit card|diagnosis|medical record|my wife|my husband|my mother|my father)\b|парол|диагноз|медицинск/i.test(
    goal + JSON.stringify(transcript))) throw Error("SECRETARY_PRIVATE_SOURCE_REJECTED");
  const turns = transcript.map(t => {
    if (!t || typeof t.text !== "string" || !t.text.trim() || t.text.length > 3000)
      throw Error("SECRETARY_SOURCE_UNAVAILABLE");
    const speaker = /^(secretary|agent|assistant|katya|катя)$/i.test(t.speaker ?? t.role ?? "") ? "secretary"
      : /^(user|caller|guest|human|собеседник)$/i.test(t.speaker ?? t.role ?? "") ? "guest" : "unknown";
    return { speaker, text: redact(t.text) };
  });
  const points = redact(goal).split(/\n+|(?<=[.!?;])\s+/).map(s => s.trim()).filter(Boolean);
  if (points.length > 20 || Buffer.byteLength(JSON.stringify(turns), "utf8") > 24000)
    throw Error("SECRETARY_SOURCE_TOO_LARGE");
  return { version: 1, points, transcript: turns, codeVersion: /^[a-zA-Z0-9._:+-]{1,120}$/.test(codeVersion) ? codeVersion : "unknown",
    limitations: ["PII redacted; compare only the supplied excerpt", "No audio proof of pauses, accent or recognition errors",
      "Unknown names/private facts cannot be certified absent by regex; source must be an explicitly approved business-call excerpt"] };
}
export function secretaryCharacters(model: ProjectModelState): SecretaryReview["characters"] {
  return Object.fromEntries(SECRETARY_AGENTS.map(a => {
    const docs = model.documents.flatMap(d => {
      try { const p = JSON.parse(d.text); return p.visualPassport?.roleId === a.agentId ? [p] : []; } catch { return []; }
    });
    const c = docs[0]?.visualPassport?.character;
    if (docs.length !== 1 || c?.traits?.length !== 3 || !c.traits.every((x: unknown) => typeof x === "string" && x) ||
        typeof c.motto !== "string" || !c.motto) throw Error("SECRETARY_OWNER_CHARACTER_UNAVAILABLE");
    return [a.agentId, { traits: [...c.traits], motto: c.motto }];
  }));
}
export function configureSecretary(s: CrewState, enabled: boolean, limit: number, ownerId: string, at: string, models: string[],
  dailyLimitMicroUsd?: number) {
  if (enabled && !SECRETARY_AGENTS.every(a => models.includes(a.modelId))) throw Error("SECRETARY_MODELS_UNVERIFIED");
  if (s.secretarySettings && s.secretarySettings.ownerId !== ownerId) throw Error("SECRETARY_OWNER_MISMATCH");
  if (enabled && s.control.testSeriesId) throw Error("HINT_PILOT_REQUIRES_SEPARATE_OWNER_DECISION");
  if (enabled && !s.control.enabled) {
    if (s.schedules.length || s.runs.some(r => ["queued", "running"].includes(r.status) &&
      !s.tasks.find(t => t.id === r.taskId)?.secretaryReview)) throw Error("OTHER_CREW_WORK_REQUIRES_OWNER_DECISION");
    s.control.enabled = true; s.control.dailyLimitMicroUsd = dailyLimitMicroUsd ?? 1e6; s.control.epoch++;
  } else if (enabled && dailyLimitMicroUsd !== undefined && s.control.dailyLimitMicroUsd !== dailyLimitMicroUsd) {
    throw Error("GLOBAL_LIMIT_CHANGE_REQUIRES_SEPARATE_OWNER_DECISION");
  }
  s.secretarySettings = { ownerId, enabled, monthlyLimitMicroUsd: limit,
    activatedAt: s.secretarySettings?.enabled || !enabled ? s.secretarySettings?.activatedAt ?? at : at };
  if (!enabled) for (const task of s.tasks.filter(t => t.secretaryReview && !["reported", "blocked"].includes(t.secretaryReview.status))) {
    task.secretaryReview!.status = "blocked"; task.secretaryReview!.error = "OWNER_DISABLED";
    for (const run of s.runs.filter(r => r.taskId === task.id && r.status === "queued")) {
      run.status = "discarded"; run.cost = 0; run.completedAt = at;
    }
  }
  if (enabled) for (const a of SECRETARY_AGENTS)
    s.agents = [...s.agents.filter(old => old.agentId !== a.agentId), { ...a }];
}
export function queueSecretaryReview(s: CrewState, ownerId: string, callSid: string, evidence: SecretaryEvidence,
  characters: SecretaryReview["characters"], at: string): Task {
  if (!s.control.enabled || !s.secretarySettings?.enabled || s.secretarySettings.ownerId !== ownerId ||
      s.secretarySettings.monthlyLimitMicroUsd <= 0 || s.control.testSeriesId) throw Error("SECRETARY_DISABLED");
  const callRef = secretaryHash([ownerId, callSid]);
  const existing = s.tasks.find(t => t.secretaryReview?.callRef === callRef);
  if (existing) return existing; // Including unknown/blocked: never recreate a paid attempt.
  const task: Task = { id: randomUUID(), title: "Разбор завершённого звонка Секретаря", phase: "analysis", closed: false,
    steps: [{ phase: "problem", holder: ownerId, actor: "call-lab", updatedAt: at, note: "Звонок завершён; проверить поручение" },
      { phase: "analysis", holder: SECRETARY_AGENTS[0].agentId, actor: "call-lab", updatedAt: at, note: "Лёва → Тома → Сева; только предложения" }],
    secretaryReview: { ownerId, callRef, evidence, evidenceHash: secretaryHash(evidence), characters, status: "author" } };
  s.tasks.push(task);
  enqueue(s, task, 0, at);
  return task;
}
function enqueue(s: CrewState, task: Task, i: number, at: string) {
  const agentId = SECRETARY_AGENTS[i].agentId;
  s.runs.push({ id: randomUUID(), taskId: task.id, agentId, eventId: `secretary:${task.id}:${i}`, at, status: "queued" });
  task.steps.at(-1)!.holder = agentId;
}
export function secretaryInput(s: CrewState, task: Task, agentId: string, modelId: string) {
  const p = task.secretaryReview!, index = ["author", "review", "summary"].indexOf(p.status), a = SECRETARY_AGENTS[index];
  const agent = s.agents.find(x => x.agentId === agentId);
  if (!a || a.agentId !== agentId || a.modelId !== modelId || agent?.inputMicroUsdPerToken !== a.inputMicroUsdPerToken ||
      agent.outputMicroUsdPerToken !== a.outputMicroUsdPerToken || secretaryHash(p.evidence) !== p.evidenceHash ||
      s.runs.some(r => r.taskId === task.id && r.status === "unknown")) throw Error("SECRETARY_ASSIGNMENT_OR_EVIDENCE_CHANGED");
  const doc = (id?: string) => id ? s.documents.find(d => d.id === id && d.taskId === task.id)?.text : undefined;
  const instruction = index === 0
    ? 'Лёва: каждый пункт поручения, цитата и индекс реплики. Ответ JSON: {"points":[{"index":0,"status":"выполнено|частично|нет|не проверено","quote":"","turn":0,"reason":""}],"openingLanguage":"en|ru|es|unknown","recognitionIssues":[],"unverified":[]}. Паузы/акцент без аудио не проверены.'
    : index === 1
      ? 'Тома: независимо проверь ВСЕ пункты по исходной расшифровке, а не доверию Лёве. Ответ JSON: {"verdict":"confirmed|not_confirmed","checks":[{"index":0,"quote":"","turn":0,"reason":""}],"disagreements":[],"unverified":[]}. Неверный/неполный разбор не подтверждать.'
      : 'Сева: сведи разбор и независимую проверку. Ответ JSON: {"outcome":"","agreed":[],"remaining":[],"unverified":[]}. Неподтверждённые выводы не объявляй договорённостью. Получатель Мария и письмо владельцу; это не приёмка продукта.';
  return JSON.stringify({ ownerCharacter: p.characters[agentId], instruction, evidence: p.evidence,
    ...(index > 0 ? { untrustedAuthor: doc(p.authorId) } : {}),
    ...(index > 1 ? { untrustedReview: doc(p.reviewId), verdict: p.verdict } : {}) });
}
function citationsValid(rows: any, p: SecretaryReview, allowUnverified = true) {
  return Array.isArray(rows) && rows.length === p.evidence.points.length &&
    new Set(rows.map(r => r?.index)).size === rows.length && rows.every(r => r && Number.isInteger(r.index) &&
      r.index >= 0 && r.index < p.evidence.points.length && typeof r.reason === "string" && r.reason.trim() &&
      (allowUnverified && r.status === "не проверено" || typeof r.quote === "string" && r.quote.trim() &&
        Number.isInteger(r.turn) && p.evidence.transcript[r.turn]?.text.includes(r.quote)));
}
export function finishSecretaryRun(s: CrewState, task: Task, documentId: string, text: string, at: string) {
  const p = task.secretaryReview!;
  let result: any; try { result = JSON.parse(text); } catch { result = null; }
  if (p.status === "author") {
    p.authorId = documentId;
    p.authorValid = citationsValid(result?.points, p) &&
      result.points.every((r: any) => ["выполнено", "частично", "нет", "не проверено"].includes(r.status));
    p.status = "review"; enqueue(s, task, 1, at);
  } else if (p.status === "review") {
    p.reviewId = documentId;
    p.verdict = p.authorValid && result?.verdict === "confirmed" && citationsValid(result?.checks, p, false) &&
      Array.isArray(result.disagreements) && result.disagreements.length === 0
      ? "confirmed" : "not_confirmed";
    p.status = "summary"; enqueue(s, task, 2, at);
  } else if (p.status === "summary") {
    p.summaryId = documentId; p.status = "reported";
    task.steps.at(-1)!.holder = "head-product";
    if (!result || typeof result.outcome !== "string" || !Array.isArray(result.agreed) ||
        !Array.isArray(result.remaining) || !Array.isArray(result.unverified)) p.error = "SUMMARY_FORMAT_UNVERIFIED";
  } else throw Error("SECRETARY_STATE_CHANGED");
}
export function secretaryReserve(s: CrewState, reserve: number, month: string) {
  const b = (s.secretaryBudget ??= {})[month] ??= { spent: 0, reserved: 0, warning: false };
  if (!s.secretarySettings?.enabled || b.spent + b.reserved + reserve > s.secretarySettings.monthlyLimitMicroUsd) return false;
  b.reserved += reserve; return true;
}
export function secretarySettle(s: CrewState, month: string, reserve: number, cost: number) {
  const b = s.secretaryBudget![month]; b.reserved -= reserve; b.spent += cost;
  if (b.spent >= s.secretarySettings!.monthlyLimitMicroUsd * .8) b.warning = true;
}
export function secretaryReviewComplete(s: CrewState, task: Task) {
  const p = task.secretaryReview;
  if (p?.status !== "reported") return false;
  const ids = [p.authorId, p.reviewId, p.summaryId];
  return ids.every((id, i) => {
    const d = s.documents.find(d => d.id === id && d.taskId === task.id && d.agentId === SECRETARY_AGENTS[i].agentId);
    return !!d && s.runs.some(r => r.id === d.runId && r.status === "done" && r.modelId === SECRETARY_AGENTS[i].modelId);
  });
}
