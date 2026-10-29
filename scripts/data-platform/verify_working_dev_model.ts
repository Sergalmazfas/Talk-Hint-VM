/** Verify the LIVE legacy working row, not its immutable shadow B copy.
 * No model reader/bootstrap helper, DDL, seed, writes, import or activation.
 */
import assert from "node:assert/strict";
import { Pool } from "pg";
import { writeFile, mkdir } from "node:fs/promises";
import { unpackModel } from "../../server/projectModel/history";
import { semanticHash } from "../../server/companyData/valueTree";
import { reviewedAccountBinding } from "../../server/companyData/v3/importApproval";
import { reviewedPackage } from "../../server/companyData/v3/reviewedPackage";
assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev only");
const pool = new Pool({connectionString: process.env.DATABASE_URL, max: 1});
const db = await pool.connect();
try {
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const row = (await db.query(`SELECT owner_key,revision,state,updated_at
    FROM talkhint_project_models WHERE owner_key=$1`, [reviewedAccountBinding.sourceOwner])).rows[0];
  assert(row, "Working owner row absent");
  const model = await unpackModel(db, row.owner_key, row.state);
  const digest = semanticHash(model);
  const matches = Number(row.revision) === 912 && digest === reviewedPackage!.manifest.semanticHash;
  const report = {
    checkedAt: new Date().toISOString(), table: "talkhint_project_models",
    owner: row.owner_key, revision: Number(row.revision), updatedAt: row.updated_at,
    semanticHash: digest, expectedSemanticHash: reviewedPackage!.manifest.semanticHash,
    matches, permissionCondition: matches ? "SATISFIED" : "NOT_SATISFIED",
    decodedWith: "unpackModel with owner's actual archive payloads",
    scope: "FULL unpacked working model, not a shadow workspace or only new-country",
    transaction: "REPEATABLE READ READ ONLY", modelWrites: 0,
  };
  await db.query("COMMIT");
  await mkdir("generated-artifacts/publish2-approval", {recursive: true});
  await writeFile("generated-artifacts/publish2-approval/WORKING_DEV_MODEL.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
  if (!matches) process.exitCode = 2;
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally { db.release(); await pool.end(); }
