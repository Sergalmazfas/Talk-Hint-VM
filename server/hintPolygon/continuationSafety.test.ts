import{it,expect}from"vitest";
import{canContinueKnownFormatStop as check}from"./continuationSafety";
const bad={valid:false,reasons:["TURN_PROVIDER_FAILURE_INVALID_HINT_JSON"]};
it("allows only new recordings after known charged format failure, not unknown, reserve or transport failure",()=>{
 expect(check([{status:"spent"}],[bad,{valid:true,reasons:[]}])).toBe(true);
 for(const status of ["unknown","reserved"])expect(check([{status}],[bad])).toBe(false);
 for(const reason of ["REPLAY_CLOCK_DRIFT_OVER_300MS","TURN_PROVIDER_FAILURE_STREAM_HTTP_500","BAD_TURNS_OVER_30_PERCENT"])
  expect(check([{status:"spent"}],[{valid:false,reasons:[reason]}])).toBe(false);
 expect(check([],[bad])).toBe(false);
 expect(check([{status:"spent"}],[])).toBe(false);
});
