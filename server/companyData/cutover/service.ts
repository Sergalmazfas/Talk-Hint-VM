import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { performance } from "node:perf_hooks";
import { semanticHash } from "../valueTree";
import { IncrementalCompanyRepository } from "../v3/repository";
import { archiveModel, unpackModel } from "../../projectModel/history";
import { ModelError } from "../../projectModel/modelError";
import { cutoverControl, cutoverLock, technicalCompanyWrite } from "./guard";
import type { CutoverAction, CutoverPolicy } from "./policy";
import { assertNoOtherCutoverProcess, cleanDiagnostic, emitDiagnostic, exceptionCode,
  workerLock, type CutoverDiagnostic } from "./diagnostics";

export type SourcePin = { workspace: string; revision: number; rootHash: string; manifestHash: string };
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const allowed: Record<CutoverAction, string[]> = {
  activate: ["shadow"], probe: ["verifying"], open_writes: ["verifying"],
  rollback: ["verifying", "active"], reactivate: ["checkpoint"], reconcile: ["shadow"],
};
/** Sole cutover controller; ordinary readers never create its rows or grants. */
export class CompanyCutover {
  constructor(readonly pool: Pool, readonly environment: "development" | "production",
    readonly candidate: CutoverPolicy, readonly approval: CutoverPolicy | null) {}
  private authorize(owner: string) {
    if (!this.approval || semanticHash(this.approval) !== semanticHash(this.candidate) ||
        owner !== this.candidate.owner || this.environment !== this.candidate.environment)
      throw new ModelError(423, "Включение ещё не разрешено владельцем.");
  }
  private async workspace(db: Pick<Pool, "query">, owner: string) {
    const q = await db.query(`SELECT * FROM company_v3_workspaces
      WHERE workspace_id=$1 AND owner_key=$2 AND environment=$3 AND schema_version=3`,
    [this.candidate.workspace, owner, this.environment]);
    if (q.rows.length !== 1) throw new ModelError(409, "Закреплённый кандидат не найден.");
    return q.rows[0];
  }
  private pin(w: any): SourcePin {
    return { workspace: w.workspace_id, revision: Number(w.current_revision),
      rootHash: w.root_hash, manifestHash: this.candidate.manifestHash };
  }
  private async exact(db: Pick<Pool, "query">, owner: string, expected: SourcePin) {
    const w = await this.workspace(db, owner);
    if (semanticHash(this.pin(w)) !== semanticHash(expected)) throw new ModelError(409, "CAS источника изменился.");
    return w;
  }
  async status(owner: string) {
    const w = await this.workspace(this.pool, owner);
    const c = await cutoverControl(this.pool, owner, this.environment);
    const ops = await this.pool.query(`SELECT operation_id,action,state,error_code,result,created_at,updated_at
      FROM company_cutover_operations WHERE owner_key=$1 AND environment=$2 ORDER BY created_at DESC LIMIT 10`,
    [owner, this.environment]);
    let checkpoint;
    if (c?.checkpoint_id) {
      const cp = (await this.pool.query(`SELECT revision,semantic_sha FROM company_cutover_checkpoints
        WHERE checkpoint_id=$1 AND owner_key=$2 AND environment=$3`,
      [c.checkpoint_id, owner, this.environment])).rows[0];
      if (cp) checkpoint = { revision: Number(cp.revision), semanticHash: cp.semantic_sha };
    }
    return { approved: !!this.approval && semanticHash(this.approval) === semanticHash(this.candidate),
      environment: this.environment, source: this.pin(w), phase: c?.phase ?? "shadow",
      writesOpen: c?.writes_open ?? false, checkpoint, operations: ops.rows,
      probeReady: c?.probe_result?.restored === true &&
        c.probe_result.revision === Number(w.current_revision) && c.probe_result.rootHash === w.root_hash };
  }
  async grant(owner: string, action: CutoverAction, expected: SourcePin) {
    this.authorize(owner);
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [cutoverLock(owner, this.environment)]);
      const w = await this.exact(db, owner, expected);
      let c = await cutoverControl(db, owner, this.environment);
      if (!c) {
        if (w.generation !== "shadow" || Number(w.current_revision) !== this.candidate.revision ||
            w.root_hash !== this.candidate.rootHash)
          throw new ModelError(409, "Первое включение требует точного принятого shadow.");
        await db.query(`INSERT INTO company_cutover_controls
          (owner_key,environment,workspace_id,manifest_hash,phase) VALUES($1,$2,$3,$4,'shadow')`,
        [owner, this.environment, w.workspace_id, this.candidate.manifestHash]);
        c = await cutoverControl(db, owner, this.environment);
      }
      if (c.workspace_id !== this.candidate.workspace || c.manifest_hash !== this.candidate.manifestHash ||
          !allowed[action]?.includes(c.phase)) throw new ModelError(409, "Действие не соответствует фазе.");
      if (action === "open_writes" && !c.probe_result?.restored)
        throw new ModelError(423, "Техническая запись и компенсация ещё не подтверждены.");
      const busy = await db.query(`SELECT 1 FROM company_cutover_operations WHERE owner_key=$1
        AND environment=$2 AND state IN ('queued','running')`, [owner, this.environment]);
      if (busy.rowCount) {
        if (action !== "rollback") throw new ModelError(409, "Предыдущая операция требует сверки, повтор запрещён.");
        // Explicit owner rollback may fence a lost worker. We already hold the
        // exclusive write lock: its transaction has settled, or we wait for it.
        // Never resume/retry the previous operation.
        await db.query(`UPDATE company_cutover_operations SET state='failed',
          error_code='OWNER_ROLLBACK_SUPERSEDED',updated_at=now()
          WHERE owner_key=$1 AND environment=$2 AND state IN ('queued','running')`, [owner, this.environment]);
        await db.query(`UPDATE company_cutover_controls SET writes_open=false,
          technical_token_hash=NULL,current_operation_id=NULL WHERE owner_key=$1 AND environment=$2`,
        [owner, this.environment]);
      }
      const last = (await db.query(`SELECT operation_id,action,state FROM company_cutover_operations
        WHERE owner_key=$1 AND environment=$2 ORDER BY created_at DESC LIMIT 1`, [owner, this.environment])).rows[0];
      if (action === "reconcile" && (last?.state !== "failed" || !["activate", "reconcile"].includes(last.action)))
        throw new ModelError(423, "Сверка доступна только после неуспешного включения.");
      if (last?.state === "failed" && !["rollback", "reactivate", "reconcile"].includes(action))
        throw new ModelError(423, "Неуспешная операция требует сверки; повтор запрещён.");
      const token = randomBytes(32).toString("hex");
      await db.query(`INSERT INTO company_cutover_grants
        (token_hash,owner_key,environment,action,expected,expires_at)
        VALUES($1,$2,$3,$4,$5,now()+interval '5 minutes')`,
      [digest(token), owner, this.environment, action,
        action === "reconcile" ? { ...expected, reconciliationOf: last.operation_id } : expected]);
      await db.query("COMMIT");
      return token;
    } catch (e) { await db.query("ROLLBACK"); throw e; } finally { db.release(); }
  }
  /** Consume grant + close barrier + queue audit atomically. No automatic retry. */
  async enqueue(owner: string, action: CutoverAction, expected: SourcePin, token: string) {
    this.authorize(owner);
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [cutoverLock(owner, this.environment)]);
      await this.exact(db, owner, expected);
      const c = await cutoverControl(db, owner, this.environment);
      if (!c || !allowed[action]?.includes(c.phase)) throw new ModelError(409, "Неподходящая фаза.");
      const pending = await db.query(`SELECT 1 FROM company_cutover_operations WHERE owner_key=$1
        AND environment=$2 AND state IN ('queued','running')`, [owner, this.environment]);
      if (pending.rowCount) throw new ModelError(409, "Операция уже выполняется.");
      const last = (await db.query(`SELECT operation_id,action,state FROM company_cutover_operations
        WHERE owner_key=$1 AND environment=$2 ORDER BY created_at DESC LIMIT 1`, [owner, this.environment])).rows[0];
      if (action === "reconcile" && (last?.state !== "failed" || !["activate", "reconcile"].includes(last.action)))
        throw new ModelError(423, "Неуспешная операция для сверки изменилась.");
      if (last?.state === "failed" && !["rollback", "reactivate", "reconcile"].includes(action))
        throw new ModelError(423, "Неуспешная операция требует сверки; старое разрешение не возобновляет её.");
      const used = await db.query(`UPDATE company_cutover_grants SET consumed_at=now()
        WHERE token_hash=$1 AND owner_key=$2 AND environment=$3 AND action=$4 AND expected=$5::jsonb
          AND consumed_at IS NULL AND expires_at>now() RETURNING token_hash`,
      [digest(token), owner, this.environment, action, JSON.stringify(
        action === "reconcile" ? { ...expected, reconciliationOf: last.operation_id } : expected)]);
      if (used.rowCount !== 1) throw new ModelError(409, "Разрешение истекло или уже использовано.");
      const operation = randomUUID();
      await db.query(`INSERT INTO company_cutover_operations
        (operation_id,owner_key,environment,action,expected,state,result) VALUES($1,$2,$3,$4,$5,'queued',$6)`,
      [operation, owner, this.environment, action, expected,
        action === "reconcile" ? { reconciliationOf: last.operation_id } : {}]);
      await db.query(`UPDATE company_cutover_controls SET writes_open=false,current_operation_id=$3,updated_at=now()
        WHERE owner_key=$1 AND environment=$2`, [owner, this.environment, operation]);
      await db.query("COMMIT");
      return operation;
    } catch (e) { await db.query("ROLLBACK"); throw e; } finally { db.release(); }
  }
  async diagnostic(operation: string, value: CutoverDiagnostic) {
    const d = cleanDiagnostic({ ...value, operation });
    if (!d) return;
    emitDiagnostic(d);
    await this.pool.query(`UPDATE company_cutover_operations
      SET result=coalesce(result,'{}'::jsonb) || jsonb_build_object('lastStage',$4::text,
        'diagnostics',coalesce(result->'diagnostics','[]'::jsonb) || $5::jsonb)
      WHERE operation_id=$1 AND owner_key=$2 AND environment=$3
        AND jsonb_array_length(coalesce(result->'diagnostics','[]'::jsonb))<64`,
    [operation, this.candidate.owner, this.environment, d.stage, JSON.stringify([d])]);
  }
  async fail(operation: string, error?: unknown) {
    await this.diagnostic(operation, { stage: "failure", exceptionCode: exceptionCode(error) });
    await this.pool.query(`UPDATE company_cutover_operations SET state='failed',
      error_code='CUTOVER_RECONCILE_REQUIRED',updated_at=now()
      WHERE operation_id=$1 AND owner_key=$2 AND environment=$3 AND state IN ('queued','running')`,
    [operation, this.candidate.owner, this.environment]);
    await this.pool.query(`UPDATE company_cutover_controls SET writes_open=false,
      technical_token_hash=NULL,updated_at=now() WHERE owner_key=$1 AND environment=$2 AND current_operation_id=$3`,
    [this.candidate.owner, this.environment, operation]);
  }
  async perform(owner: string, operation: string) {
    this.authorize(owner);
    const lease = await this.pool.connect();
    let locked = false;
    try {
      locked = !!(await lease.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
        [workerLock(owner, this.environment)])).rows[0]?.locked;
      if (!locked) throw new Error("CUTOVER_WORKER_LEASE_BUSY");
      await this.diagnostic(operation, { stage: "worker_lease_acquired" });
    const claimed = await this.pool.query(`UPDATE company_cutover_operations SET state='running',updated_at=now()
      WHERE operation_id=$1 AND owner_key=$2 AND environment=$3 AND state='queued' RETURNING *`,
    [operation, owner, this.environment]);
    if (claimed.rowCount !== 1) throw new ModelError(409, "Повтор выполнения запрещён.");
    const op = claimed.rows[0], start = performance.now();
    try {
      await this.diagnostic(operation, { stage: "operation_claimed" });
      const result = op.action === "reconcile" ? await this.reconcile(owner, op.expected, operation, op.result?.reconciliationOf) :
        op.action === "probe" ? await this.probe(owner, op.expected, operation) :
        await this.switchSource(owner, op.action, op.expected, operation);
      await this.pool.query(`UPDATE company_cutover_operations SET state='succeeded',
        result=coalesce(result,'{}'::jsonb) || $2::jsonb,updated_at=now()
        WHERE operation_id=$1 AND state='running'`, [operation, { ...result, ms: performance.now() - start }]);
      return result;
    } catch (e) { await this.fail(operation, e); throw e; }
    } finally {
      try {
        if (locked) await lease.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [workerLock(owner, this.environment)]);
      } finally { lease.release(); }
    }
  }
  private async reconcile(owner: string, expected: SourcePin, operation: string, failedOperation: string) {
    await assertNoOtherCutoverProcess();
    await this.diagnostic(operation, { stage: "process_scan_clear" });
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      // Fences legacy workers too: an old worker already in switchSource holds
      // this lock; one not yet inside sees the replaced current_operation_id.
      const lock = await db.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked",
        [cutoverLock(owner, this.environment)]);
      if (!lock.rows[0]?.locked) throw new Error("CUTOVER_WRITE_LEASE_BUSY");
      const w = await this.exact(db, owner, expected);
      const c = await cutoverControl(db, owner, this.environment);
      const failure = (await db.query(`SELECT action,state FROM company_cutover_operations
        WHERE operation_id=$1 AND owner_key=$2 AND environment=$3`, [failedOperation, owner, this.environment])).rows[0];
      if (!failure || failure.state !== "failed" || !["activate", "reconcile"].includes(failure.action) ||
          !c || c.phase !== "shadow" || c.writes_open || c.current_operation_id !== operation ||
          c.workspace_id !== expected.workspace || c.manifest_hash !== expected.manifestHash ||
          w.generation !== "shadow" || Number(w.current_revision) !== this.candidate.revision ||
          w.root_hash !== this.candidate.rootHash)
        throw new Error("CUTOVER_RECONCILE_STATE_CHANGED");
      const busy = await db.query(`SELECT 1 FROM company_cutover_operations WHERE owner_key=$1
        AND environment=$2 AND operation_id<>$3 AND state IN ('queued','running')`, [owner, this.environment, operation]);
      if (busy.rowCount) throw new Error("CUTOVER_OTHER_OPERATION_BUSY");
      await this.diagnostic(operation, { stage: "reconcile_pin_verified" });
      const root = await this.root(db, w, async (root: any, store: any) => {
        const { decode } = await import("../v3/codec");
        const heads = await db.query(`SELECT hypothesis_id,document_id,frame_hash FROM company_v3_document_heads
          WHERE workspace_id=$1 AND valid_from<=$2 ORDER BY hypothesis_id,document_id`, [w.workspace_id, this.candidate.revision]);
        const hypotheses = [{ id: "original", model: root }, ...(root.alternatives ?? [])];
        const hashes: string[][] = [];
        for (const h of heads.rows) {
          const document = await decode(h.frame_hash, store);
          const expectedDocument = hypotheses.find((v: any) => v.id === h.hypothesis_id)?.model?.documents
            ?.find((d: any) => d.id === h.document_id);
          if (!expectedDocument || semanticHash(document) !== semanticHash(expectedDocument))
            throw new Error("CUTOVER_DOCUMENT_BASELINE_MISMATCH");
          hashes.push([h.hypothesis_id, h.document_id, digest(document.text)]);
        }
        // Pin derived from the independently reviewed 84-document inventory.
        // Read actual indexed frames, NOT every historical payload version.
        if (hashes.length !== 84 || digest(JSON.stringify(hashes)) !==
            "5bbd3bb0bdbc342080819936cdbb22d5d2b31f956ff749d98bab010a48e42288")
          throw new Error("CUTOVER_DOCUMENT_BASELINE_MISMATCH");
      });
      if (semanticHash(root) !== this.candidate.semanticHash) throw new Error("CUTOVER_BASELINE_SHA_MISMATCH");
      await this.diagnostic(operation, { stage: "reconcile_sha_verified" });
      await this.diagnostic(operation, { stage: "reconcile_documents_verified" });
      await db.query(`UPDATE company_cutover_controls SET writes_open=false,technical_token_hash=NULL,
        updated_at=now() WHERE owner_key=$1 AND environment=$2 AND current_operation_id=$3`,
      [owner, this.environment, operation]);
      await db.query("COMMIT");
      return { reconciliationOf: failedOperation, documents: 84, semanticHash: this.candidate.semanticHash,
        sourceUnchanged: true, writesOpen: false, newActivationRequiresNewGrant: true };
    } catch (e) { await db.query("ROLLBACK"); throw e; } finally { db.release(); }
  }
  private async root(db: PoolClient, w: any, verify?: (root: any, store: any) => Promise<void>) {
    // Run only in the bounded child worker, never the Hint/web event loop.
    const { SqlFrameStore } = await import("../v3/store");
    const { readBusinessContract } = await import("../v3/businessContract");
    const { decode } = await import("../v3/codec");
    const store = new SqlFrameStore(db, w.workspace_id, await readBusinessContract(db));
    await store.preload();
    const root = await decode(w.root_hash, store);
    if (Number(root.revision) !== Number(w.current_revision)) throw new Error("Root revision mismatch");
    if (verify) await verify(root, store);
    return root;
  }
  private async switchSource(owner: string, action: CutoverAction, expected: SourcePin, operation: string) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [cutoverLock(owner, this.environment)]);
      const w = await this.exact(db, owner, expected);
      await this.diagnostic(operation, { stage: "pin_verified" });
      const c = await cutoverControl(db, owner, this.environment);
      if (!c || c.current_operation_id !== operation || !allowed[action]?.includes(c.phase))
        throw new ModelError(409, "Фаза или операция изменилась.");
      if (c.workspace_id !== w.workspace_id || c.manifest_hash !== expected.manifestHash)
        throw new ModelError(409, "Control pin mismatch");
      if (action === "open_writes") {
        if (w.generation !== "normalized") throw new ModelError(409, "Normalized source is not selected");
        if (!c.probe_result?.restored || c.probe_result.revision !== expected.revision ||
            c.probe_result.rootHash !== expected.rootHash)
          throw new ModelError(423, "После проверки модель изменилась.");
        await db.query(`UPDATE company_cutover_controls SET phase='active',writes_open=true,updated_at=now()
          WHERE owner_key=$1 AND environment=$2`, [owner, this.environment]);
      } else {
        if (w.generation !== (action === "rollback" ? "normalized" : "shadow"))
          throw new ModelError(409, "Source generation mismatch");
        await this.diagnostic(operation, { stage: "decode_started" });
        const root = await this.root(db, w);
        await this.diagnostic(operation, { stage: "decode_completed" });
        const sha = semanticHash(root);
        if (action === "activate" && (expected.revision !== this.candidate.revision ||
            expected.rootHash !== this.candidate.rootHash || sha !== this.candidate.semanticHash))
          throw new ModelError(409, "Baseline SHA mismatch");
        await this.diagnostic(operation, { stage: "sha_verified" });
        if (action === "rollback") {
          const cp = randomUUID(), archiveOwner = `company-checkpoint:${cp}`;
          // Separate archive parent: never overwrite imported technical archive or live legacy row.
          await db.query(`INSERT INTO talkhint_project_models(owner_key,revision,state) VALUES($1,$2,'{}')`,
            [archiveOwner, root.revision]);
          const packed = await archiveModel(db, archiveOwner, root);
          // Full reverse readback BEFORE committing source reversal.
          const restored = await unpackModel(db, archiveOwner, packed);
          if (semanticHash(restored) !== sha) throw new Error("Checkpoint readback mismatch");
          await db.query(`INSERT INTO company_cutover_checkpoints
            (checkpoint_id,owner_key,environment,workspace_id,revision,root_hash,semantic_sha,archive_owner_key,payload)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [cp, owner, this.environment, w.workspace_id, root.revision, w.root_hash, sha, archiveOwner, packed]);
          const hypotheses = [{ id: "original", model: root },
            ...(root.alternatives ?? []).map((a: any) => ({ id: a.id, model: a.model }))];
          for (const h of hypotheses) for (const d of h.model.documents ?? [])
            await db.query(`INSERT INTO company_cutover_checkpoint_documents
              (checkpoint_id,hypothesis_id,document_id,document,document_sha) VALUES($1,$2,$3,$4,$5)`,
            [cp, h.id, d.id, d, semanticHash(d)]);
          await db.query(`UPDATE company_v3_workspaces SET generation='shadow'
            WHERE workspace_id=$1 AND current_revision=$2 AND root_hash=$3`,
          [w.workspace_id, expected.revision, expected.rootHash]);
          await db.query(`UPDATE company_cutover_controls SET phase='checkpoint',writes_open=false,
            checkpoint_id=$3,technical_token_hash=NULL,updated_at=now() WHERE owner_key=$1 AND environment=$2`,
          [owner, this.environment, cp]);
        } else {
          if (action === "reactivate") {
            const cp = (await db.query(`SELECT * FROM company_cutover_checkpoints
              WHERE checkpoint_id=$1 AND owner_key=$2 AND environment=$3 AND workspace_id=$4`,
            [c.checkpoint_id, owner, this.environment, w.workspace_id])).rows[0];
            if (!cp || cp.semantic_sha !== sha || cp.root_hash !== w.root_hash ||
                Number(cp.revision) !== Number(w.current_revision)) throw new Error("Checkpoint no longer matches head");
          }
          const b = await db.query(`SELECT 1 FROM company_workspaces WHERE owner_key=$1
            AND environment=$2 AND storage_generation='normalized'`, [owner, this.environment]);
          if (b.rowCount) throw new Error("Two source generations would be active");
          await db.query("UPDATE company_v3_workspaces SET generation='normalized' WHERE workspace_id=$1", [w.workspace_id]);
          await db.query(`UPDATE company_cutover_controls SET phase='verifying',writes_open=false,
            technical_token_hash=NULL,probe_result=NULL,updated_at=now() WHERE owner_key=$1 AND environment=$2`,
          [owner, this.environment]);
        }
      }
      await db.query("COMMIT");
      return { action, revision: expected.revision, writesOpen: action === "open_writes" };
    } catch (e) { await db.query("ROLLBACK"); throw e; } finally { db.release(); }
  }
  private async probe(owner: string, expected: SourcePin, operation: string) {
    await this.exact(this.pool, owner, expected);
    const repo = new IncrementalCompanyRepository(this.pool, this.environment);
    const before = await repo.readDocumentSnapshot(owner, "new-country", this.candidate.probeDocumentId);
    const doc = before.document;
    if (doc.id === "DOC-TALKHINT-IMPROVEMENT-JOURNAL") throw new Error("Lab journal cannot be a temporary probe");
    const token = digest(randomBytes(32).toString("hex"));
    const permitted = await this.pool.query(`UPDATE company_cutover_controls SET technical_token_hash=$3
      WHERE owner_key=$1 AND environment=$2 AND phase='verifying' AND writes_open=false AND current_operation_id=$4`,
    [owner, this.environment, token, operation]);
    if (permitted.rowCount !== 1) throw new ModelError(409, "Technical operation was fenced");
    const write = async (revision: number, document: typeof doc) => repo.commitDelta(owner, revision, async store => {
      const { at, arrayLength, decode } = await import("../v3/codec");
      const { projectFragment } = await import("../v3/projection");
      const w = await this.workspace(store.db, owner), root = w.root_hash;
      const alternatives = await at(root, ["alternatives"], store);
      let prefix: string[] | undefined;
      for (let i = 0; i < await arrayLength(alternatives, store); i++)
        if (await decode(await at(root, ["alternatives", String(i), "id"], store), store) === "new-country")
          prefix = ["alternatives", String(i), "model"];
      if (!prefix) throw new Error("Probe hypothesis missing");
      const docs = await at(root, [...prefix, "documents"], store);
      let index = -1;
      for (let i = 0; i < await arrayLength(docs, store); i++)
        if (await decode(await at(root, [...prefix, "documents", String(i), "id"], store), store) === doc.id) index = i;
      if (index < 0) throw new Error("Probe document missing");
      const empty = { schema: 1, revision, elements: [], relations: [], proposals: [], taskDrafts: [], decisions: [], documents: [] };
      const fragment: any = { ...empty, alternatives: [{ id: "new-country", title: "new-country",
        model: { ...empty, documents: [document] } }] };
      const all = await projectFragment(fragment, store, store.schema, new Map([
        [doc.id, "document"], ...doc.elementIds.map((id: string) => [id, "element"] as [string, string]),
      ]));
      const columns = new Map<string, any>();
      const scope = "/alternatives/0/model/documents/0";
      for (const [key, value] of Array.from(all)) if (key === scope || key.startsWith(scope + "/"))
        columns.set(key.slice(scope.length), value);
      return { edits: [{ path: [...prefix, "documents", String(index)], value: document, columns,
        document: { hypothesis: "new-country", id: doc.id } }] };
    }, "cutover:technical-probe");
    // An internal fixed two-command sequence; HTTP cannot supply a document or command.
    return technicalCompanyWrite({owner, environment: this.environment, hash: token}, async () => {
      let first;
      try {
        first = await write(expected.revision,
          { ...doc, text: `${doc.text}\n\n[Техническая проверка cutover; будет компенсирована новой ревизией.]` });
        const undone = await write(first.revision, doc);
        const after = await repo.readDocumentSnapshot(owner, "new-country", doc.id);
        if (semanticHash(after.document) !== semanticHash(doc) || undone.revision <= first.revision)
          throw new Error("Compensation mismatch");
        const w = await this.workspace(this.pool, owner);
        const result = { writeRevision: first.revision, revision: undone.revision,
          rootHash: w.root_hash, restored: true };
        await this.pool.query(`UPDATE company_cutover_controls SET technical_token_hash=NULL,
          probe_result=$3,updated_at=now() WHERE owner_key=$1 AND environment=$2 AND current_operation_id=$4`,
        [owner, this.environment, result, operation]);
        return result;
      } finally {
        await this.pool.query(`UPDATE company_cutover_controls SET technical_token_hash=NULL
          WHERE owner_key=$1 AND environment=$2 AND current_operation_id=$3`, [owner, this.environment, operation]);
      }
    });
  }
}
