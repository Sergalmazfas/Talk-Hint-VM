import { dbReady, isDevDatabase, pool } from "../../db";
import { unpackModel } from "../history";
import { persistModelUpdate } from "../materialImport";
import { readHypothesis } from "../hypotheses";
import { passportRoadmapTitle, prepareProductPassport, productPassportMarker } from "./productPassport";

async function main() {
  if (process.env.NODE_ENV !== "development" || !isDevDatabase) throw Error("Dev database only");
  await dbReady;
  if (!pool) throw Error("Database unavailable");
  const { rows } = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  if (rows.length !== 1) throw Error("Ambiguous owner; no namespace creation");
  const checkOnly = process.argv.includes("--check");
  const saved = checkOnly
    ? prepareProductPassport(await unpackModel(pool, rows[0].owner_key, rows[0].state), rows[0].owner_key)
    : await persistModelUpdate(pool, rows[0].owner_key, s => prepareProductPassport(s, rows[0].owner_key), true);
  const m = readHypothesis(saved, "new-country"), rev = m.operatingModel!.revisions.at(-1)!;
  const product = m.elements.find(e => e.id === "TH-PRODUCT")!;
  const doc = m.documents.find(d => d.elementIds.includes(product.id) && d.text.includes(productPassportMarker))!;
  console.log(JSON.stringify({ savedAndReread: !checkOnly, checkOnly, revision: saved.revision,
    operatingVersion: rev.version, productId: product.id, productVersion: product.version,
    documentId: doc.id, passportVersion: 1, snapshotDate: "2026-10-25",
    documentStatus: "На согласовании", lifecycle: "В разработке",
    documentCharacters: doc.text.length, marker: doc.text.includes(productPassportMarker),
    roadmapId: m.documents.find(d => d.title === passportRoadmapTitle)!.id,
    actions: rev.data.nodes.filter(n => n.kind === "action").length,
    idempotent: prepareProductPassport(saved, rows[0].owner_key) === saved,
    approved: false, analystReceiptConfirmed: false, executorsStarted: false }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Update failed"); process.exitCode = 1; })
  .finally(async () => { await pool?.end(); });
