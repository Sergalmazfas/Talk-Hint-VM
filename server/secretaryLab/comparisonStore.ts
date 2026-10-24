import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ComparisonEvaluation, ComparisonRun, SavedComparison } from "../../shared/secretaryLabComparison";

export const COMPARISON_RETENTION_DAYS = 30;
type ComparisonContent = Pick<SavedComparison, "title" | "instruction" | "evaluation" | "runs">;
export interface ComparisonRepository {
  save(owner: string, content: ComparisonContent): Promise<SavedComparison>;
  list(): Promise<SavedComparison[]>;
  get(id: string): Promise<SavedComparison | undefined>;
  evaluate(id: string, evaluation: ComparisonEvaluation): Promise<SavedComparison | undefined>;
  remove(id: string): Promise<boolean>;
  purge(): Promise<void>;
}
type Row = { id: string; title: string; instruction: string; created_at: Date; expires_at: Date;
  evaluation: ComparisonEvaluation; runs: ComparisonRun[] };
const record = (r: Row): SavedComparison => ({
  id: r.id, title: r.title, instruction: r.instruction, createdAt: r.created_at.toISOString(),
  expiresAt: r.expires_at.toISOString(), evaluation: r.evaluation, runs: r.runs,
});
/** Only called after the Dev + benchmark-admin HTTP gate. Independent of every
 * live provider/agent/registry and contains no phone/calendar delivery methods. */
export class PgComparisonRepository implements ComparisonRepository {
  constructor(private pool: Pick<Pool, "query">) {}
  async save(owner: string, content: ComparisonContent) {
    const { rows } = await this.pool.query(
      `INSERT INTO secretary_lab_comparisons (id, owner_id, title, instruction, evaluation, runs, consent_at, expires_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,now(),now() + interval '30 days') RETURNING *`,
      [randomUUID(), owner, content.title, content.instruction, JSON.stringify(content.evaluation), JSON.stringify(content.runs)]);
    return record(rows[0]);
  }
  async list() {
    // Do not pull every transcript/ledger just to render the library. Read full
    // snapshots only on explicit detail/export, including after a Dev restart.
    const { rows } = await this.pool.query(
      `SELECT id, title, instruction, created_at, expires_at, evaluation,
       (SELECT jsonb_agg(jsonb_build_object('mode',r->>'mode','id',r->>'id','runtime',r->>'runtime',
         'model',r->>'model','voice',r->>'voice')) FROM jsonb_array_elements(runs) r) AS runs
       FROM secretary_lab_comparisons WHERE expires_at > now() ORDER BY created_at DESC`);
    return rows.map(record);
  }
  async get(id: string) {
    const { rows } = await this.pool.query("SELECT * FROM secretary_lab_comparisons WHERE id=$1 AND expires_at > now()", [id]);
    return rows[0] ? record(rows[0]) : undefined;
  }
  async evaluate(id: string, evaluation: ComparisonEvaluation) {
    const { rows } = await this.pool.query(
      "UPDATE secretary_lab_comparisons SET evaluation=$2::jsonb WHERE id=$1 AND expires_at > now() RETURNING *",
      [id, JSON.stringify(evaluation)]);
    // Deliberately never extend retention when a rating is edited.
    return rows[0] ? record(rows[0]) : undefined;
  }
  async remove(id: string) {
    const r = await this.pool.query("DELETE FROM secretary_lab_comparisons WHERE id=$1 AND expires_at > now()", [id]);
    return !!r.rowCount;
  }
  async purge() { await this.pool.query("DELETE FROM secretary_lab_comparisons WHERE expires_at <= now()"); }
}
