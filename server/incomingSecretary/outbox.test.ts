import { afterEach,it,expect,vi } from "vitest";
const mocks=vi.hoisted(()=>({query:vi.fn(),notify:vi.fn()}));
vi.mock("../db",()=>({pool:{query:mocks.query}}));
vi.mock("../storage",()=>({storage:{}}));
vi.mock("../secretary/notifications",()=>({notifySecretaryResult:mocks.notify}));
import { startIncomingNotifications } from "./runtime";
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllEnvs();});
it("retries owner-only ordinary alerts from the persisted closed-request outbox",async()=>{
  vi.useFakeTimers();vi.stubEnv("INCOMING_SECRETARY_RUNTIME_ENABLED","true");
  mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes("WITH candidate")?
    [{call_sid:"call",user_id:"owner",id:"request"}]:[]}));
  mocks.notify.mockRejectedValueOnce(new Error("No registered alert device")).mockResolvedValue(undefined);
  startIncomingNotifications();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(mocks.notify).toHaveBeenCalledWith("owner","request",true);
  expect(mocks.query.mock.calls.some(([sql])=>sql.includes("notification_status='failed'"))).toBe(true);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(mocks.notify).toHaveBeenCalledTimes(2);
  expect(mocks.query.mock.calls.some(([sql])=>sql.includes("notification_status='sent'"))).toBe(true);
  const claim=mocks.query.mock.calls.find(([sql])=>sql.includes("WITH candidate"))![0];
  expect(claim).toContain("SKIP LOCKED");expect(claim).toContain("payload->>'closed'='true'");
});
