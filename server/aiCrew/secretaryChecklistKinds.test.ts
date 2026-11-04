import { describe, it, expect } from "vitest";
import { initialState } from "./domain";
import { configureSecretary, queueSecretaryReview, secretaryEvidence, finishSecretaryRun, SECRETARY_AGENTS } from "./secretaryReview";
import { mannerKinds, secretaryOutputSchema, validSecretaryOutput } from "./secretaryOutput";
import { legacySecretaryPlan, secretaryInstruction, type CallPlan } from "../../shared/callPlan";

const at="2026-11-04T19:00:00Z";
const thought="Объясни, что Сергей оплатил $207.57 сам; сервис ошибочно оставил счёт открытым";
const manners=mannerKinds.map(kind=>({kind,value:0,quote:"",turn:-1,reason:"No occurrence"}));
function fixture(goal:string,kind:string,turn:number,closed=true) {
  const s=initialState();
  configureSecretary(s,true,20e6,"fixture-owner",at,SECRETARY_AGENTS.map(a=>a.modelId),1e6);
  // Both sides say the same words: checking only substring presence is insufficient.
  const evidence=secretaryEvidence(goal,[{role:"guest",text:"Paid $207.57"},{role:"secretary",text:"Paid $207.57"}],"fixture");
  const t=queueSecretaryReview(s,"fixture-owner","fixture",evidence,
    Object.fromEntries(SECRETARY_AGENTS.map(a=>[a.agentId,{traits:["a","b","c"],motto:"fixture"}])),at);
  t.secretaryReview!.outputVersion=2;
  const dialogue={checklist:[{index:0,kind,answer:"Paid $207.57",closed,quote:"Paid $207.57",turn}],
    katyaTurns:1,excessTurns:0,hypothetical:true,ideal:[]};
  const a={points:[{index:0,kind,status:closed?"выполнено":"не проверено",quote:"Paid $207.57",turn,reason:"Source quote"}],
    openingLanguage:"en",recognitionIssues:[],unverified:[],manners,dialogue,proposals:[],expectationChecks:[]};
  return {s,t,a};
}
describe("Checklist type, closure evidence and preservation",()=>{
  it("keeps the invoice explanation as one structural thought through storage and lab evidence",()=>{
    const p:CallPlan={goal:"Notify recipient",sayAsk:[thought,"Спроси, получил ли квитанцию"],ownerFacts:[],
      expectedQuestions:[],unknowns:[],disclosurePolicy:{allowed:[thought],forbidden:["Не платить повторно"]},
      language:"ru",executor:"secretary",targetPhone:"+15550001111"};
    const instruction=secretaryInstruction(p);
    const saved=JSON.parse(instruction.slice(instruction.indexOf("\n")+1));
    expect(saved).toEqual(p);
    const e=secretaryEvidence(instruction,[{role:"guest",text:"Да"}],"fixture");
    expect(e.points).toEqual(p.sayAsk);expect(e.pointKinds).toEqual(["say","ask"]);
  });
  it("preserves the same free-text complete thought and refuses overlength thoughts instead of chopping them",()=>{
    expect(legacySecretaryPlan(thought,"+15550001111").sayAsk).toEqual([thought]);
    expect(()=>legacySecretaryPlan("Объясни "+"слово ".repeat(90),"+15550001111")).toThrow("Complete plan item too long");
  });
  it.each([
    ["Explain that payment is complete","say",1,true],
    ["Explain that payment is complete","say",0,false],
    ["Ask whether payment is complete","ask",0,true],
    ["Ask whether payment is complete","ask",1,false],
    ["Invoice","unknown",0,false],
    ["Explain that payment is complete","ask",0,false],
  ])("%s / %s requires the right speaker and kind", (goal,kind,turn,valid)=>{
    const {s,t,a}=fixture(goal,kind,turn);
    finishSecretaryRun(s,t,"author",JSON.stringify(a),at);
    expect(t.secretaryReview!.authorValid).toBe(valid);
  });
  it("an honest guest unknown closes ASK, not success of the assignment",()=>{
    const {s,t,a}=fixture("Ask whether payment is complete","ask",0);
    t.secretaryReview!.evidence.transcript[0].text="I don't know";
    a.points[0]={...a.points[0],status:"нет",quote:"I don't know"};
    a.dialogue.checklist[0]={...a.dialogue.checklist[0],answer:"Unknown",quote:"I don't know"};
    finishSecretaryRun(s,t,"author",JSON.stringify(a),at);
    expect(t.secretaryReview!.authorValid).toBe(true);
  });
  it("an unclassified point stays open and explicitly unverified",()=>{
    const {s,t,a}=fixture("Invoice","unknown",0,false);
    finishSecretaryRun(s,t,"author",JSON.stringify(a),at);
    expect(t.secretaryReview!.authorValid).toBe(true);
  });
  it("does not accept completed status while the dialogue checklist remains open",()=>{
    const {s,t,a}=fixture("Explain that payment is complete","say",1,false);
    a.points[0].status="выполнено";
    finishSecretaryRun(s,t,"author",JSON.stringify(a),at);
    expect(t.secretaryReview!.authorValid).toBe(false);
  });
  it.each([0,1])("Toma independently needs a secretary citation for SAY, turn=%s",turn=>{
    const {s,t,a}=fixture("Explain that payment is complete","say",1);
    finishSecretaryRun(s,t,"author",JSON.stringify(a),at);
    expect(t.secretaryReview!.authorValid).toBe(true);
    const review={verdict:"confirmed",checks:a.points.map(({status,...row})=>row),disagreements:[],unverified:[],manners,
      dialogue:{...a.dialogue,checklist:[{...a.dialogue.checklist[0],turn}]},expectationChecks:[]};
    finishSecretaryRun(s,t,"review",JSON.stringify(review),at);
    expect(t.secretaryReview!.verdict).toBe(turn===1?"confirmed":"not_confirmed");
  });
  it("requires type in both structured model responses, not merely in prose",()=>{
    for(const stage of ["author","review"]) {
      const schema:any=secretaryOutputSchema(stage);
      expect(schema.properties.dialogue.properties.checklist.items.required).toContain("kind");
      expect(schema.properties[stage==="author"?"points":"checks"].items.required).toContain("kind");
    }
    const {a}=fixture("Ask whether payment is complete","ask",0);
    const withoutKind=structuredClone(a) as any;delete withoutKind.dialogue.checklist[0].kind;
    expect(validSecretaryOutput("author",withoutKind)).toBe(false);
  });
});
