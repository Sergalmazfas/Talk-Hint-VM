import { describe, expect, it } from "vitest";
import { savedHistoryContent } from "../../apps/secretary-mobile/src/historyContent";

describe("mobile saved history rendering content",()=>{
  it("shows the saved call transcript and summary without a linked Secretary report",()=>{
    expect(savedHistoryContent({summary:"Caller asked about hours",transcript:"Здравствуйте. ¿Abierto? ¡Sí!"},null)).toEqual({
      callSummary:"Caller asked about hours",callTranscript:"Здравствуйте. ¿Abierto? ¡Sí!",taskSummary:"",taskTranscript:"",
    });
  });
  it("keeps saved call content when its linked report fails to load",()=>{
    const call={secretaryTaskId:"unavailable",status:"failed",summary:"Partial result",transcript:"Saved before disconnection"};
    expect(savedHistoryContent(call,null).callTranscript).toBe("Saved before disconnection");
    expect(savedHistoryContent(call,null).callSummary).toBe("Partial result");
  });
  it("shows both sources when a linked report has additional or different results",()=>{
    expect(savedHistoryContent({summary:"Call result",transcript:"Original call text"},{summary:"Verified task outcome",transcript:"Enriched task transcript"})).toEqual({
      callSummary:"Call result",callTranscript:"Original call text",taskSummary:"Verified task outcome",taskTranscript:"Enriched task transcript",
    });
  });
  it("does not duplicate identical linked transcripts and summaries",()=>{
    const same={summary:"Same summary",transcript:"Same text"};
    expect(savedHistoryContent(same,same)).toEqual({
      callSummary:"Same summary",callTranscript:"Same text",taskSummary:"",taskTranscript:"",
    });
  });
  it("shows task-only history and does not fabricate absent call results",()=>{
    expect(savedHistoryContent(null,{summary:"Task only",transcript:"Task text"})).toEqual({
      callSummary:"",callTranscript:"",taskSummary:"Task only",taskTranscript:"Task text",
    });
    expect(savedHistoryContent({summary:null,transcript:null},null)).toEqual({
      callSummary:"",callTranscript:"",taskSummary:"",taskTranscript:"",
    });
  });
});
