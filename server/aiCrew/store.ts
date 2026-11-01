import type { Pool } from "pg";
import { initialState, type CrewState } from "./domain";

/** One company-wide locked row per environment: controls, all-agent budget and
 * append-only journal commit atomically. No retention/deletion is implied.
 * Explicit owner readiness creates this new table; startup never migrates it. */
export class CrewStore {
  constructor(private pool: Pool, readonly environment: "production" | "development") {}
  async initialize() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS ai_crew_runtime_state (
      environment text PRIMARY KEY CHECK (environment IN ('production','development')),
      state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
    await this.pool.query(`INSERT INTO ai_crew_runtime_state(environment,state) VALUES($1,$2::jsonb)
      ON CONFLICT(environment) DO NOTHING`, [this.environment, JSON.stringify(initialState())]);
  }
  async read(): Promise<CrewState> {
    const r = await this.pool.query("SELECT state FROM ai_crew_runtime_state WHERE environment=$1", [this.environment]);
    if (!r.rows[0]) throw Error("CREW_NOT_INITIALIZED");
    return r.rows[0].state;
  }
  async change<T>(work: (state: CrewState) => T, expectedRevision?: number): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const r = await c.query("SELECT state FROM ai_crew_runtime_state WHERE environment=$1 FOR UPDATE", [this.environment]);
      const state: CrewState = r.rows[0]?.state;
      if (!state) throw Error("CREW_NOT_INITIALIZED");
      if (expectedRevision !== undefined && state.revision !== expectedRevision) throw Error("STALE_REVISION");
      const result = work(state);
      state.revision++;
      await c.query("UPDATE ai_crew_runtime_state SET state=$2::jsonb,updated_at=now() WHERE environment=$1",
        [this.environment, JSON.stringify(state)]);
      await c.query("COMMIT");
      return result;
    } catch (error) { await c.query("ROLLBACK"); throw error; }
    finally { c.release(); }
  }
}
export type StateStore = Pick<CrewStore, "read" | "change">;
