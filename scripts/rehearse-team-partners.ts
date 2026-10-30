/** Explicit Dev-only rehearsal; outer transaction ALWAYS rolls back. No prod connection. */
import { Pool } from "pg";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { TeamRepository } from "../server/team/repository";
import { PARTNERS_BASE, PARTNERS_DOCUMENT_HASH, partnersDocument } from "../server/team/partnersApproval";
import { semanticHash } from "../server/companyData/valueTree";
const out = "generated-artifacts/team-partners-button";
const fixture = JSON.parse(await readFile("generated-artifacts/team-owner-review/TEAM_VIEW_FIXTURE.json", "utf8"));
const workspace = fixture.source.workspace;
if (!workspace.startsWith("team-review-") || process.env.NODE_ENV === "production") throw Error("Isolated Dev copy only");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = await pool.connect();
let result: any;
try {
  const row = (await db.query(`SELECT owner_key,generation,environment,current_revision,root_hash
    FROM company_v3_workspaces WHERE workspace_id=$1`, [workspace])).rows[0];
  if (!row || row.environment !== "development" || row.generation !== "test" || !row.owner_key.startsWith("team-review:"))
    throw Error("Not an isolated test workspace");
  const owner = row.owner_key;
  assert.equal(Number(row.current_revision), 918); assert.equal(row.root_hash, PARTNERS_BASE.rootHash);
  await db.query("BEGIN");
  let active = false;
  const wrapped: any = {
    release() {},
    async query(sql: string, values?: any[]) {
      if (/^BEGIN/.test(sql)) { assert(!active); active = true; return db.query("SAVEPOINT partner_rehearsal"); }
      if (sql === "COMMIT") { active = false; return db.query("RELEASE SAVEPOINT partner_rehearsal"); }
      if (sql === "ROLLBACK") {
        if (active) { await db.query("ROLLBACK TO SAVEPOINT partner_rehearsal"); active = false;
          return db.query("RELEASE SAVEPOINT partner_rehearsal"); }
        return { rows: [] };
      }
      return db.query(sql, values);
    },
  };
  const scopedPool: any = { connect: async () => wrapped };
  const strict = new TeamRepository(scopedPool, "development", true);
  const calibrate = new TeamRepository(scopedPool, "development", true, true);
  const before = await strict.read(owner);
  const pin = { ...PARTNERS_BASE, workspace };
  await assert.rejects(() => strict.applyPartners(owner, { ...pin, documentHash: "0".repeat(64) }),
    (e: any) => e.status === 409);
  assert.equal((await strict.read(owner)).rootHash, before.rootHash);
  const receipt = await (process.argv.includes("--discover") ? calibrate : strict).applyPartners(owner, pin);
  const after = await strict.read(owner);
  assert.equal(after.revision, 919);
  assert.equal(after.documents.length, before.documents.length + 1);
  for (const old of before.documents)
    assert.equal(semanticHash(after.documents.find(d => d.id === old.id)), semanticHash(old));
  assert.equal(semanticHash(after.operating), semanticHash(before.operating));
  assert.equal(semanticHash(after.elements), semanticHash(before.elements));
  assert.equal(semanticHash(after.documents.find(d => d.id === partnersDocument().id)), PARTNERS_DOCUMENT_HASH);
  await assert.rejects(() => strict.applyPartners(owner, pin), (e: any) => e.status === 409);
  result = { isolatedDevOnly: true, originalWorkspaceUntouched: true, rolledBack: true,
    previousRevision: before.revision, previousRoot: before.rootHash, receipt,
    allOldDocumentsUnchanged: true, operatingUnchanged: true, elementsUnchanged: true,
    replayRejected: true, documentHash: PARTNERS_DOCUMENT_HASH };
} finally {
  await db.query("ROLLBACK");
  if (result) {
    const row = (await db.query("SELECT current_revision,root_hash FROM company_v3_workspaces WHERE workspace_id=$1", [workspace])).rows[0];
    assert.equal(Number(row.current_revision), 918); assert.equal(row.root_hash, PARTNERS_BASE.rootHash);
  }
  db.release(); await pool.end();
}
await mkdir(out, { recursive: true });
await writeFile(`${out}/${process.argv.includes("--discover") ? "REHEARSAL_CALIBRATION" : "REHEARSAL_STRICT"}.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
