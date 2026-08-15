// EARS metrics — PURE functions only (no network, no side effects).
// Used by the harness to score transcription hypotheses against frozen
// reference transcripts. Every function here is deterministic and unit-tested
// in server/__tests__/benchmarkEarsMetrics.test.ts.

import type { CriticalEntities } from "./types";

// ---------------------------------------------------------------------------
// Text normalization
// ---------------------------------------------------------------------------

/**
 * Canonicalize text for WER/CER comparison:
 * - lowercase
 * - strip punctuation (keep digits, letters, whitespace, and $ . , for money
 *   which are handled by the number normalizer separately)
 * - collapse whitespace
 */
export function normalizeText(text: string): string {
  return (text || "")
    .toLowerCase()
    // Keep letters (incl. accented), digits and whitespace; drop the rest.
    // ASCII-safe class (no \p{...}) so this compiles without the ES6 `u` flag.
    .replace(/[^0-9a-z\u00c0-\u024f\u0400-\u04ff\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text: string): string[] {
  const n = normalizeText(text);
  return n.length ? n.split(" ") : [];
}

// ---------------------------------------------------------------------------
// Levenshtein core (generic over token arrays / char arrays)
// ---------------------------------------------------------------------------

function levenshtein<T>(a: T[], b: T[]): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Two-row DP.
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[n];
}

/**
 * Word Error Rate = Levenshtein distance over word tokens / reference words.
 * Convention: if the reference is empty and the hypothesis is empty => 0.
 * If the reference is empty but the hypothesis is not => 1 (all insertions).
 */
export function wordErrorRate(ref: string, hyp: string): number {
  const r = tokens(ref);
  const h = tokens(hyp);
  if (r.length === 0) return h.length === 0 ? 0 : 1;
  return levenshtein(r, h) / r.length;
}

/**
 * Character Error Rate = Levenshtein distance over characters (normalized,
 * whitespace collapsed) / reference character count.
 */
export function charErrorRate(ref: string, hyp: string): number {
  const r = normalizeText(ref).replace(/\s/g, "");
  const h = normalizeText(hyp).replace(/\s/g, "");
  const ra = Array.from(r);
  const ha = Array.from(h);
  if (ra.length === 0) return ha.length === 0 ? 0 : 1;
  return levenshtein(ra, ha) / ra.length;
}

// ---------------------------------------------------------------------------
// Spelled-out number normalization
// ---------------------------------------------------------------------------
//
// LIMITS (documented deliberately):
//  - Handles cardinal English number words up to the millions, plus the
//    "<amount> dollars and <amount> cents" money idiom and "<x> point <y>"
//    / "<x> dollars <y>" decimal idioms.
//  - Does NOT handle ordinals ("twenty-eighth"), fractions, or non-English
//    number words. Digit sequences already in the text are left untouched so
//    "4556" and "one zero one two" both survive (the latter as separate 0-9
//    tokens, matching how account/social digits are dictated).
//  - The goal is entity matching, not perfect NLU: it converts what it can and
//    leaves the rest, so entityAccuracy stays a lower bound (never a false
//    positive from over-eager conversion).

const SMALL: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, million: 1000000 };

function isNumberWord(w: string): boolean {
  return w in SMALL || w in TENS || w in SCALES || w === "and";
}

/**
 * Convert a contiguous run of number words into a single numeric value.
 * Returns null if the run does not resolve to a number.
 */
function wordsToNumber(words: string[]): number | null {
  if (words.length === 0) return null;
  let total = 0;
  let current = 0;
  let sawAny = false;
  for (const w of words) {
    if (w === "and") continue;
    if (w in SMALL) {
      current += SMALL[w];
      sawAny = true;
    } else if (w in TENS) {
      current += TENS[w];
      sawAny = true;
    } else if (w === "hundred") {
      current = (current === 0 ? 1 : current) * 100;
      sawAny = true;
    } else if (w === "thousand" || w === "million") {
      const scale = SCALES[w];
      total += (current === 0 ? 1 : current) * scale;
      current = 0;
      sawAny = true;
    } else {
      return null;
    }
  }
  if (!sawAny) return null;
  return total + current;
}

/**
 * Normalize spelled-out numbers and money phrases in a hypothesis to digit
 * forms, so entity matching can compare "$317.80" to
 * "three hundred seventeen dollars and eighty cents".
 *
 * Produces a normalized string where recognized spelled-out numbers are
 * replaced by their digit form (money as "$317.80", plain as "317"), while
 * leaving surrounding words intact. Existing digit tokens pass through.
 */
export function normalizeNumbersToDigits(text: string): string {
  // Preserve digit-money tokens like "$317.80" (normalizeText would strip $ and
  // .), by tokenizing on a currency-aware pass first.
  const preserved = (text || "")
    .toLowerCase()
    // keep $ and . that sit inside a money token, drop other punctuation
    .replace(/[^0-9a-z\u00c0-\u024f\u0400-\u04ff\s$.]/g, " ")
    // collapse a standalone period (not inside a number) to space
    .replace(/(?<!\d)\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = preserved.split(" ").filter(Boolean);
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    if (!isNumberWord(words[i]) || words[i] === "and") {
      out.push(words[i]);
      i++;
      continue;
    }
    // Greedily consume a number-word run, but split it at "dollars"/"cents"
    // and "point" boundaries which we handle as money/decimals.
    const run: string[] = [];
    let j = i;
    while (j < words.length && (isNumberWord(words[j]))) {
      run.push(words[j]);
      j++;
    }
    // Now inspect what follows the run for money/decimal idioms.
    // Case A: "<run> dollars [and <run2> cents]"
    const dollars = wordsToNumber(stripTrailingAnd(run));
    const after = words[j];
    if (dollars !== null && after === "dollars") {
      let k = j + 1;
      let cents = 0;
      // optional "and <cents> cents"
      if (words[k] === "and") k++;
      const centRun: string[] = [];
      while (k < words.length && isNumberWord(words[k]) && words[k] !== "and") {
        centRun.push(words[k]);
        k++;
      }
      if (centRun.length && words[k] === "cents") {
        const c = wordsToNumber(centRun);
        if (c !== null) {
          cents = c;
          k++;
        }
      } else if (words[k] === "cents") {
        k++;
      }
      out.push(formatMoney(dollars, cents));
      i = k;
      continue;
    }
    // Case B: "<run> point <run2>" => decimal (e.g. "three seventeen point
    // eighty" is not standard; handled conservatively as N.M)
    if (dollars !== null && after === "point") {
      let k = j + 1;
      const fracRun: string[] = [];
      while (k < words.length && isNumberWord(words[k]) && words[k] !== "and") {
        fracRun.push(words[k]);
        k++;
      }
      const frac = wordsToNumber(fracRun);
      if (frac !== null) {
        out.push(`${dollars}.${frac}`);
        i = k;
        continue;
      }
    }
    // Case C: plain number run.
    const val = wordsToNumber(run);
    if (val !== null) {
      out.push(String(val));
    } else {
      // Fallback: emit the raw words (couldn't resolve).
      out.push(...run);
    }
    i = j;
  }
  return out.join(" ");
}

function stripTrailingAnd(run: string[]): string[] {
  const r = [...run];
  while (r.length && r[r.length - 1] === "and") r.pop();
  return r;
}

function formatMoney(dollars: number, cents: number): string {
  return `$${dollars}.${cents.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Entity accuracy
// ---------------------------------------------------------------------------

/**
 * Canonicalize a single money string into "$<dollars>.<cents>" form.
 * "$317.80" -> "$317.80"; "$200" -> "$200.00".
 */
function canonicalMoney(m: string): string {
  const cleaned = m.replace(/[^\d.]/g, "");
  if (!cleaned) return m.toLowerCase();
  const [d, c = ""] = cleaned.split(".");
  const dollars = parseInt(d || "0", 10);
  const cents = (c + "00").slice(0, 2);
  return `$${dollars}.${cents}`;
}

/**
 * Does the (number-normalized) hypothesis contain the given money entity?
 * Compares against both the canonical "$317.80" form and the bare-dollar form
 * "$317" (transcribers often drop cents).
 */
function hypHasMoney(hypNorm: string, entity: string): boolean {
  const canon = canonicalMoney(entity); // $317.80
  const dollars = canon.slice(1).split(".")[0]; // 317
  if (hypNorm.includes(canon)) return true;
  // bare dollars with optional decimal
  const re = new RegExp(`\\$${dollars}(\\.\\d{1,2})?\\b`);
  return re.test(hypNorm);
}

/** Substring match after number normalization (for dates). */
function hypHasPhrase(hypNorm: string, entity: string): boolean {
  const e = normalizeNumbersToDigits(entity);
  if (!e) return false;
  return hypNorm.includes(e);
}

/** Plain normalized substring match (for names — no number normalization,
 * so "Meridian Card" is not corrupted). */
function hypHasPlainPhrase(hypRaw: string, entity: string): boolean {
  const e = normalizeText(entity);
  if (!e) return false;
  return hypRaw.includes(e);
}

/** Digit sequences: match the exact digit string ignoring separators. */
function hypHasDigits(hypNorm: string, entity: string): boolean {
  const want = entity.replace(/\D/g, "");
  if (!want) return false;
  const hypDigits = hypNorm.replace(/\D/g, "");
  return hypDigits.includes(want);
}

function fraction(hits: number, total: number): number | null {
  if (total === 0) return null;
  return hits / total;
}

/**
 * Per-category fraction of critical entities preserved in the hypothesis.
 * Returns null for a category with no reference entities (nothing to score).
 *
 * Matching strategy (robust, lower-bound — never over-credits):
 *  - money:  numeric canonical match ($317.80) OR bare-dollar match ($317),
 *            after spelled-out->digit normalization of the hypothesis.
 *  - dates:  normalized substring (spelled numbers converted).
 *  - digits: exact digit subsequence ignoring separators.
 *  - names:  normalized substring, case-insensitive.
 */
export function entityAccuracy(
  refEntities: CriticalEntities,
  hypText: string
): { money: number | null; dates: number | null; digits: number | null; names: number | null } {
  const hypNorm = normalizeNumbersToDigits(hypText);
  const hypRaw = normalizeText(hypText);

  const money = fraction(
    (refEntities.money || []).filter((e) => hypHasMoney(hypNorm, e)).length,
    (refEntities.money || []).length
  );
  const dates = fraction(
    (refEntities.dates || []).filter((e) => hypHasPhrase(hypNorm, e) || hypHasPhrase(hypRaw, e)).length,
    (refEntities.dates || []).length
  );
  const digits = fraction(
    (refEntities.digits || []).filter((e) => hypHasDigits(hypNorm, e) || hypHasDigits(hypRaw, e)).length,
    (refEntities.digits || []).length
  );
  const names = fraction(
    (refEntities.names || []).filter((e) => hypHasPlainPhrase(hypRaw, e)).length,
    (refEntities.names || []).length
  );
  return { money, dates, digits, names };
}

/**
 * Domain-term accuracy for one turn: of the fixture's domain terms (eSIM,
 * SMS code, port-in, ...) that actually appear in THIS reference turn,
 * what fraction survived into the hypothesis? Terms absent from the
 * reference turn are not scored (null when none apply) — this keeps the
 * metric a lower bound and never credits terms the speaker never said.
 */
export function termsAccuracy(
  terms: string[] | undefined,
  refText: string,
  hypText: string
): number | null {
  const list = (terms ?? []).map((t) => normalizeText(t)).filter((t) => t.length > 0);
  if (list.length === 0) return null;
  const refNorm = normalizeText(refText);
  const applicable = list.filter((t) => refNorm.includes(t));
  if (applicable.length === 0) return null;
  const hypNorm = normalizeText(hypText);
  return applicable.filter((t) => hypNorm.includes(t)).length / applicable.length;
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

/**
 * Nearest-rank percentile (p in [0,100]) over a numeric sample.
 * Returns null for an empty sample. p=50 => median-ish (nearest rank).
 */
export function percentile(values: number[], p: number): number | null {
  const xs = values.filter((v) => typeof v === "number" && !Number.isNaN(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0];
  const clamped = Math.min(100, Math.max(0, p));
  const rank = Math.ceil((clamped / 100) * xs.length);
  const idx = Math.min(xs.length - 1, Math.max(0, rank - 1));
  return xs[idx];
}

function mean(values: Array<number | null>): number | null {
  const xs = values.filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Content-word token WER used as a coarse SEMANTIC PROXY.
 * NOTE: this is NOT an embedding-based semantic score — it is
 * (1 - WER over content words), clamped to [0,1], and MUST be labeled as a
 * proxy in every scorecard. Stopwords are dropped so filler differences don't
 * dominate meaning.
 */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at", "for",
  "is", "it", "its", "that", "this", "so", "as", "i", "you", "we", "he", "she",
  "uh", "um", "okay", "ok", "yeah", "yes", "no", "well", "mhmm",
]);

export function semanticProxy(ref: string, hyp: string): number {
  const contentRef = tokens(ref).filter((t) => !STOPWORDS.has(t));
  const contentHyp = tokens(hyp).filter((t) => !STOPWORDS.has(t));
  if (contentRef.length === 0) return contentHyp.length === 0 ? 1 : 0;
  const wer = levenshtein(contentRef, contentHyp) / contentRef.length;
  return Math.max(0, Math.min(1, 1 - wer));
}

// ---------------------------------------------------------------------------
// Scorecard row builder
// ---------------------------------------------------------------------------

export interface EarsScorecardRow {
  candidateId: string;
  label: string;
  /** SEMANTIC PROXY (1 - content-word WER). Not an embedding score. */
  semantic: number | null;
  semanticIsProxy: true;
  wer: number | null;
  /** mean WER over Owner-role turns only (the metric that matters most) */
  ownerWer: number | null;
  /** mean WER over Guest-role turns only */
  guestWer: number | null;
  /** combined money+digits entity accuracy fraction */
  numbersMoney: number | null;
  /** domain-term accuracy (eSIM, SMS code, ...) over turns where terms apply */
  terms: number | null;
  /** reference-only candidate (accuracy ceiling) — never a LIVE winner */
  referenceOnly: boolean;
  /** placeholder: role-split accuracy requires diarized reference (null now) */
  roleSplit: number | null;
  /** fraction of turns flagged premature end-of-turn (null if not measured) */
  prematureEot: number | null;
  /** fraction of turns flagged false continuation / false-wait */
  falseWait: number | null;
  /** p50 speech-end -> EOT latency (ms) */
  eotP50: number | null;
  /** p50 speech-end -> final transcript latency (ms) */
  finalP50: number | null;
  /** rough cost estimate in USD for the corpus run (null if unknown) */
  costEstimate: number | null;
  /** number of turns scored per-turn under a PROVABLE mapping (0 when
   * per-turn metrics are unavailable for this candidate) */
  turnsScored: number;
  /** number of channel-level (document) samples behind the accuracy columns */
  channelsScored?: number;
  /** basis of the per-turn mapping: "timestamps" | "positional" |
   * "unavailable" | "mixed" | null (no streams scored) */
  perTurnBasis?: string | null;
}

export interface EarsRowInput {
  candidateId: string;
  label: string;
  wer: Array<number | null>;
  /** reference word count behind each wer sample (parallel array) — when
   * present, aggregate WER is word-weighted instead of a plain mean, so a
   * short channel cannot dominate a long one. */
  werWeights?: Array<number | null>;
  /** role of the reference turn behind each wer sample (parallel array) */
  roles?: Array<"owner" | "guest" | null>;
  cer?: Array<number | null>;
  /** provable per-turn mapping basis for each scored stream */
  perTurnBases?: Array<"timestamps" | "unavailable">;
  /** number of turns actually scored per-turn (provable mapping only) */
  perTurnScored?: number;
  semantic: Array<number | null>;
  termsAcc?: Array<number | null>;
  referenceOnly?: boolean;
  moneyAcc: Array<number | null>;
  digitsAcc: Array<number | null>;
  prematureEotFlags: Array<boolean | null>;
  falseWaitFlags: Array<boolean | null>;
  eotLatencies: Array<number | null>;
  finalLatencies: Array<number | null>;
  costEstimate?: number | null;
}

function flagFraction(flags: Array<boolean | null>): number | null {
  const xs = flags.filter((f): f is boolean => typeof f === "boolean");
  if (xs.length === 0) return null;
  return xs.filter(Boolean).length / xs.length;
}

/** Build one EARS scorecard row from the per-turn samples of a candidate. */
export function buildScorecardRow(input: EarsRowInput): EarsScorecardRow {
  const money = mean(input.moneyAcc);
  const digits = mean(input.digitsAcc);
  let numbersMoney: number | null = null;
  if (money !== null && digits !== null) numbersMoney = (money + digits) / 2;
  else numbersMoney = money ?? digits;

  const nonNull = (arr: Array<number | null>): number[] =>
    arr.filter((v): v is number => typeof v === "number" && !Number.isNaN(v));

  const roles = input.roles ?? [];
  const weights = input.werWeights ?? [];

  /** Word-weighted mean over the selected wer samples; plain mean when no
   * usable weights exist (backward compatible). */
  const weightedWer = (indices: number[]): number | null => {
    const usable = indices.filter((i) => typeof input.wer[i] === "number" && !Number.isNaN(input.wer[i] as number));
    if (usable.length === 0) return null;
    const haveWeights = usable.every((i) => typeof weights[i] === "number" && (weights[i] as number) > 0);
    if (!haveWeights) return mean(usable.map((i) => input.wer[i]));
    const totalW = usable.reduce((s, i) => s + (weights[i] as number), 0);
    if (totalW <= 0) return mean(usable.map((i) => input.wer[i]));
    return usable.reduce((s, i) => s + (input.wer[i] as number) * (weights[i] as number), 0) / totalW;
  };
  const allIdx = input.wer.map((_, i) => i);
  const werForRole = (role: "owner" | "guest"): number | null =>
    weightedWer(allIdx.filter((i) => roles[i] === role));

  const bases = (input.perTurnBases ?? []).filter((b) => b !== undefined);
  let perTurnBasis: string | null = null;
  if (bases.length > 0) {
    const uniq = Array.from(new Set(bases));
    perTurnBasis = uniq.length === 1 ? uniq[0] : "mixed";
  }

  return {
    candidateId: input.candidateId,
    label: input.label,
    semantic: mean(input.semantic),
    semanticIsProxy: true,
    wer: weightedWer(allIdx),
    ownerWer: werForRole("owner"),
    guestWer: werForRole("guest"),
    numbersMoney,
    terms: mean(input.termsAcc ?? []),
    referenceOnly: input.referenceOnly ?? false,
    roleSplit: null,
    prematureEot: flagFraction(input.prematureEotFlags),
    falseWait: flagFraction(input.falseWaitFlags),
    eotP50: percentile(nonNull(input.eotLatencies), 50),
    finalP50: percentile(nonNull(input.finalLatencies), 50),
    costEstimate: input.costEstimate ?? null,
    turnsScored: input.perTurnScored ?? input.wer.length,
    channelsScored: input.wer.length,
    perTurnBasis,
  };
}
