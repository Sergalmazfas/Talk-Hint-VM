import {describe,it,expect} from "vitest";
import {validateV3} from "../../scripts/unified-hint-rescore-checks";
const reference={ownerEvidence:[]};
function verdict(quote:string,inventedFacts:boolean,speakingForOwner:boolean,status="unsupported"){
 return {goal:"yes",goalFactsUse:"not_needed",goalScore:8,usefulnessScore:5,inventedFacts,speakingForOwner,
  claims:[{path:"cards[0].en",quote,kind:"fact",status,sourceId:null}],reason:"Offline contract control"};
}
describe("unknown-owner rubric: independent dimensions",()=>{
 it("permits an invented third-party fact without speaking for owner",()=>{
  const en="You have read my photos.";
  expect(validateV3(verdict(en,true,false),{type:"direct",cards:[{en}]},reference)).toEqual([]);
 });
 it("permits both flags for an unsupported owner-state assertion",()=>{
  const en="I see the button.";
  expect(validateV3(verdict(en,true,true),{type:"direct",cards:[{en}]},reference)).toEqual([]);
 });
 it("does not treat conditional choice options as asserted facts",()=>{
  const en="I see the button.";
  expect(validateV3(verdict(en,false,false,"conditional"),{type:"choice",cards:[{en}]},reference)).toEqual([]);
 });
});
