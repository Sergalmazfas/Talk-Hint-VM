import type { Pool, PoolClient } from "pg";
import { performance } from "node:perf_hooks";
import type { ProjectModelState } from "../../../shared/projectModel";
import { ModelError } from "../../projectModel/domain";
import { readHypothesis } from "../../projectModel/hypotheses";
import { unpackModel } from "../../projectModel/history";
import { readBusinessContract } from "./businessContract";
import { semanticHash } from "../valueTree";
import { at, arrayInsert, decode, encode, replace, type Frame } from "./codec";
import { SqlFrameStore } from "./store";
import { assertModelWriteAllowed } from "../migrationFreeze";

export interface DeltaEdit {
  path: string[];
  value?: unknown;
  /** Reuse an immutable subtree, e.g. a graph for a prepended operating revision. */
  copyFrom?: string[];
  referenceHash?: string;
  columns?: Map<string, Frame>;
  insertAt?: number;
  document?: { hypothesis: string; id: string };
}
export type PrepareDelta = (store: SqlFrameStore) => Promise<{
  edits: DeltaEdit[]; columns?: Map<string, Frame>; revisionAdvance?: number;
}>;

/**
 * Candidate v3 repository. Not registered as an active source by this module.
 * Persistence accepts an already validated delta; domain commands have a separate adapter.
 */
export class IncrementalCompanyRepository {
  constructor(readonly pool: Pool, readonly environment: "development" | "production",
    readonly allowRetainedTest = false) {
    if (allowRetainedTest && environment !== "development") throw new Error("Test access is Dev-only");
  }
  private async workspace(db: PoolClient, owner: string, lock = false) {
    const { rows } = await db.query(`SELECT * FROM company_v3_workspaces
      WHERE owner_key=$1 AND environment=$2 ${lock ? "FOR UPDATE" : ""}`, [owner, this.environment]);
    const w = rows[0];
    if (!w || w.schema_version !== 3 ||
        !(w.generation === "normalized" || (w.generation === "test" && this.allowRetainedTest)))
      throw new ModelError(503, "Company v3 source is not active for this owner/environment");
    return w;
  }
  async commitDelta(owner: string, expectedRevision: number, prepare: PrepareDelta, actor: string) {
    assertModelWriteAllowed(owner, this.environment);
    const db = await this.pool.connect(), started = performance.now();
    try {
      await db.query("BEGIN");
      const w = await this.workspace(db, owner, true);
      if (Number(w.current_revision) !== expectedRevision) throw new ModelError(409, "Stale company revision");
      const schema = await readBusinessContract(db), store = new SqlFrameStore(db, w.workspace_id, schema);
      const { edits, columns = new Map(), revisionAdvance = 1 } = await prepare(store);
      if (!edits.length && revisionAdvance === 0) {
        await db.query("ROLLBACK");
        return { revision: expectedRevision, rootHash: w.root_hash as string,
          writerMs: performance.now() - started, verificationMs: 0, delta: {}, sqlReads: store.sqlReads };
      }
      if (!edits.length) throw new ModelError(400, "Empty company delta");
      if (!Number.isSafeInteger(revisionAdvance) || revisionAdvance < 1 || revisionAdvance > 3)
        throw new ModelError(400, "Invalid company revision advance");
      let root = w.root_hash as string;
      const docs: { hypothesis: string; id: string; frame: string }[] = [];
      for (const edit of edits) {
        if (edit.path.some(k => ["__proto__", "constructor", "prototype"].includes(k))) throw new Error("Unsafe company path");
        let node = edit.referenceHash ?? (edit.copyFrom ? await at(root, edit.copyFrom, store) :
          await encode(edit.value, store, edit.columns ?? columns, edit.columns ? "" :
            `/${edit.path.map(k => k.replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`));
        await store.get(node);
        const itemFrame = node;
        if (edit.insertAt !== undefined) node = await arrayInsert(await at(root, edit.path, store), edit.insertAt, node, store);
        root = await replace(root, edit.path, node, store);
        if (edit.document) docs.push({ ...edit.document, frame: itemFrame });
      }
      const nextRevision = expectedRevision + revisionAdvance;
      root = await replace(root, ["revision"], await encode(nextRevision, store), store);
      const beforeVerification = performance.now();
      await store.flush();
      const verificationMs = performance.now() - beforeVerification;
      await db.query(`INSERT INTO company_v3_revision_heads(workspace_id,revision,root_hash,actor)
        VALUES($1,$2,$3,$4)`, [w.workspace_id, nextRevision, root, actor]);
      for (const d of docs) await db.query(`INSERT INTO company_v3_document_heads
        (workspace_id,hypothesis_id,document_id,valid_from,frame_hash) VALUES($1,$2,$3,$4,$5)`,
      [w.workspace_id, d.hypothesis, d.id, nextRevision, d.frame]);
      const changed = await db.query(`UPDATE company_v3_workspaces SET current_revision=$2,root_hash=$3
        WHERE workspace_id=$1 AND current_revision=$4 RETURNING workspace_id`,
      [w.workspace_id, nextRevision, root, expectedRevision]);
      if (changed.rowCount !== 1) throw new ModelError(409, "Company CAS lost");
      await db.query("COMMIT");
      store.stats.company_v3_revision_heads = { inserted: 1, updated: 0, logicalBytes: Buffer.byteLength(root) + Buffer.byteLength(actor) + 16 };
      store.stats.company_v3_document_heads = { inserted: docs.length, updated: 0,
        logicalBytes: docs.reduce((n, d) => n + Buffer.byteLength(JSON.stringify(d)), 0) };
      store.stats.company_v3_workspaces = { inserted: 0, updated: 1, logicalBytes: Buffer.byteLength(root) + 8 };
      return { revision: nextRevision, rootHash: root, writerMs: performance.now() - started,
        verificationMs, delta: store.stats, sqlReads: store.sqlReads };
    } catch (error) {
      await db.query("ROLLBACK"); throw error;
    } finally { db.release(); }
  }
  async readRoot(owner: string, revision?: number): Promise<ProjectModelState> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const w = await this.workspace(db, owner);
      const head = await db.query(`SELECT * FROM company_v3_revision_heads WHERE workspace_id=$1 AND revision=$2`,
        [w.workspace_id, revision ?? w.current_revision]);
      if (head.rows.length !== 1) {
        const archived = await db.query(`SELECT h.payload,a.semantic_sha256,a.source_owner_key
          FROM company_v3_archive_refs a JOIN talkhint_project_model_history h
            ON h.owner_key=a.source_owner_key AND h.key=a.source_key
          WHERE a.workspace_id=$1 AND a.source_key=$2`, [w.workspace_id, `r:${revision}`]);
        if (archived.rows.length !== 1) throw new ModelError(404, "Company revision not imported");
        const a = archived.rows[0];
        if (semanticHash(a.payload) !== a.semantic_sha256) throw new Error("Company legacy archive digest mismatch");
        const result = await unpackModel(db, a.source_owner_key, a.payload);
        await db.query("COMMIT");
        return result;
      }
      const store = new SqlFrameStore(db, w.workspace_id, await readBusinessContract(db));
      await store.preload();
      const root = await decode(head.rows[0].root_hash, store);
      if (Number(root.revision) !== Number(head.rows[0].revision)) throw new Error("Company revision header mismatch");
      if (head.rows[0].source_semantic_hash && semanticHash(root) !== head.rows[0].source_semantic_hash)
        throw new Error("Company source semantic digest mismatch");
      await db.query("COMMIT");
      return root;
    } catch (error) { await db.query("ROLLBACK"); throw error; }
    finally { db.release(); }
  }
  async read(owner: string, hypothesis = "original") {
    return readHypothesis(await this.readRoot(owner), hypothesis);
  }
  async readRevision(owner: string, revision: number, hypothesis = "original") {
    return readHypothesis(await this.readRoot(owner, revision), hypothesis);
  }
  async readDocumentSnapshot(owner: string, hypothesis: string, id: string, revision?: number) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const w = await this.workspace(db, owner);
      const requested = revision ?? Number(w.current_revision);
      if (revision !== undefined) {
        const head = await db.query(`SELECT 1 FROM company_v3_revision_heads WHERE workspace_id=$1 AND revision=$2`,
          [w.workspace_id, requested]);
        if (!head.rowCount) throw new ModelError(404, "Document revision not imported");
      }
      const result = await db.query(`SELECT frame_hash FROM company_v3_document_heads
        WHERE workspace_id=$1 AND hypothesis_id=$2 AND document_id=$3 AND valid_from <= $4
        ORDER BY valid_from DESC LIMIT 1`, [w.workspace_id, hypothesis, id, requested]);
      if (result.rows.length !== 1) throw new ModelError(404, "Company document missing");
      const store = new SqlFrameStore(db, w.workspace_id, await readBusinessContract(db));
      const document = await decode(result.rows[0].frame_hash, store);
      if (document.id !== id) throw new Error("Company document identity mismatch");
      await db.query("COMMIT");
      return { revision: requested, document };
    } catch (error) { await db.query("ROLLBACK"); throw error; }
    finally { db.release(); }
  }
}
