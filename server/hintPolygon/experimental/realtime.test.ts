import {describe,it,expect}from"vitest";
import{firstEnglishWord,nativeCost,parseNativeHint}from"./realtime";
it("accepts an exact native Markdown JSON envelope, never guesses JSON out of prose",()=>{
 const json='{"translation":"Да","suggestion":{"en":"Monday.","translation":"Понедельник."}}';
 expect(parseNativeHint("```json\n"+json+"\n```").en).toBe("Monday.");
 expect(()=>parseNativeHint("Here is what I suggest: "+json)).toThrow("INVALID_HINT_JSON");
});
describe("native prototype — no paid requests",()=>{
 it("does not call a JSON token, partial word, or translation an English hint",()=>{
  for(const text of ['{"translation":"Hello there"}','{"suggestion":{"en":"Hel','{"en":"Hello "}'])
   expect(firstEnglishWord(text)).toBeNull();
  expect(firstEnglishWord('{"suggestion":{"en":"Hello ')).toBe("Hello");
  expect(firstEnglishWord('{"suggestion":{"en":"Hello"}')).toBe("Hello");
 });
 it("accounts independently priced cached audio/text and text output",()=>{
  expect(nativeCost({input_tokens:100,output_tokens:10,
   input_token_details:{text_tokens:40,audio_tokens:60,cached_tokens:30,
    cached_tokens_details:{text_tokens:10,audio_tokens:20}},
   output_token_details:{text_tokens:10,audio_tokens:0}})).toBe(1652);
 });
 it("never invents unknown modality usage or drops undocumented cache",()=>{
  expect(()=>nativeCost({})).toThrow("NATIVE_USAGE_UNKNOWN");
  expect(()=>nativeCost({input_tokens:100,output_tokens:10,
   input_token_details:{text_tokens:40,audio_tokens:60,cached_tokens:30},
   output_token_details:{text_tokens:10,audio_tokens:0}})).toThrow("NATIVE_CACHED_USAGE_UNKNOWN");
 });
});
