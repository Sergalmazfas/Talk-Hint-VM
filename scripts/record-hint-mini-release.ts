/** Only existing Dev documents; no runtime settings, phone, email or model calls. */
import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {Pool} from "pg";
import {unpackModel} from "../server/projectModel/history";
import {persistModelUpdate} from "../server/projectModel/materialImport";
import {applyHypothesisCommand,readHypothesis} from "../server/projectModel/hypotheses";
import {ProductCrewService} from "../server/productCrew/service";
const dir="generated-artifacts/hint-unknown-owner-rule-v1";
assert.equal(new URL(process.env.DATABASE_URL!).hostname,"helium");
const pool=new Pool({connectionString:process.env.DATABASE_URL});
try{
 const result=await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
 (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) a WHERE a->>'id'='new-country')`);
 assert.equal(result.rows.length,1);
 const owner=result.rows[0].owner_key;
 const before=readHypothesis(await unpackModel(pool,owner,result.rows[0].state),"new-country");
 const ids=["DOC-HINT-UNIFIED-REPLAY","DOC-HINT-UNIFIED-RESCORE-PREFLIGHT","DOC-TALKHINT-IMPROVEMENT-JOURNAL"];
 const docs=ids.map(id=>{const d=before.documents.find(d=>d.id===id);assert(d);return d;});
 const [p,d,j]=docs.map(d=>JSON.parse(d.text));
 const marker="hint-mini:dev-release-and-unknown-state-rule-v1";
 assert(!p.executionHistory.some((x:any)=>x.marker===marker));
 const summary=JSON.parse(await readFile(`${dir}/SUMMARY.json`,"utf8"));
 const plan=JSON.parse(await readFile(`${dir}/PREFLIGHT.json`,"utf8"));
 assert(summary.accountedUSD<=5);
 const pilot=d.personalPilot;
 assert(pilot?.status==="prepared_not_activated");
 pilot.version++;
 pilot.status="dev_prepared_not_activated";
 pilot.candidate.supportedByExistingPersonalSelector=true;
 pilot.candidate.readinessScope="Dev code and offline tests only; not published or activated";
 pilot.technicalReadiness.miniRejectedByCurrentValidator=false;
 pilot.technicalReadiness.preparedCodeChangesApplied=true;
 pilot.technicalReadiness.blocker="До пилота: Publish владельцем; включена production-лаборатория; реальные письма приходят; подтверждены профиль/модель/телеметрия контрольного звонка. Пилот сейчас выключен.";
 pilot.technicalReadiness.completedDevWork=[
  "Mini разрешена только точному владельческому account ID; GET/PUT и повторная проверка при загрузке звонка.",
  "Кнопка Вернуть Terra — одна личная настройка, без смены STT и чужих аккаунтов.",
  "Офлайн-тесты маршрутов, подделанного userId, неизвестной модели, аутентификации и сохранения исходного выключенного флага."
 ];
 pilot.proposedDesign.approved=true;
 pilot.proposedDesign.ownerSource="28.10.2026: сценарий Terra → Mini → Mini → Terra принимаю; только после работающей production-лаборатории и писем.";
 pilot.proposedDesign.moneyStatus="Разрешён только стенд правила до $5. Расходы будущих живых звонков этим разрешением не покрываются.";
 pilot.activationState.runtimeCodeChanged=true;
 pilot.productionPrerequisites={labEnabled:null,emailDeliveryVerified:null,gateOpen:false,
  meaning:"Production readiness not checked here; activation remains gated, unknown is not false."};
 pilot.ownerAuthorization.latestScope="Dev diff и стенд разрешены; включение/новые звонки/Publish исполнителем не разрешены.";
 d.version++;p.version++;j.version++;
 p.personalPilot={...p.personalPilot,version:pilot.version,status:pilot.status,documentVersion:d.version,enabled:false,blocker:pilot.technicalReadiness.blocker};
 const {scope,ownerApprovedPilotOrder,pilotGate,verdict,...boundedSummary}=summary;
 p.unknownOwnerRuleBench={...boundedSummary,ruleText:plan.rule,ownerAuthorization:"Да, до $5",
  productionPromptChanged:false,canonicalResult:"P.LAB: не рекомендовать внедрение правила по этому прогону; решения владельца о внедрении нет."};
 p.executionHistory.push({at:new Date().toISOString(),marker,role:"HEAD.07 / P.LAB / P.PRODUCT",
  outcome:"Dev diff prepared; pilot order approved, activation off; text-only rule bench completed. QA/owner effect acceptance not simulated."});
 const c=j.cases.find((x:any)=>x.caseId==="HINT-MODEL-HISTORY-001");assert(c);c.unifiedReplayVersion=p.version;
 const values=[p,d,j];
 const titles=[`Hint — единая линейка моделей — v${p.version} — Dev Mini и проверка правила`,
  `Hint — калибровка и досверка — v${d.version} — личный пилот v${pilot.version}, выключен`,
  `TalkHint — журнал улучшений — v${j.version}`];
 const changes=docs.map((doc,i)=>({doc,title:titles[i],text:JSON.stringify(values[i])}));
 assert(changes.every(x=>x.text.length<=50000),changes.map(x=>`${x.doc.id}:${x.text.length}`).join(","));
 await persistModelUpdate(pool,owner,root=>{
  assert.equal(readHypothesis(root,"new-country").revision,before.revision);
  for(const x of changes)root=applyHypothesisCommand(root,"new-country",{type:"saveDocument",id:x.doc.id,
   title:x.title,text:x.text,url:x.doc.url,elementIds:x.doc.elementIds},"HEAD.07 / P.LAB: "+marker);
  return root;
 },true);
 const fresh=await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1",[owner]);
 const after=readHypothesis(await unpackModel(pool,owner,fresh.rows[0].state),"new-country");
 assert.deepEqual(after.operatingModel,before.operatingModel);
 for(const doc of before.documents)if(!ids.includes(doc.id))assert.deepEqual(after.documents.find(x=>x.id===doc.id),doc);
 const svc=new ProductCrewService({read:async()=>after,update:async()=>{throw Error("read only");}});
 for(const x of changes)assert.equal((await svc.call(owner,"get_document",{documentId:x.doc.id})).text,x.text);
 await writeFile(`${dir}/PILOT-v2.json`,JSON.stringify(pilot,null,2));
 await writeFile(`${dir}/READBACK.json`,JSON.stringify({revision:after.revision,sourceRevision:before.revision,
  versions:{parent:p.version,appendix:d.version,journal:j.version,pilot:pilot.version},readerVerified:true,
  operatingModelUnchanged:true,otherDocumentsUnchanged:true,livePilotEnabled:false,productionChanged:false},null,2));
 console.log(JSON.stringify({revision:after.revision,versions:values.map(x=>x.version),chars:changes.map(x=>x.text.length)}));
}finally{await pool.end();}
