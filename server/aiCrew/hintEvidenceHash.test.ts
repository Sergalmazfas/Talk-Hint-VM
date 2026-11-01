import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { evidenceHash, projectHintEvidence } from "./hintEvidence";

const legacyHash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function reorder(v:any):any {
  if(Array.isArray(v))return v.map(reorder);
  return v&&typeof v==="object"?Object.fromEntries(Object.keys(v).reverse().map(k=>[k,reorder(v[k])])):v;
}
describe("Hint evidence hash v1 persistence",()=>{
  const evidence=()=>projectHintEvidence({calls:[{latency:{e2eP95Ms:4000},sla:1000}],
    reports:[{qa:"QA: принято",categories:["верная","неверная"]}],problems:[{code:"ANALYSIS_UNAVAILABLE",count:2}]});
  it("keeps legacy prepared hashes while ignoring object key order at every depth",()=>{
    const e=evidence();
    expect(evidenceHash(e)).toBe(legacyHash(e));
    expect(evidenceHash(reorder(e))).toBe(legacyHash(e));
  });
  it("does not ignore changed values, array order, missing or extra fields",()=>{
    const e=evidence(),hash=evidenceHash(e);
    const changed=evidence();changed.calls[0].latency.e2eP95Ms=4001;
    expect(evidenceHash(changed)).not.toBe(hash);
    const order=evidence();order.reports[0].findings.reverse();
    expect(evidenceHash(order)).not.toBe(hash);
    const missing:any=evidence();delete missing.calls[0].slaMs;
    expect(evidenceHash(missing)).not.toBe(hash);
    const extra:any=evidence();extra.calls[0].extra=1;
    expect(evidenceHash(extra)).not.toBe(hash);
    expect(evidenceHash(reorder(extra))).toBe(evidenceHash(extra));
  });
});
