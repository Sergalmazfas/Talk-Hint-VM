import{it,expect}from"vitest";
import{geminiCost}from"./geminiCost";
it("charges unclassified input and thinking conservatively, not as free tokens",()=>{
 expect(geminiCost({promptTokenCount:560,responseTokenCount:29,thoughtsTokenCount:42,
  promptTokensDetails:[{modality:"TEXT",tokenCount:313},{modality:"AUDIO",tokenCount:222}],
  responseTokensDetails:[{modality:"AUDIO",tokenCount:29}]})).toBe(1828);
 expect(geminiCost({promptTokenCount:100,responseTokenCount:10})).toBe(420);
});
it("fails closed on inconsistent or absent usage",()=>{
 expect(()=>geminiCost({})).toThrow("USAGE_UNKNOWN");
 expect(()=>geminiCost({promptTokenCount:1,responseTokenCount:0,promptTokensDetails:[{modality:"TEXT",tokenCount:2}]})).toThrow("INCONSISTENT");
});
