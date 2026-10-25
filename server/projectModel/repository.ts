import type { Pool } from "pg";
import type { ModelCommand, ProjectModelState } from "../../shared/projectModel";
import { ModelError } from "./domain";
import { applyHypothesisCommand, readHypothesis } from "./hypotheses";
import { initialModel } from "./seed";

export interface ModelRepository {
  read(owner: string, hypothesis?: string): Promise<ProjectModelState>;
  update(owner: string, revision: number, command: ModelCommand, hypothesis?: string): Promise<ProjectModelState>;
  updateMany?(owner: string, revision: number, commands: ModelCommand[], hypothesis?: string): Promise<ProjectModelState>;
}
/** Additive table, owner-keyed; durable history and state commit atomically. */
export class PgModelRepository implements ModelRepository {
  private ready?: Promise<void>;
  constructor(private getPool: () => Promise<Pool>) {}
  private async database() {
    const pool = await this.getPool();
    if (!this.ready) {
      this.ready = pool.query(`CREATE TABLE IF NOT EXISTS talkhint_project_models (
        owner_key text PRIMARY KEY, revision integer NOT NULL,
        state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
      )`).then(() => {}).catch(e => { this.ready = undefined; throw e; });
    }
    await this.ready;
    return pool;
  }
  private async ensure(pool: Pool, owner: string) {
    await pool.query("INSERT INTO talkhint_project_models(owner_key, revision, state) VALUES($1,0,$2::jsonb) ON CONFLICT(owner_key) DO NOTHING",
      [owner, JSON.stringify(initialModel())]);
  }
  async read(owner: string, hypothesis = "original") {
    const pool = await this.database();
    await this.ensure(pool, owner);
    const r = await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", [owner]);
    return readHypothesis(r.rows[0].state as ProjectModelState, hypothesis);
  }
  async update(owner: string, revision: number, command: ModelCommand, hypothesis = "original") {
    return this.updateMany(owner, revision, [command], hypothesis);
  }
  /** A result document and its work status must commit or roll back together. */
  async updateMany(owner: string, revision: number, commands: ModelCommand[], hypothesis = "original") {
    if (!commands.length || commands.length > 3) throw new ModelError(400, "Invalid transaction size");
    const pool = await this.database();
    await this.ensure(pool, owner);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query("SELECT state,revision FROM talkhint_project_models WHERE owner_key=$1 FOR UPDATE", [owner]);
      if (r.rows[0].revision !== revision) throw new ModelError(409, "Модель изменена в другой вкладке. Обновите данные и сравните правки.");
      const next = commands.reduce((state, command) => applyHypothesisCommand(state, hypothesis, command, owner), r.rows[0].state as ProjectModelState);
      await client.query("UPDATE talkhint_project_models SET state=$2::jsonb,revision=$3,updated_at=now() WHERE owner_key=$1",
        [owner, JSON.stringify(next), next.revision]);
      await client.query("COMMIT");
      return readHypothesis(next, hypothesis);
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
