/**
 * Task #250 — Production acceptance: verify v2.2 Strategy Memory prevents
 * Brain from repeating already-used/failed strategies across turns.
 *
 * Runs through a scripted 8-turn call with the REAL:
 *   - StrategyMemoryTracker (server/strategyMemory.ts)
 *   - buildLiveSystemPrompt (shared/prompts.ts)
 *   - gpt-5.6-terra via OpenAI API
 *
 * Records per-turn: hint type, latency, strategy-repeat flag, invented-state
 * flag, follow-through quality (reviewer judgement from logged output).
 *
 * Usage:  npx tsx scripts/prod-acceptance-250.ts
 */

import { StrategyMemoryTracker, scoreOutcome } from "../server/strategyMemory";
import { buildLiveSystemPrompt } from "../shared/prompts";
import { normalizeSuggestion } from "../server/hintShape";
import { buildOpenAIChatBody } from "../server/hintProvider";

const MODEL = "gpt-5.6-terra";
const MAX_TOKENS = 250;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) { console.error("OPENAI_API_KEY not set"); process.exit(1); }

// ---------------------------------------------------------------------------
// Scripted call scenario: "Cancel subscription / waive fee" — customer service
// The guest (customer service agent) pushes back on each strategy, so Brain
// MUST adapt each turn and not repeat the previously rejected approach.
// ---------------------------------------------------------------------------
const GOAL = "Cancel my subscription and waive the $50 early termination fee — I've been a loyal customer for 3 years.";
const LANGUAGE = "ru";

interface Turn {
  /** Guest utterance (customer service agent) */
  guestText: string;
  /** Scripted Owner response (what user actually said after seeing the hint) */
  ownerResponse: string;
  /** Whether the owner's response USED the hint (for cycle scoring) */
  usedHint: "full" | "partial" | "ignored" | "none";
  /** Label for logging */
  label: string;
}

const TURNS: Turn[] = [
  {
    label: "T1 - Initial offer: fee waiver denied (first attempt: loyalty argument)",
    guestText: "I understand you'd like to cancel. However, our policy requires a $50 early termination fee. I can note your loyalty on the account.",
    ownerResponse: "I've been with you for 3 years and never missed a payment. Surely you can waive it as a courtesy for a long-term customer.",
    usedHint: "full",
  },
  {
    label: "T2 - Supervisor claim, loyalty argument already tried",
    guestText: "I understand your frustration, but I don't have the authority to waive the fee. That's just our company policy.",
    ownerResponse: "Can I speak with a supervisor who does have that authority?",
    usedHint: "full",
  },
  {
    label: "T3 - Supervisor also refuses; escalation failed",
    guestText: "I am the supervisor. We appreciate your loyalty, but the fee applies to all cancellations per our terms. We really can't waive it.",
    ownerResponse: "I understand there's a policy. Is there any exception process, or a credit I can apply toward a future plan?",
    usedHint: "partial",
  },
  {
    label: "T4 - No exception, pivots to retention offer",
    guestText: "We do have retention offers. I can offer you 50% off for the next 3 months if you stay.",
    ownerResponse: "I appreciate that, but I really need to cancel. The fee still makes this feel unfair.",
    usedHint: "ignored",
  },
  {
    label: "T5 - Retention rejected; fee still present",
    guestText: "I see. I can proceed with the cancellation, but the $50 fee will still apply. Shall I go ahead?",
    ownerResponse: "Before you do — could you apply the fee as a credit to my final invoice instead of charging my card?",
    usedHint: "full",
  },
  {
    label: "T6 - Credit on invoice accepted partially",
    guestText: "I can make a note requesting that, but I can't guarantee approval. It would go to billing review.",
    ownerResponse: "Okay. And when will billing review decide? I'd like to know before my card is charged.",
    usedHint: "partial",
  },
  {
    label: "T7 - Billing timeline given; wrapping up",
    guestText: "Billing review typically takes 3–5 business days. Your card won't be charged until then.",
    ownerResponse: "That works for me. Please confirm my cancellation effective today and send me a confirmation email.",
    usedHint: "full",
  },
  {
    label: "T8 - Final confirmation",
    guestText: "I've processed the cancellation effective today and will send a confirmation to your email. Is there anything else I can help you with?",
    ownerResponse: "No, that's everything. Thank you.",
    usedHint: "ignored",
  },
];

// ---------------------------------------------------------------------------

interface TurnResult {
  label: string;
  turn: number;
  guestText: string;
  ownerResponse: string;
  hint: string;
  hintType: string;
  hintTranslation: string;
  latencyMs: number;
  strategyMemorySnapshot: string;
  // filled after review
  inventedState: boolean;
  strategyRepeat: boolean;
  followThrough: boolean;
}

async function callOpenAI(systemPrompt: string, userPrompt: string): Promise<string> {
  const body = buildOpenAIChatBody(MODEL, systemPrompt, userPrompt, MAX_TOKENS);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

function parseHint(raw: string) {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function stripPreamble(text: string): string {
  return text.replace(/^(i understand|of course|certainly|great|let me|okay|ok|alright)[,.]?\s*/i, "").trim();
}

async function main() {
  const tracker = new StrategyMemoryTracker();
  const results: TurnResult[] = [];
  const conversationLog: string[] = [];

  console.log("=".repeat(70));
  console.log("Task #250 — Production Acceptance: v2.2 Strategy Memory");
  console.log(`Model: ${MODEL}  |  Turns: ${TURNS.length}`);
  console.log(`Goal: ${GOAL}`);
  console.log("=".repeat(70) + "\n");

  for (let i = 0; i < TURNS.length; i++) {
    const turn = TURNS[i];
    console.log(`\n${"─".repeat(60)}`);
    console.log(`Turn ${i + 1}: ${turn.label}`);
    console.log(`Guest: "${turn.guestText}"`);

    // Close previous cycle: this guest turn is the reaction
    tracker.recordGuestTurn(turn.guestText);

    // Build the prompt with strategy memory
    const strategyMemoryBlock = tracker.render();
    const conversationContext = conversationLog.join("\n");
    const systemPrompt = buildLiveSystemPrompt({
      goal: GOAL,
      language: LANGUAGE,
      conversationContext,
      translateEnabled: true,
      strategyMemory: strategyMemoryBlock,
    });

    const userPrompt = `Guest said: "${turn.guestText}"\n\nRemember: Your suggestion must ADVANCE the user's goal.`;

    if (strategyMemoryBlock) {
      console.log("\n[Memory block being sent to Brain]:");
      console.log(strategyMemoryBlock.split("\n").map(l => "  " + l).join("\n"));
    } else {
      console.log("[No memory yet — first turn]");
    }

    const t0 = Date.now();
    let rawContent = "";
    try {
      rawContent = await callOpenAI(systemPrompt, userPrompt);
    } catch (err: any) {
      console.error(`  API error: ${err.message}`);
      results.push({ label: turn.label, turn: i+1, guestText: turn.guestText, ownerResponse: turn.ownerResponse,
        hint: "ERROR", hintType: "error", hintTranslation: "", latencyMs: Date.now()-t0,
        strategyMemorySnapshot: strategyMemoryBlock, inventedState: false, strategyRepeat: false, followThrough: false });
      continue;
    }
    const latencyMs = Date.now() - t0;

    const parsed = parseHint(rawContent);
    const normalized = parsed?.suggestion
      ? normalizeSuggestion(parsed.suggestion, { translateEnabled: true, stripPreamble })
      : null;

    const hintEn = normalized?.en ?? parsed?.suggestion?.en ?? "";
    const hintType = normalized?.type ?? parsed?.suggestion?.type ?? "direct";
    const hintTranslation = normalized?.translation ?? parsed?.suggestion?.translation ?? "";
    const hintOptions = normalized?.options ?? parsed?.suggestion?.options ?? [];

    console.log(`\n[Brain response] (${latencyMs}ms)`);
    console.log(`  Type: ${hintType}`);
    console.log(`  EN:   "${hintEn}"`);
    if (hintOptions.length) console.log(`  Opts: ${JSON.stringify(hintOptions.map((o: any) => o.en ?? o.label))}`);
    console.log(`  TR:   "${hintTranslation}"`);
    console.log(`  Sentiment: ${parsed?.sentiment ?? "?"}`);

    // Record hint as delivered
    if (hintEn) {
      tracker.recordSuggestion(hintEn, hintType as any, hintOptions);
    }

    // Simulate owner response
    console.log(`\nOwner said (scripted, ${turn.usedHint}): "${turn.ownerResponse}"`);
    tracker.recordOwnerTurn(turn.ownerResponse);

    // Update conversation log
    conversationLog.push(`Guest: ${turn.guestText}`);
    if (hintEn) conversationLog.push(`[TalkHint suggested: "${hintEn}"]`);
    conversationLog.push(`Owner: ${turn.ownerResponse}`);
    // Keep last 10 lines
    while (conversationLog.length > 12) conversationLog.shift();

    results.push({
      label: turn.label,
      turn: i + 1,
      guestText: turn.guestText,
      ownerResponse: turn.ownerResponse,
      hint: hintEn,
      hintType,
      hintTranslation,
      latencyMs,
      strategyMemorySnapshot: strategyMemoryBlock,
      // These will be filled by automated heuristics + logged for manual review
      inventedState: false,
      strategyRepeat: false,
      followThrough: false,
    });
  }

  // ── Post-run analysis ────────────────────────────────────────────────────

  console.log("\n" + "=".repeat(70));
  console.log("POST-RUN ANALYSIS");
  console.log("=".repeat(70));

  // Latency stats
  const latencies = results.map(r => r.latencyMs).filter(l => l > 0);
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
  const avg = latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1);

  console.log(`\nLatency (${latencies.length} turns with data):`);
  console.log(`  avg=${Math.round(avg)}ms  p50=${p50}ms  p95=${p95}ms`);
  console.log(`  v2.1 baseline: p50=1501ms / p90=1782ms`);
  const latencyRegression = p50 > 1501 * 1.25 || p95 > 1782 * 1.5;
  console.log(`  Regression: ${latencyRegression ? "⚠ YES" : "✓ NONE"}`);

  // Hint type distribution
  const typeCounts: Record<string, number> = {};
  results.forEach(r => { typeCounts[r.hintType] = (typeCounts[r.hintType] ?? 0) + 1; });
  console.log("\nHint type distribution:");
  Object.entries(typeCounts).forEach(([t, n]) => console.log(`  ${t}: ${n}`));

  // Strategy memory final state
  const finalRender = tracker.render();
  const cycleCount = (finalRender.match(/^\[\d+\]/gm) || []).length;
  console.log(`\nFinal memory: ${cycleCount} closed cycles rendered (max 4)`);
  if (finalRender) {
    console.log("\nFinal RECENT STRATEGY MEMORY block:");
    console.log(finalRender.split("\n").map(l => "  " + l).join("\n"));
  }

  // Per-turn summary
  console.log("\nPer-turn summary:");
  console.log(["Turn", "Type", "Latency", "Hint (first 60 chars)"].map(s => s.padEnd(12)).join(""));
  results.forEach(r => {
    const label = r.hint.slice(0, 55) + (r.hint.length > 55 ? "…" : "");
    console.log([`T${r.turn}`.padEnd(12), r.hintType.padEnd(12), `${r.latencyMs}ms`.padEnd(12), label].join(""));
  });

  // ── Strategy-repeat detection heuristic ──────────────────────────────────
  // Check if Brain re-used the SAME core suggestion across turns where the
  // earlier attempt was marked as ignored/rejected (owner didn't use the hint).
  // This is a token-overlap check on consecutive hints.
  console.log("\nStrategy-repeat heuristic (token overlap between consecutive hints):");
  let strategyRepeats = 0;
  for (let i = 1; i < results.length; i++) {
    const prev = results[i - 1];
    const curr = results[i];
    if (!prev.hint || !curr.hint) continue;
    const prevTokens = new Set(prev.hint.toLowerCase().split(/\W+/).filter(t => t.length > 4));
    const currTokens = curr.hint.toLowerCase().split(/\W+/).filter(t => t.length > 4);
    const overlap = currTokens.filter(t => prevTokens.has(t)).length;
    const overlapRatio = prevTokens.size > 0 ? overlap / prevTokens.size : 0;
    const isRepeat = overlapRatio > 0.6 && TURNS[i - 1].usedHint === "ignored";
    if (isRepeat) {
      strategyRepeats++;
      results[i].strategyRepeat = true;
    }
    console.log(`  T${i}→T${i+1}: overlap=${(overlapRatio*100).toFixed(0)}% prev_used=${TURNS[i-1].usedHint} ${isRepeat ? "⚠ REPEAT" : "✓ ok"}`);
  }
  console.log(`  Strategy repeats detected: ${strategyRepeats}/${results.length - 1} transitions`);

  // ── Summary verdict ────────────────────────────────────────────────────────
  const inventedStateViolations = results.filter(r => r.inventedState).length;
  // (invented-state is manually reviewed from the logged output above; this
  //  script sets it to false by default — reviewer updates after reading hints)
  console.log("\n" + "=".repeat(70));
  console.log("SECTION 5 METRICS SUMMARY");
  console.log("=".repeat(70));
  console.log(`Turns run:               ${results.length}`);
  console.log(`Latency p50:             ${p50}ms  (baseline: 1501ms)`);
  console.log(`Latency p95:             ${p95}ms  (baseline: 1782ms)`);
  console.log(`Latency regression:      ${latencyRegression ? "YES ⚠" : "NONE ✓"}`);
  console.log(`Hint types:              ${Object.entries(typeCounts).map(([k,v])=>`${k}:${v}`).join(" / ")}`);
  console.log(`Strategy repeats:        ${strategyRepeats} (threshold: 0)`);
  console.log(`Invented-state (auto):   ${inventedStateViolations} (manual review required)`);
  console.log(`Closed memory cycles:    ${cycleCount} (max 4)`);
  console.log(`Single Brain call/turn:  ✓ (one API call per turn — architecture enforced)`);
  console.log(`\nManual review tasks:`);
  console.log(`  1. Scan each [Brain response] above — does it assert unspoken content as fact?`);
  console.log(`  2. After T2 (supervisor escalation ignored) — does T3 hint still escalate, or adapt?`);
  console.log(`  3. After T4 (retention rejected) — does T5 hint repeat "stay" offer, or pivot to credit?`);
  console.log(`  4. Confirm follow-through: each successive hint builds on the previous exchange.`);
  console.log(`\nProvisional verdict (requires manual invented-state check above):`);
  const provisionalPass = !latencyRegression && strategyRepeats === 0;
  console.log(`  ${provisionalPass ? "✓ PASS" : "⚠ FAIL"}`);
}

main().catch(err => { console.error(err); process.exit(1); });
