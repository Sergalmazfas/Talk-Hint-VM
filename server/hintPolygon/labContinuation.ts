import{sha,BASELINE,type Recipe}from"./contracts";
import type{Row}from"./metrics";
/** Permission to EXPERIMENT is not acceptance of LIVE parity or the product. */
export function verifyLabContinuation(proof:any,corpusHash:string,rows:Row[],baseline:Recipe=BASELINE){
 const g=proof?.groups?.[0];
 if(proof?.corpusHash!==corpusHash||proof.capMicro!==15_000_000||proof.groups.length!==1||
  g?.group!=="saved-goal"||g.complete!==true||g.expected!==15||g.completed!==rows.length||
  rows.length+g.withheld.length!==15||g.validCalls<1||g.qualityCoverage!==g.validCalls||
  !Number.isFinite(g.timings?.firstHintWord?.p50Ms)||g.timings.firstHintWord.p50Ms<=0)
  throw Error("MEASURED_BASELINE_EVIDENCE_INCOMPLETE");
 const expectedRecipe=sha(JSON.stringify(baseline));
 if(rows.some(r=>r.corpusHash!==corpusHash||r.recipeHash!==expectedRecipe||
  !g.review.some((e:any)=>e.fixtureId===r.fixtureId&&e.rawHash===sha(JSON.stringify(r)))))
  throw Error("BASELINE_ROW_OR_RECIPE_CHANGED");
 return{status:"owner_authorized_lab_continuation",corpusHash,evidenceHash:sha(JSON.stringify(proof)),
  liveParityVerified:false,productAcceptance:false,limitMicro:15_000_000,
  authority:"owner: after measured baseline, continue experimental recipes without more button presses within the same $15",
  caveat:"server timings only; does not accept LIVE/UI equivalence; invalid calls and unknown expenses remain visible"};
}
