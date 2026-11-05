import { AnthropicCrewProvider } from "../aiCrew/anthropic";
import { SECRETARY_AGENTS, secretaryEvidence, secretaryHash, secretaryInput } from "../aiCrew/secretaryReview";
import { secretaryOutputSchema, validSecretaryOutput } from "../aiCrew/secretaryOutput";
import type { SavedRehearsal } from "./store";
export function validateRehearsalFindings(stage: string, value: any, evidence: ReturnType<typeof secretaryEvidence>) {
  if (!validSecretaryOutput(stage, value)) return false;
  const rows = stage === "author" ? value.points : value.checks;
  const complete = (items: any[]) => items.length === evidence.points.length &&
    new Set(items.map(x => x.index)).size === evidence.points.length &&
    items.every(x => Number.isInteger(x.index) && x.index >= 0 && x.index < evidence.points.length);
  const citation = (item: any) => !item.quote || (Number.isInteger(item.turn) && item.turn >= 0 &&
    evidence.transcript[item.turn]?.text.includes(item.quote));
  if (!complete(rows) || !complete(value.dialogue.checklist) ||
      !rows.every((r: any) => citation(r) && (stage !== "author" ||
        !["выполнено", "частично"].includes(r.status) || !!r.quote || r.kind === "prohibition")) ||
      !value.dialogue.checklist.every((r: any) => citation(r) && (!r.closed || !!r.quote || r.kind === "prohibition")) ||
      !value.manners.every(citation) || (value.opening && !citation(value.opening))) return false;
  if (stage === "review" && value.verdict === "confirmed" && value.disagreements.length) return false;
  return true;
}
/** Same evidence redaction, prompts, models and output schemas as Secretary review.
 * Independent original evidence is supplied to Toma; author output is untrusted. */
export async function reviewRehearsal(row: SavedRehearsal, save: () => Promise<void>,
  client = new AnthropicCrewProvider()) {
  const r = row.report, result = r.rehearsal.review;
  const plan = r.rehearsal.scene.plan;
  const evidence = secretaryEvidence(plan.goal + "\n" + plan.sayAsk.join("\n"), r.turns.map(t => ({
    speaker: t.role, text: t.text,
  })), r.rehearsal.codeVersion, [], ["Sergey"]);
  evidence.limitations.push("Dev role-play, NOT a PSTN call. Text models have NOT listened to audio.",
    "Transcript timestamps and TTFT are not VAD end-to-first-sound measurements.");
  const docs: any[] = [], records: any[] = [];
  let cost = 0;
  for (let index = 0; index < 2; index++) {
    const stage = index === 0 ? "author" : "review";
    const a = SECRETARY_AGENTS[index];
    const task: any = { id: row.id, secretaryReview: { status: stage, evidence, evidenceHash: secretaryHash(evidence),
      outputVersion: 2, characters: {}, authorId: index ? `${row.id}-author` : undefined } };
    const state: any = { agents: SECRETARY_AGENTS, runs: [], documents: docs };
    const input = secretaryInput(state, task, a.agentId, a.modelId);
    if (Buffer.byteLength(input) > 80_000) throw Error("REHEARSAL_REVIEW_INPUT_TOO_LARGE");
    let partial: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const output = await client.message(a.modelId, input, 6000, AbortSignal.timeout(90_000), {
        schema: secretaryOutputSchema(stage), ...(partial ? { partial } : {}),
      });
      if (output.model !== a.modelId) throw Error("REHEARSAL_REVIEW_MODEL_CHANGED");
      const debit = Math.ceil(output.usage.input_tokens * a.inputMicroUsdPerToken +
        output.usage.output_tokens * a.outputMicroUsdPerToken);
      cost += debit;
      records.push({ agentId: a.agentId, model: output.model, ...output.usage, ...output.http, costMicroUsd: debit,
        stopReason: output.stopReason });
      result.costMicroUsd = cost; result.usage = records; await save();
      if (output.stopReason === "max_tokens" && !attempt) { partial = output.text; continue; }
      if (output.stopReason !== "end_turn") throw Error("REHEARSAL_REVIEW_INCOMPLETE");
      let parsed: unknown;
      try { parsed = JSON.parse(output.text); } catch { throw Error("REHEARSAL_REVIEW_INVALID_JSON"); }
      if (!validateRehearsalFindings(stage, parsed, evidence)) throw Error("REHEARSAL_REVIEW_EVIDENCE_INVALID");
      if (!index) { result.leva = parsed; docs.push({ id: `${row.id}-author`, taskId: row.id, text: output.text }); }
      else result.toma = parsed;
      await save();
      break;
    }
  }
  result.status = "completed"; await save();
  return cost;
}
