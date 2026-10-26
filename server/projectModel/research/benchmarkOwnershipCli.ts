import { dbReady, isDevDatabase, pool } from "../../db";
import { unpackModel } from "../history";
import { readHypothesis } from "../hypotheses";
import { persistModelUpdate } from "../materialImport";
import { prepareBenchmarkOwnership, ownershipDocumentId } from "./benchmarkOwnership";

async function main() {
  if (process.env.NODE_ENV !== "development" || !isDevDatabase) throw Error("Dev database only");
  await dbReady;
  if (!pool) throw Error("Database unavailable");
  const { rows } = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  if (rows.length !== 1) throw Error("Ambiguous owner");
  const root = await unpackModel(pool, rows[0].owner_key, rows[0].state);
  if (process.argv.includes("--inspect")) {
    const m = readHypothesis(root, "new-country"), data = m.operatingModel!.revisions.at(-1)!.data;
    console.log(JSON.stringify({ revision: root.revision,
      roles: data.nodes.filter(n => ["product-manager-specialist", "benchmark-role-reference", "head-product", "head-market"].includes(n.id)),
      actions: data.nodes.filter(n => n.kind === "action" && /^(MKT\.2|PRD\.1|ENG\.1)/.test(n.code)).map(n => ({ id:n.id,code:n.code,name:n.name,role:n.roleId,next:n.nextId,report:n.reporting })),
      passports: m.elements.filter(e => e.coordination?.kind === "role_passport"),
      documents: m.documents.map(d => ({id:d.id,title:d.title})),
      lingvanex: m.competitorDirectory!.records.filter(r=>r.revisions.at(-1)!.snapshot.appStore.includes("1367461351")).map(r=>({id:r.id,version:r.revisions.at(-1)!.version,snapshot:r.revisions.at(-1)!.snapshot})),
    }));
    return;
  }
  const checkOnly = process.argv.includes("--check");
  const saved = checkOnly ? prepareBenchmarkOwnership(root, rows[0].owner_key)
    : await persistModelUpdate(pool, rows[0].owner_key, s => prepareBenchmarkOwnership(s, rows[0].owner_key), true);
  const m = readHypothesis(saved, "new-country"), rev = m.operatingModel!.revisions.at(-1)!;
  console.log(JSON.stringify({savedAndReread:!checkOnly,revision:saved.revision,operatingVersion:rev.version,
    document: m.documents.find(d=>d.id===ownershipDocumentId)?.title,
    lingvanex:m.competitorDirectory!.records.filter(r=>r.revisions.at(-1)!.snapshot.appStore.includes("1367461351")).map(r=>({id:r.id,version:r.revisions.at(-1)!.version})),
    actions:rev.data.nodes.filter(n=>n.kind==="action").length,
    idempotent:prepareBenchmarkOwnership(saved,rows[0].owner_key)===saved,executorsStarted:false}));
}
main().catch(e=>{console.error(e instanceof Error?e.message:"Update failed");process.exitCode=1;})
  .finally(async()=>{await pool?.end();});
