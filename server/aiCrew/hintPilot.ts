import { randomUUID } from "node:crypto";
import type { CrewState, Task } from "./domain";
import { evidenceHash, HINT_CANDIDATES, type HintCandidate, type HintEvidence } from "./hintEvidence";

export const HINT_MAX_OUTPUT = 2000;
export const HINT_PRICING_URL = "https://platform.claude.com/docs/en/about-claude/pricing#model-pricing";
// USD per million == microUSD per token; standard synchronous API, no caching,
// no fast/batch/geographic multiplier. Owner must explicitly confirm rates.
export const HINT_AGENTS = [
  { agentId: "product-manager-specialist", modelId: "claude-sonnet-5-5", inputMicroUsdPerToken: 2, outputMicroUsdPerToken: 10 },
  { agentId: "Hint-lg-qa-role", modelId: "claude-opus-5-5", inputMicroUsdPerToken: 4, outputMicroUsdPerToken: 20 },
] as const;
export type HintPilot = { candidate: HintCandidate; evidence: HintEvidence; evidenceHash: string;
  ownerId: string; status: "prepared" | "author" | "review" | "owner";
  proposalId?: string; reviewId?: string; verdict?: "confirmed" | "not_confirmed";
  ratesConfirmedBy: string; pricingUrl: string };

export function prepareHintPilot(s: CrewState, candidate: HintCandidate, evidence: HintEvidence, actor: string, at: string, models: string[]) {
  if (s.control.enabled || s.control.dailyLimitMicroUsd !== 0) throw Error("PREPARE_REQUIRES_OFF_ZERO");
  if (s.tasks.some(t => t.hintPilot && !t.closed)) throw Error("ONE_PILOT_TASK_ONLY");
  if (!HINT_AGENTS.every(a => models.includes(a.modelId))) throw Error("PILOT_MODELS_UNVERIFIED");
  if (!evidence.calls.length && !evidence.reports.length && !evidence.problems.length) throw Error("NO_HINT_EVIDENCE");
  if (candidate === "latency" && !evidence.calls.some(c => c.latency.e2eP95Ms != null && c.slaMs != null && c.latency.e2eP95Ms > c.slaMs) ||
      candidate === "usefulness" && !evidence.calls.some(c => (c.usage.delivered ?? 0) > 0 && c.usage.usageRatePct != null && c.usage.usageRatePct < 50) ||
      candidate === "unavailable" && !evidence.problems.some(p => p.code === "ANALYSIS_UNAVAILABLE" && (p.count ?? 0) > 0))
    throw Error("CANDIDATE_NOT_SUPPORTED_BY_EXCERPT");
  // Re-project elsewhere before passing here; this object is produced only by
  // server SELECTs, never accepted from the HTTP request body.
  for (const agent of HINT_AGENTS) s.agents = [...s.agents.filter(a => a.agentId !== agent.agentId), { ...agent }];
  const task: Task = { id: randomUUID(), title: HINT_CANDIDATES[candidate], phase: "analysis", closed: false,
    steps: [{ phase: "problem", holder: actor, updatedAt: at, actor, note: HINT_CANDIDATES[candidate] },
      { phase: "analysis", holder: HINT_AGENTS[0].agentId, updatedAt: at, actor, note: "Пилот подготовлен; запуск требует отдельного решения владельца" }],
    hintPilot: { candidate, evidence, evidenceHash: evidenceHash(evidence), ownerId: actor, status: "prepared",
      ratesConfirmedBy: actor, pricingUrl: HINT_PRICING_URL } };
  s.tasks.push(task);
  return task;
}
export function startHintPilot(s: CrewState, task: Task, actor: string, at: string) {
  const p = task.hintPilot;
  if (!p || p.ownerId !== actor || p.status !== "prepared" || task.phase !== "analysis") throw Error("PILOT_NOT_STARTABLE");
  if (!s.control.enabled || s.control.dailyLimitMicroUsd <= 0) throw Error("PILOT_DISABLED");
  p.status = "author";
  s.runs.push({ id: randomUUID(), taskId: task.id, agentId: HINT_AGENTS[0].agentId,
    eventId: `hint-author:${task.id}`, at, status: "queued" });
}
export function pilotInput(s: CrewState, task: Task, agentId: string, modelId: string): string {
  const p = task.hintPilot!;
  if (evidenceHash(p.evidence) !== p.evidenceHash) throw Error("EVIDENCE_CHANGED");
  const expected = p.status === "author" ? HINT_AGENTS[0] : p.status === "review" ? HINT_AGENTS[1] : null;
  const actual = s.agents.find(a => a.agentId === agentId);
  if (!expected || expected.agentId !== agentId || modelId !== expected.modelId ||
      actual?.inputMicroUsdPerToken !== expected.inputMicroUsdPerToken ||
      actual?.outputMicroUsdPerToken !== expected.outputMicroUsdPerToken) throw Error("PILOT_ASSIGNMENT_CHANGED");
  const proposal = p.proposalId ? s.documents.find(d => d.id === p.proposalId && d.agentId === HINT_AGENTS[0].agentId && d.taskId === task.id) : null;
  if (p.status === "review" && !proposal) throw Error("AUTHOR_PROPOSAL_REQUIRED");
  return JSON.stringify({ role: expected.agentId, task: HINT_CANDIDATES[p.candidate],
    evidenceHash: p.evidenceHash, evidence: p.evidence,
    instruction: p.status === "author"
      ? "Паша: разбор → предложение. Отдельно факты, гипотезы, пробелы, варианты проверки. До 2000 токенов. Только описание, никаких действий."
      : "Фома: независимо проверь предложение Паши по тем же фактам. Ответ строго JSON: {\"verdict\":\"confirmed\" или \"not_confirmed\",\"analysis\":\"обоснование, расхождения, что не проверено\"}. Это проверка разбора, НЕ приёмка продукта. До 2000 токенов. Ничего не выполнять.",
    ...(proposal ? { untrustedAuthorProposal: proposal.text } : {}),
  });
}
export function finishPilotRun(s: CrewState, task: Task, documentId: string, text: string, at: string) {
  const p = task.hintPilot!;
  if (p.status === "author") {
    p.proposalId = documentId; p.status = "review";
    task.steps.at(-1)!.holder = HINT_AGENTS[1].agentId;
    s.runs.push({ id: randomUUID(), taskId: task.id, agentId: HINT_AGENTS[1].agentId,
      eventId: `hint-review:${task.id}:${documentId}`, at, status: "queued" });
  } else if (p.status === "review") {
    p.reviewId = documentId;
    try {
      const v = JSON.parse(text);
      if (!["confirmed", "not_confirmed"].includes(v.verdict) || typeof v.analysis !== "string" || !v.analysis.trim()) throw Error();
      p.verdict = v.verdict;
    } catch {
      // Invalid/truncated review is NOT confirmation. Owner sees raw proposal,
      // journal failure and explicit not_confirmed; no automatic paid retry.
      p.verdict = "not_confirmed";
    }
    p.status = "owner"; task.steps.at(-1)!.holder = p.ownerId;
  } else throw Error("PILOT_STATE_CHANGED");
}
export function pilotReviewComplete(s: CrewState, task: Task) {
  const p = task.hintPilot;
  if (!p || p.status !== "owner" || !p.proposalId || !p.reviewId) return false;
  const author = s.documents.find(d => d.id === p.proposalId && d.agentId === HINT_AGENTS[0].agentId && d.taskId === task.id);
  const review = s.documents.find(d => d.id === p.reviewId && d.agentId === HINT_AGENTS[1].agentId && d.taskId === task.id);
  const runs = [author, review].map(d => s.runs.find(r => r.id === d?.runId && r.status === "done"));
  return !!author && !!review && !!runs[0] && !!runs[1] && runs[0].modelId !== runs[1].modelId;
}
