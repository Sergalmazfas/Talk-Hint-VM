import { describe, it, expect } from "vitest";
import request from "supertest";
import { createActionsMockServer, MOCK_PHONE } from "./actionsMockServer";

const options = () => ({ origin: "https://mock.example.test",
  redirectUri: "https://chatgpt.com/aip/g-TestActions/oauth/callback",
  clientSecret: "test-confidential-secret-not-a-real-credential-0000",
  ownerPassword: "test-owner-password-not-a-real-credential-0000" });
describe("isolated Actions test service", () => {
  it("fails closed with weak credentials or a non-443 origin", () => {
    for (const update of [{ clientSecret: "weak" }, { ownerPassword: "weak" },
      { ownerPassword: options().clientSecret },
      { origin: "http://example.test" }, { origin: "https://example.test:6000" }])
      expect(() => createActionsMockServer({ ...options(), ...update })).toThrow();
  });
  it("exposes only synthetic health, without credentials or native data", async () => {
    const service = createActionsMockServer(options());
    const result = await request(service.app).get("/test/health");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ mock: true, realDialerAvailable: false,
      data: "synthetic-only", outboundMockEnabled: false });
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.headers["x-talkhint-environment"]).toBe("mock-only");
    expect(result.text).not.toContain(options().clientSecret);
    expect(service.stats()).toEqual({ dispatches: 0, tasks: 0 });
  });
  it("defaults to five read operations with no outbound scope", async () => {
    const { app } = createActionsMockServer(options());
    const result = await request(app).get("/api/chatgpt-actions/openapi.json");
    expect(Object.keys(result.body.paths)).toHaveLength(5);
    expect(JSON.stringify(result.body)).not.toContain("secretary:start");
    expect((await request(app).get("/api/chatgpt-actions/calls")).status).toBe(401);
    expect((await request(app).post("/api/chatgpt-actions/drafts").send({ phoneNumber: MOCK_PHONE })).status).toBe(404);
  });
  it("never registers phone, SMS, incoming, native login or legacy routes", async () => {
    const { app } = createActionsMockServer({ ...options(), outbound: true });
    for (const path of ["/start-call", "/twilio/voice", "/api/login", "/api/send-sms",
      "/api/chatgpt-actions/tools/start_call", "/api/chatgpt-actions/confirmations/approve"])
      expect((await request(app).post(path).send({ confirmed: true })).status).toBe(404);
  });
  it("rejects non-fictional numbers before any mock dispatch", async () => {
    const service = createActionsMockServer({ ...options(), outbound: true });
    expect((await request(service.app).post("/api/chatgpt-actions/drafts")
      .send({ phoneNumber: "+12125552345" })).status).toBe(400);
    expect(service.stats().dispatches).toBe(0);
  });
});
