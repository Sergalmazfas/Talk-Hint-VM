/** One descriptive MCP packet, no retries, no live/runtime settings. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const root="generated-artifacts/hint-polygon/team";
await mkdir(root,{recursive:true});
const save=(name,data)=>writeFile(`${root}/${name}.json`,JSON.stringify(data,null,2));
const hash=text=>createHash("sha256").update(text).digest("hex");
const canon=value=>Array.isArray(value)?value.map(canon):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canon(value[k])])):value;
const equal=(a,b)=>assert.deepEqual(canon(a),canon(b));
try{await readFile(`${root}/attempt.json`);throw Error("PRIOR_ATTEMPT_NO_RETRY");}catch(e){if(e.code!=="ENOENT")throw e;}
await save("attempt",{time:new Date().toISOString(),expectedRevision:1192,noRetry:true});
async function rpc(name,args) {
  const r=await fetch("https://talkhint.app/api/product-crew/mcp",{method:"POST",
    headers:{"Content-Type":"application/json","X-API-Key":process.env.PRODUCT_CREW_KEY},
    body:JSON.stringify({jsonrpc:"2.0",id:randomUUID(),method:"tools/call",params:{name,arguments:args}}),
    signal:AbortSignal.timeout(150000)});
  if(!r.ok)throw Error(`HTTP_${r.status}_${name}_NO_RETRY`);
  const j=await r.json();if(j.error||j.result?.isError)throw Error(`MCP_REFUSAL_${name}`);
  return JSON.parse(j.result.content[0].text);
}
let revision=1192;
const journal=[];
const roles=[
  ["laboratory-engineer-role","DOC-PLAB-PROMPT-PROPOSAL","Замир"],
  ["lg-qa-role","DOC-PLG-QA-PROMPT-PROPOSAL","Фома"],
  ["product-manager-specialist","DOC-TEAM-PPRODUCT","Паша"],
  ["head-product","DOC-TEAM-HEAD06","Мария"],
];
async function doc(id){
  const d=await rpc("get_document",{documentId:id});
  assert.equal(d.revision,revision);assert.equal(d.snapshotHash,hash(d.text));return d;
}
async function write(name,body,commands,beforeHash){
  const requestId=randomUUID(),before=revision;
  const entry={name,requestId,revisionBefore:before,commands,beforeHash,status:"attempting"};
  journal.push(entry);await save("journal",journal);
  const result=await rpc(name,{...body,revision:before,requestId});
  await save(`receipt-${journal.length}`,result);
  assert.equal(result.saved,true);assert.equal(result.launched,false);assert.notEqual(result.replayed,true);
  assert.equal(result.revision,before+commands);
  assert(result.record.coordination.operations.some(o=>o.id===requestId));
  revision=result.revision;Object.assign(entry,{revisionAfter:revision,status:"saved_needs_readback"});await save("journal",journal);
  return result;
}
try{
  const list=await fetch("https://talkhint.app/api/product-crew/mcp",{method:"POST",
    headers:{"Content-Type":"application/json","X-API-Key":process.env.PRODUCT_CREW_KEY},
    body:JSON.stringify({jsonrpc:"2.0",id:randomUUID(),method:"tools/list"}),signal:AbortSignal.timeout(30000)});
  assert(list.ok);const listed=await list.json();
  for(const name of ["create_work","submit_result","update_employee_sections"])assert(listed.result.tools.some(t=>t.name===name));
  await save("tools",listed.result);
  const team=await rpc("get_team",{});assert.equal(team.revision,revision);
  const manifest=JSON.parse(await readFile("generated-artifacts/hint-polygon/private-manifest.json","utf8"));
  const profiles={};
  for(const [role,id]of roles){const d=await doc(id);profiles[role]=d;await save(`${id}-before`,d);}
  const packet={
    format:"talkhint.stage.review-result",accepted:false,runtimeChanged:false,sourceDecision:"Владелец: новый изолированный полигон Hint, рядом со старым, сначала А, серия до $15.",
    sourceRevision:revision,sourceHashes:Object.fromEntries(roles.map(([role,id])=>[id,profiles[role].snapshotHash])),
    documents:{
      "new-hint-polygon":{status:"phase-a-in-progress",ownerRole:"laboratory-engineer-role",source:"server/hintPolygon; scripts/hint-polygon.ts",
        corpus:{recordings:36,corpusHash:manifest.corpusHash,durationMinutes:96.1896,vad:"automatic per channel, not human verified",missingGoals:21},
        method:{replayRate:1,eotThreshold:.7,eotTimeoutMs:3000,model:"gpt-5.6-terra",maxOutputTokens:250,judgeModel:"gpt-4.1-mini",
          clocks:["physical VAD speech end","STT final","parsed first English word","full hint","translation"],
          independentJudge:true,invalidExcludedFromSpeedQuality:true,invalidCostsRetained:true,unknownNeverRetried:true},
        status:"Baseline not yet independently verified. Other recipes/adapters not implemented/locked. Backend-ready timing is not iPhone screen timing.",
        ownership:["Замир → независимая проверка Фомы → Паша → Мария → владелец"],
        pashaWeekly:{frequency:"weekly",count:3,output:"три идеи улучшения Hint с источниками → Марии",webSearchAllowed:true,status:"described; scheduler not enabled"},
        priorContractDocumentId:"DOC-PC-d46a6112-aec3-48f7-98d5-8e077f4e725b",
        isolation:"Старый стенд и рабочий Hint не изменять. Ни продукт, ни live-промпт не включать без отдельного да владельца.",
        budget:"$15 all trials/diagnostics together; local persistent reserve-before-request ledger; not company runtime limits"},
      "knowledge-zamir-proposals":{status:"proposed",acceptedBy:null,runtimeInjected:false,mergedIntoOriginalBook:false,
        bookDocumentId:"DOC-PC-11c0b66c-e5c7-49d3-9e5f-2cef5621b47f",lessons:[
          {id:"POLYGON-LIVE-ABSTENTION",text:"Повторять живую нормализацию: отдельная пустая подсказка на приветствие — не ошибка стрима; 0 подсказок за весь прогон — недействителен. Судить все guest-final, включая пропущенные вопросы.",status:"proposed",acceptedBy:null},
          {id:"POLYGON-PROVIDER-CONTRACT",text:"Проверять параметры API до резерва. JSON mode требует явной инструкции JSON. HTTP/request-id и очищенный текст ошибки сохранять; неизвестный исход не бесплатный и не повторяется.",status:"proposed",acceptedBy:null},
          {id:"POLYGON-LIVE-PARITY",text:"Не считать backend-ready временем показа на iPhone. Диапазон 2–5с не доказывает parity; учитывать несохранённые цели, карточки и стратегию исторического звонка.",status:"proposed",acceptedBy:null}]},
      "knowledge-foma-proposals":{status:"proposed",acceptedBy:null,runtimeInjected:false,mergedIntoOriginalBook:false,
        bookDocumentId:"DOC-PC-1d862fd6-7ab5-4d37-ba1d-11d33609b4bf",lessons:[
          {id:"QA-POLYGON-COVERAGE",text:"Проверять не только скорость выданных подсказок: считать все guest-final, отказы и пропущенные вопросы; независимый судья получает также пустые ответы.",status:"proposed",acceptedBy:null},
          {id:"QA-POLYGON-INVALIDS",text:"Битый/пустой/обрезанный/без доверенного тайминга прогон не участвует в скорости и качестве; его стоимость и причина остаются. Unknown не обнулять и не повторять под новым UUID.",status:"proposed",acceptedBy:null},
          {id:"QA-POLYGON-PROVENANCE",text:"Сверять corpus/audio/VAD/goal/code/prompt hash и профиль запроса. Неполный live-контекст и автоматический VAD явно ограничивают выводы; нет самоприёмки базовой линии.",status:"proposed",acceptedBy:null}]},
    },
  };
  const text=JSON.stringify(packet);
  const created=await write("create_work",{title:"Новый полигон Hint: изоляция, метод и предложенные уроки",description:packet.sourceDecision,
    client:"Сергей — владелец",need:"Один честный полигон и проверяемая цепочка команды без изменения рабочего Hint.",
    roleId:"product-manager-specialist",processId:"lab-action-method",relatedIds:roles.map(r=>r[0]),
    nextStep:"Сохранить описательный пакет и рабочие места; проверка Клавдия отдельно.",
    expectedResult:"Зафиксированный корпус/метод, предлагаемые уроки, недельные идеи Паши и границы.",
    acceptance:"Владелец после независимой проверки; самоприёмки нет."},1,hash(JSON.stringify(team)));
  let check=await rpc("get_work",{recordId:created.record.id});assert.equal(check.revision,revision);
  journal.at(-1).status="readback_verified";await save("journal",journal);
  const submitted=await write("submit_result",{recordId:created.record.id,title:"Новый полигон Hint: этап А и знания (предложено)",text,nextStep:"Продолжить только лабораторную проверку А; B–F не включать без честного baseline."},2,hash(JSON.stringify(check)));
  const documentId=`DOC-PC-${journal.at(-1).requestId}`;
  const result=await doc(documentId);assert.equal(result.text,text);await save("package-after",result);
  journal.at(-1).status="readback_verified";await save("journal",journal);
  for(const [role,id,name]of roles){
    const before=await doc(id);assert.equal(before.snapshotHash,profiles[role].snapshotHash);
    const p=JSON.parse(before.text),workplace=structuredClone(p.employeeSections.workplace);
    workplace.description+="\nНовый изолированный полигон: server/hintPolygon, офлайн 1x; старый стенд и рабочий Hint не изменяются. Сначала проверка А, другие рецепты до неё заблокированы.";
    workplace.sourceDocumentIds.push(documentId);
    if(role==="product-manager-specialist")workplace.outputs.push("Раз в неделю — три идеи улучшения Hint с источниками → Марии; веб-поиск разрешён. Здесь описано, автопланировщик не включается.");
    assert(workplace.description.length<=4000&&workplace.outputs.length<=20&&workplace.sourceDocumentIds.length<=30);
    await write("update_employee_sections",{roleId:role,profileHash:before.snapshotHash,
      reason:`${name}: описать новый инструмент/полигон и связать предложенные знания; личности, рабочие промпты, модели и права не менять.`,
      ownerDecisionRef:packet.sourceDecision,sections:{workplace}},2,before.snapshotHash);
    const after=await doc(id),a=JSON.parse(after.text);
    assert.equal(a.version,p.version+1);equal(a.employeeSections.workplace,workplace);
    for(const v of [a,p]){delete v.version;delete v.employeeSections.workplace;}equal(a,p);
    await save(`${id}-after`,after);journal.at(-1).status="readback_verified";journal.at(-1).afterHash=after.snapshotHash;await save("journal",journal);
  }
  assert.equal(revision,1203);
  await save("completed",{revision,fromRevision:1192,commands:11,calls:6,documentId,hash:result.snapshotHash,
    allReadbacksPassed:true,oldBooksRewritten:false,agentsLaunched:false,promptsChanged:false,modelsChanged:false});
  console.log(JSON.stringify({status:"completed",revision,documentId}));
}catch(e){await save("STOP",{revision,error:e.message,journal,repeatForbidden:true});console.error("STOP",e.message);process.exitCode=1;}
