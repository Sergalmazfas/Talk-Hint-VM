import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../apps/secretary-mobile/src/config",()=>({
  defaultApiOrigin:()=>"https://talkhint.app",validateOrigin:(v:string)=>v,
}));
vi.mock("../../apps/secretary-mobile/src/storage",()=>({
  originStorage:{get:async()=>null,set:async()=>{},clear:async()=>{}},
  tokenStorage:{get:async()=>"scoped-session"},
}));
import { api, setApiOrigin, isLiveMode } from "../../apps/secretary-mobile/src/api";
const fetchMock=vi.fn();
beforeEach(async()=>{
  vi.stubGlobal("fetch",fetchMock);fetchMock.mockReset();
  await setApiOrigin("https://talkhint.app");
});
it("uses explicit live endpoints only after server capability discovery",async()=>{
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({testOnly:false,callingMode:"live"})));
  await api.me();expect(isLiveMode()).toBe(true);
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({id:"live:review",testOnly:false})));
  await api.prepare({clientRequestId:"id",recipient:"Demo",phoneNumber:"+12025550123",instruction:"Hours",cardIds:[]});
  expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("https://talkhint.app/api/mobile-secretary/live/prepare");
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({task:{status:"starting"}})));
  await api.confirmTask("live:review");
  expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("/live-reviews/live%3Areview/confirm");
  expect(JSON.parse(fetchMock.mock.calls.at(-1)?.[1].body)).toEqual({confirmRealCall:true});
});
it("never upgrades a saved TEST review into a real call",async()=>{
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({testOnly:false,callingMode:"live"})));
  await api.me();
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({task:{status:"completed"}})));
  await api.confirmTask("old-test-id");
  expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("/test-tasks/old-test-id/confirm");
  expect(JSON.parse(fetchMock.mock.calls.at(-1)?.[1].body)).toEqual({});
});
it("defaults to TEST against older servers and resets capability on backend changes",async()=>{
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({testOnly:true})));
  await api.me();expect(isLiveMode()).toBe(false);
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({id:"test"})));
  await api.prepare({clientRequestId:"id",recipient:"Demo",phoneNumber:"+12025550123",instruction:"Hours",cardIds:[]});
  expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("https://talkhint.app/api/mobile-secretary/prepare");
  await setApiOrigin("https://different.example.test");expect(isLiveMode()).toBe(false);
});
