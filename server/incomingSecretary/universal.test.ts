import {expect,it,vi} from "vitest";
vi.mock("../db",()=>({pool:null}));
import {allowedCards,buildInstructions,defaults} from "./policy";
import {liveConfig} from "./liveAudio";
import {IntakeSession} from "./session";
import {MemoryRequests} from "./store";
it.each([
  ["Massage","Massage by appointment; Tue–Sun 08:00–22:00; travel 30 minutes."],
  ["Children's centre","Children's art workshops, Monday 09:00–12:00, at our centre; ask age group."],
  ["Repair service","Truck inspection and inverter repairs. Phone consultations, Monday 07:00–18:00."],
])("uses only the approved %s card, with no second questionnaire or business default",(title,body)=>{
  const settings={...defaults("work"),timeZone:"Pacific/Honolulu",
    business:{days:[1],opens:"03:17",closes:"04:19",travelMinutes:137},cardIds:["mine"]};
  const cards=[{id:"mine",userId:"alice",profileScope:"work",title,body},
    {id:"foreign",userId:"bob",profileScope:"work",title:"FOREIGN",body:"FOREIGN SECRET"},
    {id:"private",userId:"alice",profileScope:"personal",title:"PRIVATE",body:"PRIVATE SECRET"},
    {id:"unapproved",userId:"alice",profileScope:"work",title:"UNAPPROVED",body:"UNAPPROVED SECRET"}];
  const instructions=buildInstructions(settings,allowedCards(cards,"alice",settings.cardIds));
  expect(instructions).toContain(JSON.stringify({title,body}));
  expect(instructions).not.toMatch(/Pacific\/Honolulu|03:17|04:19|FOREIGN SECRET|PRIVATE SECRET|UNAPPROVED SECRET/);
  // Exclude only the separate runtime UTC line, never business-card content.
  const businessInstructions=instructions.replace(/^Current UTC time \(not the business timezone\): .+$/m,"");
  if(title!=="Massage")expect(businessInstructions).not.toMatch(/massage|30 minutes|08:00|22:00/);
});
it("has no industry-specific voice-layer instruction in addition to backend facts",()=>{
  const instructions=buildInstructions(defaults("dev-sandbox"),[]).replace(/^Current UTC time \(not the business timezone\): .+$/m,"");
  const config=JSON.stringify(liveConfig(instructions));
  expect(config).not.toMatch(/massage|Monday|Tue.Sun|30 minutes|08:00|22:00|future mobile/);
  expect(config).toContain("ONLY source");expect(config).toContain("virtual secretary");
});
it.each(["2026-10-26T22:00:08.301Z","2026-10-26T04:00:00.000Z","2026-10-26T05:00:00.000Z"])("distinguishes UTC clock %s from invented business hours",(utc)=>{
  const clock=vi.spyOn(Date.prototype,"toISOString").mockReturnValue(utc);
  try {
    const instructions=buildInstructions(defaults("dev-sandbox"),[]);
    expect(instructions).toContain(`Current UTC time (not the business timezone): ${utc}.`);
    const business=instructions.replace(/^Current UTC time \(not the business timezone\): .+$/m,"");
    expect(business).not.toMatch(/08:00|22:00|04:00|05:00|30 minutes/);
  } finally { clock.mockRestore(); }
});
it("can save a general callback request without inventing an address, appointment duration or timezone",async()=>{
  const session=new IntakeSession("alice","isolated-general-request",defaults("work"),new MemoryRequests());
  await session.begin();
  const r=await session.save({name:"Ana",phone:"+15550000001",callbackConfirmed:true,language:"es",notes:"¿Ofrecen clases de dibujo?",reviewed:true},true);
  expect(r.request.status).toBe("pending_owner");expect(r.missing).toEqual([]);expect(r.bookingConfirmed).toBe(false);
  expect(r.request.fields.address).toBeUndefined();expect(r.request.fields.durationMinutes).toBeUndefined();
  expect(r.request.timeZone).toBeNull();
});
