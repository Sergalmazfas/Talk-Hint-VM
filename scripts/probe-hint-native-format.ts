/** One synthetic protocol control, no call/goal data. Same $15 series ledger. */
import{openSync,writeFileSync,closeSync}from"node:fs";
import{Ledger}from"../server/hintPolygon/ledger";
import{NativeHints}from"../server/hintPolygon/experimental/realtime";
import{sha}from"../server/hintPolygon/contracts";
const root="generated-artifacts/hint-polygon",path=`${root}/native-format-control.json`;
const fd=openSync(path,"wx",0o600);writeFileSync(fd,JSON.stringify({status:"started",noRetry:true}));closeSync(fd);
const ledger=new Ledger(`${root}/series-ledger.json`,true),audio=Buffer.alloc(3200,255);
const native=new NativeHints(ledger,"native-format-v1","synthetic-format-control",sha(audio),
 'You are an API format control, not a phone agent. Return only this JSON: {"translation":"","suggestion":{"en":"Hello.","translation":"Здравствуйте."}}. Do not call tools.',128);
try{
 await native.open();
 native.owner("This is a synthetic format check. Reply with the JSON in the system instruction.");
 for(let off=0;off<audio.length;off+=160){native.append(audio.subarray(off,off+160));await new Promise(r=>setTimeout(r,20));}
 const result=await native.generate("control","synthetic control; not a call transcript");
 const report={status:"completed",model:result.model,nonemptyEnglish:!!result.en,
  inputTokens:result.usage.input_tokens,outputTokens:result.usage.output_tokens,
  ownEntries:ledger.snapshot().entries.filter(e=>e.id.startsWith("native-format-v1-")),
  noCallData:true,noRetry:true};
 writeFileSync(path,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(e){
 const report={status:"failed",error:(e as Error).message,noRetry:true,
  ownEntries:ledger.snapshot().entries.filter(e=>e.id.startsWith("native-format-v1-"))};
 writeFileSync(path,JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exitCode=1;
}finally{await native.close();await ledger.close();}
