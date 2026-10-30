/** Real PostgreSQL, read-only retained Dev copy; exercise NON-test read branches. */
import { Pool } from "pg";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { readContext } from "../server/team/repository";
import { SqlFrameStore } from "../server/companyData/v3/store";
import { readBusinessContract } from "../server/companyData/v3/businessContract";
import { DIRECTORY, TEAM_OWNER } from "../server/team/plan";
import { PARTNERS_BASE } from "../server/team/partnersApproval";
import { teamView } from "../server/team/view";
import { withTeamRuntime } from "../server/team/runtime";
import { teamRuntimeChecks } from "../server/team/runtimeChecks";
import { EXTERNAL_PARTNERS_DOCUMENT, withExternalPartners } from "../server/team/external";

const out = "generated-artifacts/team-reader-fix";
if (process.env.NODE_ENV === "production") throw Error("Dev rehearsal only");
const fixture = JSON.parse(await readFile("generated-artifacts/team-owner-review/TEAM_VIEW_FIXTURE.json", "utf8"));
const workspace = fixture.source.workspace;
if (!workspace.startsWith("team-review-")) throw Error("Retained test copy only");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = await pool.connect();
const queries: string[] = [];
let result: any;
try {
  await db.query("BEGIN READ ONLY");
  const before = (await db.query("SELECT * FROM company_v3_workspaces WHERE workspace_id=$1", [workspace])).rows[0];
  assert.equal(before.environment, "development"); assert.equal(before.generation, "test");
  assert(before.owner_key.startsWith("team-review:"));
  assert.equal(Number(before.current_revision), 918); assert.equal(before.root_hash, PARTNERS_BASE.rootHash);
  const client: any = {
    async query(sql: string, params?: any[]) {
      queries.push(sql);
      if (sql.includes("FROM company_v3_workspaces w")) {
        // Metadata-only fixture, never persisted. Real frame/payload SQL below
        // uses this guarded Dev namespace. No production connection or auth bypass.
        return { rows: [{ ...before, owner_key: TEAM_OWNER, environment: "production",
          generation: "normalized", phase: "active", writes_open: true, actor: "isolated-read-fixture" }] };
      }
      return db.query(sql, params);
    },
  };
  const store = new SqlFrameStore(client, workspace, await readBusinessContract(client));
  const context = await readContext(client, TEAM_OWNER, "production", { store }); // NOT test:true.
  const directory = context.documents.find(document => document.id === DIRECTORY)!;
  const acceptedName = JSON.parse(directory.text).owner.name;
  assert.equal(context.secretaryOwnerName, acceptedName);
  assert.equal(context.rootHash, before.root_hash); assert.equal(context.revision, 918);
  assert(queries.some(sql => sql.includes("FROM secretary_tasks")));
  assert(queries.some(sql => sql.includes("FROM secretary_outgoing_defaults")));
  assert(!queries.some(sql => /\bFROM users\b/.test(sql)));
  const view = withExternalPartners(
    withTeamRuntime(teamView(context, "production"), context, await teamRuntimeChecks(context)),
    context.documents.find(document => document.id === EXTERNAL_PARTNERS_DOCUMENT)?.text);
  assert.equal(view.apply.completed, 4);
  assert(view.members.length > 0);
  const after = (await db.query("SELECT * FROM company_v3_workspaces WHERE workspace_id=$1", [workspace])).rows[0];
  assert.deepEqual(after, before);
  result = { isolatedDevOnly: true, readOnlyTransaction: true, productionConnectionUsed: false,
    persistedMetadataChanged: false, testModeBypass: false,
    allProductionOnlySecretaryReadsExecuted: true, noUsersNameQuery: true,
    displayProjectionCompleted: true, membersRead: view.members.length,
    revision: context.revision, rootHash: context.rootHash, documentsRead: context.documents.length,
    ownerNameSource: `${DIRECTORY}:owner.name`, ownerNameMatchesAcceptedDirectory: true,
    queryCount: queries.length };
} finally {
  await db.query("ROLLBACK"); db.release(); await pool.end();
}
await mkdir(out, { recursive: true });
await writeFile(`${out}/PG_READ_PATH.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
