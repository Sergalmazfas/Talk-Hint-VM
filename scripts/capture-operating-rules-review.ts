/** Read-only input for an approval package. No runtime, transport or model writes. */
import { Pool } from "pg";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { unpackModel } from "../server/projectModel/history";
import { readHypothesis } from "../server/projectModel/hypotheses";

const output = process.argv[2];
if (!output?.startsWith("/tmp/")) throw new Error("Snapshot must be a temporary /tmp file");
const connectionString = process.env.DATABASE_URL;
if (!connectionString || new URL(connectionString).hostname !== "helium")
  throw new Error("Only the existing Dev database is allowed");
const pool = new Pool({ connectionString });
const client = await pool.connect();
try {
  await client.query("BEGIN READ ONLY");
  const rows = await client.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h
     WHERE h->>'id'='new-country')`);
  if (rows.rows.length !== 1) throw new Error("Ambiguous owner; no snapshot exported");
  const row = rows.rows[0];
  const root = await unpackModel(client, row.owner_key, row.state);
  const state = readHypothesis(root, "new-country");
  await writeFile(output, JSON.stringify(state), { mode: 0o600 });
  console.log(JSON.stringify({
    revision: state.revision, operatingVersion: state.operatingModel?.revisions.at(-1)?.version,
    sha256: createHash("sha256").update(JSON.stringify(state)).digest("hex"),
    readOnly: true, output,
  }));
  await client.query("ROLLBACK");
} finally {
  client.release();
  await pool.end();
}
