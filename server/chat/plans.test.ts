import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { proposedPlan } from "./plans";
import { ChatService } from "./service";
import { chatRouter } from "./routes";
import { ChatError } from "./contracts";
import { limitedHistory } from "./provider";

export const planFixture = {
  goal: "Ask for a new tire, all-in price at most $400.",
  ownerFacts: ["Arrival in two hours", "Wait at most one hour"],
  sayAsk: ["Ask for the total price including installation; do not split this thought.", "Book only if all conditions match."],
  expectedQuestions: [{ q: "Truck number?", answer: null }],
  unknowns: ["Availability"],
  disclosurePolicy: { allowed: ["Arrival in two hours"], forbidden: ["Do not pay"] },
  language: "en" as const, executor: "hint" as const, targetPhone: "+14055550123",
};

describe("Native chat call-plan proposals", () => {
  it("preserves whole checklist thoughts, prohibitions, exact price and unknown answers", () => {
    const action = proposedPlan(planFixture);
    expect(action.status).toBe("proposed");
    expect(action.plan).toEqual(planFixture);
    expect(action.planHash).toMatch(/^[a-f0-9]{64}$/);
    expect(proposedPlan({ ...planFixture, goal: "New price $350" }).planHash).not.toBe(action.planHash);
  });
  it("requires a US phone for Secretary, refuses malformed or oversized plans without truncation", () => {
    expect(() => proposedPlan({ ...planFixture, executor: "secretary", targetPhone: undefined }))
      .toThrow("SECRETARY_PHONE_REQUIRED");
    expect(() => proposedPlan({ ...planFixture, executor: "secretary", targetPhone: "+442012345678" }))
      .toThrow("SECRETARY_PHONE_REQUIRED");
    expect(() => proposedPlan({ ...planFixture, executor: "secretary",
      ownerFacts: Array(10).fill("a".repeat(400)) })).toThrow("SECRETARY_PLAN_TOO_LONG");
    expect(() => proposedPlan({ ...planFixture, userId: "someone_else" })).toThrow("INVALID_CALL_PLAN");
  });
  it("bounds context including large plan payloads, not only visible text", () => {
    const action = proposedPlan({ ...planFixture, ownerFacts: Array(5).fill("a".repeat(400)) });
    const rows = Array.from({ length: 24 }, () => ({
      text: "x", status: "complete", action, role: "assistant",
    }));
    const selected = limitedHistory(rows as any);
    expect(selected.length).toBeLessThan(24);
    expect(selected.reduce((n, m) => n + m.text.length + JSON.stringify(m.action).length + 32, 0)).toBeLessThanOrEqual(18000);
  });
});

describe("Native confirmation bridge never starts a call", () => {
  const fixture = (executor: "hint" | "secretary") => {
    const action = proposedPlan({ ...planFixture, executor });
    let saved = false;
    const repo = { confirmPlan: vi.fn(async (owner, conversation, id, hash, apply) => {
      expect(owner).toBe("alice");
      if (hash !== action.planHash) throw new ChatError("PLAN_CHANGED");
      if (!saved) { action.result = await apply(action); action.status = "confirmed"; saved = true; }
      return { id, conversationId: conversation, role: "assistant", status: "complete", action };
    }) };
    const backend = {
      saveHint: vi.fn(async () => ({ id: "saved", status: "pending", expiresAt: "2026-11-10T00:00:00.000Z" })),
      reviewSecretary: vi.fn(async () => ({ phoneNumber: planFixture.targetPhone, instruction: "reviewed assignment",
        confirmationToken: "ephemeral-unit-test-capability" })),
    };
    const svc = new ChatService(repo as any, {} as any, {} as any, backend);
    return { svc, repo, backend, action };
  };
  it("saves Hint only on explicit confirm with the message ID as stable idempotency key", async () => {
    const { svc, backend, action } = fixture("hint");
    const id = randomUUID();
    expect(backend.saveHint).not.toHaveBeenCalled();
    const first = await svc.confirmPlan("alice", "conversation", id, action.planHash);
    const second = await svc.confirmPlan("alice", "conversation", id, action.planHash);
    expect(first.dialed).toBe(false);
    expect(second.message.action?.status).toBe("confirmed");
    expect(backend.saveHint).toHaveBeenCalledExactlyOnceWith("alice", id, planFixture);
    expect(backend.reviewSecretary).not.toHaveBeenCalled();
  });
  it("Secretary only yields a transient review token; it is absent from persisted history", async () => {
    const { svc, backend, action } = fixture("secretary");
    const first = await svc.confirmPlan("alice", "conversation", randomUUID(), action.planHash);
    expect(first.dialed).toBe(false);
    expect(first.review?.confirmationToken).toBe("ephemeral-unit-test-capability");
    expect(JSON.stringify(first.message)).not.toContain("ephemeral-unit-test-capability");
    expect(backend.saveHint).not.toHaveBeenCalled();
  });
  it("a mismatched hash cannot save a plan or issue a review token", async () => {
    const { svc, backend } = fixture("secretary");
    await expect(svc.confirmPlan("alice", "conversation", randomUUID(), "f".repeat(64))).rejects.toThrow("PLAN_CHANGED");
    expect(backend.saveHint).not.toHaveBeenCalled();
    expect(backend.reviewSecretary).not.toHaveBeenCalled();
  });
  it("HTTP endpoint derives owner from auth, enforces same-origin intent and a hash-only body", async () => {
    const { svc, action } = fixture("hint");
    const app = express(); app.use(express.json());
    app.use("/api/chat-v1", chatRouter((req, _res, next) => { (req as any).user = { id: "alice" }; next(); }, async () => svc));
    const path = `/api/chat-v1/conversations/${randomUUID()}/messages/${randomUUID()}/confirm-plan`;
    expect((await request(app).post(path).send({ planHash: action.planHash })).status).toBe(403);
    expect((await request(app).post(path).auth("unit-test", { type: "bearer" })
      .send({ planHash: action.planHash, userId: "mallory" })).status).toBe(400);
    const result = await request(app).post(path).auth("unit-test", { type: "bearer" }).send({ planHash: action.planHash });
    expect(result.status).toBe(200);
    expect(result.body.dialed).toBe(false);
    expect(result.headers["cache-control"]).toBe("no-store");
  });
});
