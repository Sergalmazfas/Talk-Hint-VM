import { callPlanSchema } from "../../shared/callPlan";

const normalized = (s: string) => s.toLocaleLowerCase().replace(new RegExp("[^\\p{L}\\p{N}]+", "gu"), " ").trim();
const contains = (haystack: string, needle: string) => !!needle && (` ${haystack} `).includes(` ${needle} `);
export function preparationDialogue(transcript: unknown) {
  const owner: string[] = [], guest: string[] = [];
  for (const line of typeof transcript === "string" ? transcript.split("\n") : []) {
    const match = line.match(/^\s*(?:\[[^\]]+\]\s*)?(Owner|Guest|GST|OWN)\s*:\s*(.*)$/i);
    if (match) (/^(owner|own)$/i.test(match[1]) ? owner : guest).push(match[2]);
  }
  return { owner, guest };
}
/**
 * Free conservative P.PREP evidence, not a semantic judge or an assertion of usefulness.
 * Raw/speaker-ambiguous transcripts never acquire invented question/answer percentages.
 */
export function preparationAssessment(snapshot: any, transcript: unknown) {
  const parsed = callPlanSchema.safeParse(snapshot?.plan);
  if (!parsed.success) return { role: "P.PREP", status: "no_valid_plan", semanticAssessment: "not_measured" };
  const dialogue = preparationDialogue(transcript);
  const owner = dialogue.owner.map(normalized), guest = dialogue.guest.map(normalized);
  const rows = parsed.data.expectedQuestions.map((v, index) => ({
    index, question: v.q, answer: v.answer,
    exactQuestionObserved: guest.length ? guest.some(s => contains(s, normalized(v.q))) : null,
    exactAnswerObserved: v.answer?.trim() && owner.length ? owner.some(s => contains(s, normalized(v.answer!))) : null,
  }));
  return {
    role: "P.PREP", status: owner.length && guest.length ? "text_evidence_only" : "speaker_evidence_unavailable",
    planId: snapshot.id, planHash: snapshot.hash, rows,
    expectedQuestions: rows.length,
    exactQuestionsObserved: guest.length ? rows.filter(r => r.exactQuestionObserved === true).length : null,
    exactAnswersObserved: owner.length ? rows.filter(r => r.exactAnswerObserved === true).length : null,
    semanticAssessment: "not_measured", usefulness: "not_measured",
    limitations: ["Только точные текстовые совпадения в распознанной речи, не семантическая оценка.",
      "Нет совпадения не означает промах; перефразирование и язык могут отличаться.",
      "Совпадение ответа не доказывает, что владелец прочитал подсказку или счёл её полезной.",
      "Самостоятельный агент P.PREP не включён."],
  };
}
