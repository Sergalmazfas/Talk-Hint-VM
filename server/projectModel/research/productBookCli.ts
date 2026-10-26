import { Pool } from "pg";
import { prepareProductBook } from "./productBook";
import { unpackModel } from "../history";
import { persistModelUpdate } from "../materialImport";
import { readHypothesis } from "../hypotheses";
import { productBookDocumentId, readProductBook } from "../../../shared/productBook";

async function main() {
  const url = process.env.DATABASE_URL;
  if (process.env.NODE_ENV !== "development" || !url || !/helium|lithium/.test(new URL(url).hostname))
    throw Error("Explicit Dev database only; no production fallback");
  const pool = new Pool({ connectionString: url });
  try {
    const rows = (await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
      (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`)).rows;
    if (rows.length !== 1) throw Error("Ambiguous owner; no namespace created");
    const check = process.argv.includes("--check");
    const saved = check
      ? prepareProductBook(await unpackModel(pool, rows[0].owner_key, rows[0].state), rows[0].owner_key)
      : await persistModelUpdate(pool, rows[0].owner_key, s => prepareProductBook(s, rows[0].owner_key), true);
    const model = readHypothesis(saved, "new-country");
    const doc = model.documents.find(d => d.id === productBookDocumentId)!;
    const book = readProductBook(doc)!;
    console.log(JSON.stringify({ savedAndReread: !check, revision: saved.revision,
      documentId: doc.id, version: book.version, status: book.status, features: book.features.length,
      textCharacters: doc.text.length, linkedDrafts: model.elements.filter(t => t.id.startsWith("PB-GAP-")).length,
      idempotent: prepareProductBook(saved, rows[0].owner_key) === saved, crewStarted: false }));
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Book update failed"); process.exitCode = 1; });
