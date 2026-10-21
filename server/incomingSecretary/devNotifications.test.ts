import { it,expect,vi } from "vitest";
vi.mock("../db",()=>({db:{}}));
import { inspectAlertCredentials } from "./devNotifications";
it("reports missing ordinary alert credentials, not VoIP success or push delivery",()=>{
  expect(inspectAlertCredentials()).toMatchObject({certificateConfigured:false,keyConfigured:false,credentialsUsable:false,deliveryTested:false});
  expect(inspectAlertCredentials().issues).toHaveLength(2);
});
it("malformed credential errors never echo raw input values",()=>{
  const result=inspectAlertCredentials("sensitive-certificate-marker","sensitive-key-marker");
  expect(result.credentialsUsable).toBe(false);expect(result.issues).toHaveLength(2);
  expect(JSON.stringify(result)).not.toContain("sensitive");
});
