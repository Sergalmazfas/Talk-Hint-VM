import { it, expect } from "vitest";
import { initialState } from "./domain";
import { recordSecretaryCallFact } from "./secretaryAutomation";
it("records every C report, including calls after five, once; unknown is not success",()=>{
  const s=initialState(),at="2026-11-04T19:00:00Z";
  for(let i=0;i<7;i++){
    s.tasks.push({id:"call"+i,steps:[{updatedAt:at}],secretaryReview:{status:"reported",evidence:{}}} as any);
    recordSecretaryCallFact(s,"call"+i,at,{ordinal:i+1,comparison:i===6?"не проверено":"сошлось"});
    recordSecretaryCallFact(s,"call"+i,at,{ordinal:i+1,comparison:"SHOULD NOT DUPLICATE"});
  }
  const rows=s.journal.filter(r=>r.kind==="katya_c_call_plan_fact_reported");
  expect(rows).toHaveLength(7);
  expect(JSON.stringify(rows)).not.toContain("SHOULD NOT DUPLICATE");
  expect(JSON.stringify(rows[6])).toContain("не проверено");
  expect(rows.every(r=>r.detail.ownerAcceptance===false)).toBe(true);
});
