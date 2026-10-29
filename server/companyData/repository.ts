import type { Pool, PoolClient } from "pg";
import type { ModelRepository } from "../projectModel/repository";
import type { ModelCommand, ProjectModelState } from "../../shared/projectModel";
import { readHypothesis, applyHypothesisCommand } from "../projectModel/hypotheses";
import { unpackModel } from "../projectModel/history";
import { ModelError } from "../projectModel/modelError";
import { inspectSchema, project, readRootFromSql, insertProjection } from "./relational";
import { textHash, semanticHash } from "./valueTree";

export type CompanyEnvironment = "development" | "production";
/** Always bound by server authentication, never an owner key taken from input JSON. */
export class CompanyModelRepository implements ModelRepository {
  constructor(private getPool: () => Promise<Pool>, private environment: CompanyEnvironment,
    private shadowVerification = false) {
    if (shadowVerification && environment !== "development") throw new Error("Shadow verification is Dev-only");
  }
  private async scope(db: Pick<PoolClient, "query">, owner: string, lock = false) {
    const result = await db.query(`SELECT workspace_id,current_revision,storage_generation
      FROM company_workspaces WHERE owner_key=$1 AND environment=$2 ${lock ? "FOR UPDATE" : ""}`,
    [owner, this.environment]);
    const w = result.rows[0];
    if (!w || (w.storage_generation !== "normalized" &&
        !(this.shadowVerification && w.storage_generation === "shadow")))
      throw new ModelError(503, "Нормализованный источник не включён для этого владельца и окружения.");
    return w;
  }
  async read(owner: string, hypothesis = "original"): Promise<ProjectModelState> {
    const pool = await this.getPool();
    const db = await pool.connect();
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const w = await this.scope(db, owner);
      const schema = await inspectSchema(db);
      const root = await readRootFromSql(db, w.workspace_id, w.current_revision, schema);
      await db.query("COMMIT");
      return readHypothesis(root, hypothesis);
    } catch (error) { await db.query("ROLLBACK"); throw error; } finally { db.release(); }
  }
  async readDocument(owner: string, hypothesis: string, documentId: string) {
    return (await this.readDocumentSnapshot(owner, hypothesis, documentId)).document;
  }
  async readDocumentSnapshot(owner: string, hypothesis: string, documentId: string) {
    const pool = await this.getPool();
    const w = await this.scope(pool, owner);
    if (hypothesis === "new-country") {
      const structure = await pool.query(`SELECT 1 FROM company_operating_revisions
        WHERE workspace_id=$1 AND hypothesis_id=$2 LIMIT 1`, [w.workspace_id, hypothesis]);
      if (!structure.rowCount) throw new ModelError(409, "В этом рабочем пространстве ещё нет структуры new-country");
    }
    const result = await pool.query(`SELECT * FROM company_document_versions WHERE workspace_id=$1
      AND hypothesis_id=$2 AND document_id=$3 AND revision=$4`,
    [w.workspace_id, hypothesis, documentId, w.current_revision]);
    const r = result.rows[0];
    if (!r) throw new ModelError(404, "Документ не найден.");
    if (textHash(r.text_body) !== r.utf8_sha256 || r.text_body.length !== Number(r.utf16_length))
      throw new ModelError(503, "Контрольная сумма документа не совпала.");
    const links = await pool.query(`SELECT element_id FROM company_document_links WHERE workspace_id=$1
      AND hypothesis_id=$2 AND document_id=$3 AND revision=$4 ORDER BY ordinal`,
    [w.workspace_id, hypothesis, documentId, w.current_revision]);
    return { revision: w.current_revision as number, document: {
      id: r.document_id as string, title: r.title as string, text: r.text_body as string, url: r.url as string,
      updatedAt: r.updated_at_source as string, elementIds: links.rows.map(x => x.element_id as string) } };
  }
  async readRevision(owner: string, revision: number, hypothesis = "original") {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new ModelError(400, "Некорректная ревизия.");
    const pool = await this.getPool(), db = await pool.connect();
    try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const w = await this.scope(db, owner);
    const versions = await db.query(`SELECT 1 FROM company_model_revisions WHERE workspace_id=$1 AND revision=$2`,
      [w.workspace_id, revision]);
    if (versions.rowCount) {
      const result = readHypothesis(await readRootFromSql(db, w.workspace_id, revision, await inspectSchema(db)), hypothesis);
      await db.query("COMMIT"); return result;
    }
    const archived = await db.query(`SELECT h.payload,a.semantic_sha256 FROM company_source_archives a
      JOIN talkhint_project_model_history h ON h.owner_key=a.source_owner_key AND h.key=a.source_key
      WHERE a.workspace_id=$1 AND a.source_key=$2`, [w.workspace_id, `r:${revision}`]);
    if (!archived.rowCount) throw new ModelError(404, "Ревизия не найдена; история не выдумывается.");
    if (semanticHash(archived.rows[0].payload) !== archived.rows[0].semantic_sha256)
      throw new ModelError(503, "Контрольная сумма архивной ревизии не совпала.");
    const result = readHypothesis(await unpackModel(db, owner, archived.rows[0].payload), hypothesis);
    await db.query("COMMIT"); return result;
    } catch (error) { await db.query("ROLLBACK"); throw error; } finally { db.release(); }
  }
  async update(owner: string, revision: number, command: ModelCommand, hypothesis = "original") {
    return this.updateMany(owner, revision, [command], hypothesis);
  }
  async updateMany(owner: string, revision: number, commands: ModelCommand[], hypothesis = "original") {
    if (this.shadowVerification) throw new ModelError(403, "Теневой reader не принимает записи.");
    if (!commands.length || commands.length > 3) throw new ModelError(400, "Invalid transaction size");
    const db = await (await this.getPool()).connect();
    try {
      await db.query("BEGIN");
      await db.query("SET LOCAL lock_timeout='2s'");
      await db.query("SET CONSTRAINTS ALL DEFERRED");
      const w = await this.scope(db, owner, true);
      if (w.current_revision !== revision) throw new ModelError(409, "Модель изменилась; обновите данные.");
      const schema = await inspectSchema(db);
      const before = await readRootFromSql(db, w.workspace_id, revision, schema);
      const next = commands.reduce((state, cmd) => applyHypothesisCommand(state, hypothesis, cmd, owner), before);
      if (next === before) { await db.query("COMMIT"); return readHypothesis(before, hypothesis); }
      const origins = await db.query("SELECT hypothesis_id,operating_version,source_revision FROM company_operating_revisions WHERE workspace_id=$1",
        [w.workspace_id]);
      const p = project(next, w.workspace_id, schema, { domainWrite: true, actor: owner,
        operatingOrigins: new Map(origins.rows.map(r => [`${r.hypothesis_id}:${r.operating_version}`, r.source_revision])) });
      await db.query("UPDATE company_hypotheses SET current_revision=$2 WHERE workspace_id=$1", [w.workspace_id, next.revision]);
      await insertProjection(db, p, schema, { verifyAndRelease: true });
      const verified = await readRootFromSql(db, w.workspace_id, next.revision, schema);
      const changed = await db.query(`UPDATE company_workspaces SET current_revision=$3
        WHERE workspace_id=$1 AND current_revision=$2 RETURNING current_revision`, [w.workspace_id, revision, next.revision]);
      if (changed.rowCount !== 1) throw new ModelError(409, "CAS failed");
      await db.query("SET CONSTRAINTS ALL IMMEDIATE");
      await db.query("COMMIT");
      // Legacy state and archive are deliberately NOT written after normalized cutover.
      return readHypothesis(verified, hypothesis);
    } catch (error) { await db.query("ROLLBACK"); throw error; } finally { db.release(); }
  }
}
