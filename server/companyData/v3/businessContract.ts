import type { PoolClient } from "pg";
import { inspectSchema, type Schema } from "../relational";
import { textHash } from "../valueTree";
import { businessTables } from "../relational";

/** Migration/import preparation only. Readers NEVER infer old record layout from today's schema. */
export async function prepareBusinessContract(db: PoolClient) {
  const definition = JSON.stringify(await inspectSchema(db)), digest = textHash(definition);
  await db.query(`INSERT INTO company_v3_business_contract(version,definition_text,sha256)
    VALUES(1,$1,$2) ON CONFLICT DO NOTHING`, [definition, digest]);
  return readBusinessContract(db);
}
export async function readBusinessContract(db: PoolClient): Promise<Schema> {
  const { rows } = await db.query("SELECT definition_text,sha256 FROM company_v3_business_contract WHERE version=1");
  if (rows.length !== 1 || textHash(rows[0].definition_text) !== rows[0].sha256)
    throw new Error("Company business decoding contract missing or corrupt");
  const schema: Schema = JSON.parse(rows[0].definition_text);
  if (Object.keys(schema).length !== businessTables.length ||
      businessTables.some(t => !schema[t]?.columns.length || !schema[t]?.keys.length))
    throw new Error("Invalid company business decoding contract");
  return schema;
}
