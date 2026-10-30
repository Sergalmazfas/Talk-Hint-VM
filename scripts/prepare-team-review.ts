/**
 * Explicit CLI only. Never imported by the app/build.
 * Uploads owner-supplied portraits OR rehearses on a NEW retained Dev copy.
 * Does not connect to production and never updates the frozen Dev owner.
 */
import { Pool } from "pg";
import { Client } from "@replit/object-storage";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { portraitManifest, verifiedPortrait } from "../server/team/portraits";
import { payloadTables, physicalTable } from "../server/companyData/v3/schema";
import { SqlFrameStore } from "../server/companyData/v3/store";
import { readBusinessContract } from "../server/companyData/v3/businessContract";
import { encode, replace } from "../server/companyData/v3/codec";
import { TeamRepository } from "../server/team/repository";
import { IncrementalCompanyRepository } from "../server/companyData/v3/repository";
import { teamView } from "../server/team/view";
import { TEAM_BASE, TEAM_PLAN_HASH, proposedStep, JOURNAL, DIRECTORY } from "../server/team/plan";

const out = "generated-artifacts/team-owner-review";
const uploaded = {
  maria: "DCA4E415-0DE9-4A1B-9936-787BD9A9E06A",
  tikhon: "138C64CD-1919-47B6-9B3F-AA2A9DBF6A51",
  zamir: "1481CFC8-2CB0-4FC0-ADF7-2356C45B02FD",
  foma: "101C9081-D2C5-4F31-96C6-2687DBB45779",
  katya: "9146D4D1-803B-44D7-A521-5802546279CA",
};
async function upload() {
  const client = new Client(), results = [];
  for (const [name, uuid] of Object.entries(uploaded)) {
    const pin = portraitManifest[name], path = `attached_assets/${uuid}_1793320819523.png`;
    const bytes = await readFile(path);
    if (bytes.length !== pin.bytes || createHash("sha256").update(bytes).digest("hex") !== pin.sha256)
      throw Error("Input portrait mismatch");
    const exists = await client.exists(pin.object);
    if (!exists.ok) throw Error("Storage existence check failed");
    if (!exists.value) {
      const result = await client.uploadFromBytes(pin.object, bytes, { compress: false });
      if (!result.ok) throw Error("Portrait upload failed");
    }
    await verifiedPortrait(name, pin.sha256, client);
    results.push({ name, ...pin, verified: true, overwritten: false });
  }
  await writeFile(`${out}/PORTRAITS.json`, JSON.stringify(results, null, 2));
  console.log("Five private immutable portraits uploaded/verified; no model data applied.");
}
async function rehearse() {
  if (process.env.NODE_ENV === "production") throw Error("Dev-only rehearsal");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = await pool.connect();
  const source = "company-cutover-rehearsal-7849d552-4a38-4ac0-841d-43ec26f6b1b6";
  const id = randomUUID(), owner = `team-review:${id}`, workspace = `team-review-${id}`;
  try {
    await db.query("BEGIN");
    const sourceRow = (await db.query("SELECT * FROM company_v3_workspaces WHERE workspace_id=$1 AND environment='development' AND current_revision=912", [source])).rows[0];
    if (!sourceRow) throw Error("Retained baseline missing");
    const tableNames = ["company_v3_text_snapshots", ...payloadTables.map(physicalTable), "company_v3_payload_text_refs",
      "company_v3_frames", "company_v3_document_heads", "company_v3_revision_heads", "company_v3_size_budgets"];
    await db.query(`INSERT INTO company_v3_workspaces
      (workspace_id,owner_key,environment,schema_version,current_revision,root_hash,generation,label,retain_until_owner_review)
      SELECT $1,$2,'development',schema_version,current_revision,
      root_hash,'test','TEAM REVIEW REHEARSAL — RETAIN FOR OWNER; NOT WORKING SOURCE',true
      FROM company_v3_workspaces WHERE workspace_id=$3`, [workspace, owner, source]);
    for (const table of tableNames) {
      const columns = (await db.query(`SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table]))
        .rows.map(r => r.column_name as string);
      if (!columns.includes("workspace_id") || columns.some(c => !/^[a-z][a-z0-9_]*$/.test(c))) throw Error("Unexpected table layout");
      const asOf = table === "company_v3_revision_heads" ? " AND revision<=912" :
        table === "company_v3_document_heads" ? " AND valid_from<=912" : "";
      await db.query(`INSERT INTO ${table} (${columns.join(",")}) SELECT ${columns.map(c => c === "workspace_id" ? "$1" : c).join(",")}
        FROM ${table} WHERE workspace_id=$2${asOf}`, [workspace, source]);
    }
    const store = new SqlFrameStore(db, workspace, await readBusinessContract(db));
    const root = await replace(sourceRow.root_hash, ["revision"], await encode(914, store), store);
    if (root !== TEAM_BASE.rootHash) throw Error(`Reconstructed r914 pin differs: ${root}`);
    await store.flush();
    await db.query(`UPDATE company_v3_workspaces SET current_revision=914,root_hash=$2 WHERE workspace_id=$1`, [workspace, root]);
    await db.query(`INSERT INTO company_v3_revision_heads(workspace_id,revision,root_hash,actor)
      VALUES($1,914,$2,'team-review:exact-r914-reconstruction')`, [workspace, root]);
    await db.query("COMMIT");
    console.log("Retained copy reconstructed at exact r914 root.");
    const repo = new TeamRepository(pool, "development", true, process.argv.includes("--discover-pins"));
    const before = await repo.read(owner);
    const raw = new IncrementalCompanyRepository(pool, "development", true);
    try {
      await raw.commitDelta(owner, 914, async () => ({ edits: [{ path: ["revision"], value: 915 }],
        expectedRootHash: "0".repeat(64) }), "team-review:wrong-output-pin");
      throw Error("Wrong output pin unexpectedly committed");
    } catch (e: any) { if (e.status !== 409) throw e; }
    const unchanged = await repo.read(owner);
    if (unchanged.revision !== before.revision || unchanged.rootHash !== before.rootHash)
      throw Error("Wrong output pin did not roll back");
    const receipts = [], changes = [];
    for (let step = 0; step < 4; step++) {
      const context = await repo.read(owner);
      const proposed = proposedStep(step, context.documents, context.operating, portraitManifest);
      changes.push({ step, beforeRevision: context.revision, beforeRoot: context.rootHash,
        documents: proposed.documents.map(d => ({
          id: d.id, before: context.documents.find(o => o.id === d.id) ?? null, after: d,
        })),
        operatingUnchanged: true });
      const pin = { workspace, revision: context.revision, rootHash: context.rootHash, step, planHash: TEAM_PLAN_HASH };
      receipts.push(await repo.apply(owner, pin));
      console.log(`Rehearsed step ${step + 1}: revision ${receipts[step].revision}`);
      // A repeated request must conflict, never append twice.
      try { await repo.apply(owner, pin); throw Error("Replay unexpectedly succeeded"); }
      catch (e: any) { if (e.status !== 409) throw e; }
    }
    const after = await repo.read(owner);
    if (JSON.stringify(before.operating) !== JSON.stringify(after.operating)) throw Error("Operating graph changed");
    for (const d of before.documents) if (![JOURNAL, "DOC-PLAB-PROMPT-PROPOSAL", "DOC-PLG-QA-PROMPT-PROPOSAL"].includes(d.id) &&
      after.documents.find(x => x.id === d.id)?.text !== d.text) throw Error(`Unrelated document changed: ${d.id}`);
    const view = teamView(after, "development");
    await writeFile(`${out}/MODEL_CHANGES.json`, JSON.stringify(changes, null, 2));
    await writeFile(`${out}/REHEARSAL.json`, JSON.stringify({ workspace, owner, planHash: TEAM_PLAN_HASH,
      before: { revision: before.revision, rootHash: before.rootHash }, after: { revision: after.revision, rootHash: after.rootHash },
      receipts, unrelatedDocumentsUnchanged: true, operatingGraphUnchanged: true,
      wrongOutputPinRolledBack: true, staleReplaysRejected: 4, retained: true,
      calibrationOnly: process.argv.includes("--discover-pins") }, null, 2));
    await writeFile(`${out}/TEAM_VIEW_FIXTURE.json`, JSON.stringify(view, null, 2));
    console.log("Isolated rehearsal finished; copy retained; production and frozen Dev owner untouched.");
  } catch (e) { await db.query("ROLLBACK"); throw e; }
  finally { db.release(); await pool.end(); }
}
await mkdir(out, { recursive: true });
if (process.argv.includes("--upload")) await upload();
else if (process.argv.includes("--rehearse")) await rehearse();
else throw Error("Choose --upload or --rehearse; no implicit actions");
