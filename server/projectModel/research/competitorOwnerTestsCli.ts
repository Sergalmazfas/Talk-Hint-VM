import { dbReady, isDevDatabase, pool } from "../../db";
import { unpackModel } from "../history";
import { readHypothesis } from "../hypotheses";
import { persistModelUpdate } from "../materialImport";
import { prepareThreeCards, threeCardSpecs, threeCardsRoadmapTitle } from "./competitorOwnerTests";

async function main(){
  if(process.env.NODE_ENV!=="development"||!isDevDatabase)throw Error("Dev database only");
  await dbReady;if(!pool)throw Error("Database unavailable");
  const {rows}=await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  if(rows.length!==1)throw Error("Ambiguous owner");
  const check=process.argv.includes("--check"),today=new Date().toISOString().slice(0,10);
  const root=await unpackModel(pool,rows[0].owner_key,rows[0].state);
  const saved=check?prepareThreeCards(root,rows[0].owner_key,today):
    await persistModelUpdate(pool,rows[0].owner_key,s=>prepareThreeCards(s,rows[0].owner_key,today),true);
  const m=readHypothesis(saved,"new-country");
  console.log(JSON.stringify({savedAndReread:!check,revision:saved.revision,operatingVersion:m.operatingModel!.revisions.at(-1)!.version,
    analystPassportVersion:m.analystPreparation!.revisions.at(-1)!.version,roadmap:m.documents.find(d=>d.title===threeCardsRoadmapTitle)?.id,
    cards:threeCardSpecs.map(s=>{const r=m.competitorDirectory!.records.find(r=>r.revisions.at(-1)!.snapshot.appStore.includes(`/id${s.appId}`))!;const v=r.revisions.at(-1)!;
      return {id:r.id,version:v.version,name:v.snapshot.name,task:v.snapshot.dossier!.offerFacts.find(f=>f.id==="owner-manual-test")?.title};}),
    idempotent:prepareThreeCards(saved,rows[0].owner_key,today)===saved,liveTestsPerformed:false,workersStarted:false}));
}
main().catch(e=>{console.error(e instanceof Error?e.message:"Update failed");process.exitCode=1;}).finally(async()=>{await pool?.end();});
