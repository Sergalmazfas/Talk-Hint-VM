/** Routing only. A shadow import never selects the normalized source. No DDL here. */
import type { Pool } from "pg";
import { CompanyModelRepository, type CompanyEnvironment } from "./repository";
import { textHash } from "./valueTree";
import { IncrementalCompanyRepository } from "./v3/repository";
import { CommandCompanyRepository } from "./v3/commands";
import { checkpointDocument } from "./cutover/guard";
export const companyEnvironment = (): CompanyEnvironment =>
  process.env.NODE_ENV === "production" ? "production" : "development";

async function sourceVersion(pool: Pick<Pool, "query">, owner: string, env: string) {
  const present = await pool.query(`SELECT to_regclass('public.company_workspaces') AS company_table,
    to_regclass('public.company_v3_workspaces') AS company_v3_table`);
  let v3 = false, v2 = false;
  if (present.rows[0]?.company_v3_table) {
    const q = await pool.query(`SELECT 1 FROM company_v3_workspaces
      WHERE owner_key=$1 AND environment=$2 AND generation='normalized' AND schema_version=3`, [owner, env]);
    v3 = !!q.rowCount;
  }
  if (present.rows[0]?.company_table) {
    const q = await pool.query(`SELECT 1 FROM company_workspaces
      WHERE owner_key=$1 AND environment=$2 AND storage_generation='normalized'`, [owner, env]);
    v2 = !!q.rowCount;
  }
  if (v2 && v3) throw new Error("Two active company sources; refuse ambiguous routing");
  return v3 ? 3 : v2 ? 2 : null;
}
export async function hasNormalizedCompanySource(pool: Pick<Pool, "query">, owner: string) {
  return !!await sourceVersion(pool, owner, companyEnvironment());
}
export async function activeCompanyRepository(pool: Pool, owner: string) {
  const version = await sourceVersion(pool, owner, companyEnvironment());
  return version === 3 ? new CommandCompanyRepository(new IncrementalCompanyRepository(pool, companyEnvironment())) :
    version === 2 ? new CompanyModelRepository(async () => pool, companyEnvironment()) : null;
}
/** Fast owner-bound journal read: no reconstruction of all graph/history for one lab input. */
export async function activeCompanyDocument(pool: Pick<Pool, "query">, owner: string,
  environment: string, documentId: string) {
  const present = await pool.query(`SELECT to_regclass('public.company_workspaces') AS company_table,
    to_regclass('public.company_v3_workspaces') AS company_v3_table,
    to_regclass('public.company_cutover_controls') AS cutover_table`);
  if (present.rows[0]?.cutover_table) {
    const checkpoint = await checkpointDocument(pool, owner, environment, "new-country", documentId);
    if (checkpoint) return { text: checkpoint.document.text as string, revision: checkpoint.revision };
  }
  if (present.rows[0]?.company_v3_table) {
    const candidate = await pool.query(`SELECT 1 FROM company_v3_workspaces
      WHERE owner_key=$1 AND environment=$2 AND generation='normalized' AND schema_version=3`, [owner, environment]);
    if (candidate.rowCount) {
      if (await sourceVersion(pool, owner, environment) !== 3) throw new Error("Ambiguous active company document source");
      if (!["development", "production"].includes(environment)) throw new Error("Unknown company environment");
      const v3 = new IncrementalCompanyRepository(pool as Pool, environment as CompanyEnvironment);
      const result = await v3.readDocumentSnapshot(owner, "new-country", documentId);
      return { text: result.document.text as string, revision: result.revision };
    }
  }
  if (!present.rows[0]?.company_table) return null;
  const workspaces = await pool.query(`SELECT workspace_id,current_revision FROM company_workspaces
    WHERE owner_key=$1 AND environment=$2 AND storage_generation='normalized'`, [owner, environment]);
  if (!workspaces.rowCount) return null;
  const w = workspaces.rows[0];
  const docs = await pool.query(`SELECT text_body,utf8_sha256 FROM company_document_versions
    WHERE workspace_id=$1 AND hypothesis_id='new-country' AND document_id=$2 AND revision=$3`,
  [w.workspace_id, documentId, w.current_revision]);
  if (!docs.rowCount || textHash(docs.rows[0].text_body) !== docs.rows[0].utf8_sha256)
    throw new Error("Active company document missing or corrupt; legacy fallback is forbidden");
  return { text: docs.rows[0].text_body as string, revision: w.current_revision as number };
}
