import { describe, it, expect } from "vitest";
import {
  normalizeText,
  wordErrorRate,
  charErrorRate,
  entityAccuracy,
  percentile,
  normalizeNumbersToDigits,
  semanticProxy,
  buildScorecardRow,
} from "../benchmark/earsMetrics";
import { GOLD_CALL_CRITICAL_ENTITIES } from "../benchmark/goldCall";

describe("normalizeText", () => {
  it("lowercases, strips punctuation and collapses whitespace", () => {
    expect(normalizeText("  Hello,  WORLD!! ")).toBe("hello world");
    expect(normalizeText("$317.80 — paid.")).toBe("317 80 paid");
  });
  it("handles empty/null input", () => {
    expect(normalizeText("")).toBe("");
    // @ts-expect-error deliberate null
    expect(normalizeText(null)).toBe("");
  });
});

describe("wordErrorRate", () => {
  it("is 0 for identical text (ignoring case/punctuation)", () => {
    expect(wordErrorRate("The cat sat.", "the cat sat")).toBe(0);
  });
  it("counts a single substitution", () => {
    // ref 3 words, 1 substitution => 1/3
    expect(wordErrorRate("the cat sat", "the dog sat")).toBeCloseTo(1 / 3, 6);
  });
  it("counts insertions and deletions", () => {
    expect(wordErrorRate("the cat", "the big cat")).toBeCloseTo(1 / 2, 6); // 1 insertion / 2
    expect(wordErrorRate("the big cat", "the cat")).toBeCloseTo(1 / 3, 6); // 1 deletion / 3
  });
  it("edge cases: empty ref/hyp", () => {
    expect(wordErrorRate("", "")).toBe(0);
    expect(wordErrorRate("", "hello")).toBe(1);
    expect(wordErrorRate("hello world", "")).toBe(1); // 2 deletions / 2
  });
});

describe("charErrorRate", () => {
  it("is 0 for identical normalized text", () => {
    expect(charErrorRate("Hello", "hello")).toBe(0);
  });
  it("counts a single char substitution", () => {
    // "cat" vs "cot" => 1 sub / 3 chars
    expect(charErrorRate("cat", "cot")).toBeCloseTo(1 / 3, 6);
  });
  it("edge cases", () => {
    expect(charErrorRate("", "")).toBe(0);
    expect(charErrorRate("", "ab")).toBe(1);
    expect(charErrorRate("abc", "")).toBe(1);
  });
});

describe("normalizeNumbersToDigits", () => {
  it("converts a money phrase with dollars and cents", () => {
    const out = normalizeNumbersToDigits("three hundred seventeen dollars and eighty cents");
    expect(out).toContain("$317.80");
  });
  it("converts plain spelled numbers", () => {
    expect(normalizeNumbersToDigits("two hundred")).toBe("200");
    expect(normalizeNumbersToDigits("one hundred fifty")).toBe("150");
    expect(normalizeNumbersToDigits("fifteen")).toBe("15");
  });
  it("leaves surrounding words intact", () => {
    const out = normalizeNumbersToDigits("i paid three hundred fifty today");
    expect(out).toBe("i paid 350 today");
  });
  it("passes existing digit tokens through", () => {
    expect(normalizeNumbersToDigits("account 4556")).toContain("4556");
  });
  it("does not over-convert (leaves unresolved runs)", () => {
    // 'point' decimal idiom
    const out = normalizeNumbersToDigits("three hundred seventeen point eighty");
    expect(out).toContain("317.80");
  });
});

describe("entityAccuracy on Gold Call critical entities", () => {
  it("scores a perfect hypothesis at 1.0 across categories", () => {
    // Hypothesis that contains all money (digit form), dates, digits, names.
    const hyp =
      "alex called meridian card services and spoke to maria about $317.80 and $200 and $150 and $350 " +
      "due by august 15 on the tenth of each month in september; social 212307789 last four 7789";
    const acc = entityAccuracy(GOLD_CALL_CRITICAL_ENTITIES, hyp);
    expect(acc.money).toBe(1);
    expect(acc.names).toBe(1);
    expect(acc.digits).toBe(1);
    expect(acc.dates).toBe(1);
  });

  it("matches spelled-out money against numeric reference", () => {
    const hyp = "the payment was three hundred seventeen dollars and eighty cents";
    const acc = entityAccuracy({ money: ["$317.80"], dates: [], digits: [], names: [], decisions: [] }, hyp);
    expect(acc.money).toBe(1);
  });

  it("drops accuracy for a corrupted hypothesis", () => {
    // Wrong names, wrong money, missing digits.
    const corrupted =
      "someone called a bank and talked to a person about some money due later this month";
    const acc = entityAccuracy(GOLD_CALL_CRITICAL_ENTITIES, corrupted);
    expect((acc.money ?? 1)).toBeLessThan(1);
    expect((acc.names ?? 1)).toBeLessThan(1);
    expect((acc.digits ?? 1)).toBeLessThan(1);
  });

  it("returns null for a category with no reference entities", () => {
    const acc = entityAccuracy({ money: [], dates: [], digits: [], names: [], decisions: [] }, "anything");
    expect(acc.money).toBeNull();
    expect(acc.dates).toBeNull();
    expect(acc.digits).toBeNull();
    expect(acc.names).toBeNull();
  });

  it("matches bare-dollar hypothesis when cents are dropped", () => {
    const acc = entityAccuracy(
      { money: ["$317.80"], dates: [], digits: [], names: [], decisions: [] },
      "the amount was $317 total"
    );
    expect(acc.money).toBe(1);
  });
});

describe("percentile", () => {
  it("returns null for empty input", () => {
    expect(percentile([], 50)).toBeNull();
  });
  it("returns the sole value for a single-element sample", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });
  it("computes nearest-rank percentiles", () => {
    const xs = [10, 20, 30, 40, 50];
    expect(percentile(xs, 50)).toBe(30);
    expect(percentile(xs, 100)).toBe(50);
    expect(percentile(xs, 0)).toBe(10);
  });
  it("ignores NaN values", () => {
    // nearest-rank p50 of [10,20] => rank ceil(0.5*2)=1 => 10
    expect(percentile([NaN, 10, 20], 50)).toBe(10);
  });
});

describe("semanticProxy", () => {
  it("is 1 for identical content words", () => {
    expect(semanticProxy("the cat sat on the mat", "cat sat mat")).toBeGreaterThan(0.9);
  });
  it("is lower when content diverges", () => {
    const p = semanticProxy("payment of three hundred dollars", "weather is nice today");
    expect(p).toBeLessThan(0.5);
  });
  it("clamps to [0,1]", () => {
    const p = semanticProxy("a", "completely different content words here");
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });
});

describe("buildScorecardRow", () => {
  it("aggregates samples and labels semantic as a proxy", () => {
    const row = buildScorecardRow({
      candidateId: "dg-flux-general-en",
      label: "Flux EN",
      wer: [0.1, 0.2, null],
      cer: [0.05, 0.1, null],
      semantic: [0.9, 0.8],
      moneyAcc: [1, 0.5],
      digitsAcc: [1, 1],
      prematureEotFlags: [false, true, null],
      falseWaitFlags: [false, false],
      eotLatencies: [100, 200, 300],
      finalLatencies: [150, 250],
      costEstimate: 0.02,
    });
    expect(row.semanticIsProxy).toBe(true);
    expect(row.wer).toBeCloseTo(0.15, 6);
    expect(row.numbersMoney).toBeCloseTo((0.75 + 1) / 2, 6);
    expect(row.prematureEot).toBeCloseTo(1 / 2, 6);
    expect(row.eotP50).toBe(200); // nearest-rank p50 of [100,200,300]
    expect(row.finalP50).toBe(150); // nearest-rank p50 of [150,250] => 150
    expect(row.roleSplit).toBeNull();
    expect(row.costEstimate).toBe(0.02);
  });

  it("yields nulls when no samples exist", () => {
    const row = buildScorecardRow({
      candidateId: "x",
      label: "X",
      wer: [],
      semantic: [],
      moneyAcc: [],
      digitsAcc: [],
      prematureEotFlags: [],
      falseWaitFlags: [],
      eotLatencies: [],
      finalLatencies: [],
    });
    expect(row.wer).toBeNull();
    expect(row.numbersMoney).toBeNull();
    expect(row.eotP50).toBeNull();
    expect(row.prematureEot).toBeNull();
  });
});
