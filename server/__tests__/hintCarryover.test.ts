import { describe, it, expect } from "vitest";
import { HintCarryover, combineWithCarryover, CARRYOVER_MAX_AGE_MS } from "../hintCarryover";
import { isQuestionOrActionRequest } from "../waitState";

// ---------------------------------------------------------------------------
// Coverage for the dropped-question carryover (task: don't lose hints when the
// robot speaks several phrases in a burst).
//
// The contract we pin:
//   - a dropped turn containing a QUESTION is remembered; plain statements are not.
//   - consume() returns the pending question once and clears it.
//   - the newest dropped question supersedes an older one.
//   - an expired (too old) question is not resurrected.
//   - combineWithCarryover merges the question into the next turn's text.
//   - burst scenario: 2-3 rapid phrases where the question is in the FIRST one
//     ends with a single hint text that still contains the question.
// ---------------------------------------------------------------------------

describe("HintCarryover", () => {
  it("remembers a dropped turn that contains a question", () => {
    const c = new HintCarryover(isQuestionOrActionRequest);
    const remembered = c.remember("Are you using an iPhone or an Android device?", 13, "stale");
    expect(remembered).toBe(true);
    expect(c.peek()?.text).toBe("Are you using an iPhone or an Android device?");
    expect(c.peek()?.utteranceId).toBe(13);
    expect(c.peek()?.reason).toBe("stale");
  });

  it("does NOT remember a dropped turn without a question", () => {
    const c = new HintCarryover(isQuestionOrActionRequest);
    const remembered = c.remember("We appreciate your patience during this process.", 14, "cooldown");
    expect(remembered).toBe(false);
    expect(c.peek()).toBeNull();
  });

  it("ignores empty / whitespace text", () => {
    const c = new HintCarryover(() => true);
    expect(c.remember("   ", 1, "stale")).toBe(false);
    expect(c.peek()).toBeNull();
  });

  it("consume() returns the pending question once and clears it", () => {
    const c = new HintCarryover(() => true);
    c.remember("What is your account number?", 5, "cooldown");
    const first = c.consume();
    expect(first?.text).toBe("What is your account number?");
    expect(c.consume()).toBeNull();
  });

  it("the newest dropped question wins", () => {
    const c = new HintCarryover(() => true);
    c.remember("What is your name?", 3, "stale");
    c.remember("What is your address?", 4, "stale");
    expect(c.consume()?.text).toBe("What is your address?");
  });

  it("an expired question is not resurrected", () => {
    let now = 1_000_000;
    const c = new HintCarryover(() => true, () => now);
    c.remember("What is your date of birth?", 7, "stale");
    now += CARRYOVER_MAX_AGE_MS + 1;
    expect(c.consume()).toBeNull();
  });

  it("a fresh (not yet expired) question IS returned", () => {
    let now = 1_000_000;
    const c = new HintCarryover(() => true, () => now);
    c.remember("What is your date of birth?", 7, "stale");
    now += CARRYOVER_MAX_AGE_MS - 1;
    expect(c.consume()?.text).toBe("What is your date of birth?");
  });

  it("clear() drops the pending question", () => {
    const c = new HintCarryover(() => true);
    c.remember("Can you confirm your email?", 9, "no_suggestion");
    c.clear();
    expect(c.consume()).toBeNull();
  });
});

describe("combineWithCarryover", () => {
  it("prepends the carried question to the current turn", () => {
    expect(combineWithCarryover("Are you on an iPhone?", "Please open your settings now.")).toBe(
      "Are you on an iPhone? Please open your settings now."
    );
  });

  it("handles empty sides gracefully", () => {
    expect(combineWithCarryover("", "current")).toBe("current");
    expect(combineWithCarryover("pending?", "")).toBe("pending?");
  });
});

// ---------------------------------------------------------------------------
// CONCURRENT burst scenario — mirrors the real websocket handler ordering:
//
//   1. handler entry is SYNCHRONOUS: hintCarryover.beginTurn(text, id)
//      (eagerly captures the still-generating previous turn's question)
//   2. the handler awaits context/translation, then calls
//      buildHintText(turn, isLatest) to construct the model input
//   3. it awaits a (slow, controllable) suggestion promise
//   4. stale guard: if a newer turn arrived meanwhile, the suggestion is
//      dropped WITHOUT re-remembering (beginTurn already captured it)
//   5. finally: finishTurn(turn)
//
// The regression pinned here: phrases 1-3 all arrive BEFORE phrase 1's
// suggestion request resolves. The delivered hint (phrase 3's) must still
// contain phrase 1's question — the eager capture in beginTurn is what makes
// that possible; capturing at the stale guard would be too late.
// ---------------------------------------------------------------------------

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("concurrent burst of rapid phrases (question in the first)", () => {
  // Simulates handleGuestUtteranceComplete/runGuestUtterance concurrency-wise.
  function makePipeline(c: HintCarryover) {
    let latestUtteranceId = -1;
    const delivered: { utteranceId: number; hintText: string }[] = [];
    const dropped: { utteranceId: number; reason: string }[] = [];

    async function handleTurn(
      text: string,
      utteranceId: number,
      suggestion: Promise<unknown> // controllable "LLM" latency
    ) {
      // (1) synchronous entry, exactly like the websocket handler
      const { turn } = c.beginTurn(text, utteranceId);
      latestUtteranceId = utteranceId;
      try {
        // (2) context awaits happen here in prod; then the model input is built
        await Promise.resolve();
        const { hintText } = c.buildHintText(turn, utteranceId === latestUtteranceId);
        // (3) await the suggestion generation
        await suggestion;
        // (4) stale guard — no re-remember (beginTurn captured it eagerly)
        if (utteranceId !== latestUtteranceId) {
          dropped.push({ utteranceId, reason: "stale" });
          return;
        }
        delivered.push({ utteranceId, hintText });
      } finally {
        // (5)
        c.finishTurn(turn);
      }
    }

    return { handleTurn, delivered, dropped };
  }

  it("phrases 1-3 arrive before phrase 1 resolves; delivered phrase-3 hint includes phrase 1's question", async () => {
    const c = new HintCarryover(isQuestionOrActionRequest);
    const { handleTurn, delivered, dropped } = makePipeline(c);

    const s1 = deferred<void>();
    const s2 = deferred<void>();
    const s3 = deferred<void>();

    // All three phrases arrive while phrase 1's suggestion is still in flight.
    const p1 = handleTurn("Are you trying to activate your eSIM today?", 13, s1.promise);
    const p2 = handleTurn("Our support team is available around the clock.", 14, s2.promise);
    const p3 = handleTurn("Thank you for holding, let us continue.", 15, s3.promise);

    // Phrase 3's suggestion resolves FIRST (it's the freshest); then the older ones.
    s3.resolve();
    await p3;
    s1.resolve();
    s2.resolve();
    await Promise.all([p1, p2]);

    expect(delivered).toHaveLength(1);
    expect(delivered[0].utteranceId).toBe(15);
    expect(delivered[0].hintText).toContain("Are you trying to activate your eSIM today?");
    expect(delivered[0].hintText).toContain("Thank you for holding, let us continue.");
    // The older turns were dropped as stale — logged, not silent, not re-remembered.
    expect(dropped.map((d) => d.utteranceId).sort()).toEqual([13, 14]);
    // The question was consumed by the delivered hint; nothing lingers.
    expect(c.consume()).toBeNull();
  });

  it("two-phrase burst: superseded question is merged into phrase 2's hint", async () => {
    const c = new HintCarryover(isQuestionOrActionRequest);
    const { handleTurn, delivered } = makePipeline(c);

    const s1 = deferred<void>();
    const s2 = deferred<void>();
    const p1 = handleTurn("What is the best callback number for you?", 20, s1.promise);
    const p2 = handleTurn("We can also send you a text message.", 21, s2.promise);
    s2.resolve();
    s1.resolve();
    await Promise.all([p1, p2]);

    expect(delivered).toHaveLength(1);
    expect(delivered[0].hintText).toBe(
      "What is the best callback number for you? We can also send you a text message."
    );
  });

  it("a superseded statement (no question) carries nothing — no false merges", async () => {
    const c = new HintCarryover(isQuestionOrActionRequest);
    const { handleTurn, delivered } = makePipeline(c);

    const s1 = deferred<void>();
    const s2 = deferred<void>();
    const p1 = handleTurn("We appreciate your patience.", 30, s1.promise);
    const p2 = handleTurn("Your call is important to us.", 31, s2.promise);
    s2.resolve();
    s1.resolve();
    await Promise.all([p1, p2]);

    expect(delivered).toHaveLength(1);
    expect(delivered[0].hintText).toBe("Your call is important to us.");
  });

  it("sequential turns (previous finished) do not trigger supersede capture", async () => {
    const c = new HintCarryover(isQuestionOrActionRequest);
    const { handleTurn, delivered } = makePipeline(c);

    // Phrase 1 fully completes (delivered) before phrase 2 arrives.
    const s1 = deferred<void>();
    const p1 = handleTurn("Are you using an iPhone?", 40, s1.promise);
    s1.resolve();
    await p1;

    const s2 = deferred<void>();
    const p2 = handleTurn("Please open your settings now.", 41, s2.promise);
    s2.resolve();
    await p2;

    expect(delivered).toHaveLength(2);
    // Phrase 1's question was answered by its own hint — it must NOT leak into phrase 2.
    expect(delivered[1].hintText).toBe("Please open your settings now.");
  });

  it("cooldown-dropped question (remembered explicitly) reaches the next turn's hint", async () => {
    const c = new HintCarryover(isQuestionOrActionRequest);
    // Phrase 1 completes but its hint is blocked by cooldown → handler remembers it.
    const { turn: t1 } = c.beginTurn("What is your account number?", 50);
    const { hintText: h1 } = c.buildHintText(t1, true);
    c.remember(h1, 50, "cooldown");
    c.finishTurn(t1);
    // Phrase 2 arrives later and delivers.
    const { turn: t2 } = c.beginTurn("We can look that up together.", 51);
    const { hintText: h2 } = c.buildHintText(t2, true);
    c.finishTurn(t2);
    expect(h2).toBe("What is your account number? We can look that up together.");
  });

  // Post-generation filters (duplicate_suggestion / repeat_intent /
  // self_overlap) fire AFTER the pending question was consumed into hintText.
  // The websocket handler's dropHint(reason, ..., preserveQuestion=true) calls
  // remember(hintText, ...) at that point — pin that the consumed question
  // survives the suppression and reaches the NEXT turn's hint.
  it("question consumed into a hint that is then suppressed post-generation is re-remembered and reaches the next turn", async () => {
    const c = new HintCarryover(isQuestionOrActionRequest);

    // Turn A: its own hint was dropped (cooldown) → question remembered.
    const { turn: tA } = c.beginTurn("Can you confirm your email address?", 70);
    const { hintText: hA } = c.buildHintText(tA, true);
    c.remember(hA, 70, "cooldown");
    c.finishTurn(tA);

    // Turn B consumes the question, generates a suggestion... which is then
    // suppressed as duplicate_suggestion. dropHint preserves the merged text.
    const { turn: tB } = c.beginTurn("Let me pull up your file.", 71);
    const { hintText: hB, carried } = c.buildHintText(tB, true);
    expect(carried?.utteranceId).toBe(70);
    expect(hB).toContain("Can you confirm your email address?");
    // ...suggestion suppressed post-generation:
    expect(c.remember(hB, 71, "duplicate_suggestion")).toBe(true);
    c.finishTurn(tB);

    // Turn C finally delivers — the question is still in its model input.
    const { turn: tC } = c.beginTurn("Alright, one more thing.", 72);
    const { hintText: hC } = c.buildHintText(tC, true);
    c.finishTurn(tC);
    expect(hC).toContain("Can you confirm your email address?");
    expect(c.consume()).toBeNull();
  });

  it("post-generation suppression of a question-free hint preserves nothing", () => {
    const c = new HintCarryover(isQuestionOrActionRequest);
    const { turn } = c.beginTurn("We value your business.", 80);
    const { hintText } = c.buildHintText(turn, true);
    // dropHint(..., preserveQuestion=true) → remember() declines: no question.
    expect(c.remember(hintText, 80, "self_overlap")).toBe(false);
    c.finishTurn(turn);
    expect(c.peek()).toBeNull();
  });

  it("wantSuggestion=false paths (reaction/farewell/wait) never consume — the pending question stays queued", () => {
    const c = new HintCarryover(isQuestionOrActionRequest);
    c.remember("What time works best for you?", 90, "cooldown");
    // Reaction-only turn: the handler skips buildHintText entirely (hintText =
    // raw text, no consume) and dropHint uses preserveQuestion=false.
    const { turn } = c.beginTurn("Okay, got it.", 91);
    c.finishTurn(turn);
    // The question is still pending for the next eligible turn.
    const { turn: t2 } = c.beginTurn("We are open on Saturdays as well.", 92);
    const { hintText } = c.buildHintText(t2, true);
    c.finishTurn(t2);
    expect(hintText).toContain("What time works best for you?");
  });

  it("question carried into a turn that is itself superseded survives to the third turn", async () => {
    const c = new HintCarryover(isQuestionOrActionRequest);
    const { handleTurn, delivered } = makePipeline(c);

    // Phrase 1 (question) superseded before it even builds its input; phrase 2
    // merges it, but phrase 3 supersedes phrase 2 mid-generation. Phrase 2's
    // handle text was updated with the merge, so beginTurn(3) re-captures the
    // MERGED text and phrase 3 still contains the original question.
    const s1 = deferred<void>();
    const s2 = deferred<void>();
    const s3 = deferred<void>();
    const p1 = handleTurn("Do you have your ID with you?", 60, s1.promise);
    // Let phrase 1 pass its buildHintText microtask before phrase 2 arrives.
    await Promise.resolve();
    const p2 = handleTurn("It will only take a minute.", 61, s2.promise);
    await Promise.resolve();
    const p3 = handleTurn("Alright, moving on to the next step.", 62, s3.promise);
    s3.resolve();
    await p3;
    s1.resolve();
    s2.resolve();
    await Promise.all([p1, p2]);

    expect(delivered).toHaveLength(1);
    expect(delivered[0].utteranceId).toBe(62);
    expect(delivered[0].hintText).toContain("Do you have your ID with you?");
  });
});
