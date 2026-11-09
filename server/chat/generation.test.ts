import { describe, it, expect, vi } from "vitest";
import { ChatService } from "./service";
import { ChatError } from "./contracts";
import { proposedPlan } from "./plans";

const repo = () => ({
  claim: vi.fn().mockResolvedValue(true),
  messages: vi.fn().mockResolvedValue({ messages: [
    { sequence: 1, text: "Hello", role: "user", status: "complete" },
    { sequence: 2, text: "future", role: "user", status: "complete" },
  ] }),
  save: vi.fn().mockResolvedValue(undefined),
});
describe("Chat 1A generation persistence", () => {
  it("stores a proposal in the completed reply without saving Hint or issuing a Secretary token", async () => {
    const r = repo();
    const action = proposedPlan({ goal: "Ask price", ownerFacts: [], sayAsk: ["Ask price"],
      expectedQuestions: [], unknowns: [], disclosurePolicy: { allowed: [], forbidden: ["Do not pay"] },
      language: "en", executor: "hint" });
    const backend = { saveHint: vi.fn(), reviewSecretary: vi.fn() };
    const provider = { available: () => true, generate: async function* () {
      yield { text: "Please review" }; yield { action }; yield { complete: true };
    } };
    await (new ChatService(r as any, provider, {} as any, backend) as any).run("alice", "chat", "reply", 1, []);
    expect(r.save).toHaveBeenLastCalledWith("alice", "reply", "Please review", "complete", null,
      expect.objectContaining({ action }));
    expect(backend.saveHint).not.toHaveBeenCalled();
    expect(backend.reviewSecretary).not.toHaveBeenCalled();
  });
  it("persists partial output, completion and provider evidence; excludes future messages", async () => {
    const r = repo();
    const provider = { available: () => true, generate: vi.fn(async function* () {
      yield { text: "Hello", requestId: "req_test" };
      yield { text: " there" };
      yield { complete: true, usage: { output_tokens: 2 } };
    }) };
    const s = new ChatService(r as any, provider);
    await (s as any).run("alice", "chat", "reply", 1, []);
    expect(provider.generate.mock.calls[0][0]).toEqual([{ sequence: 1, text: "Hello", role: "user", status: "complete" }]);
    expect(r.save).toHaveBeenLastCalledWith("alice", "reply", "Hello there", "complete", null,
      expect.objectContaining({ requestId: "req_test", usage: { output_tokens: 2 } }));
    expect(r.save.mock.calls.some(c => c[3] === "generating")).toBe(true);
  });
  it("does not turn an incomplete/failed stream into a completed answer or retry it", async () => {
    const r = repo();
    const provider = { available: () => true, generate: vi.fn(async function* () {
      yield { text: "partial" };
      throw new ChatError("MODEL_RESPONSE_INCOMPLETE", 502);
    }) };
    await (new ChatService(r as any, provider) as any).run("alice", "chat", "reply", 1, []);
    expect(provider.generate).toHaveBeenCalledOnce();
    expect(r.save).toHaveBeenLastCalledWith("alice", "reply", "partial", "interrupted", "MODEL_RESPONSE_INCOMPLETE", expect.any(Object));
  });
  it("preserves provider failure classification and aborts the request", async () => {
    const r = repo(); let signal: AbortSignal | undefined;
    const provider = { available: () => true, generate: vi.fn(async function* (_h, _a, inputSignal) {
      signal = inputSignal;
      throw Object.assign(Error("private provider body"), { status: 429, request_id: "req_error" });
    }) };
    await (new ChatService(r as any, provider) as any).run("alice", "chat", "reply", 1, []);
    expect(signal?.aborted).toBe(true);
    expect(r.save).toHaveBeenLastCalledWith("alice", "reply", "", "failed", "MODEL_REQUEST_FAILED", expect.any(Object));
  });
  it("does no model work if another process already claimed the reply", async () => {
    const r = repo(); r.claim.mockResolvedValue(false);
    const provider = { available: () => true, generate: vi.fn() };
    await (new ChatService(r as any, provider) as any).run("alice", "chat", "reply", 1, []);
    expect(provider.generate).not.toHaveBeenCalled();
  });
});
