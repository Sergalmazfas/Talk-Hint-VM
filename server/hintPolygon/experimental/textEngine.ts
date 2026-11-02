import{performance}from"node:perf_hooks";
import type{Fixture}from"../replay";
import type{Ledger}from"../ledger";
import{sha,type Recipe}from"../contracts";
import{chat,parseHint,promptRequest}from"../provider";
import{buildOpenAIChatBody}from"../../hintProvider";
import type{HintEngine,EngineHint}from"./engine";
import{streamHint}from"./stream";
type Card={id:string;triggers:string[];en:string;native:string};
export function parseCards(text:string):Card[]{
 let root:any;try{root=JSON.parse(text);}catch{throw Error("INVALID_CARDS_JSON");}
 if(!Array.isArray(root.cards)||!root.cards.length||root.cards.length>12)throw Error("INVALID_CARDS");
 const seen=new Set<string>();
 for(const c of root.cards){
  if(typeof c.id!=="string"||!/^[a-z0-9_-]{1,24}$/i.test(c.id)||seen.has(c.id)||
   typeof c.en!=="string"||!c.en.trim()||c.en.length>300||typeof c.native!=="string"||c.native.length>600||
   !Array.isArray(c.triggers)||!c.triggers.length||c.triggers.some((x:any)=>typeof x!=="string"||x.length>80))
   throw Error("INVALID_CARD");
  seen.add(c.id);
 }
 return root.cards;
}
const words=(t:string)=>t.toLowerCase().replace(/[^a-z0-9 ]/g," ").split(/\s+/).filter(Boolean);
export function localCard(text:string,cards:Card[]):Card|null{
 const tokens=new Set(words(text));let best:Card|null=null,score=0;
 for(const c of cards){
  const terms=Array.from(new Set(c.triggers.flatMap(words)));
  const s=terms.length?terms.filter(w=>tokens.has(w)).length/terms.length:0;
  if(s>score&&s>=.25){score=s;best=c;}
 }
 return best;
}
/** Conservative free lookup, never the retired paid classifier. */
export function addonCard(text:string,cards:Card[]):Card|null{
 if(/\b(no|not|never|cannot|can't|don't|doesn't|won't|unavailable|cancel)\b/i.test(text))return null;
 const stop=new Set(["a","an","the","is","are","you","your","i","we","it","to","for","of","and","can","do","please"]);
 const tokens=new Set(words(text).filter(w=>!stop.has(w)));
 let best:Card|null=null,bestScore=0;
 for(const card of cards){
  const terms=Array.from(new Set(card.triggers.flatMap(words).filter(w=>!stop.has(w))));
  const matches=terms.filter(w=>tokens.has(w)).length,score=terms.length?matches/terms.length:0;
  if(matches>=2&&score>=.75&&score>bestScore){best=card;bestScore=score;}
 }
 return best;
}
const compact="For this English-first experiment, return JSON with translation=\"\" and suggestion={en: one concise English reply, translation:\"\"}. No Russian in this first stage. Preserve factual grounding and allow en=\"\" when no reply is needed.";
const plan="Create at most 8 useful, specific reply cards BEFORE a call, using ONLY its saved goal. Never invent names, dates, bookings, prices or answers absent from that goal. Prefer safe questions. Output JSON {cards:[{id, triggers:[English keyword], en:short English reply, native:Russian translation}]}. No future utterances or recordings are available.";
const classifier="Choose one suitable precomputed reply for the LAST guest utterance. Return JSON {card_id:string|null}. Null if none fits or this is only an acknowledgement. Never rewrite a card.";
export function textEngine(f:Fixture,r:Recipe,ledger:Ledger,run:string):HintEngine{
 const prefix=`${run}-${f.id}`,audit:unknown[]=[];
 let cards:Card[]=[];
 type Spec={text:string;history:string;promise:Promise<void>;result?:any;error?:Error;used:boolean};
 const specs=new Map<string,Spec>(),previous=new Map<string,string>();
 let fatal:Error|undefined;
 const full=(text:string,history:string)=>promptRequest(r,text,f.goal,history);
 const ordinary=async(id:string,text:string,history:string)=>{
  const req=full(text,history),v=await chat(ledger,id,"brain",req.body,f.id,parseHint),h=v.prepared as ReturnType<typeof parseHint>;
  return{...h,firstAt:v.readyAt,fullAt:v.readyAt,translationAt:h.translation?v.readyAt:null,
   inputTokens:v.usage.prompt_tokens,outputTokens:v.usage.completion_tokens,systemHash:req.systemHash,systemChars:req.systemChars};
 };
 const settled=async()=>{await Promise.all(Array.from(specs.values(),s=>s.promise));};
 return{
  async open(){
   if(!["precomputed","classifier-card","hint-first-cards"].includes(r.architecture))return;
   const began=performance.now();
   const body=buildOpenAIChatBody(r.model,plan,"Saved goal:\n"+f.goal,1200);
   const value=await chat(ledger,`${prefix}-cards`,"brain",body,f.id,parseCards);
   cards=value.prepared as Card[];audit.push({stage:"goal-only-precompute",cards:cards.length,usage:value.usage,
    systemHash:sha(plan),systemChars:Array.from(plan).length,cardsHash:sha(JSON.stringify(cards)),precomputeMs:performance.now()-began});
  },
  frame(){},owner(){},
  partial(turnKey,text,history){
   if(r.architecture!=="speculative"||fatal||turnKey==="unknown"||specs.has(turnKey))return;
   const w=words(text),old=previous.get(turnKey);previous.set(turnKey,w.join(" "));
   if(w.length<5||!old||!w.join(" ").startsWith(old))return;
   const s:Spec={text:w.join(" "),history,promise:Promise.resolve(),used:false};specs.set(turnKey,s);
   s.promise=ordinary(`${prefix}-spec-${turnKey}`,text,history+"\nGuest: "+text)
    .then(v=>{s.result=v;}).catch(e=>{s.error=e;fatal=e;});
  },
  async generate(turnId,text,history,turnKey){
   if(fatal)throw fatal;
   if(r.architecture==="hint-first"||r.architecture==="hint-first-cards"){
    const req=full(text,history),body=buildOpenAIChatBody(r.model,req.system+"\n"+compact,req.user,r.maxOutputTokens);
    const card=r.architecture==="hint-first-cards"?addonCard(text,cards):null;
    const now=performance.now();
    if(r.architecture==="hint-first-cards")audit.push({stage:"card-decision",turnId,hit:!!card,cardIdHash:card?sha(card.id):null,source:card?"card":"stream"});
    // A miss runs EXACTLY V, never abstains. A hit still translates the Guest
    // using the same second stage; it does not remove translation coverage.
    const a=card?{en:card.en,firstAt:now,fullAt:now,usage:{prompt_tokens:0,completion_tokens:0}}:
      await streamHint(ledger,`${run}-${turnId}-english`,body,f.id);
    const t=buildOpenAIChatBody(r.model,
      "Translate only supplied text into Russian. Return JSON {translation:Russian guest utterance,native:Russian English-reply translation}. No additional commentary.",
      JSON.stringify({guest:text,english:a.en}),250);
    const b=await chat(ledger,`${run}-${turnId}-russian`,"brain",t,f.id,text=>{
     let x:any;try{x=JSON.parse(text);}catch{throw Error("INVALID_TRANSLATION_JSON");}
     if(typeof x.native!=="string"||typeof x.translation!=="string")throw Error("INVALID_TRANSLATION_SCHEMA");
     return x as{native:string;translation:string};
    }),h=b.prepared as{native:string;translation:string};
    return{en:a.en,native:h.native,translation:h.translation,firstAt:a.firstAt,fullAt:a.fullAt,
     translationAt:b.readyAt,inputTokens:a.usage.prompt_tokens+b.usage.prompt_tokens,
     outputTokens:a.usage.completion_tokens+b.usage.completion_tokens,
     systemHash:sha(card?"card-lookup:"+sha(JSON.stringify(cards)):req.system+"\n"+compact),
     systemChars:card?0:Array.from(req.system+"\n"+compact).length};
   }
   if(r.architecture==="precomputed"||r.architecture==="classifier-card"){
    let card:Card|null,at:number;
    let inputTokens=0,outputTokens=0;
    if(r.architecture==="precomputed"){card=localCard(text,cards);at=performance.now();}
    else{
     const body=buildOpenAIChatBody(r.model,
      classifier,
      JSON.stringify({goal:f.goal,cards:cards.map(({native,...c})=>c),history,lastGuest:text}),32);
     const value=await chat(ledger,`${run}-${turnId}-classify`,"brain",body,f.id,t=>{
      let x:any;try{x=JSON.parse(t);}catch{throw Error("INVALID_CLASSIFICATION");}
      if(x.card_id!==null&&!cards.some(c=>c.id===x.card_id))throw Error("UNKNOWN_CARD_ID");return x.card_id;
     });
     card=cards.find(c=>c.id===value.prepared)??null;at=value.readyAt;
     inputTokens=value.usage.prompt_tokens;outputTokens=value.usage.completion_tokens;
    }
    return{en:card?.en??"",native:card?.native??"",translation:"",firstAt:at,fullAt:at,
     translationAt:card?at:null,inputTokens,outputTokens,
     systemHash:sha(r.architecture==="precomputed"?"no-model-lookup:"+sha(JSON.stringify(cards)):classifier),
     systemChars:r.architecture==="precomputed"?0:Array.from(classifier).length};
   }
   if(r.architecture==="speculative"){
    const s=turnKey?specs.get(turnKey):undefined;
    const index=history.lastIndexOf("\nGuest: ");
    const beforeGuest=index>=0?history.slice(0,index).trim():history.startsWith("Guest: ")?"":history.trim();
    if(s&&s.text===words(text).join(" ")&&s.history.trim()===beforeGuest){
     const release=performance.now();s.used=true;await s.promise;if(s.error)throw s.error;
     const h=s.result as EngineHint;
     // Held until final EOT; never display a prediction before its validation.
     return{...h,firstAt:Math.max(h.firstAt,release),fullAt:Math.max(h.fullAt,release),
      translationAt:h.translationAt===null?null:Math.max(h.translationAt,release)};
    }
    return ordinary(`${run}-${turnId}-final`,text,history);
   }
   throw Error("UNIMPLEMENTED_TEXT_ARCHITECTURE");
  },
  async settle(){await settled();if(fatal)throw Error("SPECULATIVE_PROVIDER_FAILURE_"+fatal.message);},
  async close(){await settled();},
  audit:()=>[...audit,...Array.from(specs.entries(),([key,s])=>({stage:"speculation",turnKey:key,used:s.used,error:s.error?.message??null}))],
  metadata:()=>({systemHash:sha((["hint-first","hint-first-cards"].includes(r.architecture)?full("","").system+"\n"+compact:
    r.architecture==="speculative"?full("","").system:plan)+"\n"+f.goal),
   systemChars:Array.from(["hint-first","hint-first-cards"].includes(r.architecture)?full("","").system+"\n"+compact:
    r.architecture==="speculative"?full("","").system:plan).length,
   promptVersion:"experimental-"+r.architecture+"-"+r.prompt+"-"+sha(["hint-first","hint-first-cards"].includes(r.architecture)?compact:plan).slice(0,16),
   contextProvenance:r.architecture==="precomputed"||r.architecture==="classifier-card"?
    "goal-only cards before replay; no future Guest data; classifier sees actual final history":
    r.architecture==="speculative"?"real Flux Update only; exact-text+history reuse after EOT; mismatches discarded and paid":
    r.architecture==="hint-first-cards"?"goal-only cards; conservative local match else unchanged English-first; Guest Russian preserved":
    "real Terra English SSE first; separate Terra Russian request; no live product mutation"}),
 };
}
