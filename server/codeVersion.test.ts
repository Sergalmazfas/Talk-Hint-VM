import { describe, it, expect } from "vitest";
import { codeVersion, recordedCallVersion, stampCallMetadata } from "./codeVersion";
import { modeNotice } from "./callLab/policy";
import { authorizedHintSource } from "./callLab/source";
describe("recorded call-start code version",()=>{
 it("stamps all new calls and keeps other metadata; fake supplied version cannot override",()=>{
  const m=stampCallMetadata({mode:"secretary",codeVersion:{commit:"fake"}});
  expect(m.mode).toBe("secretary");expect(m.codeVersion).toMatchObject({commit:codeVersion().commit,sourceHash:codeVersion().sourceHash});
  expect(m.codeVersion).not.toHaveProperty("fixes");expect(m.codeVersion).not.toHaveProperty("taskRef");
  expect(m.codeVersion.sourceHash).toMatch(/^[a-f0-9]{64}$/);
 });
 it("never attributes old calls to the later analysis code",()=>{
  expect(recordedCallVersion({metadata:{}})).toBeNull();
  const call={call_sid:"fixture",lab_mode:"secretary",ended_at:"2026-11-01",metadata:{codeVersion:{commit:"older"}}};
  expect(modeNotice(call,"production").code_version).toEqual({commit:"older"});
 });
 it("Hint source carries the stored version, not currently executing build",()=>{
  const source=authorizedHintSource({user_id:"owner",call_sid:"f",lab_mode:"hint",started_at:"2026-11-01T01:00Z",
   ended_at:"2026-11-01T01:01Z",transcript:"test",metadata:{codeVersion:{commit:"call-start"}}},
  {enabled:true,owner_id:"owner",environment:"production",activated_at:"2026-11-01T00:00Z"},"production");
  expect(source?.code_version).toEqual({commit:"call-start"});
 });
});
