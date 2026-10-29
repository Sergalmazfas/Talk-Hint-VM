import type { ProjectModelState } from "../../../shared/projectModel";
import { project, type Schema } from "../relational";
import { child } from "../valueTree";
import type { Frame } from "./codec";
import { payloadTables } from "./schema";
import { SqlFrameStore } from "./store";

/** Project a changed fragment only; never called with the current full workspace by a writer. */
export async function projectFragment(root: ProjectModelState, store: SqlFrameStore, schema: Schema,
  externalNamespaces?: Map<string, string>) {
  const projection = project(root, store.workspace, schema, { domainWrite: true, actor: "company-v3-writer", externalNamespaces });
  const mapping = new Map<string, string>();
  for (const table of payloadTables) {
    if (["company_model_revisions", "company_hypotheses"].includes(table)) continue;
    for (const row of projection.tables.get(table) ?? []) {
      const key = `${table}:${JSON.stringify(schema[table].keys.map(k => String(row[k])))}`;
      mapping.set(key, await store.payload(table, row));
    }
  }
  const columns = new Map<string, Frame>();
  for (const row of projection.tables.get("company_record_locations") ?? []) {
    if (["company_model_revisions", "company_hypotheses"].includes(row.target_table)) continue;
    const record = mapping.get(`${row.target_table}:${JSON.stringify(row.key_values)}`);
    if (!record) throw new Error("Company fragment mapping missing");
    row.source_fields.forEach((field: string, i: number) => {
      const path = field === "$value" ? row.source_pointer : child(row.source_pointer, field);
      columns.set(path, { kind: "column", table: row.target_table, record, column: row.target_columns[i] });
    });
  }
  return columns;
}
