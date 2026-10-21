import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerCallProfileRoutes } from "./routes";
import { WORK_NUMBER_CANDIDATE, WORK_NUMBER_OWNER } from "./policy";

describe("owner-approved existing-pool work number setup; no dialing", () => {
  const personal = { id: "p", userId: WORK_NUMBER_OWNER, twilioNumber: "+19543200848", name: "Serg", type: "personal" };
  let app: express.Express, owner: string | undefined;
  const deps = { numbers: vi.fn(), pool: vi.fn(), inspect: vi.fn(), assign: vi.fn(), canAdoptExisting: vi.fn() };
  beforeEach(() => {
    vi.resetAllMocks(); owner = WORK_NUMBER_OWNER; app = express(); app.use(express.json());
    deps.numbers.mockResolvedValue([personal]);
    deps.canAdoptExisting.mockResolvedValue(false);
    deps.pool.mockResolvedValue([{ ...WORK_NUMBER_CANDIDATE, twilioNumber: WORK_NUMBER_CANDIDATE.phoneNumber, isAssigned: false }]);
    deps.inspect.mockResolvedValue({ foundOnMain: true, voiceEnabled: true, usesVoiceApplication: false, voiceMethod: "POST",
      voiceUrl: "https://talkhint.app/twilio/voice", statusCallback: "https://talkhint.app/twilio/status" });
    deps.assign.mockResolvedValue({ id: "w", twilioNumber: WORK_NUMBER_CANDIDATE.phoneNumber, name: "Рабочий", type: "work" });
    registerCallProfileRoutes(app, (req, res, next) => {
      if (!owner) return void res.sendStatus(401);
      req.user = { id: owner } as any; next();
    }, deps);
  });
  const attach = (body: object = { numberId: WORK_NUMBER_CANDIDATE.id }) =>
    request(app).post("/api/call-profiles/work-number").send(body);
  it("is read-only on GET, reveals no pool credentials, and keeps AI/calendar disabled", async () => {
    const r = await request(app).get("/api/call-profiles");
    expect(r.status).toBe(200); expect(r.body.incomingAiEnabled).toBe(false);
    expect(r.body.calendarConnected).toBe(false);
    expect(r.body.profiles[0].numbers[0].phoneNumber).toBe(personal.twilioNumber);
    expect(r.body.profiles[1].secretaryOutboundReady).toBe(false);
    expect(deps.assign).not.toHaveBeenCalled(); expect(deps.inspect).not.toHaveBeenCalled();
    expect(JSON.stringify(r.body)).not.toContain("subaccount");
  });
  it("requires auth, restricts this plan to its owner, and rejects foreign browser writes", async () => {
    owner = undefined; expect((await attach()).status).toBe(401);
    owner = "other"; expect((await attach()).status).toBe(403);
    owner = WORK_NUMBER_OWNER;
    expect((await attach().set("Origin", "https://attacker.test")).status).toBe(403);
    expect(deps.assign).not.toHaveBeenCalled();
  });
  it("accepts only the approved candidate, not CDL or owner/caller-controlled changes", async () => {
    expect((await attach({ numberId: "unapproved-number" })).status).toBe(400);
    expect((await attach({ numberId: WORK_NUMBER_CANDIDATE.id, userId: "other" })).status).toBe(400);
    expect(deps.inspect).not.toHaveBeenCalled(); expect(deps.assign).not.toHaveBeenCalled();
  });
  it("no longer offers or accepts the discarded 2875 number", async () => {
    expect((await attach({ numberId: "f23589ca-5da1-465b-86a4-f5ac4616f9f8" })).status).toBe(400);
    const r = await request(app).get("/api/call-profiles");
    expect(r.body.recommendedWorkNumber.phoneNumber).toBe("+17867331025");
    expect(deps.assign).not.toHaveBeenCalled();
  });
  it("shows the approved previous CDL binding as a move, not as a free line", async () => {
    deps.pool.mockResolvedValue([{ id: WORK_NUMBER_CANDIDATE.id, twilioNumber: WORK_NUMBER_CANDIDATE.phoneNumber, isAssigned: true }]);
    deps.canAdoptExisting.mockResolvedValueOnce(true);
    const r = await request(app).get("/api/call-profiles");
    expect(r.body.recommendedWorkNumber.available).toBe(true);
    expect(r.body.recommendedWorkNumber.existingBindingMove).toBe(true);
    deps.canAdoptExisting.mockResolvedValueOnce(false);
    expect((await request(app).get("/api/call-profiles")).body.recommendedWorkNumber.available).toBe(false);
  });
  it("allows replacing only the discarded trial work line", async () => {
    deps.numbers.mockResolvedValue([personal, { ...personal, id: "trial", twilioNumber: "+19548592875", type: "work" }]);
    expect((await attach()).status).toBe(200);
    expect(deps.assign).toHaveBeenCalledOnce();
  });
  it("requires provider preflight and assigns to the authenticated owner only", async () => {
    expect((await attach()).status).toBe(200);
    expect(deps.assign).toHaveBeenCalledExactlyOnceWith(WORK_NUMBER_CANDIDATE.id, WORK_NUMBER_OWNER);
    expect(deps.inspect).toHaveBeenCalledExactlyOnceWith(WORK_NUMBER_CANDIDATE.phoneNumber);
  });
  it("recovers the same assignment without provider mutation or another claim", async () => {
    deps.numbers.mockResolvedValue([personal, { id: "w", userId: WORK_NUMBER_OWNER,
      twilioNumber: WORK_NUMBER_CANDIDATE.phoneNumber, name: "Рабочий", type: "work" }]);
    const r = await attach();
    expect(r.status).toBe(200); expect(r.body.reused).toBe(true);
    expect(deps.inspect).not.toHaveBeenCalled(); expect(deps.assign).not.toHaveBeenCalled();
  });
  it("does not replace an existing different work number", async () => {
    deps.numbers.mockResolvedValue([personal, { ...personal, id: "existing", twilioNumber: "+19995550100", type: "work" }]);
    expect((await attach()).status).toBe(409); expect(deps.assign).not.toHaveBeenCalled();
  });
  it("fails closed if provider inspection fails or points to another app", async () => {
    deps.inspect.mockRejectedValueOnce(new Error("provider unavailable"));
    expect((await attach()).status).toBe(503);
    deps.inspect.mockResolvedValueOnce({ foundOnMain: false });
    expect((await attach()).status).toBe(409); expect(deps.assign).not.toHaveBeenCalled();
  });
});
