import { createHash } from "node:crypto";
import type { ProjectModelState } from "../../shared/projectModel";
import { expectedResultSchema, type ExpectedResult } from "../../shared/journalExpectation";

export type ExpectationTarget = ExpectedResult["metrics"][number] & { entryId: string; recordedAt: string };
export type ExpectationSnapshot = {
  documentId: string; documentHash: string;
  status: "available" | "not_recorded_before_call" | "unreadable" | "call_start_unknown";
  targets: ExpectationTarget[];
};
const id = "DOC-TALKHINT-IMPROVEMENT-JOURNAL";
/** A client-supplied historical date must never backdate an expectation. */
export function selectCallExpectations(model: ProjectModelState, startedAt: unknown): ExpectationSnapshot {
  const doc = model.documents.find(d => d.id === id);
  const result: ExpectationSnapshot = { documentId: id,
    documentHash: createHash("sha256").update(doc?.text ?? "").digest("hex"),
    status: "not_recorded_before_call", targets: [] };
  const start = typeof startedAt === "string" || startedAt instanceof Date ? new Date(startedAt).getTime() : NaN;
  if (!Number.isFinite(start)) return { ...result, status: "call_start_unknown" };
  if (!doc) return result;
  try {
    const journal = JSON.parse(doc.text);
    if (journal.format !== "talkhint.improvement-journal" || !Array.isArray(journal.crewJournalEntries))
      return { ...result, status: "unreadable" };
    const entries = journal.crewJournalEntries.slice().reverse().filter((e: any) => typeof e?.id === "string" &&
      Number.isFinite(Date.parse(e.expectedResultRecordedAt)) && Date.parse(e.expectedResultRecordedAt) <= start)
      .sort((a: any, b: any) => Date.parse(b.expectedResultRecordedAt) - Date.parse(a.expectedResultRecordedAt));
    const metrics = new Map<string, ExpectationTarget>();
    for (const entry of entries) {
      const parsed = expectedResultSchema.safeParse(entry.expectedResult);
      if (!parsed.success || parsed.data.appliesTo !== "secretary_call" ||
          !entry.targetRoleIds?.some((r: string) => ["secretary-lab-engineer", "secretary-qa", "secretary-project-head"].includes(r))) continue;
      for (const target of parsed.data.metrics)
        if (!metrics.has(target.metric)) metrics.set(target.metric, { ...target, entryId: entry.id, recordedAt: entry.expectedResultRecordedAt });
    }
    // Never silently drop a target to fit the prompt.
    if (metrics.size > 16) return { ...result, status: "unreadable" };
    return { ...result, status: metrics.size ? "available" : "not_recorded_before_call", targets: Array.from(metrics.values()) };
  } catch { return { ...result, status: "unreadable" }; }
}
export function compareExpectations(snapshot: ExpectationSnapshot | undefined, output: any, secretaryTurns: number) {
  return (snapshot?.targets ?? []).map(t => {
    const raw = t.metric === "katya_turns" && t.unit === "turns" ? secretaryTurns :
      t.metric === "repeat_questions" && t.unit === "repeats" ?
        (Array.isArray(output?.manners) ? output.manners.find((m: any) => m?.kind === "repeat_questions")?.value : null) :
      t.metric === "excess_turns" && t.unit === "turns" ? output?.dialogue?.excessTurns : null;
    const actual = typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;
    const matched = actual === null ? null : t.operator === "lte" ? actual <= t.value : t.operator === "gte" ? actual >= t.value : actual === t.value;
    return { entryId: t.entryId, metric: t.metric, actual,
      status: matched === null ? "не проверено" : matched ? "сошлось" : "не сошлось" };
  });
}
export function callExpectation(snapshot: ExpectationSnapshot | undefined): ExpectedResult | undefined {
  return snapshot?.targets.length ? { text: "Числовые ожидания из журнала до начала звонка",
    appliesTo: "secretary_call", metrics: snapshot.targets.map(({ metric, operator, value, unit }) => ({ metric, operator, value, unit })) } : undefined;
}
export function validExpectationChecks(snapshot: ExpectationSnapshot | undefined, output: any, secretaryTurns: number) {
  const expected = compareExpectations(snapshot, output, secretaryTurns), rows = output?.expectationChecks;
  return Array.isArray(rows) && rows.length === expected.length &&
    new Set(rows.map((r: any) => `${r?.entryId}:${r?.metric}`)).size === rows.length &&
    expected.every(e => rows.some((r: any) => r?.entryId === e.entryId && r.metric === e.metric &&
      r.actual === e.actual && r.status === e.status && typeof r.reason === "string" && !!r.reason.trim()));
}
