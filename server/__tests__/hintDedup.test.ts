import { describe, it, expect } from "vitest";
import {
  SuggestionDedupGuard,
  DUPLICATE_SIMILARITY,
  SELF_OVERLAP_SIMILARITY,
  MAX_DUP_EXEMPTIONS_PER_QUESTION,
} from "../hintDedup";
import { HintCarryover } from "../hintCarryover";
import { isQuestionOrActionRequest } from "../waitState";
import { textSimilarity } from "../dialogueMatch";

// ---------------------------------------------------------------------------
// Coverage for the duplicate-suggestion re-show exemption (task: the bot on a
// real call asked "Mint phone number or home Internet?" twice; both answers
// were >=80% similar so the dup filter suppressed the second one — user saw
// ONE hint for the whole call).
//
// The contract we pin:
//   - a repeated GUEST QUESTION may re-show a similar hint exactly ONCE
//     (per normalized question);
//   - a THIRD repeat of the same question is suppressed again (looping IVR);
//   - a NON-question guest turn with a similar hint is suppressed as before
//     and (in the pipeline) the drop goes through the carryover path;
//   - self_overlap behaves exactly as before — the question exemption never
//     bypasses it;
//   - reset() clears per-call exemption state.
// ---------------------------------------------------------------------------

// A tiny pipeline harness mirroring the websocket handler's guard section:
// recentSuggestions window + carryover on drop. Keeps tests at the "pipeline"
// level the task asks for, without dragging in Twilio/Deepgram plumbing.
function makePipeline() {
  const guard = new SuggestionDedupGuard();
  const carryover = new HintCarryover();
  const recentSuggestions: string[] = [];
  const recentOwnerUtterances: string[] = [];
  const shown: string[] = [];
  const drops: { reason: string; guestText: string }[] = [];
  let nextUtteranceId = 1;

  /** Run one guest turn through the guard, like runGuestUtterance's tail. */
  function runGuestTurn(guestText: string, suggestionText: string) {
    const utteranceId = nextUtteranceId++;
    const decision = guard.evaluate({
      suggestionText,
      guestText,
      recentSuggestions,
      recentOwnerUtterances,
    });
    if (decision.action === "drop") {
      drops.push({ reason: decision.reason, guestText });
      // Mirrors dropHint(..., preserveQuestion=true): a dropped hint's guest
      // text goes to the carryover so a question isn't lost forever.
      carryover.remember(guestText, utteranceId, decision.reason);
      return decision;
    }
    shown.push(suggestionText);
    recentSuggestions.push(suggestionText);
    if (recentSuggestions.length > 4) recentSuggestions.shift();
    return decision;
  }

  return { guard, carryover, recentSuggestions, recentOwnerUtterances, shown, drops, runGuestTurn };
}

const QUESTION = "Is this for your Mint phone number or your home Internet?";
const REASKED = "Sorry — is this for your Mint phone number or home Internet?";
const ANSWER_HINT = "It's for my Mint phone number.";
const SIMILAR_HINT = "It's for my Mint phone number, please."; // 6/7 shared words → ~0.86 Jaccard

describe("SuggestionDedupGuard — re-asked question exemption", () => {
  it("sanity: fixtures actually trip the thresholds", () => {
    expect(textSimilarity(ANSWER_HINT, SIMILAR_HINT)).toBeGreaterThanOrEqual(DUPLICATE_SIMILARITY);
    expect(isQuestionOrActionRequest(QUESTION)).toBe(true);
    expect(MAX_DUP_EXEMPTIONS_PER_QUESTION).toBe(1);
  });

  it("shows a similar hint a SECOND time when the guest re-asks the question", () => {
    const p = makePipeline();
    expect(p.runGuestTurn(QUESTION, ANSWER_HINT).action).toBe("show");
    // Bot re-asks nearly the same question; model produces a near-identical hint.
    const second = p.runGuestTurn(REASKED, SIMILAR_HINT);
    expect(second.action).toBe("show_exempt");
    expect(p.shown).toEqual([ANSWER_HINT, SIMILAR_HINT]);
    expect(p.drops).toHaveLength(0);
  });

  it("suppresses the THIRD repeat of the same normalized question (looping IVR)", () => {
    const p = makePipeline();
    p.runGuestTurn(QUESTION, ANSWER_HINT);
    expect(p.runGuestTurn(REASKED, SIMILAR_HINT).action).toBe("show_exempt");
    // Same (normalized) re-asked question again → exemption is used up.
    const third = p.runGuestTurn(REASKED, SIMILAR_HINT);
    expect(third.action).toBe("drop");
    expect(third.action === "drop" && third.reason).toBe("duplicate_suggestion");
    expect(p.shown).toHaveLength(2);
  });

  it("each DIFFERENT normalized question gets its own single exemption", () => {
    const p = makePipeline();
    p.runGuestTurn(QUESTION, ANSWER_HINT);
    expect(p.runGuestTurn(REASKED, SIMILAR_HINT).action).toBe("show_exempt");
    const other = "Could you tell me which plan are you on?";
    expect(p.runGuestTurn(other, SIMILAR_HINT).action).toBe("show_exempt");
    // ...but repeating THAT question again is suppressed too.
    expect(p.runGuestTurn(other, SIMILAR_HINT).action).toBe("drop");
  });

  it("exemption keys on the NORMALIZED question (punctuation/case don't reset the cap)", () => {
    const p = makePipeline();
    p.runGuestTurn(QUESTION, ANSWER_HINT);
    expect(p.runGuestTurn("Are you calling about billing?", SIMILAR_HINT).action).toBe("show_exempt");
    expect(p.runGuestTurn("are you calling about BILLING", SIMILAR_HINT).action).toBe("drop");
  });

  it("suppresses a similar hint when the guest turn is NOT a question, and the drop goes through the carryover path", () => {
    const p = makePipeline();
    p.runGuestTurn(QUESTION, ANSWER_HINT);
    const statement = "Okay, I'm pulling up your Mint account details now.";
    expect(isQuestionOrActionRequest(statement)).toBe(false);
    const res = p.runGuestTurn(statement, SIMILAR_HINT);
    expect(res.action).toBe("drop");
    expect(res.action === "drop" && res.reason).toBe("duplicate_suggestion");
    // The pipeline routed the drop into the carryover (which itself only
    // remembers questions — a plain statement is safe to lose).
    expect(p.drops).toEqual([{ reason: "duplicate_suggestion", guestText: statement }]);
    expect(p.carryover.peek()).toBeNull();
  });

  it("a dropped duplicate whose guest text IS a question (but exemption exhausted) is preserved in carryover", () => {
    const p = makePipeline();
    p.runGuestTurn(QUESTION, ANSWER_HINT);
    p.runGuestTurn(REASKED, SIMILAR_HINT); // uses the exemption
    p.runGuestTurn(REASKED, SIMILAR_HINT); // suppressed → carryover
    expect(p.carryover.peek()?.text).toBe(REASKED);
    expect(p.carryover.peek()?.reason).toBe("duplicate_suggestion");
  });
});

describe("SuggestionDedupGuard — self_overlap unchanged", () => {
  it("drops a suggestion HON already said, even when the guest asked a question", () => {
    const p = makePipeline();
    p.recentOwnerUtterances.push("It's for my Mint phone number.");
    const res = p.runGuestTurn(QUESTION, SIMILAR_HINT);
    expect(res.action).toBe("drop");
    expect(res.action === "drop" && res.reason).toBe("self_overlap");
  });

  it("the question exemption never bypasses self-overlap (dup + self-overlap both trip)", () => {
    const p = makePipeline();
    p.runGuestTurn(QUESTION, ANSWER_HINT);
    p.recentOwnerUtterances.push(ANSWER_HINT); // HON actually said it
    const res = p.runGuestTurn(REASKED, SIMILAR_HINT); // exemption would fire...
    expect(res.action).toBe("drop");
    expect(res.action === "drop" && res.reason).toBe("self_overlap");
  });

  it("does not drop below the self-overlap threshold", () => {
    const guard = new SuggestionDedupGuard({ similarity: () => SELF_OVERLAP_SIMILARITY - 0.01 });
    const res = guard.evaluate({
      suggestionText: "anything",
      guestText: "anything",
      recentSuggestions: ["x"],
      recentOwnerUtterances: ["y"],
    });
    expect(res.action).toBe("show");
  });
});

describe("SuggestionDedupGuard — reset()", () => {
  it("clears per-call exemption counts so a new call starts fresh", () => {
    const p = makePipeline();
    p.runGuestTurn(QUESTION, ANSWER_HINT);
    p.runGuestTurn(REASKED, SIMILAR_HINT); // exemption used
    expect(p.runGuestTurn(REASKED, SIMILAR_HINT).action).toBe("drop");
    p.guard.reset();
    // Same question after reset → exemption available again.
    expect(p.runGuestTurn(REASKED, SIMILAR_HINT).action).toBe("show_exempt");
  });
});
