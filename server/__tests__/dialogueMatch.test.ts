import { describe, it, expect } from "vitest";
import {
  selectActiveLibrary,
  matchDialogueLibrary,
  DIALOGUE_MATCH_THRESHOLD,
  DIALOGUE_GOAL_SELECT_THRESHOLD,
} from "../dialogueMatch";
import type { DialogueLibrary, DialogueEntry } from "@shared/schema";

// Helper to build a minimal DialogueLibrary row for selection/matching tests.
function lib(
  id: string,
  goalType: string,
  goalText: string,
  entries: Partial<DialogueEntry>[] = [],
): DialogueLibrary {
  return {
    id,
    userId: "u1",
    goalType,
    goalText,
    entries: entries.map((e, i) => ({
      id: e.id ?? `e${i}`,
      type: (e.type ?? "typical") as DialogueEntry["type"],
      trigger: e.trigger ?? "",
      variants: e.variants ?? [],
      answer: e.answer ?? "",
      translation: e.translation ?? "",
      slot: e.slot ?? null,
      sortOrder: e.sortOrder ?? i,
    })),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as DialogueLibrary;
}

describe("selectActiveLibrary — the RIGHT library is chosen per goal", () => {
  it("returns null when the user has no libraries", () => {
    expect(selectActiveLibrary([], "book a haircut", "booking")).toBeNull();
  });

  it("picks the library whose goalText matches the active goal, not just the first", () => {
    // Two similar goals of the SAME goalType (e.g. two CDL interviews).
    const cdlSwift = lib("A", "other", "CDL interview at Swift Transport");
    const cdlKnight = lib("B", "other", "CDL interview at Knight trucking company");
    const libs = [cdlSwift, cdlKnight];

    // Active goal clearly names Knight → must resolve to B, even though A is first.
    const chosen = selectActiveLibrary(libs, "CDL interview at Knight trucking company", "other");
    expect(chosen?.id).toBe("B");
  });

  it("distinguishes different domains by goalText even when goalType differs", () => {
    const sale = lib("S", "negotiation", "sell the premium marketing package");
    const doctor = lib("D", "booking", "book an appointment with the doctor");
    const libs = [sale, doctor];

    expect(selectActiveLibrary(libs, "book an appointment with the doctor", "booking")?.id).toBe("D");
    expect(selectActiveLibrary(libs, "sell the premium marketing package", "negotiation")?.id).toBe("S");
  });

  it("falls back to the detected goalType when goal text is not confident", () => {
    const booking = lib("A", "booking", "schedule a salon visit");
    const pricing = lib("B", "pricing", "quote a price for the roof job");
    const libs = [booking, pricing];

    // Unrelated goal text (below the confident threshold) → domain fallback.
    const chosen = selectActiveLibrary(libs, "zzz totally unrelated phrase", "pricing");
    expect(chosen?.id).toBe("B");
  });

  it("returns null when nothing matches and no library shares the domain", () => {
    const booking = lib("A", "booking", "schedule a salon visit");
    expect(selectActiveLibrary([booking], "unrelated", "support")).toBeNull();
  });

  it("with several same-domain libraries and an active goal, prefers the best in-domain match", () => {
    const v1 = lib("A", "other", "recruiter call for warehouse associate role");
    const v2 = lib("B", "other", "recruiter call for senior software engineer position");
    const libs = [v1, v2];
    // Below the confident global threshold but clearly closer to B within the domain.
    const chosen = selectActiveLibrary(libs, "recruiter call senior software engineer", "other");
    expect(chosen?.id).toBe("B");
  });
});

describe("matchDialogueLibrary — library-first hit vs GPT fallback (null)", () => {
  const libs = [
    lib("A", "booking", "book a haircut appointment", [
      { trigger: "how much does a haircut cost", variants: ["what is the price of a haircut"], answer: "A haircut is $30.", translation: "Стрижка стоит 30 долларов." },
      { trigger: "what are your opening hours", variants: [], answer: "We are open 9 to 6.", translation: "Мы работаем с 9 до 6." },
    ]),
  ];

  it("returns a library entry when the utterance is close to a trigger/variant", () => {
    const hit = matchDialogueLibrary(libs, "how much does a haircut cost", "book a haircut appointment", "booking");
    expect(hit).not.toBeNull();
    expect(hit!.entry.answer).toBe("A haircut is $30.");
    expect(hit!.library.id).toBe("A");
  });

  it("matches on a variant paraphrase too", () => {
    const hit = matchDialogueLibrary(libs, "what is the price of a haircut", "book a haircut appointment", "booking");
    expect(hit?.entry.answer).toBe("A haircut is $30.");
  });

  it("returns null (→ GPT fallback) when no entry is similar enough", () => {
    const miss = matchDialogueLibrary(libs, "do you sell birthday cakes", "book a haircut appointment", "booking");
    expect(miss).toBeNull();
  });

  it("returns null when no library exists at all (→ GPT fallback)", () => {
    expect(matchDialogueLibrary([], "anything", "some goal", "booking")).toBeNull();
  });

  it("matches against the EDITED entries (uses whatever the library currently holds)", () => {
    // Simulate a post-edit library: the answer text was changed by the user.
    const edited = [
      lib("A", "booking", "book a haircut appointment", [
        { trigger: "how much does a haircut cost", answer: "A haircut is now $45 after our update.", translation: "Теперь стрижка стоит 45 долларов." },
      ]),
    ];
    const hit = matchDialogueLibrary(edited, "how much does a haircut cost", "book a haircut appointment", "booking");
    expect(hit?.entry.answer).toBe("A haircut is now $45 after our update.");
  });

  it("thresholds are the documented values", () => {
    expect(DIALOGUE_MATCH_THRESHOLD).toBe(0.6);
    expect(DIALOGUE_GOAL_SELECT_THRESHOLD).toBe(0.35);
  });
});
