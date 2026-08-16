// LIVE Hint Policy v2.2 — Strategy Memory (Task #236).
//
// Bounded, deterministic per-call tracker of the last few hint cycles:
//   TalkHint suggestion -> what the Owner ACTUALLY said -> Guest reaction.
// Rendered as a compact "RECENT STRATEGY MEMORY" block injected into the live
// system prompt before every Terra call, so the Brain can distinguish what was
// SUGGESTED from what was actually SAID and use the Guest's reaction to plan
// the next step — without a second LLM, classifier, or summarizer.
//
// Hard guarantees (mirrors of the task's hard constraints):
//  - Pure string/array work. No model call, no DB round-trip, fully synchronous.
//  - Bounded: at most MAX_CYCLES cycles kept, every text capped, so memory
//    never grows with call length.
//  - Suggestion ≠ Owner fact: the render explicitly labels suggestions as
//    advice; the outcome is computed only from actual Owner speech using the
//    same deterministic token-overlap scorer as the #226 hint-usage pipeline.
//  - CHOICE options stay hypothetical: an option is reported as "branch
//    selected" only when the Owner's real speech matched it; unselected
//    options are never presented as spoken.

import { usageScore, USAGE_FULL_THRESHOLD, USAGE_PARTIAL_THRESHOLD } from "./hintUsage";
import type { HintType, HintOption } from "./hintShape";

// How many completed hint cycles the memory keeps (task spec: last 2-4).
export const MAX_CYCLES = 4;
// Per-field character cap so the block stays cheap in tokens.
const MAX_TEXT = 160;
// At most this many owner turns are attributed to one cycle (robot callers
// can speak in bursts; two turns is enough to judge usage).
const MAX_OWNER_TURNS_PER_CYCLE = 2;

export type CycleOutcome =
  | "accepted"          // owner's actual speech covered the suggestion (>= full threshold)
  | "partial"           // owner used only part of the suggestion
  | "ignored"           // owner said something else entirely
  | "no owner reply";   // owner said nothing before the guest spoke again

export interface StrategyCycle {
  suggestionEn: string;
  suggestionType?: HintType;
  options?: Pick<HintOption, "label" | "en">[];
  ownerSaid: string[];       // actual Owner turns after the hint (capped)
  guestReaction?: string;    // the NEXT guest turn (closes the cycle)
  closed: boolean;
}

function cap(text: string): string {
  const t = text.trim();
  return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT - 1) + "…" : t;
}

/** Deterministic outcome from actual Owner speech only — never from the hint itself. */
export function scoreOutcome(cycle: StrategyCycle): { outcome: CycleOutcome; selectedBranch?: string } {
  if (cycle.ownerSaid.length === 0) return { outcome: "no owner reply" };
  const ownerAll = cycle.ownerSaid.join(" ");

  // CHOICE: score each option against actual speech; a branch is "selected"
  // only when the owner's speech matched that option at least partially AND
  // strictly better than every other option (ties select nothing).
  if (cycle.suggestionType === "choice" && cycle.options && cycle.options.length >= 2) {
    let bestIdx = -1;
    let best = 0;
    let secondBest = 0;
    cycle.options.forEach((o, i) => {
      const s = usageScore(o.en, ownerAll);
      if (s > best) { secondBest = best; best = s; bestIdx = i; }
      else if (s > secondBest) { secondBest = s; }
    });
    if (bestIdx >= 0 && best >= USAGE_PARTIAL_THRESHOLD && best > secondBest) {
      const label = cycle.options[bestIdx].label || cycle.options[bestIdx].en;
      return { outcome: best >= USAGE_FULL_THRESHOLD ? "accepted" : "partial", selectedBranch: label };
    }
    return { outcome: "ignored" };
  }

  const s = usageScore(cycle.suggestionEn, ownerAll);
  if (s >= USAGE_FULL_THRESHOLD) return { outcome: "accepted" };
  if (s >= USAGE_PARTIAL_THRESHOLD) return { outcome: "partial" };
  return { outcome: "ignored" };
}

export class StrategyMemoryTracker {
  private cycles: StrategyCycle[] = [];

  /** A hint was actually DELIVERED to the user (sent to the UI). */
  recordSuggestion(en: string, type?: HintType, options?: Pick<HintOption, "label" | "en">[]): void {
    if (!en || !en.trim()) return;
    this.cycles.push({
      suggestionEn: cap(en),
      suggestionType: type,
      options: options?.slice(0, 3).map((o) => ({ label: o.label, en: cap(o.en) })),
      ownerSaid: [],
      closed: false,
    });
    if (this.cycles.length > MAX_CYCLES) this.cycles.shift(); // bounded, oldest out
  }

  /** The Owner actually spoke — attach to the newest open cycle. */
  recordOwnerTurn(text: string): void {
    if (!text || !text.trim()) return;
    const open = this.cycles[this.cycles.length - 1];
    if (!open || open.closed) return;
    if (open.ownerSaid.length >= MAX_OWNER_TURNS_PER_CYCLE) return;
    open.ownerSaid.push(cap(text));
  }

  /** A new Guest turn arrived — it is the reaction that CLOSES the open cycle. */
  recordGuestTurn(text: string): void {
    const open = this.cycles[this.cycles.length - 1];
    if (!open || open.closed) return;
    open.guestReaction = cap(text || "");
    open.closed = true;
  }

  /** Number of cycles currently held (bounded by MAX_CYCLES). */
  size(): number {
    return this.cycles.length;
  }

  /**
   * Render the compact RECENT STRATEGY MEMORY block, or "" when there is
   * nothing useful yet. Only CLOSED cycles are rendered — an open cycle has no
   * Guest reaction yet and its owner attribution may still be in flight.
   */
  render(): string {
    const closed = this.cycles.filter((c) => c.closed);
    if (closed.length === 0) return "";
    const lines: string[] = [
      "RECENT STRATEGY MEMORY (what TalkHint previously SUGGESTED in this call — advice, NOT facts; only \"Owner actually said\" lines are real speech):",
    ];
    closed.forEach((c, i) => {
      const typeTag = c.suggestionType ? ` (${c.suggestionType})` : "";
      lines.push(`[${i + 1}] TalkHint suggested${typeTag}: "${c.suggestionEn}"`);
      if (c.suggestionType === "choice" && c.options) {
        lines.push(`    Options shown (hypothetical until spoken): ${c.options.map((o) => `${o.label || "?"}: "${o.en}"`).join(" / ")}`);
      }
      lines.push(
        c.ownerSaid.length > 0
          ? `    Owner actually said: ${c.ownerSaid.map((t) => `"${t}"`).join(" ")}`
          : `    Owner actually said: (nothing — the suggestion was NOT spoken)`
      );
      if (c.guestReaction) lines.push(`    Guest reaction: "${c.guestReaction}"`);
      const { outcome, selectedBranch } = scoreOutcome(c);
      lines.push(`    Outcome: ${outcome}${selectedBranch ? ` / branch selected: ${selectedBranch}` : ""}`);
    });
    return lines.join("\n");
  }
}
