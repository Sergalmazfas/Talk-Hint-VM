import { afterEach, describe, expect, it, vi } from "vitest";
import { legacySecretaryPlan, secretaryInstruction, callPlanSchema } from "../../shared/callPlan";
import { voicemailChoice, voicemailPolicy, voicemailMessageLeft, voicemailAnnouncement } from "./voicemail";
import { SecretaryConversationEngine } from "./conversationEngine";
import { parseSecretaryEndRequest } from "./callEnding";
import { secretaryEvidence } from "../aiCrew/secretaryReview";
import { renderProcessLetter } from "../callLab/processReport";
import { retellPhoneMonitoring } from "./retellMonitor";
import { secretaryActionReport } from "../team/actionReports";
import { detectHintIncident } from "../callLab/watchdog";
const announcement="Please leave your message after the beep.";
const base=legacySecretaryPlan("Tell him payment is complete. Ask whether he has questions.", "+15550000001");
const instruction=(voicemail?:"leave"|"skip")=>secretaryInstruction({...base,...(voicemail?{voicemail}:{})});
afterEach(()=>vi.useRealTimers());
describe("Voicemail owner decisions, evidence and reporting",()=>{
  it.each(["leave","skip"] as const)("round-trips owner decision %s without new permissions",mode=>{
    expect(voicemailChoice(instruction(mode))).toBe(mode);
    expect(voicemailPolicy(instruction(mode))).toContain(mode==="leave"?"ONE message":"no speech");
    expect(callPlanSchema.safeParse({...base,voicemail:"invent"}).success).toBe(false);
  });
  it("omitted decision never grants disclosure of task details",()=>{
    expect(voicemailChoice(instruction())).toBeUndefined();
    expect(voicemailPolicy(instruction())).toContain("NO task details or facts");
    expect(voicemailPolicy(instruction("leave"))).toContain("ENTIRE exact single message");
  });
  it("does not classify a human request or silence as an announcement",()=>{
    expect(voicemailAnnouncement("Please repeat the number.")).toBe(false);
    expect(voicemailAnnouncement("")).toBe(false);
    expect(voicemailAnnouncement(announcement)).toBe(true);
  });
  it("skip is silent and immediate, without a silence/IVR gate or model",async()=>{
    vi.useFakeTimers();
    const stream=vi.fn(async function*(){yield{type:"complete" as const,output:[],tools:[]};});
    const engine=new SecretaryConversationEngine("fixture",instruction("skip"),stream,true);
    const emit=vi.fn();let ended=false;
    const pending=engine.respond([{role:"user",content:announcement}],new AbortController().signal,emit).then(v=>{ended=true;return v;});
    expect(await pending).toEqual({reason:"follow_up",farewell:""});
    expect(ended).toBe(true);
    expect(stream).not.toHaveBeenCalled();expect(emit).not.toHaveBeenCalled();
  });
  it("interruption aborts the voicemail gate without speech or end",async()=>{
    vi.useFakeTimers();const controller=new AbortController(),stream=vi.fn(async function*(){});
    const engine=new SecretaryConversationEngine("fixture",instruction("leave"),stream,true),emit=vi.fn();
    const pending=engine.respond([{role:"user",content:announcement}],controller.signal,emit);
    controller.abort();expect(await pending).toBeUndefined();expect(emit).not.toHaveBeenCalled();
  });
  it("allows a complete voicemail as one farewell but keeps ordinary end bounds",()=>{
    const raw={reason:"follow_up",farewell:"a".repeat(400)};
    expect(parseSecretaryEndRequest(raw)).toBeUndefined();expect(parseSecretaryEndRequest(raw,true)?.farewell).toHaveLength(400);
    expect(parseSecretaryEndRequest({...raw,farewell:"a".repeat(2001)},true)).toBeUndefined();
  });
  it("message left requires actual subsequent speech, not merely reaching voicemail",()=>{
    const turns=[{role:"guest",text:announcement},{role:"secretary",text:"Please call back. Goodbye."}];
    expect(voicemailMessageLeft(instruction(),turns)).toBe(true);
    expect(voicemailMessageLeft(instruction(),turns.slice(0,1))).toBe(false);
    expect(voicemailMessageLeft(instruction("skip"),turns)).toBe(false);
    expect(voicemailMessageLeft(instruction(),[...turns,{role:"guest",text:"Hello, I am here now."}])).toBe(false);
    const task={id:"t",call_sid:"c",user_id:"u",phone_number:base.targetPhone,instruction:instruction(),
      transcript_turns:turns,stream_ended_at:"2026-11-04T19:00:00Z"};
    const report=secretaryActionReport({call_sid:"c",user_id:"u"},task)!;
    expect(report.outcome).toBe("message_left");expect(report.assigned).not.toContain('{"goal"');
  });
  it("lab distinguishes voicemail from a returning human",()=>{
    const e=secretaryEvidence(instruction(),[{role:"guest",text:announcement},{role:"secretary",text:"Goodbye"}],"fixture");
    expect(e.voicemail).toBe(true);expect(e.pointKinds).toEqual(["say","ask"]);
    expect(secretaryEvidence(instruction(),[...e.transcript,{speaker:"guest",text:"Hello, I am here."}],"fixture").voicemail).toBe(false);
  });
  it("preserves owner/Katya and gives a recognized full/short private name one stable tag",()=>{
    const e=secretaryEvidence("Ask the question",[{role:"guest",text:"This is John Smith. This is John."},
      {role:"secretary",text:"This is Katya. My name is Sergey."}],"fixture",[],["Sergey"]);
    const tags=e.transcript[0].text.match(/\[ENTITY_\d+\]/g)!;
    expect(tags).toHaveLength(2);expect(tags[0]).toBe(tags[1]);
    expect(e.transcript[1].text).toContain("Katya");expect(e.transcript[1].text).toContain("Sergey");
  });
  it("initial monitor is unknown/connecting, never falsely terminal-unavailable",()=>{
    expect(retellPhoneMonitoring("never-started-fixture").sourceConnected).toBeUndefined();
    expect(retellPhoneMonitoring("never-started-fixture").sourceReconnectSupported).toBe(false);
  });
  it("uses the longer Secretary chain grace and ignores saved/mailed reports",()=>{
    const now=Date.parse("2026-11-04T19:00:00Z"),old=new Date(now-127000).toISOString();
    const row={call_sid:"fixture",ended_at:old,closed_at:null,job_key:"j",job_status:"pending",
      job_created:old,job_updated:old,execution:null,qa_status:null,mail_status:null,mail_updated:null};
    expect(detectHintIncident({...row,lab_mode:"secretary"},now)).toBeNull();
    expect(detectHintIncident({...row,lab_mode:"hint"},now)?.code).toBe("QUEUE_DELAY");
    expect(detectHintIncident({...row,has_report:true},now)).toBeNull();
    expect(detectHintIncident({...row,mail_status:"sent_confirmed"},now)).toBeNull();
    expect(detectHintIncident({...row,lab_mode:"secretary",job_created:new Date(now-601000).toISOString()},now)?.code).toBe("QUEUE_DELAY");
  });
  it("mail is three lines, a short typed table and private link, not full JSON analysis",()=>{
    const metricReason = "Независимая проверка полного разговора. ".repeat(8) + "КОНЕЦ_ОБЪЯСНЕНИЯ";
    const report={mode:"secretary",environment:"production",private_report_path:"/api/admin/call-lab/reports/"+"a".repeat(64),
      action_reports:[{id:"x",at:"2026-11-04T19:00:00Z",role:"SECRETARY",assigned:"Tell payment complete",outcome:"message_left",
        succeeded:["FULL_PRIVATE_ANALYSIS"],failed:[],needsOwner:[],source:"fixture"}],
      secretary_summary:{learned:"Message left",wentWrong:"No human answer",nextAction:"Wait for callback"},
      secretaryReview:{checklist:[{index:0,item:"Tell payment complete",kind:"say",closed:true,quote:"Payment complete"}],
        metrics:{reviewer:[{metric:"repeats",actual:0,status:"сошлось",reason:metricReason}]}}};
    const body=renderProcessLetter(report).body;
    expect(body.split("\n").slice(0,3)).toEqual(["Что узнали: Message left","Что пошло не так: No human answer","Что сделать: Wait for callback"]);
    expect(body).toContain("сказать | да");expect(body).toContain("repeats: 0 — сошлось");
    expect(body).toContain(metricReason);
    expect(body).toContain(report.private_report_path);expect(body).not.toContain("FULL_PRIVATE_ANALYSIS");expect(body).not.toContain('{"');
  });
});
