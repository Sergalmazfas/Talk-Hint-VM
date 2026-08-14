// Seeds the Gold Call #1 fixture (frozen reference transcript, goal, critical
// entities) into benchmark_fixtures. Idempotent: keyed by source_call_sid.
// NOTE: no audio exists for this call — audioBase64 stays null, which the
// EARS harness reports honestly as "no real audio fixtures yet".

import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { benchmarkFixtures, type BenchmarkFixture } from "@shared/schema";
import {
  GOLD_CALL_SOURCE_CALL_SID, GOLD_CALL_TITLE, GOLD_CALL_KIND, GOLD_CALL_GOAL,
  GOLD_CALL_TURNS, GOLD_CALL_CRITICAL_ENTITIES, GOLD_CALL_CONFIRMED_FACTS,
} from "./goldCall";

export async function ensureGoldCallFixture(): Promise<BenchmarkFixture> {
  const existing = await db.select().from(benchmarkFixtures)
    .where(eq(benchmarkFixtures.sourceCallSid, GOLD_CALL_SOURCE_CALL_SID));
  if (existing.length > 0) return existing[0];
  const [row] = await db.insert(benchmarkFixtures).values({
    title: GOLD_CALL_TITLE,
    kind: GOLD_CALL_KIND,
    goal: GOLD_CALL_GOAL,
    referenceTurns: GOLD_CALL_TURNS,
    criticalEntities: GOLD_CALL_CRITICAL_ENTITIES,
    confirmedFacts: GOLD_CALL_CONFIRMED_FACTS,
    sourceCallSid: GOLD_CALL_SOURCE_CALL_SID,
    tags: ["gold", "bank_dispute", "english"],
  }).returning();
  return row;
}

/** Stable hash over the fixture corpus for before/after run comparability. */
export function corpusHash(fixtures: Pick<BenchmarkFixture, "id" | "referenceTurns" | "goal">[]): string {
  const h = crypto.createHash("sha256");
  for (const f of [...fixtures].sort((a, b) => a.id.localeCompare(b.id))) {
    h.update(f.id);
    h.update(JSON.stringify(f.referenceTurns));
    h.update(f.goal);
  }
  return h.digest("hex").slice(0, 16);
}
