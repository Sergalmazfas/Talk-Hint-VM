import { beforeEach, afterEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  create: vi.fn(), save: vi.fn(), validate: vi.fn(),
  numbers: [
    { id: "personal", type: "personal", twilioNumber: "+19990000001" },
    { id: "work", type: "work", twilioNumber: "+19990000002" },
  ],
}));
vi.mock("twilio", () => ({ default: () => ({ calls: { create: f.create } }) }));
vi.mock("../db", () => ({ db: {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => f.numbers }) }) }),
} }));
vi.mock("../storage", () => ({ storage: { getCallByCallSid: async () => undefined, createCall: f.save } }));
vi.mock("./retellPhone", () => ({ requireRetellPhone: async () => ({}) }));
vi.mock("./personalities/outgoing", () => ({ validateOutgoingSnapshot: f.validate }));
import { dialSecretaryTask } from "./dialer";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TWILIO_ACCOUNT_SID", "test"); vi.stubEnv("TWILIO_AUTH_TOKEN", "test");
  vi.stubEnv("OPENAI_API_KEY", "test"); vi.stubEnv("REPLIT_DEV_DOMAIN", "test.replit.dev");
  vi.stubEnv("NODE_ENV", "development");
  f.create.mockResolvedValue({ sid: "CA" + "a".repeat(32) });
  f.save.mockResolvedValue({ id: "history" });
});
afterEach(() => vi.unstubAllEnvs());
const job = { id: "task", userId: "owner", phoneNumber: "+19990000003", voiceProvider: "retell" };
it("dials the explicit owned work line, not the legacy personal default", async () => {
  f.validate.mockResolvedValue({ numberId: "work" });
  await dialSecretaryTask({ ...job, outgoingContext: { version: 1 } });
  expect(f.create).toHaveBeenCalledWith(expect.objectContaining({ from: "+19990000002", to: job.phoneNumber }));
  expect(f.save).toHaveBeenCalledWith(expect.objectContaining({ fromNumber: "+19990000002" }));
});
it("does not fall back to another line when the selected number is unavailable", async () => {
  f.validate.mockResolvedValue({ numberId: "missing" });
  await expect(dialSecretaryTask({ ...job, outgoingContext: { version: 1 } })).rejects.toThrow();
  expect(f.create).not.toHaveBeenCalled();
});
it("keeps the legacy calling line for older tasks without the new context", async () => {
  await dialSecretaryTask(job);
  expect(f.validate).not.toHaveBeenCalled();
  expect(f.create).toHaveBeenCalledWith(expect.objectContaining({ from: "+19990000001" }));
});
