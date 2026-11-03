import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { secretaryInstruction, type CallPlan } from "../../shared/callPlan";
const f = vi.hoisted(() => ({
  create: vi.fn(), save: vi.fn(), validate: vi.fn(), existing: vi.fn(), patch: vi.fn(), where: vi.fn(),
  numbers: [
    { id: "personal", type: "personal", twilioNumber: "+19990000001" },
    { id: "work", type: "work", twilioNumber: "+19990000002" },
  ],
}));
vi.mock("twilio", () => ({ default: () => ({ calls: { create: f.create } }) }));
vi.mock("../db", () => ({ db: {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => f.numbers }) }) }),
  update: () => ({ set: (value: unknown) => { f.patch(value); return { where: f.where }; } }),
} }));
vi.mock("../storage", () => ({ storage: { getCallByCallSid: f.existing, createCall: f.save } }));
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
  f.existing.mockResolvedValue(undefined); f.where.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());
const job = { id: "task", userId: "owner", phoneNumber: "+19990000003", voiceProvider: "retell" };
it("dials the explicit owned work line, not the legacy personal default", async () => {
  f.validate.mockResolvedValue({ numberId: "work" });
  await dialSecretaryTask({ ...job, outgoingContext: { version: 1 } });
  expect(f.create).toHaveBeenCalledWith(expect.objectContaining({
    from: "+19990000002", to: job.phoneNumber, timeLimit: 600, record: false,
  }));
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
  expect(f.create).toHaveBeenCalledWith(expect.objectContaining({
    from: "+19990000001", timeLimit: 600, record: false,
  }));
});
const plan: CallPlan = {
  goal: "Confirm installation", ownerFacts: [], sayAsk: ["Price and time"],
  expectedQuestions: [{ q: "When?", answer: "Tomorrow" }], unknowns: [],
  disclosurePolicy: { allowed: ["Installation"], forbidden: ["Payment"] },
  language: "ru", executor: "secretary", targetPhone: job.phoneNumber,
};
it("persists the exact structured plan through the dialer, not just the text instruction", async () => {
  await dialSecretaryTask({ ...job, instruction: secretaryInstruction(plan) });
  expect(f.save).toHaveBeenCalledWith(expect.objectContaining({
    metadata: expect.objectContaining({ callPlan: expect.objectContaining({ plan }),
      callPlanPreparation: expect.objectContaining({ status: "structured_plan" }) }),
  }));
});
it("repairs only plan metadata when the voice callback won history creation", async () => {
  f.existing.mockResolvedValue({ id: "history-raced", userId: job.userId, metadata: { retellPhone: { state: "registered" } } });
  await dialSecretaryTask({ ...job, instruction: secretaryInstruction(plan) });
  expect(f.create).toHaveBeenCalledTimes(1); expect(f.save).not.toHaveBeenCalled();
  const dialect = new PgDialect();
  const params = dialect.sqlToQuery(f.patch.mock.calls[0][0].metadata).params;
  expect(JSON.parse(params[0])).toMatchObject({ callPlan: { id: job.id, plan } });
  expect(dialect.sqlToQuery(f.where.mock.calls[0][0]).params).toEqual(["history-raced", job.userId]);
  expect(Object.keys(f.patch.mock.calls[0][0])).toEqual(["metadata"]);
});
it("never fabricates a structured plan for old approved instructions", async () => {
  await dialSecretaryTask({ ...job, instruction: "Plain old instruction" });
  const metadata = f.save.mock.calls[0][0].metadata;
  expect(metadata.callPlan).toBeUndefined();
  expect(metadata.callPlanPreparation.status).toBe("legacy_instruction_no_structured_plan");
});
