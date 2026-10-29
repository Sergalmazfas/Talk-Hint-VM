import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient } from "pg";
import { ModelError } from "../../projectModel/modelError";
import { unpackModel } from "../../projectModel/history";
import { semanticHash } from "../valueTree";
import { blocksLegacySeed } from "../v3/importApproval";

type DB = Pick<Pool | PoolClient, "query">;
type Permit = { owner: string; environment: string; hash: string };
const permits = new AsyncLocalStorage<Permit>();
export const cutoverLock = (owner: string, env: string) => `company-cutover:${env}:${owner}`;
export async function cutoverControl(db: DB, owner: string, env: string) {
  const exists = await db.query("SELECT to_regclass('public.company_cutover_controls') AS present");
  if (!exists.rows[0]?.present) return null;
  return (await db.query("SELECT * FROM company_cutover_controls WHERE owner_key=$1 AND environment=$2",
    [owner, env])).rows[0] ?? null;
}
/** Must be called INSIDE a transaction, BEFORE any workspace/model FOR UPDATE.
 * Shared lock lasts through commit. Cutover takes the exclusive counterpart,
 * so every already-started application writer settles before switching.
 */
export async function lockCompanyWrite(db: DB, owner: string, env: string) {
  await db.query("SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))", [cutoverLock(owner, env)]);
  const c = await cutoverControl(db, owner, env);
  const p = permits.getStore();
  const technical = c?.phase === "verifying" && !!p && p.owner === owner &&
    p.environment === env && p.hash === c.technical_token_hash;
  if ((c && (!c.writes_open || c.phase !== "active") && !technical) ||
      (!c && blocksLegacySeed(owner, env)))
    throw new ModelError(423, "Запись модели временно закрыта. Проверки переключения ещё не завершены.");
}
/** Internal capability, never read from an HTTP body/header or exported as an MCP tool. */
export const technicalCompanyWrite = <T>(permit: Permit, fn: () => Promise<T>) => permits.run(permit, fn);

export async function checkpointRoot(db: DB, owner: string, env: string) {
  const c = await cutoverControl(db, owner, env);
  if (c?.phase !== "checkpoint") return null;
  const r = await db.query(`SELECT * FROM company_cutover_checkpoints
    WHERE checkpoint_id=$1 AND owner_key=$2 AND environment=$3 AND workspace_id=$4`,
  [c.checkpoint_id, owner, env, c.workspace_id]);
  const cp = r.rows[0];
  if (!cp) throw new ModelError(503, "Проверенный снимок отката недоступен; seed запрещён.");
  const root = await unpackModel(db, cp.archive_owner_key, cp.payload);
  if (Number(root.revision) !== Number(cp.revision) || semanticHash(root) !== cp.semantic_sha)
    throw new ModelError(503, "Проверка контрольной суммы снимка отката не прошла.");
  return root;
}

export async function checkpointDocument(db: DB, owner: string, env: string, hypothesis: string, id: string) {
  const c = await cutoverControl(db, owner, env);
  if (c?.phase !== "checkpoint") return null;
  const q = await db.query(`SELECT d.*,c.revision FROM company_cutover_checkpoint_documents d
    JOIN company_cutover_checkpoints c USING(checkpoint_id)
    WHERE d.checkpoint_id=$1 AND c.owner_key=$2 AND c.environment=$3
      AND c.workspace_id=$4 AND d.hypothesis_id=$5 AND d.document_id=$6`,
  [c.checkpoint_id, owner, env, c.workspace_id, hypothesis, id]);
  const r = q.rows[0];
  if (!r || semanticHash(r.document) !== r.document_sha)
    throw new ModelError(503, "Документ проверенного снимка отката недоступен.");
  return { revision: Number(r.revision), document: r.document };
}
