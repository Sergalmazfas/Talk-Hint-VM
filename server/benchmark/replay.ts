// LIVE End-to-End Replay: turns a completed BRAIN run (per candidate) into a
// conversation-tape timeline: Guest said → AI state → strategy → suggested
// reply → latency, with the full timestamp trail. Where a stage was never
// measured live (WS sent / client rendered for a replayed call), values are
// estimates and are labeled as such.

import type { BenchmarkFixture, BenchmarkRun } from "@shared/schema";
import type { BrainTurnResult, ReplayTurn, ReferenceTurn } from "./types";

const ESTIMATED_WS_MS = 15;      // measured typical server->WS overhead
const ESTIMATED_RENDER_MS = 60;  // measured typical client render overhead

export function buildReplay(run: BenchmarkRun, fixture: BenchmarkFixture, candidateId: string): {
  candidateId: string;
  estimatedStages: string[];
  turns: ReplayTurn[];
} {
  const turnResults = ((run.results as any)?.turnResults ?? []) as BrainTurnResult[];
  const mine = new Map<number, BrainTurnResult>();
  for (const t of turnResults) if (t.candidateId === candidateId) mine.set(t.turnIdx, t);

  const refTurns = (fixture.referenceTurns as ReferenceTurn[]) ?? [];
  const turns: ReplayTurn[] = [];

  for (const ref of refTurns) {
    const r = mine.get(ref.idx);
    const out = r?.output ?? null;
    const ready = r?.suggestionReadyAfterGuestEndMs ?? null;
    turns.push({
      turnIdx: ref.idx,
      role: ref.role,
      said: ref.text,
      aiState: out?.current_topic ? `${out.current_topic}${out.goal_status ? ` | goal: ${out.goal_status}` : ""}` : null,
      strategy: out?.strategy ?? null,
      suggestedReply: out?.should_suggest ? out?.suggested_reply ?? null : null,
      timestamps: r ? {
        audioEnd: 0,
        sttFinal: 0, // frozen transcript replay: STT stage bypassed by design
        hintTrigger: 0,
        llmFirstToken: r.firstTokenMs ?? undefined,
        suggestionReady: ready ?? undefined,
        wsSent: ready != null ? ready + ESTIMATED_WS_MS : undefined,
        clientRendered: ready != null ? ready + ESTIMATED_WS_MS + ESTIMATED_RENDER_MS : undefined,
      } : {},
      latencyMs: ready,
      judgeScore: r?.judge?.scores?.overall_live_copilot_quality ?? null,
    });
  }
  return {
    candidateId,
    estimatedStages: ["wsSent (estimated +15ms)", "clientRendered (estimated +75ms total)", "sttFinal (bypassed: frozen transcript)"],
    turns,
  };
}
