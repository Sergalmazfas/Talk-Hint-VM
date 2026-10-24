import { fieldsSchema, mergeFields, missingFields, warnings, outcome, type Settings, type Fields, type Turn } from "./policy";
import type { RequestStore } from "./store";

/** Same persistence/validation policy for telephone runtime and isolated preview. */
export class IntakeSession {
  constructor(readonly owner: string, readonly callSid: string, readonly settings: Settings, readonly store: RequestStore) {}
  async begin() {
    const r=await this.store.begin(this.owner,this.settings.numberId,this.callSid);
    if(r.timeZone!==undefined||r.closed)return r;
    return this.store.update(this.owner,this.callSid,r=>({...r,timeZone:null,
      missing:missingFields(r.fields,this.settings)}));
  }
  async turn(turn: Turn) {
    return this.store.update(this.owner,this.callSid,r => {
      if(r.turns.some(t=>t.id===turn.id))return r;
      if(r.turns.length>=1000)throw new Error("Transcript safety limit reached");
      return {...r,turns:[...r.turns,turn]};
    });
  }
  async callerStarted() {
    return this.store.update(this.owner,this.callSid,r=>{
      if(r.closed)return r;
      const fields={...r.fields,reviewed:false};
      return {...r,fields,missing:missingFields(fields,this.settings),status:"collecting"};
    });
  }
  async save(input: unknown, submit = false) {
    const patch=fieldsSchema.parse(input);
    const request=await this.store.update(this.owner,this.callSid,r => {
      if (r.closed) return r;
      const fields: Fields=mergeFields(r.fields,patch), missing=missingFields(fields,this.settings);
      const turns=[...r.turns];
      if(patch.language)for(let i=turns.length-1;i>=0;i--)if(turns[i].role==="caller"){
        turns[i]={...turns[i],language:patch.language};break;
      }
      return {...r,fields,missing,turns,
        status:submit ? (missing.length ? "incomplete" : "pending_owner") : "collecting",
        outcome: outcome(fields.language,submit&&missing.length===0)};
    });
    return {saved:true,request,missing:request.missing,warnings:warnings(request.fields,this.settings),bookingConfirmed:false};
  }
  async end(reason: string) {
    return this.store.update(this.owner,this.callSid,r => r.closed ? r : ({
      ...r,closed:true,endReason:reason, missing:missingFields(r.fields,this.settings),
      status:r.status==="pending_owner"&&["completed","connection ended"].includes(reason) ? "pending_owner" : "incomplete",
      outcome:outcome(r.fields.language,r.status==="pending_owner"&&["completed","connection ended"].includes(reason)),
    }));
  }
}
