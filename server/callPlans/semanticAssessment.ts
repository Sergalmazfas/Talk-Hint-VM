import { z } from "zod";
import { callPlanSchema } from "../../shared/callPlan";
import { preparationAssessment, preparationDialogue } from "./assessment";
import { planHash } from "./store";

const rowSchema = z.object({
  guestQuote: z.string().trim().min(1).max(500),
  planIndex: z.number().int().nonnegative().nullable(),
  ownerQuote: z.string().trim().min(1).max(500).nullable(),
  answerMatch: z.enum(["matched", "partial", "different", "unknown"]),
  explanation: z.string().trim().min(1).max(1000),
}).strict();
export const preparationReviewSchema = z.object({
  rows: z.array(rowSchema).max(60), limitations: z.array(z.string().max(500)).max(20),
}).strict();

/** Validates an EXISTING authorized lab analysis + its QA; makes no LLM call.
 * Semantic matching belongs to the judge, while quotes/indices/hash are
 * independently checked by code. Literal plan-word matching is not the judge. */
export function reviewedPreparationAssessment(snapshot: any, transcript: unknown, report: any) {
  const base = preparationAssessment(snapshot, transcript);
  const parsed = callPlanSchema.safeParse(snapshot?.plan);
  if (!parsed.success) return base;
  const unavailable = (reason: string) => ({
    ...base, semanticReview: { status: "not_measured", reason },
  });
  if (snapshot.hash !== planHash(parsed.data)) return unavailable("plan_hash_mismatch");
  if (report?.qa_status !== "QA: принято") return unavailable("qa_not_accepted");
  const review = preparationReviewSchema.safeParse(report.analysis?.preparation);
  if (!review.success) return unavailable("structured_review_unavailable");
  const { owner, guest } = preparationDialogue(transcript);
  if (!owner.length || !guest.length) return unavailable("speaker_evidence_unavailable");
  const quoted = (source: string[], quote: string) => source.some(s => s.toLocaleLowerCase().includes(quote.toLocaleLowerCase()));
  const seen = new Set<string>();
  for (const row of review.data.rows) {
    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|https?:\/\/|(?:\+?\d[\s().-]*){9,}/i
      .test(`${row.guestQuote}\n${row.ownerQuote ?? ""}\n${row.explanation}`))
      return unavailable("private_review_text");
    const key = row.guestQuote.toLocaleLowerCase();
    if (seen.has(key) || !quoted(guest, row.guestQuote)) return unavailable("invalid_guest_evidence");
    seen.add(key);
    if (row.planIndex !== null && row.planIndex >= parsed.data.expectedQuestions.length)
      return unavailable("invalid_plan_index");
    if (row.ownerQuote !== null && !quoted(owner, row.ownerQuote)) return unavailable("invalid_owner_evidence");
    const answer = row.planIndex === null ? null : parsed.data.expectedQuestions[row.planIndex].answer;
    // Null/unknown prepared answers can never count as matched or partial.
    if (row.answerMatch !== "unknown" && (!answer?.trim() || row.ownerQuote === null))
      return unavailable("answer_without_evidence");
  }
  const rows = review.data.rows;
  const covered = rows.filter(r => r.planIndex !== null).length;
  const eligible = rows.filter(r => r.planIndex !== null &&
    parsed.data.expectedQuestions[r.planIndex].answer?.trim());
  const answered = eligible.filter(r => r.ownerQuote !== null && r.answerMatch !== "unknown");
  const matched = answered.filter(r => r.answerMatch === "matched").length;
  return {
    ...base, semanticAssessment: "lab_qa_reviewed",
    semanticReview: {
      status: "lab_qa_reviewed", rows, limitations: review.data.limitations,
      questionsAssessed: rows.length, questionsCovered: covered,
      questionCoveragePercent: rows.length ? Math.round(1000 * covered / rows.length) / 10 : null,
      preparedAnswersAssessed: answered.length, answersMatched: matched,
      answersUnassessed: eligible.length - answered.length,
      answerMatchPercent: answered.length ? Math.round(1000 * matched / answered.length) / 10 : null,
      partialAnswers: answered.filter(r => r.answerMatch === "partial").length,
      basis: "Смысловая оценка существующей лаборатории + QA; цитаты и hash проверены кодом. Только оценённые вопросы, полнота STT не подтверждена.",
    },
    usefulness: "not_measured",
  };
}
