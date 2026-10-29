/**
 * Owner-authenticated candidate import. HTTP registration is fail-closed.
 * Production execution is disabled by default and was NOT run for B2.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { semanticHash, textHash } from "../valueTree";
import { ddlV3, payloadTables, physicalTable } from "./schema";
import { readBusinessContract } from "./businessContract";
import { SqlFrameStore } from "./store";
import { decode } from "./codec";

export interface OwnerAuthentication {
  /** Obtain on the server from verified owner session + CSRF; never from body fields. */
  ownerKey: string; isOwner: boolean; csrfVerified: boolean;
}
export interface TransferRecord { table: string; row: Record<string, any> }
export interface TransferManifest {
  schemaVersion: 3; schemaDigest: string; sourceOwner: string; sourceEnvironment: string;
  sourceWorkspace: string; revision: number; rootHash: string; semanticHash: string;
  recordCount: number; recordsDigest: string;
}
export const transferDigest = (records: TransferRecord[]) => {
  const h = createHash("sha256");
  for (const r of records) h.update(semanticHash(r)).update("\n");
  return h.digest("hex");
};
const tables = [...payloadTables.map(physicalTable), "company_v3_contracts", "company_v3_business_contract", "company_v3_text_snapshots",
  "company_v3_payload_text_refs", "company_v3_frames", "company_v3_revision_heads", "company_v3_document_heads",
  "company_v3_archive_refs", "company_v3_size_budgets", "talkhint_project_models", "talkhint_project_model_history"];
function authenticate(auth: OwnerAuthentication) {
  if (!auth.isOwner || !auth.csrfVerified || !auth.ownerKey) throw new Error("Authenticated owner + CSRF required");
}
export class OwnerImportService {
  constructor(private pool: Pool, private environment: "development" | "production",
    private allowProductionImport = false) {}
  private guard(auth: OwnerAuthentication) {
    authenticate(auth);
    if (this.environment === "production" && !this.allowProductionImport)
      throw new Error("Production import not enabled; owner release/binding approval required");
  }
  async grant(auth: OwnerAuthentication, manifest: TransferManifest, targetOwner: string, expiresInMs = 600_000) {
    this.guard(auth);
    if (targetOwner !== auth.ownerKey) throw new Error("Target owner binding mismatch");
    if (manifest.schemaVersion !== 3 || manifest.schemaDigest !== textHash(ddlV3())) throw new Error("Schema contract mismatch");
    if (!["development", "production"].includes(manifest.sourceEnvironment) || !manifest.sourceOwner ||
        !Number.isSafeInteger(manifest.recordCount) || manifest.recordCount < 1 ||
        expiresInMs <= 0 || expiresInMs > 3_600_000) throw new Error("Invalid import grant");
    const token = randomBytes(32).toString("hex"), grantHash = textHash(token);
    await this.pool.query(`INSERT INTO company_v3_import_grants
      (grant_hash,source_owner,target_owner,source_environment,target_environment,package_hash,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,now()+($7::bigint * interval '1 millisecond'))`,
    [grantHash, manifest.sourceOwner, targetOwner, manifest.sourceEnvironment, this.environment, semanticHash(manifest), expiresInMs]);
    return token;
  }
  async consume(auth: OwnerAuthentication, token: string, manifest: TransferManifest,
    records: AsyncIterable<TransferRecord>, activateAfterVerification = false) {
    this.guard(auth);
    if (typeof activateAfterVerification !== "boolean") throw new Error("Explicit boolean activation required");
    if (activateAfterVerification) throw new Error("Activation is a separate owner-approved operation, never part of import");
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const q = await db.query(`SELECT *,expires_at>now() AS fresh FROM company_v3_import_grants
        WHERE grant_hash=$1 FOR UPDATE`, [textHash(token)]);
      const grant = q.rows[0];
      if (!grant || grant.consumed_at || !grant.fresh) throw new Error("Import grant missing, expired or replayed");
      if (grant.target_owner !== auth.ownerKey || grant.target_environment !== this.environment ||
          grant.source_owner !== manifest.sourceOwner || grant.source_environment !== manifest.sourceEnvironment ||
          grant.package_hash !== semanticHash(manifest)) throw new Error("Import owner/environment/package binding mismatch");
      if (manifest.schemaVersion !== 3 || manifest.schemaDigest !== textHash(ddlV3())) throw new Error("Import schema mismatch");
      // Recheck emptiness in the SAME transaction, after serializing concurrent imports.
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`company-import:${this.environment}:${auth.ownerKey}`]);
      const occupied = await db.query(`SELECT 1 FROM company_v3_workspaces WHERE owner_key=$1 AND environment=$2
        UNION ALL SELECT 1 FROM company_workspaces WHERE owner_key=$1 AND environment=$2
        UNION ALL SELECT 1 FROM talkhint_project_models WHERE owner_key=$1`, [auth.ownerKey, this.environment]);
      if (occupied.rowCount) throw new Error("Target is not empty; import refused without overwrite");
      const workspace = `company-import-${randomUUID()}`;
      // Archive FKs need a legacy parent, but it MUST NOT be the live owner's row:
      // PgModelRepository otherwise serves that JSON before an explicit cutover.
      const archiveOwner = `company-archive:${workspace}`;
      await db.query(`INSERT INTO company_v3_workspaces
        (workspace_id,owner_key,environment,label,generation,current_revision,root_hash)
        VALUES($1,$2,$3,'Owner-authenticated imported candidate','shadow',$4,'pending')`,
      [workspace, auth.ownerKey, this.environment, manifest.revision]);
      const digest = createHash("sha256"); let count = 0, legacyRootImported = false;
      for await (const record of records) {
        if (!tables.includes(record.table)) throw new Error("Unapproved import table");
        digest.update(semanticHash(record)).update("\n"); count++;
        if (count > manifest.recordCount) throw new Error("Import record count exceeded");
        const row = { ...record.row };
        if (record.table === "company_v3_business_contract") {
          const existing = await db.query("SELECT sha256 FROM company_v3_business_contract WHERE version=$1", [row.version]);
          if (existing.rowCount && existing.rows[0].sha256 !== row.sha256) throw new Error("Incompatible business contract");
          if (row.version !== 1 || textHash(row.definition_text) !== row.sha256) throw new Error("Business contract mismatch");
        } else if (record.table === "company_v3_contracts") {
          if (semanticHash({ version: row.version, kind: row.kind, field_names: row.field_names }) !== row.contract_hash)
            throw new Error("Imported contract digest mismatch");
        } else if (["talkhint_project_models", "talkhint_project_model_history"].includes(record.table)) {
          if (row.owner_key !== manifest.sourceOwner) throw new Error("Archive source owner mismatch");
          row.owner_key = archiveOwner;
          if (record.table === "talkhint_project_models") legacyRootImported = true;
        } else {
          if (row.workspace_id !== manifest.sourceWorkspace) throw new Error("Source workspace mismatch");
          row.workspace_id = workspace;
          if (record.table === "company_v3_archive_refs") {
            if (row.source_owner_key !== manifest.sourceOwner) throw new Error("Source archive binding mismatch");
            row.source_owner_key = archiveOwner;
          }
        }
        const names = Object.keys(row);
        if (names.some(k => !/^[a-z_][a-z0-9_]*$/.test(k))) throw new Error("Unsafe import field");
        await db.query(`INSERT INTO ${record.table} (${names.map(n => `"${n}"`).join(",")})
          SELECT ${names.map(n => `"${n}"`).join(",")} FROM jsonb_populate_record(NULL::${record.table},$1::jsonb)
          ${record.table === "company_v3_contracts" ? "ON CONFLICT(contract_hash) DO NOTHING" :
            record.table === "company_v3_business_contract" ? "ON CONFLICT(version) DO NOTHING" : ""}`, [JSON.stringify(row)]);
      }
      if (count !== manifest.recordCount || digest.digest("hex") !== manifest.recordsDigest) throw new Error("Import stream digest/count mismatch");
      const store = new SqlFrameStore(db, workspace, await readBusinessContract(db));
      await store.preload();
      const root = await decode(manifest.rootHash, store);
      if (root.revision !== manifest.revision || semanticHash(root) !== manifest.semanticHash) throw new Error("Imported root digest mismatch");
      const hypotheses = [{ id: "original", model: root }, ...(root.alternatives ?? [])];
      for (const h of hypotheses) for (const document of h.model.documents) {
        const index = await db.query(`SELECT frame_hash FROM company_v3_document_heads
          WHERE workspace_id=$1 AND hypothesis_id=$2 AND document_id=$3 AND valid_from<=$4
          ORDER BY valid_from DESC LIMIT 1`, [workspace, h.id, document.id, manifest.revision]);
        if (index.rowCount !== 1 || semanticHash(await decode(index.rows[0].frame_hash, store)) !== semanticHash(document))
          throw new Error("Imported direct document index mismatch");
      }
      await db.query(`DECLARE company_import_archives NO SCROLL CURSOR FOR SELECT h.payload,a.semantic_sha256 FROM company_v3_archive_refs a
        JOIN talkhint_project_model_history h ON h.owner_key=a.source_owner_key AND h.key=a.source_key
        WHERE a.workspace_id=$1`, [workspace]);
      while (true) {
        const archives = await db.query("FETCH 1 FROM company_import_archives");
        if (!archives.rows.length) break;
        const a = archives.rows[0];
        if (semanticHash(a.payload) !== a.semantic_sha256) throw new Error("Imported archive digest mismatch");
      }
      await db.query("CLOSE company_import_archives");
      const raced = await db.query("SELECT 1 FROM talkhint_project_models WHERE owner_key=$1", [auth.ownerKey]);
      if (raced.rowCount) throw new Error("Legacy target changed during import");
      if (!legacyRootImported && (await db.query("SELECT 1 FROM company_v3_archive_refs WHERE workspace_id=$1",
        [workspace])).rowCount) throw new Error("Archive parent missing");
      // Import never activates. There is deliberately no HTTP cutover endpoint.
      await db.query("UPDATE company_v3_workspaces SET root_hash=$2,generation=$3 WHERE workspace_id=$1",
        [workspace, manifest.rootHash, "shadow"]);
      await db.query("UPDATE company_v3_import_grants SET consumed_at=now() WHERE grant_hash=$1", [textHash(token)]);
      await db.query("COMMIT");
      return { workspace, archiveOwner, imported: count, generation: "shadow",
        activated: false, semanticHash: manifest.semanticHash };
    } catch (error) { await db.query("ROLLBACK"); throw error; }
    finally { db.release(); }
  }
}
