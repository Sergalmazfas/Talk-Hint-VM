// Tests for the goal-return analysis (Task #227): transcript parsing,
// fail-closed judge-label validation, metrics (episodes/returns/owner moves),
// judge call with mocked fetch, and honest report rendering.

import { describe, it, expect } from "vitest";
import {
  parseTranscriptTurns,
  validateGoalReturnLabels,
  computeGoalReturnMetrics,
  judgeGoalReturn,
  generateGoalReturnReport,
  buildGoalReturnUserPrompt,
  hintTextSimilarity,
  findSpokenMatch,
  validateHintLabels,
  judgeDeliveredHints,
  computeHintMetrics,
  SPOKEN_MATCH_THRESHOLD,
  type GoalReturnTurn,
  type TurnLabel,
  type DeliveredHint,
} from "../benchmark/goalReturn";

const T = (idx: number, role: "owner" | "guest", text: string): GoalReturnTurn => ({ idx, role, text });
const L = (idx: number, segment: TurnLabel["segment"], ownerMove: TurnLabel["ownerMove"] = null, note = ""): TurnLabel =>
  ({ idx, segment, ownerMove, note });

describe("parseTranscriptTurns", () => {
  it("parses persisted Speaker: text lines with roles and continuations", () => {
    const turns = parseTranscriptTurns(
      "Guest: Wells Fargo online.\nOwner: Representative.\ncontinued line\nGuest: To better assist you...\n",
    );
    expect(turns).toHaveLength(3);
    expect(turns[0]).toEqual({ idx: 0, role: "guest", text: "Wells Fargo online." });
    expect(turns[1].role).toBe("owner");
    expect(turns[1].text).toBe("Representative. continued line");
  });

  it("maps localized owner labels and returns [] for empty input", () => {
    expect(parseTranscriptTurns("Вы: привет")[0].role).toBe("owner");
    expect(parseTranscriptTurns("You: hi")[0].role).toBe("owner");
    expect(parseTranscriptTurns("")).toEqual([]);
  });
});

describe("validateGoalReturnLabels (fail-closed)", () => {
  const turns = [T(0, "guest", "a"), T(1, "owner", "b")];

  it("accepts a complete labeling and nulls owner_move on guest turns", () => {
    const out = validateGoalReturnLabels(
      { labels: [
        { idx: 0, segment: "on_goal", owner_move: "drifts", note: "x" }, // guest w/ bogus move
        { idx: 1, segment: "on_goal", owner_move: "returns_to_goal", note: "y" },
      ] },
      turns,
    );
    expect(out).not.toBeNull();
    expect(out![0].ownerMove).toBeNull();
    expect(out![1].ownerMove).toBe("returns_to_goal");
  });

  it("rejects missing turn, duplicate idx, and unknown enum values", () => {
    expect(validateGoalReturnLabels({ labels: [{ idx: 0, segment: "on_goal", owner_move: null, note: "" }] }, turns)).toBeNull();
    expect(validateGoalReturnLabels({ labels: [
      { idx: 0, segment: "on_goal", owner_move: null, note: "" },
      { idx: 0, segment: "on_goal", owner_move: null, note: "" },
    ] }, turns)).toBeNull();
    expect(validateGoalReturnLabels({ labels: [
      { idx: 0, segment: "banana", owner_move: null, note: "" },
      { idx: 1, segment: "on_goal", owner_move: null, note: "" },
    ] }, turns)).toBeNull();
    expect(validateGoalReturnLabels(null, turns)).toBeNull();
  });
});

describe("computeGoalReturnMetrics", () => {
  it("computes percentages, episodes with returns, and owner-move counts", () => {
    const turns = [
      T(0, "guest", "greeting"), T(1, "owner", "goal ask"), T(2, "guest", "verify identity"),
      T(3, "owner", "gives dob"), T(4, "guest", "back to topic"), T(5, "owner", "steers back"),
      T(6, "guest", "chit chat"),
    ];
    const labels = [
      L(0, "justified_digression"), L(1, "on_goal", "neutral"), L(2, "justified_digression"),
      L(3, "justified_digression", "supports_branch"), L(4, "on_goal"), L(5, "on_goal", "returns_to_goal"),
      L(6, "off_goal"),
    ];
    const m = computeGoalReturnMetrics(turns, labels);
    expect(m.turnsLabeled).toBe(7);
    expect(m.onGoalPct).toBeCloseTo(42.9, 1);
    expect(m.episodes).toHaveLength(3);
    expect(m.episodes[0]).toMatchObject({ startIdx: 0, endIdx: 0, returned: true });
    expect(m.episodes[1]).toMatchObject({ startIdx: 2, endIdx: 3, kind: "justified_digression", returned: true });
    expect(m.episodes[2]).toMatchObject({ startIdx: 6, endIdx: 6, kind: "off_goal", returned: false });
    expect(m.episodesReturned).toBe(2);
    expect(m.ownerMoveCounts).toEqual({ returns_to_goal: 1, supports_branch: 1, drifts: 0, neutral: 1 });
    expect(m.badOwnerTurns).toEqual([]);
  });

  it("collects drifting owner turns as bad examples", () => {
    const turns = [T(0, "owner", "totally off topic")];
    const m = computeGoalReturnMetrics(turns, [L(0, "off_goal", "drifts", "pulls away")]);
    expect(m.badOwnerTurns).toHaveLength(1);
    expect(m.badOwnerTurns[0].note).toBe("pulls away");
  });
});

describe("judgeGoalReturn", () => {
  const turns = [T(0, "guest", "hello"), T(1, "owner", "I need X")];
  const goodPayload = {
    labels: [
      { idx: 0, segment: "justified_digression", owner_move: null, note: "greeting" },
      { idx: 1, segment: "on_goal", owner_move: "returns_to_goal", note: "asks for X" },
    ],
    rationale: "fine call",
  };
  const mkFetch = (content: string, ok = true) => async () => ({
    ok, status: ok ? 200 : 500,
    text: async () => "err",
    json: async () => ({ choices: [{ message: { content } }] }),
  });

  it("returns a validated judgement on a good response", async () => {
    const j = await judgeGoalReturn("test-model", "get X", turns, { fetchImpl: mkFetch(JSON.stringify(goodPayload)) as any, nowMs: () => 0 });
    expect(j).not.toBeNull();
    expect(j!.judgeModel).toBe("test-model");
    expect(j!.labels).toHaveLength(2);
    expect(j!.rationale).toBe("fine call");
  });

  it("fails closed on API error, bad JSON, and incomplete labeling", async () => {
    expect(await judgeGoalReturn("m", "g", turns, { fetchImpl: mkFetch("", false) as any, nowMs: () => 0 })).toBeNull();
    expect(await judgeGoalReturn("m", "g", turns, { fetchImpl: mkFetch("not json") as any, nowMs: () => 0 })).toBeNull();
    const incomplete = JSON.stringify({ labels: goodPayload.labels.slice(0, 1), rationale: "" });
    expect(await judgeGoalReturn("m", "g", turns, { fetchImpl: mkFetch(incomplete) as any, nowMs: () => 0 })).toBeNull();
  });

  it("prompt contains the goal and every turn", () => {
    const p = buildGoalReturnUserPrompt("get X", turns);
    expect(p).toContain("CALL GOAL: get X");
    expect(p).toContain("0 [guest] hello");
    expect(p).toContain("1 [owner] I need X");
  });
});

describe("hint evaluation — only from explicit hint records", () => {
  const turns = [
    T(0, "guest", "how can I help"),
    T(1, "owner", "I need to unlock my online banking account today"),
    T(2, "owner", "thanks"),
  ];
  const hints: DeliveredHint[] = [
    { text: "I need to unlock my online banking account today", utteranceId: 1 },
    { text: "Could you tell me a joke instead?" },
  ];
  const mkFetch = (content: string, ok = true) => async () => ({
    ok, status: ok ? 200 : 500,
    text: async () => "err",
    json: async () => ({ choices: [{ message: { content } }] }),
  });

  it("spoken match is deterministic fuzzy similarity against owner turns", () => {
    expect(hintTextSimilarity("a b c", "a b c")).toBe(1);
    expect(hintTextSimilarity("a b", "c d")).toBe(0);
    const m = findSpokenMatch(hints[0].text, turns);
    expect(m).not.toBeNull();
    expect(m!.turnIdx).toBe(1);
    expect(m!.similarity).toBeGreaterThanOrEqual(SPOKEN_MATCH_THRESHOLD);
    const miss = findSpokenMatch("completely unrelated words here", turns);
    expect(miss === null || miss.similarity < SPOKEN_MATCH_THRESHOLD).toBe(true);
  });

  it("validateHintLabels fails closed on missing/duplicate/unknown labels", () => {
    expect(validateHintLabels({ labels: [{ index: 0, role: "neutral", note: "" }] }, hints)).toBeNull();
    expect(validateHintLabels({ labels: [
      { index: 0, role: "neutral", note: "" }, { index: 0, role: "neutral", note: "" },
    ] }, hints)).toBeNull();
    expect(validateHintLabels({ labels: [
      { index: 0, role: "banana", note: "" }, { index: 1, role: "neutral", note: "" },
    ] }, hints)).toBeNull();
    expect(validateHintLabels({ labels: [
      { index: 0, role: "returns_to_goal", note: "a" }, { index: 1, role: "drifts", note: "b" },
    ] }, hints)).toHaveLength(2);
  });

  it("judgeDeliveredHints labels each supplied hint and attaches spoken-match signal", async () => {
    const payload = JSON.stringify({
      labels: [
        { index: 0, role: "returns_to_goal", note: "back to goal" },
        { index: 1, role: "drifts", note: "joke is off-goal" },
      ],
      rationale: "ok",
    });
    const j = await judgeDeliveredHints("m", "unlock account", turns, hints, { fetchImpl: mkFetch(payload) as any, nowMs: () => 0 });
    expect(j).not.toBeNull();
    expect(j!.labels[0].spokenMatchTurnIdx).toBe(1); // hint 0 matches owner turn 1
    expect(j!.labels[1].spokenMatchTurnIdx).toBeNull(); // joke hint never spoken
  });

  it("computeHintMetrics derives metrics EXCLUSIVELY from hint records/labels — owner turns don't leak in", () => {
    const labels = [
      { index: 0, role: "returns_to_goal" as const, note: "", spokenMatchTurnIdx: 1, spokenSimilarity: 1 },
      { index: 1, role: "drifts" as const, note: "joke", spokenMatchTurnIdx: null, spokenSimilarity: 0.1 },
    ];
    const hm = computeHintMetrics(hints, labels);
    expect(hm.hintsEvaluated).toBe(2); // == hints.length, regardless of 3 turns / 2 owner turns
    expect(hm.roleCounts).toEqual({ returns_to_goal: 1, supports_branch: 0, drifts: 1, neutral: 0 });
    expect(hm.spokenCount).toBe(1);
    expect(hm.badHints).toEqual([{ index: 1, text: hints[1].text, note: "joke" }]);
    // No hint records => no hint metrics can exist at all.
    expect(computeHintMetrics([], []).hintsEvaluated).toBe(0);
  });

  it("report renders a hint section ONLY when hint records were supplied", () => {
    const labels = [L(0, "on_goal", "neutral")];
    const base = {
      title: "Call", goal: "g", goalSource: "operator-supplied",
      judgement: { labels, judgeModel: "m", rationale: "" },
      metrics: computeGoalReturnMetrics([T(0, "owner", "hi")], labels),
      turns: [T(0, "owner", "hi")], hintStats: null, notes: [],
    };
    const withoutHints = generateGoalReturnReport([{ ...base, hints: null, hintJudgement: null, hintMetrics: null }]);
    expect(withoutHints).toContain("Оценка подсказок недоступна");
    expect(withoutHints).not.toContain("Оценка доставленных подсказок");
    expect(withoutHints).toContain("не атрибуция подсказкам");

    const hintLabels = [{ index: 0, role: "returns_to_goal" as const, note: "n", spokenMatchTurnIdx: 0, spokenSimilarity: 1 }];
    const withHints = generateGoalReturnReport([{
      ...base,
      hints: [{ text: "hi" }],
      hintJudgement: { labels: hintLabels, judgeModel: "m", rationale: "r" },
      hintMetrics: computeHintMetrics([{ text: "hi" }], hintLabels),
    }]);
    expect(withHints).toContain("Оценка доставленных подсказок (1 записей подсказок)");
    expect(withHints).toContain("Подсказок оценено (по явным записям подсказок): 1");
  });
});

describe("generateGoalReturnReport", () => {
  it("renders metrics, goal source, hint counts, and honest limitations", () => {
    const turns = [T(0, "owner", "hi")];
    const labels = [L(0, "on_goal", "neutral")];
    const report = generateGoalReturnReport([{
      title: "Call A", goal: "get X", goalSource: "frozen fixture abc",
      judgement: { labels, judgeModel: "test-model", rationale: "ok" },
      metrics: computeGoalReturnMetrics(turns, labels),
      turns, hintStats: { hintsSent: 3, hintsDropped: 1 }, notes: [],
    }]);
    expect(report).toContain("Goal-Return Analysis");
    expect(report).toContain("frozen fixture abc");
    expect(report).toContain("отправлено 3, отброшено 1");
    expect(report).toContain("Тексты доставленных подсказок НЕ сохраняются");
    expect(report).toContain("Звонков оценено: 1");
  });

  it("marks unjudged calls as unscored instead of fabricating", () => {
    const report = generateGoalReturnReport([{
      title: "Call B", goal: "g", goalSource: "operator-supplied",
      judgement: null, metrics: null, turns: [], hintStats: null, notes: ["judge error: boom"],
    }]);
    expect(report).toContain("не оценён (fail-closed");
    expect(report).toContain("judge error: boom");
    expect(report).toContain("Ни один звонок не был оценён");
  });
});
