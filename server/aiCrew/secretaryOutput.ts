import { z } from "zod";

const str = { type: "string" }, integer = { type: "integer" };
const object = (properties: Record<string, unknown>) => ({
  type: "object", properties, required: Object.keys(properties), additionalProperties: false,
});
const array = (items: unknown) => ({ type: "array", items });
const strings = array(str);
export const mannerKinds = ["repeat_questions", "multi_questions", "repeat_intro", "recap_words", "thank_you", "got_it"] as const;
const manner = object({ kind: { type: "string", enum: mannerKinds },
  value: { type: ["integer", "null"] }, quote: str, turn: integer, reason: str });
const row = { index: integer, quote: str, turn: integer, reason: str };
const expectationChecks = array(object({ entryId: str, metric: str, actual: { type: ["number", "null"] },
  status: { type: "string", enum: ["сошлось", "не сошлось", "не проверено"] }, reason: str }));
const proposal = object({ status: { type: "string", const: "proposed" }, acceptor: { type: "string", const: "owner" },
  target: { type: "string", enum: ["katya_checklist", "preparation"] }, rule: str, before: str, after: str });
const dialogue = object({
  checklist: array(object({ index: integer, answer: str, closed: { type: "boolean" }, quote: str, turn: integer })),
  katyaTurns: integer, excessTurns: integer,
  hypothetical: { type: "boolean", const: true },
  ideal: array(object({ speaker: { type: "string", enum: ["secretary", "guest"] }, text: str, sourceTurns: array(integer) })),
});
export function secretaryOutputSchema(stage: string) {
  return stage === "author" ? object({
    points: array(object({ ...row, status: { type: "string", enum: ["выполнено", "частично", "нет", "не проверено"] } })),
    openingLanguage: { type: "string", enum: ["en", "ru", "es", "unknown"] },
    recognitionIssues: strings, unverified: strings, manners: array(manner), dialogue, proposals: array(proposal), expectationChecks,
  }) : stage === "review" ? object({
    verdict: { type: "string", enum: ["confirmed", "not_confirmed"] },
    checks: array(object(row)), disagreements: strings, unverified: strings, manners: array(manner), dialogue, expectationChecks,
  }) : object({ outcome: str, agreed: strings, remaining: strings, unverified: strings,
    learned: str, wentWrong: str, nextAction: str, proposals: array(proposal) });
}
const text = z.string().max(6000);
const rows = { index: z.number().int(), quote: text, turn: z.number().int(), reason: text };
const expectationCheckRows = z.array(z.object({ entryId: text, metric: text, actual: z.number().finite().nonnegative().nullable(),
  status: z.enum(["сошлось", "не сошлось", "не проверено"]), reason: text.min(1) }).strict()).max(16);
const manners = z.array(z.object({ kind: z.enum(mannerKinds), value: z.number().int().nonnegative().nullable(),
  quote: text, turn: z.number().int(), reason: text }).strict()).length(mannerKinds.length)
  .refine(a => new Set(a.map(m => m.kind)).size === mannerKinds.length);
const proposals = z.array(z.object({ status: z.literal("proposed"), acceptor: z.literal("owner"),
  target: z.enum(["katya_checklist", "preparation"]), rule: text, before: text, after: text }).strict()).max(5);
const dialogueCheck = z.object({
  checklist: z.array(z.object({ index: z.number().int(), answer: text, closed: z.boolean(), quote: text, turn: z.number().int() }).strict()).max(20),
  katyaTurns: z.number().int().nonnegative(), excessTurns: z.number().int().nonnegative(), hypothetical: z.literal(true),
  ideal: z.array(z.object({ speaker: z.enum(["secretary", "guest"]), text, sourceTurns: z.array(z.number().int()).max(150) }).strict()).max(150),
}).strict();
export function validSecretaryOutput(stage: string, value: unknown) {
  const schema = stage === "author" ? z.object({
    points: z.array(z.object({ ...rows, status: z.enum(["выполнено", "частично", "нет", "не проверено"]) }).strict()).max(20),
    openingLanguage: z.enum(["en", "ru", "es", "unknown"]), recognitionIssues: z.array(text),
    unverified: z.array(text), manners, dialogue: dialogueCheck, proposals, expectationChecks: expectationCheckRows,
  }).strict() : stage === "review" ? z.object({ verdict: z.enum(["confirmed", "not_confirmed"]),
    checks: z.array(z.object(rows).strict()).max(20), disagreements: z.array(text), unverified: z.array(text), manners, dialogue: dialogueCheck, expectationChecks: expectationCheckRows }).strict() :
    z.object({ outcome: text, agreed: z.array(text), remaining: z.array(text), unverified: z.array(text),
      learned: text, wentWrong: text, nextAction: text, proposals }).strict();
  return schema.safeParse(value).success;
}
