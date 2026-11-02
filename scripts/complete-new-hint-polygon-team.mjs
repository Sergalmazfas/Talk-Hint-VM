// Resume ONLY distinct, still-unwritten roles after independently verified reads.
import fs from "node:fs/promises";
import {createHash,randomUUID}from"node:crypto";
import assert from"node:assert/strict";
const root="generated-artifacts/hint-polygon/team";
const save=(p,v)=>fs.writeFile(`${root}/${p}.json`,JSON.stringify(v,null,2));
const hash=t=>createHash("sha256").update(t).digest("hex");
try{await fs.readFile(`${root}/continuation.json`);throw Error("PRIOR_CONTINUATION_NO_RETRY");}catch(e){if(e.code!=="ENOENT")throw e;}
await save("continuation",{at:new Date().toISOString(),noRepeatOfPreviousCommands:true});
async function rpc(name,args){
 const r=await fetch("https://talkhint.app/api/product-crew/mcp",{method:"POST",headers:{"Content-Type":"application/json","X-API-Key":process.env.PRODUCT_CREW_KEY},
  body:JSON.stringify({jsonrpc:"2.0",id:randomUUID(),method:"tools/call",params:{name,arguments:args}}),signal:AbortSignal.timeout(150000)});
 if(!r.ok)throw Error(`HTTP_${r.status}_STOP`);const j=await r.json();if(j.error||j.result?.isError)throw Error("MCP_REFUSAL_STOP");return JSON.parse(j.result.content[0].text);
}
let revision=1199;
const journal=JSON.parse(await fs.readFile(`${root}/journal.json`,"utf8"));
const recovered=JSON.parse(await fs.readFile(`${root}/final-readbacks.json`,"utf8"));
assert.equal(journal.length,4);
assert(recovered.every(d=>d.revision===revision&&d.unchangedOutsideWorkplace));
assert(recovered[0].hasNewSource&&recovered[1].hasNewSource&&!recovered[2].hasNewSource&&!recovered[3].hasNewSource);
const documentId="DOC-PC-b656e602-9b5f-4f0d-9d72-e8ffff913b29";
const canon=v=>Array.isArray(v)?v.map(canon):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])])):v;
try{
 // Revalidate the interrupted call's complete postcondition; never resubmit it.
 for(const item of recovered.slice(0,2)){
   const d=await rpc("get_document",{documentId:item.documentId});assert.equal(d.revision,revision);assert.equal(hash(d.text),item.hash);
 }
 Object.assign(journal[3],{revisionAfter:revision,status:"readback_recovered_no_repeat",afterHash:recovered[1].hash,
   note:"Operator paused for source-ID verification; IDs confirmed. Exact profile postcondition and +2 revision independently read back; original HTTP receipt not retained."});
 await save("journal",journal);
 for(const [role,id,name]of[["product-manager-specialist","DOC-TEAM-PPRODUCT","Паша"],["head-product","DOC-TEAM-HEAD06","Мария"]]){
   const before=await rpc("get_document",{documentId:id});assert.equal(before.revision,revision);assert.equal(hash(before.text),before.snapshotHash);
   const original=JSON.parse(await fs.readFile(`${root}/${id}-before.json`,"utf8"));assert.equal(before.snapshotHash,original.snapshotHash);
   const p=JSON.parse(before.text),workplace=structuredClone(p.employeeSections.workplace);
   workplace.description+="\nНовый изолированный полигон: server/hintPolygon, офлайн 1x; старый стенд и рабочий Hint не изменяются. Сначала проверка А, другие рецепты до неё заблокированы.";
   workplace.sourceDocumentIds.push(documentId);
   if(role==="product-manager-specialist")workplace.outputs.push("Раз в неделю — три идеи улучшения Hint с источниками → Марии; веб-поиск разрешён. Здесь описано, автопланировщик не включается.");
   const requestId=randomUUID(),entry={name:"update_employee_sections",roleId:role,requestId,revisionBefore:revision,commands:2,beforeHash:before.snapshotHash,status:"attempting"};
   journal.push(entry);await save("journal",journal);
   const r=await rpc("update_employee_sections",{roleId:role,profileHash:before.snapshotHash,revision,requestId,
     reason:`${name}: описательная связь с новым полигоном; рабочие промпты, модели, личность и права не менять.`,
     ownerDecisionRef:"Владелец: новый изолированный полигон Hint, рядом со старым, сначала А, серия до $15.",sections:{workplace}});
   await save(`receipt-${journal.length}`,r);
   assert.equal(r.saved,true);assert.equal(r.launched,false);assert.notEqual(r.replayed,true);assert.equal(r.revision,revision+2);
   assert(r.record.coordination.operations.some(o=>o.id===requestId));revision=r.revision;
   const d=await rpc("get_document",{documentId:id});assert.equal(d.revision,revision);assert.equal(hash(d.text),d.snapshotHash);
   const a=JSON.parse(d.text);assert.equal(a.version,p.version+1);assert.deepEqual(canon(a.employeeSections.workplace),canon(workplace));
   for(const v of[a,p]){delete v.version;delete v.employeeSections.workplace;}assert.deepEqual(canon(a),canon(p));
   await save(`${id}-after`,d);Object.assign(entry,{revisionAfter:revision,afterHash:d.snapshotHash,status:"readback_verified"});await save("journal",journal);
 }
 assert.equal(revision,1203);
 await save("completed",{revision,fromRevision:1192,documentId,calls:6,commands:11,allReadbacksPassed:true,oldBooksRewritten:false,
   originalHttpReceiptForFoma:false,recoveredByIndependentRead:true,agentsLaunched:false,promptsChanged:false,modelsChanged:false});
 console.log(JSON.stringify({status:"completed",revision,documentId}));
}catch(e){await save("continuation-STOP",{revision,error:e.message,repeatForbidden:true});console.error("STOP",e.message);process.exitCode=1;}
