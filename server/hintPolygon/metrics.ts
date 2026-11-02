import { percentile } from "./contracts";
export type Turn = {
  turnId: string; speechEndMs: number|null; sttFinalMs: number; firstWordMs: number|null;
  fullHintMs: number|null; translationMs: number|null; valid: boolean; reason?: string;
  systemHash: string; systemChars: number; inputTokens?:number; outputTokens?:number;
};
export type Row = {
  fixtureId:string; recipeId:string; corpusHash:string; recipeHash:string; codeCommit:string;
  valid:boolean; reasons:string[]; turns:Turn[]; quality:number|null;
  chargedMicro:number; costBasis:string; clockMaxDriftMs:number; durationMs:number;
  contextProvenance:string; judgeModel:string; promptVersion:string;
  sttEvidence?: {
    windows:{role:string;startMs:number;endMs:number;receivedMs:number;hasText:boolean}[];
    tail:{role:string;lastVadEndMs:number;lastFinalAudioEndMs:number;covered:boolean}[];
  };
};
export function summarize(rows: Row[], expectedCorpusSize: number) {
  const good=rows.filter(r=>r.valid);
  const turns=good.flatMap(r=>r.turns).filter(t=>t.valid && t.speechEndMs!==null);
  const metric=(key:"sttFinalMs"|"firstWordMs"|"fullHintMs"|"translationMs")=>{
    const v=turns.filter(t=>t[key]!==null).map(t=>t[key]!-t.speechEndMs!).filter(x=>x>=0);
    return {n:v.length,p50Ms:percentile(v,.5),p95Ms:percentile(v,.95)};
  };
  return {
    attempted:rows.length,expectedCorpusSize,validCalls:good.length,invalidCalls:rows.length-good.length,
    guestFinals:rows.reduce((s,r)=>s+r.turns.length,0),
    deliveredHints:rows.reduce((s,r)=>s+r.turns.filter(t=>t.fullHintMs!==null).length,0),
    abstentions:rows.reduce((s,r)=>s+r.turns.filter(t=>t.reason==="NO_HINT_FOR_TURN").length,0),
    timings:{stt:metric("sttFinalMs"),firstHintWord:metric("firstWordMs"),fullHint:metric("fullHintMs"),translation:metric("translationMs")},
    quality:good.some(r=>r.quality!==null)?good.reduce((s,r)=>s+(r.quality??0),0)/good.filter(r=>r.quality!==null).length:null,
    chargedMicro:rows.reduce((s,r)=>s+r.chargedMicro,0),
    // Invalid attempts cost money too; do not hide that in "price per call".
    meanCostPerAttemptMicro:rows.length?rows.reduce((s,r)=>s+r.chargedMicro,0)/rows.length:null,
    status:"not_live_parity_verified",
    nextRecipesAllowed:false,
    reason:rows.length<expectedCorpusSize?"CORPUS_INCOMPLETE":"Need matched production telemetry/context and independent method review; 2–5s alone is not live parity proof.",
  };
}
