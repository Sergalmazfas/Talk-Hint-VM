/** OFFLINE counter. Never imported by the app; no provider/DB/call writes.
 * stdin accepts LENGTH-PRESERVING MASKED facts, not private call content. */
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";
import { execFileSync } from "node:child_process";
import { confirmedSecretaryOwnerName } from "../server/secretary/ownerIdentity";

const input=JSON.parse(fs.readFileSync(0,"utf8"));
const file=path.resolve("server/secretaryLab/speedExperiment.ts");
function count(source:string) {
  const limit=Number(source.match(/export const COMPACT_PROMPT_LIMIT = (\d+);/)?.[1] ?? 5000);
  const check=[
    'if (instructions.length > 5000) throw Error(`COMPACT_PROMPT_EXCEEDS_5000:${instructions.length}`);',
    'if (instructions.length > COMPACT_PROMPT_LIMIT) throw Error(`${COMPACT_PROMPT_FALLBACK_REASON}:${instructions.length}`);'
  ].find(line=>source.includes(line));
  if (!check) throw Error("AUDIT_TEMPLATE_CHANGED");
  source=source.replace(check,"/* OFFLINE audit records oversize; runtime guard is unchanged. */")
    .replace("return { instructions, prefix,",`return { instructions, prefix, components: {
      rules: (typeof phonePolicy !== "undefined" ? phonePolicy : compactPolicy).length,
      identity: identity.length, character: style.length,
      ivr: (input.telephone ? IVR_INSTRUCTIONS : compactIvr).length },`);
  const m:any=new Module(file);m.filename=file;m.paths=(Module as any)._nodeModulePaths(path.dirname(file));
  m._compile(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
  const p=m.exports.compactSpeedPrompt({owner:confirmedSecretaryOwnerName(input.ownerId),
    personality:input.personality,plan:{assignment:input.instruction,authorizedCards:input.cards},
    runtimeUtc:"2026-11-04T00:00:00.000Z",telephone:true});
  const assignment=JSON.stringify(input.instruction).length,cards=JSON.stringify(input.cards).length;
  return {components:{...p.components,assignment,cards,framing:p.chars-
    Object.values(p.components).reduce((a:any,b:any)=>a+b,0)-assignment-cards},
    compactLimit:limit,total:p.chars,prefix:p.prefix.length,excess:Math.max(0,p.chars-limit),
    planCapacity:limit-p.prefix.length-(p.chars-p.prefix.length-assignment-cards),
    prefixFitsAlone:p.prefix.length<=limit};
}
console.log(JSON.stringify({source:"Read-only latest Pilot preparation; values masked, UTF-16/JSON escape lengths preserved",
  published:count(execFileSync("git",["show","HEAD:server/secretaryLab/speedExperiment.ts"],{encoding:"utf8"})),
  preparedChecklistVersion:count(fs.readFileSync(file,"utf8")), taskFields:input.taskFieldLengths},null,2));
