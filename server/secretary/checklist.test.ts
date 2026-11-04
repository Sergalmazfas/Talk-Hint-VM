import { describe, it, expect } from "vitest";
import { splitCallChecklist, SECRETARY_CHECKLIST_POLICY } from "../../shared/callChecklist";
import { checklistCallPlan, secretaryInstruction, type CallPlan } from "../../shared/callPlan";
import { secretaryEvidence } from "../aiCrew/secretaryReview";
import { secretaryPhoneTools, secretaryTestTools } from "./conversationEngine";

const plan:CallPlan={goal:"Ask about NEW tires",ownerFacts:[],sayAsk:["Ask availability, brand, total price including installation and taxes, earliest arrival."],
  expectedQuestions:[],unknowns:[],disclosurePolicy:{allowed:[],forbidden:[]},language:"en",executor:"secretary",targetPhone:"+15551112222"};
describe("Owner-approved checklist preparation",()=>{
  it("splits a paragraph without inventing facts, losing tax constraints or tire size",()=>{
    const items=splitCallChecklist(["Ask availability, brand, total price including installation and taxes, earliest arrival."]);
    expect(items).toEqual(["Ask availability","brand","total price including installation and taxes","earliest arrival."]);
    expect(splitCallChecklist(["NEW 295/75 R22.5; confirm $1,500. Ask availability."]))
      .toEqual(["NEW 295/75 R22.5;","confirm $1,500.","Ask availability."]);
    expect(splitCallChecklist(["Узнать наличие, цену, когда можно приехать."]))
      .toEqual(["Узнать наличие","цену","когда можно приехать."]);
    expect(splitCallChecklist(["- 150 USD", "-150 USD", "295.75 USD", "1. 50 USD"]))
      .toEqual(["- 150 USD", "-150 USD", "295.75 USD", "1. 50 USD"]);
    expect(splitCallChecklist(["Ask if overnight parking is allowed, what it costs, and whether a spot can be reserved."]))
      .toEqual(["Ask if overnight parking is allowed","what it costs","and whether a spot can be reserved."]);
  });
  it("normalizes once before saving/confirmation, keeps the original goal and disclosure",()=>{
    const normalized=checklistCallPlan(plan);
    expect(normalized.sayAsk).toHaveLength(4);
    expect(checklistCallPlan(normalized)).toEqual(normalized);
    expect(normalized.goal).toBe(plan.goal);expect(normalized.disclosurePolicy).toEqual(plan.disclosurePolicy);
    const stored=secretaryInstruction(plan);
    const parsed=JSON.parse(stored.slice(stored.indexOf("\n")+1));
    expect(parsed.sayAsk).toEqual(normalized.sayAsk);
    expect(secretaryEvidence(stored,[{role:"guest",text:"Not sure"}],"fixture").points).toEqual(normalized.sayAsk);
  });
  it("treats an unknown answer as closed, not successful, preserves end playback/IVR safety",()=>{
    expect(SECRETARY_CHECKLIST_POLICY).toContain('closes that item as unknown, not as success');
    expect(SECRETARY_CHECKLIST_POLICY).toContain('no recap or "Is that right?"');
    expect(SECRETARY_CHECKLIST_POLICY).toContain("Never end during IVR, hold, transfer or silence");
    expect(secretaryPhoneTools[0].description).toContain("Playback must complete");
    expect(secretaryTestTools[0].description).not.toContain("No recap/Is that right");
  });
  it("does not truncate or invent a checklist if a long single goal needs owner clarification",()=>{
    const long={...plan,sayAsk:[],goal:"a".repeat(600)};
    expect(checklistCallPlan(long)).toEqual(long);
  });
});
