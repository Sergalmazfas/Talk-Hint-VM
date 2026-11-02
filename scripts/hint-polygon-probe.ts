/** ONE distinct compatibility probe, no call audio, no retry, shared $15 ledger. */
import { writeFileSync,existsSync } from "node:fs";
import { Ledger } from "../server/hintPolygon/ledger";
import { chat } from "../server/hintPolygon/provider";
import { BASELINE } from "../server/hintPolygon/contracts";
const path="generated-artifacts/hint-polygon/compatibility-probe.json";
if(existsSync(path))throw Error("PROBE_ALREADY_ATTEMPTED_DO_NOT_REPEAT");
writeFileSync(path,JSON.stringify({status:"attempting",purpose:"new minimal request; not a repeat of unknown call judge"}),{mode:0o600,flag:"wx"});
const l=new Ledger("generated-artifacts/hint-polygon/series-ledger.json");
try{
  const result=await chat(l,"compatibility-gpt-4.1-mini-minimal-v1","judge",{
    model:BASELINE.judgeModel,max_tokens:32,messages:[{role:"user",content:"Reply with just {}."}],
  });
  writeFileSync(path,JSON.stringify({status:"success",model:result.model,usage:result.usage,requestId:result.requestId,
    httpStatus:result.httpStatus,cost:result.cost,seriesHeldMicro:l.held()},null,2),{mode:0o600});
}catch(e){
  writeFileSync(path,JSON.stringify({status:"failed",reason:(e as Error).message,
    entry:l.snapshot().entries.at(-1),seriesHeldMicro:l.held()},null,2),{mode:0o600});
}finally{l.close();}
console.log("Compatibility probe completed; sanitized result in generated-artifacts/hint-polygon/compatibility-probe.json");
