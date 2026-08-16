// Goal-return analysis (Task #227): offline, per-call analysis of whether the
// conversation stays on the call goal, digresses when justified (verification,
// operator clarifications) and RETURNS to the goal when the branch closes.
//
// Data honesty (verified against production DB, 2026-08-16):
//  - calls.transcript persists only "Speaker: text" lines (Owner/Guest speech);
//  - the goal is NOT persisted on the call row (metadata.goalText is absent on
//    every production call) — it must come from a frozen benchmark fixture or
//    be operator-supplied, and the source is recorded in the report;
//  - delivered hint TEXTS are not persisted anywhere; calls.metadata.hintLatency
//    entries carry timings/outcomes only. Owner-turn labels therefore measure
//    the OWNER's conversational behavior (goal adherence) and are NEVER
//    presented as hint effectiveness — ordinary owner speech is
//    indistinguishable from an accepted hint. Hint-level evaluation runs ONLY
//    when explicit hint records ({text, utteranceId?}) are supplied; the only
//    usage signal we can compute is a fuzzy text match of the hint against
//    owner turns ("spoken match"), reported with that limitation stated.
//
// ZERO imports from the production call path. Analysis only — never touches
// the live pipeline.

import { chatOnce, type FetchLike } from "./openaiClient";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GoalReturnTurn {
  idx: number;
  role: "owner" | "guest";
  text: string;
}

export const SEGMENT_LABELS = ["on_goal", "justified_digression", "off_goal"] as const;
export type SegmentLabel = (typeof SEGMENT_LABELS)[number];

// owner_move labels the OWNER's own conversational move (goal adherence).
// It applies to OWNER turns only (null for guest turns) and is NOT an
// evaluation of copilot hints — nothing links a spoken owner turn to a hint.
export const OWNER_MOVES = ["returns_to_goal", "supports_branch", "drifts", "neutral"] as const;
export type OwnerMove = (typeof OWNER_MOVES)[number];

// A delivered hint record (from persisted storage or supplied by the operator).
export interface DeliveredHint {
  text: string;
  utteranceId?: number;
}

export interface HintLabel {
  index: number; // position in the supplied hints array
  role: OwnerMove; // returns_to_goal | supports_branch | drifts | neutral
  note: string;
  // Deterministic usage signal: best fuzzy match against owner turns.
  spokenMatchTurnIdx: number | null;
  spokenSimilarity: number | null;
}

export interface HintMetrics {
  hintsEvaluated: number;
  roleCounts: Record<OwnerMove, number>;
  spokenCount: number; // hints with a fuzzy owner-turn match >= threshold
  badHints: { index: number; text: string; note: string }[];
}

export interface TurnLabel {
  idx: number;
  segment: SegmentLabel;
  ownerMove: OwnerMove | null;
  note: string;
}

export interface DigressionEpisode {
  startIdx: number;
  endIdx: number;
  kind: "justified_digression" | "off_goal" | "mixed";
  returned: boolean; // an on_goal turn follows the episode
}

export interface GoalReturnMetrics {
  turnsTotal: number;
  turnsLabeled: number;
  onGoalPct: number | null; // % labeled turns on_goal
  justifiedPct: number | null;
  offGoalPct: number | null;
  episodes: DigressionEpisode[];
  episodesReturned: number;
  ownerMoveCounts: Record<OwnerMove, number>;
  // Owner turns judged to pull the call AWAY from the goal (owner behavior —
  // NOT attributable to hints).
  badOwnerTurns: { idx: number; text: string; note: string }[];
}

export interface GoalReturnJudgement {
  labels: TurnLabel[];
  judgeModel: string;
  rationale: string;
}

// ---------------------------------------------------------------------------
// Transcript parsing ("Speaker: text" lines, same persisted format the
// AirAtoma path writes; local copy so this module has zero prod-path imports).
// ---------------------------------------------------------------------------

const OWNER_SPEAKER = /^(owner|you|вы|я)$/i;

export function parseTranscriptTurns(text: string): GoalReturnTurn[] {
  const turns: GoalReturnTurn[] = [];
  for (const rawLine of (text ?? "").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(/^([^:]{1,40}):\s*(.*)$/);
    if (m && m[2] !== undefined) {
      const role: "owner" | "guest" = OWNER_SPEAKER.test(m[1].trim()) ? "owner" : "guest";
      turns.push({ idx: turns.length, role, text: m[2] });
    } else if (turns.length > 0) {
      // Continuation of the previous turn (multi-line utterance).
      turns[turns.length - 1].text += ` ${line}`;
    }
  }
  return turns;
}

// ---------------------------------------------------------------------------
// LLM judge — one structured call labeling every turn. Fail-closed: a missing
// or malformed label for ANY turn invalidates the judgement (null), never
// silently fabricated.
// ---------------------------------------------------------------------------

const JUDGE_TIMEOUT_MS = 120_000;

const GOAL_RETURN_SCHEMA = {
  name: "goal_return_labels",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["labels", "rationale"],
    properties: {
      labels: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["idx", "segment", "owner_move", "note"],
          properties: {
            idx: { type: "integer" },
            segment: { type: "string", enum: [...SEGMENT_LABELS] },
            owner_move: { type: ["string", "null"], enum: [...OWNER_MOVES, null] },
            note: { type: "string" },
          },
        },
      },
      rationale: { type: "string" },
    },
  },
} as const;

const GOAL_RETURN_SYSTEM = [
  "You are an expert conversation analyst for a live phone-call copilot.",
  "The OWNER of the call pursues a specific GOAL; the GUEST is the other party (IVR, operator...).",
  "Real calls legitimately digress: identity verification, account lookups, operator clarifications,",
  "hold/wait states. A good call SUPPORTS a needed side-branch and RETURNS to the goal once the",
  "branch closes. Label EVERY turn of the transcript:",
  "  segment: on_goal (directly advances/discusses the goal) |",
  "           justified_digression (necessary side-branch: verification, clarification, hold, greeting/IVR navigation) |",
  "           off_goal (unnecessary drift away from the goal).",
  "For OWNER turns additionally label owner_move — the OWNER's own conversational move (this is a",
  "goal-adherence label for the Owner's behavior; do NOT assume any turn came from a copilot hint):",
  "  returns_to_goal (steers the call back to the goal after/inside a digression) |",
  "  supports_branch (correctly serves a justified side-branch, e.g. gives requested verification info) |",
  "  drifts (pulls the call AWAY from the goal when it should not) |",
  "  neutral (ack/filler with no steering effect).",
  "owner_move MUST be null for guest turns. Give a short note (<=120 chars) per turn and one overall",
  "rationale (<=400 chars). Label EVERY idx exactly once. Return JSON only.",
].join("\n");

export interface GoalReturnJudgeDeps {
  fetchImpl?: FetchLike;
  nowMs?: () => number;
}

export function buildGoalReturnUserPrompt(goal: string, turns: GoalReturnTurn[]): string {
  return [
    `CALL GOAL: ${goal}`,
    "",
    "TRANSCRIPT (one line per turn, `idx [role] text`):",
    ...turns.map((t) => `${t.idx} [${t.role}] ${t.text}`),
  ].join("\n");
}

/** Fail-closed validation of the judge payload against the turn list. */
export function validateGoalReturnLabels(parsed: any, turns: GoalReturnTurn[]): TurnLabel[] | null {
  if (!parsed || !Array.isArray(parsed.labels)) return null;
  const byIdx = new Map<number, TurnLabel>();
  for (const l of parsed.labels) {
    if (!l || typeof l !== "object") return null;
    if (!Number.isInteger(l.idx)) return null;
    if (!SEGMENT_LABELS.includes(l.segment)) return null;
    const move = l.owner_move === null ? null : l.owner_move;
    if (move !== null && !OWNER_MOVES.includes(move)) return null;
    if (byIdx.has(l.idx)) return null; // duplicate label
    byIdx.set(l.idx, {
      idx: l.idx,
      segment: l.segment,
      ownerMove: move,
      note: typeof l.note === "string" ? l.note.slice(0, 200) : "",
    });
  }
  const out: TurnLabel[] = [];
  for (const t of turns) {
    const l = byIdx.get(t.idx);
    if (!l) return null; // missing label for a turn — unusable, never fabricated
    // Guest turns must not carry an owner_move; normalize hard to null.
    out.push(t.role === "guest" ? { ...l, ownerMove: null } : l);
  }
  return out;
}

export async function judgeGoalReturn(
  judgeModel: string,
  goal: string,
  turns: GoalReturnTurn[],
  deps: GoalReturnJudgeDeps = {},
): Promise<GoalReturnJudgement | null> {
  const nowMs = deps.nowMs || (() => Date.now());
  const res = await chatOnce({
    model: judgeModel,
    system: GOAL_RETURN_SYSTEM,
    user: buildGoalReturnUserPrompt(goal, turns),
    maxTokens: 16_000,
    responseFormat: { type: "json_schema", json_schema: GOAL_RETURN_SCHEMA },
    timeoutMs: JUDGE_TIMEOUT_MS,
    fetchImpl: deps.fetchImpl,
    nowMs,
  });
  if (!res.ok) return null;
  let parsed: any;
  try {
    const match = res.content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const labels = validateGoalReturnLabels(parsed, turns);
  if (!labels) return null;
  return {
    labels,
    judgeModel,
    rationale: typeof parsed.rationale === "string" ? parsed.rationale.slice(0, 600) : "",
  };
}

// ---------------------------------------------------------------------------
// Hint evaluation — ONLY over explicit hint records. Never inferred from
// owner turns. Fail-closed: every hint index must be labeled or the hint
// judgement is null.
// ---------------------------------------------------------------------------

const HINT_SCHEMA = {
  name: "hint_labels",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["labels", "rationale"],
    properties: {
      labels: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["index", "role", "note"],
          properties: {
            index: { type: "integer" },
            role: { type: "string", enum: [...OWNER_MOVES] },
            note: { type: "string" },
          },
        },
      },
      rationale: { type: "string" },
    },
  },
} as const;

const HINT_SYSTEM = [
  "You are an expert evaluator of a live phone-call copilot's DELIVERED HINTS.",
  "You get the call GOAL, the transcript, and the list of hint texts that were shown to the Owner.",
  "For EACH hint, judge what the hint would do to the conversation if spoken:",
  "  returns_to_goal (steers the call back to the goal after/inside a digression) |",
  "  supports_branch (correctly serves a justified side-branch, e.g. verification info) |",
  "  drifts (pulls the call AWAY from the goal) |",
  "  neutral (ack/filler with no steering effect).",
  "You do NOT know whether the Owner actually spoke a hint — judge the hint text on its own",
  "merits in transcript context. Short note (<=120 chars) per hint, overall rationale (<=400 chars).",
  "Label EVERY index exactly once. Return JSON only.",
].join("\n");

/** Normalized word-set Jaccard similarity — the deterministic "spoken match" signal. */
export function hintTextSimilarity(a: string, b: string): number {
  // Strip punctuation (keep letters/digits incl. non-ASCII), lowercase, split.
  const words = (s: string) => {
    const set = new Set<string>();
    for (const w of s.toLowerCase().replace(/[!-\/:-@\[-`{-~«»…—]/g, " ").split(/\s+/)) {
      if (w) set.add(w);
    }
    return set;
  };
  const wa = words(a), wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  wa.forEach((w) => { if (wb.has(w)) inter++; });
  return inter / (wa.size + wb.size - inter);
}

export const SPOKEN_MATCH_THRESHOLD = 0.8;

/** Best fuzzy match of a hint against owner turns (usage signal, with limits). */
export function findSpokenMatch(hint: string, turns: GoalReturnTurn[]): { turnIdx: number; similarity: number } | null {
  let best: { turnIdx: number; similarity: number } | null = null;
  for (const t of turns) {
    if (t.role !== "owner") continue;
    const sim = hintTextSimilarity(hint, t.text);
    if (!best || sim > best.similarity) best = { turnIdx: t.idx, similarity: sim };
  }
  return best && best.similarity > 0 ? best : null;
}

export interface HintJudgement {
  labels: HintLabel[];
  judgeModel: string;
  rationale: string;
}

export function validateHintLabels(parsed: any, hints: DeliveredHint[]): { index: number; role: OwnerMove; note: string }[] | null {
  if (!parsed || !Array.isArray(parsed.labels)) return null;
  const byIndex = new Map<number, { index: number; role: OwnerMove; note: string }>();
  for (const l of parsed.labels) {
    if (!l || typeof l !== "object" || !Number.isInteger(l.index)) return null;
    if (!OWNER_MOVES.includes(l.role)) return null;
    if (byIndex.has(l.index)) return null;
    byIndex.set(l.index, { index: l.index, role: l.role, note: typeof l.note === "string" ? l.note.slice(0, 200) : "" });
  }
  const out: { index: number; role: OwnerMove; note: string }[] = [];
  for (let i = 0; i < hints.length; i++) {
    const l = byIndex.get(i);
    if (!l) return null; // missing label — unusable, never fabricated
    out.push(l);
  }
  return out;
}

export async function judgeDeliveredHints(
  judgeModel: string,
  goal: string,
  turns: GoalReturnTurn[],
  hints: DeliveredHint[],
  deps: GoalReturnJudgeDeps = {},
): Promise<HintJudgement | null> {
  if (hints.length === 0) return null;
  const nowMs = deps.nowMs || (() => Date.now());
  const user = [
    `CALL GOAL: ${goal}`,
    "",
    "TRANSCRIPT (`idx [role] text`):",
    ...turns.map((t) => `${t.idx} [${t.role}] ${t.text}`),
    "",
    "DELIVERED HINTS (`index: text`):",
    ...hints.map((h, i) => `${i}: ${h.text}`),
  ].join("\n");
  const res = await chatOnce({
    model: judgeModel,
    system: HINT_SYSTEM,
    user,
    maxTokens: 16_000,
    responseFormat: { type: "json_schema", json_schema: HINT_SCHEMA },
    timeoutMs: JUDGE_TIMEOUT_MS,
    fetchImpl: deps.fetchImpl,
    nowMs,
  });
  if (!res.ok) return null;
  let parsed: any;
  try {
    const match = res.content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const core = validateHintLabels(parsed, hints);
  if (!core) return null;
  const labels: HintLabel[] = core.map((l) => {
    const m = findSpokenMatch(hints[l.index].text, turns);
    return {
      ...l,
      spokenMatchTurnIdx: m && m.similarity >= SPOKEN_MATCH_THRESHOLD ? m.turnIdx : null,
      spokenSimilarity: m ? Math.round(m.similarity * 100) / 100 : null,
    };
  });
  return { labels, judgeModel, rationale: typeof parsed.rationale === "string" ? parsed.rationale.slice(0, 600) : "" };
}

/** Hint metrics — derived EXCLUSIVELY from labeled hint records. */
export function computeHintMetrics(hints: DeliveredHint[], labels: HintLabel[]): HintMetrics {
  const roleCounts: Record<OwnerMove, number> = { returns_to_goal: 0, supports_branch: 0, drifts: 0, neutral: 0 };
  const badHints: HintMetrics["badHints"] = [];
  let spokenCount = 0;
  for (const l of labels) {
    roleCounts[l.role]++;
    if (l.spokenMatchTurnIdx !== null) spokenCount++;
    if (l.role === "drifts" && badHints.length < 5) {
      badHints.push({ index: l.index, text: (hints[l.index]?.text ?? "").slice(0, 200), note: l.note });
    }
  }
  return { hintsEvaluated: labels.length, roleCounts, spokenCount, badHints };
}

// ---------------------------------------------------------------------------
// Metrics (pure)
// ---------------------------------------------------------------------------

export function computeGoalReturnMetrics(
  turns: GoalReturnTurn[],
  labels: TurnLabel[],
): GoalReturnMetrics {
  const byIdx = new Map(labels.map((l) => [l.idx, l]));
  const labeled = turns.filter((t) => byIdx.has(t.idx));
  const seg = (t: GoalReturnTurn) => byIdx.get(t.idx)!.segment;

  const counts = { on_goal: 0, justified_digression: 0, off_goal: 0 } as Record<SegmentLabel, number>;
  for (const t of labeled) counts[seg(t)]++;

  const pct = (n: number) => (labeled.length === 0 ? null : Math.round((n / labeled.length) * 1000) / 10);

  // Episodes: maximal contiguous runs of non-on_goal turns.
  const episodes: DigressionEpisode[] = [];
  let cur: { start: number; end: number; kinds: Set<SegmentLabel> } | null = null;
  for (let i = 0; i < labeled.length; i++) {
    const t = labeled[i];
    if (seg(t) !== "on_goal") {
      if (!cur) cur = { start: t.idx, end: t.idx, kinds: new Set() };
      cur.end = t.idx;
      cur.kinds.add(seg(t));
    } else if (cur) {
      episodes.push({
        startIdx: cur.start,
        endIdx: cur.end,
        kind: cur.kinds.size > 1 ? "mixed" : (cur.kinds.values().next().value as any),
        returned: true, // followed by this on_goal turn
      });
      cur = null;
    }
  }
  if (cur) {
    // Episode runs to the end of the call — never returned to the goal.
    // (A farewell-only tail still counts as not-returned; the report shows the range.)
    episodes.push({
      startIdx: cur.start,
      endIdx: cur.end,
      kind: cur.kinds.size > 1 ? "mixed" : (cur.kinds.values().next().value as any),
      returned: false,
    });
  }

  const ownerMoveCounts: Record<OwnerMove, number> = {
    returns_to_goal: 0,
    supports_branch: 0,
    drifts: 0,
    neutral: 0,
  };
  const badOwnerTurns: GoalReturnMetrics["badOwnerTurns"] = [];
  for (const t of labeled) {
    const l = byIdx.get(t.idx)!;
    if (t.role === "owner" && l.ownerMove) {
      ownerMoveCounts[l.ownerMove]++;
      if (l.ownerMove === "drifts" && badOwnerTurns.length < 5) {
        badOwnerTurns.push({ idx: t.idx, text: t.text.slice(0, 200), note: l.note });
      }
    }
  }

  return {
    turnsTotal: turns.length,
    turnsLabeled: labeled.length,
    onGoalPct: pct(counts.on_goal),
    justifiedPct: pct(counts.justified_digression),
    offGoalPct: pct(counts.off_goal),
    episodes,
    episodesReturned: episodes.filter((e) => e.returned).length,
    ownerMoveCounts,
    badOwnerTurns,
  };
}

// ---------------------------------------------------------------------------
// Report (markdown, BRAIN-report style: honest, missing data stated)
// ---------------------------------------------------------------------------

export interface GoalReturnCallReportInput {
  title: string;
  goal: string;
  goalSource: string; // e.g. "frozen fixture <id>" | "operator-supplied"
  judgement: GoalReturnJudgement | null;
  metrics: GoalReturnMetrics | null;
  turns: GoalReturnTurn[];
  hintStats?: { hintsSent: number; hintsDropped: number } | null;
  // Explicit hint records + their judgement. Hint metrics are ONLY rendered
  // from these — never inferred from owner turns.
  hints?: DeliveredHint[] | null;
  hintJudgement?: HintJudgement | null;
  hintMetrics?: HintMetrics | null;
  notes?: string[];
}

export function generateGoalReturnReport(callsIn: GoalReturnCallReportInput[]): string {
  const L: string[] = [];
  L.push(`# Goal-Return Analysis — отчёт (offline, по записанным звонкам)`);
  L.push(`${new Date().toISOString()} · анализ, НЕ изменение live-пайплайна`);
  L.push("");
  L.push(`## Честные ограничения данных`);
  L.push(`- Цель звонка НЕ сохраняется на записи звонка в production — источник цели указан для каждого звонка (frozen fixture или задана оператором).`);
  L.push(`- Тексты доставленных подсказок НЕ сохраняются в production; счётчики sent/dropped взяты из hintLatency-метаданных, когда они есть.`);
  L.push(`- Разметка Owner-реплик — это анализ поведения Owner'а (goal-adherence), НЕ эффективность подсказок: обычная речь Owner'а неотличима от принятой подсказки, атрибуция невозможна.`);
  L.push(`- Оценка подсказок выполняется ТОЛЬКО там, где переданы явные записи подсказок; признак «произнесена» — нечёткое совпадение текста подсказки с Owner-репликой (порог ${SPOKEN_MATCH_THRESHOLD}), это эвристика, не доказательство использования.`);
  L.push("");

  for (const c of callsIn) {
    L.push(`## ${c.title}`);
    L.push(`Цель: «${c.goal}» _(источник: ${c.goalSource})_`);
    if (c.hintStats) {
      L.push(`Подсказки за звонок (hintLatency): отправлено ${c.hintStats.hintsSent}, отброшено ${c.hintStats.hintsDropped} (текстов в метаданных нет).`);
    } else {
      L.push(`Подсказки за звонок: hintLatency-метаданных нет — счётчики недоступны.`);
    }
    if (!c.judgement || !c.metrics) {
      L.push(`**Судья не дал валидной разметки — звонок не оценён (fail-closed, ничего не сфабриковано).**`);
      for (const n of c.notes ?? []) L.push(`- ${n}`);
      L.push("");
      continue;
    }
    const m = c.metrics;
    L.push(`Судья: ${c.judgement.judgeModel}. Размечено ${m.turnsLabeled}/${m.turnsTotal} turn'ов.`);
    L.push("");
    L.push(`| Метрика | Значение |`);
    L.push(`| --- | --- |`);
    L.push(`| % turn'ов на цели | ${m.onGoalPct ?? "—"}% |`);
    L.push(`| % оправданных отступлений | ${m.justifiedPct ?? "—"}% |`);
    L.push(`| % ухода от цели | ${m.offGoalPct ?? "—"}% |`);
    L.push(`| Эпизодов отступления | ${m.episodes.length} |`);
    L.push(`| …из них с возвратом к цели | ${m.episodesReturned}/${m.episodes.length} |`);
    L.push(`| Owner-реплик «возврат к цели» (поведение Owner'а, не атрибуция подсказкам) | ${m.ownerMoveCounts.returns_to_goal} |`);
    L.push(`| Owner-реплик «поддержка нужной ветки» | ${m.ownerMoveCounts.supports_branch} |`);
    L.push(`| Owner-реплик «уводит в сторону» | ${m.ownerMoveCounts.drifts} |`);
    L.push(`| Owner-реплик нейтральных | ${m.ownerMoveCounts.neutral} |`);
    L.push("");
    if (m.episodes.length > 0) {
      L.push(`Эпизоды: ${m.episodes.map((e) => `turn ${e.startIdx}–${e.endIdx} (${e.kind}${e.returned ? ", вернулись" : ", НЕ вернулись"})`).join("; ")}`);
    }
    if (m.badOwnerTurns.length > 0) {
      L.push(`Примеры плохих (Owner уводит от цели — поведение Owner'а):`);
      for (const b of m.badOwnerTurns) L.push(`- turn ${b.idx}: «${b.text}» — ${b.note}`);
    } else {
      L.push(`Плохих Owner-реплик (уводящих от цели) судья не нашёл.`);
    }
    if (c.judgement.rationale) L.push(`Резюме судьи: ${c.judgement.rationale}`);
    // Hint-level evaluation — ONLY from explicit hint records.
    if (c.hints && c.hints.length > 0) {
      if (c.hintJudgement && c.hintMetrics) {
        const hm = c.hintMetrics;
        L.push("");
        L.push(`### Оценка доставленных подсказок (${hm.hintsEvaluated} записей подсказок)`);
        L.push(`| Роль подсказки | Кол-во |`);
        L.push(`| --- | --- |`);
        L.push(`| возвращает к цели | ${hm.roleCounts.returns_to_goal} |`);
        L.push(`| поддерживает нужную ветку | ${hm.roleCounts.supports_branch} |`);
        L.push(`| уводит в сторону | ${hm.roleCounts.drifts} |`);
        L.push(`| нейтральная | ${hm.roleCounts.neutral} |`);
        L.push(`| «произнесена» (нечёткое совпадение с Owner-репликой ≥ ${SPOKEN_MATCH_THRESHOLD}) | ${hm.spokenCount}/${hm.hintsEvaluated} |`);
        if (hm.badHints.length > 0) {
          L.push(`Плохие подсказки (уводят в сторону):`);
          for (const b of hm.badHints) L.push(`- hint ${b.index}: «${b.text}» — ${b.note}`);
        }
        if (c.hintJudgement.rationale) L.push(`Резюме судьи по подсказкам: ${c.hintJudgement.rationale}`);
      } else {
        L.push(`Записи подсказок переданы (${c.hints.length}), но судья не дал валидной разметки — подсказки не оценены (fail-closed).`);
      }
    } else {
      L.push(`Оценка подсказок недоступна: тексты подсказок для этого звонка не сохранены и не переданы — метрики выше описывают только поведение Owner'а.`);
    }
    for (const n of c.notes ?? []) L.push(`- ${n}`);
    L.push("");
  }

  // Aggregate verdict across scoreable calls.
  const scored = callsIn.filter((c) => c.metrics);
  L.push(`## Итог`);
  if (scored.length === 0) {
    L.push(`Ни один звонок не был оценён — вывода нет.`);
  } else {
    const eps = scored.flatMap((c) => c.metrics!.episodes);
    const ret = eps.filter((e) => e.returned).length;
    const drift = scored.reduce((a, c) => a + c.metrics!.ownerMoveCounts.drifts, 0);
    const back = scored.reduce((a, c) => a + c.metrics!.ownerMoveCounts.returns_to_goal, 0);
    L.push(`Звонков оценено: ${scored.length}. Эпизодов отступления: ${eps.length}, с возвратом к цели: ${ret}. ` +
      `Owner-реплик «возврат к цели»: ${back}, «уводит в сторону»: ${drift} (поведение Owner'а — не атрибуция подсказкам).`);
    const hintScored = callsIn.filter((c) => c.hintMetrics);
    if (hintScored.length > 0) {
      const hBack = hintScored.reduce((a, c) => a + c.hintMetrics!.roleCounts.returns_to_goal, 0);
      const hDrift = hintScored.reduce((a, c) => a + c.hintMetrics!.roleCounts.drifts, 0);
      const hTotal = hintScored.reduce((a, c) => a + c.hintMetrics!.hintsEvaluated, 0);
      L.push(`Подсказок оценено (по явным записям подсказок): ${hTotal} в ${hintScored.length} звонках — «возвращает к цели»: ${hBack}, «уводит в сторону»: ${hDrift}.`);
    } else {
      L.push(`Подсказки не оценивались: ни для одного звонка не переданы записи подсказок (тексты подсказок в production не сохраняются).`);
    }
    L.push(eps.length > 0 && ret === eps.length && drift === 0
      ? `Вывод: во всех оценённых звонках отступления закрывались возвратом к цели, уводящих Owner-реплик не найдено.`
      : `Вывод: см. эпизоды без возврата и уводящие реплики выше — это кандидаты на разбор.`);
  }
  return L.join("\n");
}
