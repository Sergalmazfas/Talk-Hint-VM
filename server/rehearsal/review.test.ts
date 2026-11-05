import { describe, expect, it, vi } from "vitest";
import { reviewRehearsal, validateRehearsalFindings } from "./review";
import { secretaryEvidence, SECRETARY_AGENTS } from "../aiCrew/secretaryReview";
import { mannerKinds } from "../aiCrew/secretaryOutput";
import { defaultRehearsalScenes, rehearsalVersions } from "./catalog";
function findings(stage: string, evidence: ReturnType<typeof secretaryEvidence>) {
  const common = { manners: mannerKinds.map(kind => ({ kind, value: null, quote: "", turn: -1, reason: "Not measured" })),
    unverified: ["Audio has not been listened to"], expectationChecks: [],
    dialogue: { checklist: evidence.points.map((_, index) => ({ index, kind: "ask", answer: "Unknown", closed: false, quote: "", turn: -1 })),
      katyaTurns: 1, excessTurns: 0, hypothetical: true, ideal: [] } };
  return stage === "author" ? { ...common, points: evidence.points.map((_, index) => ({
    index, kind: "ask", status: "не проверено", quote: "", turn: -1, reason: "No evidence",
  })), openingLanguage: "en", recognitionIssues: [], proposals: [] } :
    { ...common, verdict: "not_confirmed", checks: evidence.points.map((_, index) => ({
      index, kind: "ask", quote: "", turn: -1, reason: "No evidence",
    })), disagreements: ["Missing answers"] };
}
describe("Leva → independent Toma under the production evidence contract", () => {
  const evidence = () => secretaryEvidence("Ask price", [{ speaker: "guest", text: "The price is $150" }], "fixture");
  it("rejects an empty or fabricated review rather than confirming it", () => {
    const e = evidence(), a: any = findings("author", e);
    expect(validateRehearsalFindings("author", a, e)).toBe(true);
    a.points = []; expect(validateRehearsalFindings("author", a, e)).toBe(false);
    const fake: any = findings("author", e); fake.points[0] = {
      index: 0, kind: "ask", status: "выполнено", quote: "$999", turn: 0, reason: "invented",
    };
    expect(validateRehearsalFindings("author", fake, e)).toBe(false);
  });
  it("cannot confirm a review which contains disagreements", () => {
    const e = evidence(), review: any = findings("review", e); review.verdict = "confirmed";
    expect(validateRehearsalFindings("review", review, e)).toBe(false);
  });
  function fixture() {
    const scene = defaultRehearsalScenes()[0], version = rehearsalVersions()[1];
    return { id: "r", report: { turns: [{ role: "guest", text: "There is a tire for $150", atMs: 1000 }],
      rehearsal: { scene, version, codeVersion: version.hash, review: { status: "running" } } } } as any;
  }
  it("uses two different models, 6000-token structured outputs, original evidence for Toma", async () => {
    const row = fixture(), calls: any[] = [];
    const fake = { message: vi.fn(async (model, input, max, signal, options) => {
      const body = JSON.parse(input), stage = calls.length ? "review" : "author";
      calls.push({ model, body, max, options });
      return { model, text: JSON.stringify(findings(stage, body.evidence)), usage: { input_tokens: 10, output_tokens: 20 },
        http: { httpStatus: 200, requestId: "req_fixture" }, stopReason: "end_turn" };
    }) };
    const save = vi.fn().mockResolvedValue(undefined);
    const cost = await reviewRehearsal(row, save, fake as any);
    expect(calls.map(c => c.model)).toEqual(SECRETARY_AGENTS.slice(0, 2).map(a => a.modelId));
    expect(calls[0].model).not.toBe(calls[1].model);
    expect(calls.every(c => c.max === 6000 && c.options.schema.additionalProperties === false)).toBe(true);
    expect(calls[1].body.evidence).toEqual(calls[0].body.evidence);
    expect(calls[1].body.untrustedAuthor).toBeTruthy();
    expect(row.report.rehearsal.review.status).toBe("completed");
    expect(cost).toBeGreaterThan(0);
  });
  it("does not retry a provider unknown or continue to Toma", async () => {
    const row = fixture(), fake = { message: vi.fn().mockRejectedValue(Error("usage unknown")) };
    await expect(reviewRehearsal(row, vi.fn(), fake as any)).rejects.toThrow("unknown");
    expect(fake.message).toHaveBeenCalledOnce();
  });
});
