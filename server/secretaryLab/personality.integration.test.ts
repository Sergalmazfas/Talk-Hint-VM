import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { pool, dbReady, isDevDatabase } from "../db";
import { listPersonalities, availablePersonalityVersion } from "../secretary/personalities/store";
import { SecretaryConversationEngine } from "../secretary/conversationEngine";
import { PgComparisonRepository } from "./comparisonStore";
import { comparisonSnapshot } from "./comparisonSnapshot";
import type { RetellReport } from "./retell";

it.runIf(process.env.RUN_PERSONALITY_DB_TESTS === "1")("reads the real catalog and round-trips both personality reports through the common PostgreSQL repository", async () => {
  await dbReady;
  if (!isDevDatabase || !pool) throw Error("This acceptance test is Dev-only");
  vi.stubEnv("NODE_ENV", "development");
  const connection = await pool.connect();
  try {
    const catalog = await listPersonalities("катя", undefined, 25);
    const katya = catalog.items.find((p: any) => p.slug === "katya");
    expect(katya).toBeDefined();
    const binding = await availablePersonalityVersion(katya.id, katya.currentVersion, "work");
    expect(binding.snapshot.examples.length).toBeGreaterThan(0);
    expect(binding.snapshot.rules).toContain("ПРИНЦИП РАЗДЕЛЕНИЯ");
    const engine = new SecretaryConversationEngine("test-owner", "TEST message only", undefined, false, binding);
    expect(engine.instructions).toContain(JSON.stringify(binding.snapshot.rules));
    for (const example of binding.snapshot.examples) expect(engine.instructions).toContain(JSON.stringify(example));
    expect(engine.report.testOnly).toBe(true);

    // Uncommitted rows cannot be seen by any background worker or UI.
    await connection.query("BEGIN");
    const owner = "lab-personality-test-" + randomUUID();
    const id = randomUUID();
    await connection.query("INSERT INTO users(id,email) VALUES($1,$2)", [owner, owner + "@test.invalid"]);
    const report: RetellReport = {
      id, callId: "", status: "ended", instruction: "TEST message only", model: engine.report.model,
      voice: "TEST catalogue voice", promptHash: "a".repeat(64), createdAt: new Date().toISOString(),
      monitorStatus: "ended", turns: [], events: [], observations: [], metrics: { guestTurns: 0, secretaryTurns: 0 },
      engine: engine.report, personality: engine.report.personality,
    };
    const runs = (["retell-engine", "eleven-engine"] as const).map(mode => comparisonSnapshot(mode,
      { ...report, profileId: mode === "retell-engine" ? "default" : "baseline" }));
    const writer = new PgComparisonRepository(connection);
    await writer.checkpoint(owner, id, { title: "TEST personality persistence", instruction: report.instruction,
      evaluation: { score: null, note: "" }, runs });
    const reader = new PgComparisonRepository(connection);
    const saved = await reader.get(id);
    expect(saved?.runs).toHaveLength(2);
    for (const run of saved!.runs) {
      expect(run.personality).toEqual({ id: katya.id, name: katya.name, version: katya.currentVersion, mode: "work" });
      expect(run.profileId).toBe(run.mode === "retell-engine" ? "default" : "baseline");
      expect(JSON.parse(JSON.stringify(saved)).runs.find((r: any) => r.mode === run.mode).personality).toEqual(run.personality);
    }
    await expect(availablePersonalityVersion(katya.id, katya.currentVersion + 100, "work")).rejects.toMatchObject({ status: 409 });
  } finally {
    await connection.query("ROLLBACK");
    connection.release();
    vi.unstubAllEnvs();
  }
});
