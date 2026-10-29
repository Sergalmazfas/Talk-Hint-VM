/** Routing only. A shadow import never selects the normalized source. No DDL here. */
import type { Pool } from "pg";
import { CompanyModelRepository, type CompanyEnvironment } from "./repository";
import { textHash } from "./valueTree";
export const companyEnvironment = (): CompanyEnvironment =>
  process.env.NODE_ENV === "production" ? "production" : "development";

export async function hasNormalizedCompanySource(pool: Pick<Pool, "query">, owner: string) {
  const present = await pool.query("SELECT to_regclass('public.company_workspaces') AS company_table");
  if (!present.rows[0]?.company_table) return null; // Schema not published yet.
  const env = companyEnvironment();
  const active = await pool.query(`SELECT 1 FROM company_workspaces
    WHERE owner_key=$1 AND environment=$2 AND storage_generation='normalized'`, [owner, env]);
  return !!active.rowCount;
}
export async function activeCompanyRepository(pool: Pool, owner: string) {
  return await hasNormalizedCompanySource(pool, owner) ?
    new CompanyModelRepository(async () => pool, companyEnvironment()) : null;
}
/** Fast owner-bound journal read: no reconstruction of all graph/history for one lab input. */
export async function activeCompanyDocument(pool: Pick<Pool, "query">, owner: string,
  environment: string, documentId: string) {
  const present = await pool.query("SELECT to_regclass('public.company_workspaces') AS company_table");
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
