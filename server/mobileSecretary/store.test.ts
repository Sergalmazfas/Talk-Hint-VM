import { beforeEach, expect, it, vi } from "vitest";
const query=vi.hoisted(()=>vi.fn(async()=>({rows:[],rowCount:1})));
vi.mock("../db",()=>({dbReady:Promise.resolve(),pool:{query}}));
import { MobileStore } from "./store";
beforeEach(()=>{vi.clearAllMocks();});
it("uses an additive production table, owner-bound atomic leases and one-time consumption",async()=>{
  vi.stubEnv("NODE_ENV","production");
  const store=new MobileStore();
  await store.claimLive("review","owner","starting");
  await store.consume("approved","owner");
  const sql=query.mock.calls.map(c=>(c as unknown as [string])[0]).join("\n");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS mobile_secretary_state");
  expect(sql).not.toContain("mobile_secretary_dev");
  expect(sql).toContain("owner=$2 AND kind='live-review'");
  expect(sql).toContain("payload->>'status'='prepared'");
  expect(sql).toContain("expires>now() RETURNING id");
});
it("preserves the existing Dev table for compatibility",async()=>{
  vi.stubEnv("NODE_ENV","development");
  await new MobileStore().get("id","owner");
  const sql=query.mock.calls.map(c=>(c as unknown as [string])[0]).join("\n");
  expect(sql).toContain("mobile_secretary_dev");
  expect(sql).not.toContain("mobile_secretary_state");
});
