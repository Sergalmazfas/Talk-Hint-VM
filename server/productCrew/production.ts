import type { Pool } from "pg";
import type { ModelRepository } from "../projectModel/repository";
import { activeCompanyRepository } from "../companyData/active";
import { ModelError } from "../projectModel/modelError";

/** Never bootstrap a legacy book or fall back to a Dev/checkpoint source. */
export function productionProductRepository(getPool: () => Promise<Pool>): ModelRepository {
  const active = async (owner: string, hypothesis: string, write = false) => {
    if (process.env.NODE_ENV !== "production") throw new ModelError(503, "Production MCP недоступен в Dev.");
    if (hypothesis !== "new-country") throw new ModelError(403, "Только модель new-country.");
    const pool = await getPool();
    const { rows } = await pool.query(`SELECT w.workspace_id,c.writes_open
      FROM company_v3_workspaces w JOIN company_cutover_controls c
      ON c.workspace_id=w.workspace_id AND c.owner_key=w.owner_key AND c.environment=w.environment
      WHERE w.owner_key=$1 AND w.environment='production' AND w.generation='normalized'
      AND w.schema_version=3 AND c.phase='active'`, [owner]);
    if (rows.length !== 1) throw new ModelError(423, "Активный production-источник недоступен; другая копия не подставляется.");
    if (write && !rows[0].writes_open) throw new ModelError(423, "Запись в production закрыта.");
    // This also rejects ambiguous simultaneous v2/v3 sources. The repository's
    // transaction rechecks the write gate and revision under its ordinary lock.
    const repository = await activeCompanyRepository(pool, owner);
    if (!repository) throw new ModelError(423, "Нормализованный источник недоступен.");
    return repository;
  };
  return {
    read: async (owner, hypothesis = "new-country") => (await active(owner, hypothesis)).read(owner, hypothesis),
    update: async (owner, revision, command, hypothesis = "new-country") =>
      (await active(owner, hypothesis, true)).update(owner, revision, command, hypothesis),
    updateMany: async (owner, revision, commands, hypothesis = "new-country") =>
      (await active(owner, hypothesis, true)).updateMany(owner, revision, commands, hypothesis),
    readDocumentSnapshot: async (owner, hypothesis, id) =>
      (await active(owner, hypothesis)).readDocumentSnapshot(owner, hypothesis, id),
  };
}
