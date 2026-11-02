/** A known, charged format failure is not an unknown provider execution.
 * This permits OTHER, never-started recordings; never a retry of the failure. */
export function canContinueKnownFormatStop(
 entries:{status:string}[],
 rows:{valid:boolean;reasons:string[]}[],
):boolean{
 const failed=rows.filter(r=>!r.valid);
 return entries.length>0&&entries.every(e=>e.status==="spent")&&failed.length>0&&
  failed.every(r=>r.reasons.length===1&&r.reasons[0]==="TURN_PROVIDER_FAILURE_INVALID_HINT_JSON");
}
