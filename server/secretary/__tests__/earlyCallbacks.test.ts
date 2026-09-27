import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  task: null as any,
}));

vi.mock("../../db", async () => {
  const { secretaryTasks } = await vi.importActual<typeof import("@shared/schema")>("@shared/schema");
  const resultRows = () => state.task ? [structuredClone(state.task)] : [];
  const selectBuilder = {
    from() { return this; },
    where() { return this; },
    for() { return this; },
    limit: async () => resultRows(),
  };
  const updateBuilder = (isTask: boolean) => {
    let changes: Record<string, any> = {};
    const apply = async () => {
      if (!isTask || !state.task) return [];
      const next = { ...changes };
      if (next.status && typeof next.status !== "string") {
        next.status = state.task.status === "starting" ? "ringing" : state.task.status;
      }
      state.task = { ...state.task, ...next };
      return resultRows();
    };
    const query: any = {
      set(values: Record<string, any>) { changes = values; return this; },
      where() { return this; },
      returning: apply,
      then(resolve: any, reject: any) { return Promise.resolve(isTask ? apply() : []).then(resolve, reject); },
    };
    return query;
  };
  const tx = {
    select: () => selectBuilder,
    update: (table: unknown) => updateBuilder(table === secretaryTasks),
  };
  return {
    db: {
      ...tx,
      transaction: async (work: (tx: typeof tx) => Promise<unknown>) => work(tx),
    },
    isDatabaseAvailable: () => true,
  };
});

import {
  attachSecretaryCall,
  bindSecretaryCall,
  finishSecretaryAttempt,
  getSecretaryTaskForCall,
} from "../tasks";

const callSid = "CA0123456789abcdef0123456789abcdef";

describe("early Twilio callback reconciliation", () => {
  beforeEach(() => {
    state.task = {
      id: "task-early",
      userId: "owner-early",
      mode: "live",
      status: "starting",
      phoneNumber: "+19545551234",
      instruction: "Ask about a return.",
      callSid: null,
      callId: null,
      transcript: "",
      providerStatus: null,
      outcome: null,
      summary: null,
      verifiedFacts: [],
      nextStep: null,
      notificationStatus: "pending",
      attemptTranscripts: [],
      attempts: 1,
      updatedAt: new Date(),
      createdAt: new Date(),
    };
  });

  it("binds early voice/stream starts while the task is still starting", async () => {
    expect(await bindSecretaryCall("task-early", callSid)).toMatchObject({ status: "starting", callSid });
    expect(await getSecretaryTaskForCall("task-early", callSid)).toMatchObject({
      id: "task-early",
      status: "starting",
      callSid,
    });
  });

  it("preserves a terminal callback received before dial attach and reconciles History", async () => {
    await bindSecretaryCall("task-early", callSid);
    const terminal = await finishSecretaryAttempt("task-early", callSid, "no-answer");
    expect(terminal).toMatchObject({ status: "no_answer", callSid });

    const attached = await attachSecretaryCall("task-early", callSid, "history-early");
    expect(attached).toMatchObject({
      status: "no_answer",
      callSid,
      callId: "history-early",
    });
  });
});