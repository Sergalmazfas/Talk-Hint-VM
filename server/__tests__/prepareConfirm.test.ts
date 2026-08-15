// Protocol-level lost-ack regression for prepare_confirm_goal (Task #197).
//
// Scenario under test: the client confirms the goal, the server processes it,
// but the client misses BOTH response frames (goal_set + prepare_opening)
// because the socket dropped. On reconnect the client resends the SAME
// confirmation id. The client must end up with the confirmed goal and the
// ORIGINAL opening exactly once — no duplicate goal activation, no second
// opening generation.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handlePrepareConfirmGoal } from "../prepareConfirm";
import { clearPrepareState, clearOpeningDedup } from "../prepare";

const realFetch = global.fetch;

function solResponse(text: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ output: [{ type: "message", content: [{ type: "output_text", text }] }] }),
    text: async () => "",
  } as any;
}

describe("handlePrepareConfirmGoal — lost-ack replay", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    clearPrepareState("u1");
    clearOpeningDedup("u1");
  });
  afterEach(() => {
    global.fetch = realFetch;
    clearPrepareState("u1");
    clearOpeningDedup("u1");
  });

  it("client misses both frames -> resend delivers goal_set + original opening exactly once, goal activated once", async () => {
    const fetchMock = vi.fn(async () =>
      solResponse(JSON.stringify({ opening_phrase_en: "Hi, calling about my bill.", translation: "Здравствуйте, я по поводу счёта." })));
    global.fetch = fetchMock as any;

    const activateGoal = vi.fn();
    // First confirmation: frames go to a socket that is already dead — the
    // client never sees them. Server-side processing still completes.
    const lostFrames: any[] = [];
    await handlePrepareConfirmGoal("u1", "Оспорить платёж", "confirm-42", {
      sendFrame: (obj) => lostFrames.push(obj),
      activateGoal,
    });
    expect(activateGoal).toHaveBeenCalledTimes(1);
    expect(lostFrames.map((f) => f.type)).toEqual(["prepare_opening"]);

    // Reconnect resend with the SAME id on a new socket.
    const replayFrames: any[] = [];
    await handlePrepareConfirmGoal("u1", "Оспорить платёж", "confirm-42", {
      sendFrame: (obj) => replayFrames.push(obj),
      activateGoal,
    });

    // The goal reaches the client (persistable), activation ran only once,
    // and the opening is the ORIGINAL one — a single Sol call in total.
    expect(activateGoal).toHaveBeenCalledTimes(1);
    expect(replayFrames[0]).toEqual({ type: "goal_set", goal: "Оспорить платёж" });
    expect(replayFrames[1]).toMatchObject({
      type: "prepare_opening",
      phraseEn: "Hi, calling about my bill.",
      clientMessageId: "confirm-42",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a FAILED first confirmation is not treated as duplicate: retry activates once and re-runs the opening", async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return solResponse("no json here");
      return solResponse(JSON.stringify({ opening_phrase_en: "Hello.", translation: "Здравствуйте." }));
    }) as any;

    const activateGoal = vi.fn();
    const frames1: any[] = [];
    await handlePrepareConfirmGoal("u1", "goal", "c-7", { sendFrame: (o) => frames1.push(o), activateGoal });
    expect(frames1[0].type).toBe("prepare_error");

    const frames2: any[] = [];
    await handlePrepareConfirmGoal("u1", "goal", "c-7", { sendFrame: (o) => frames2.push(o), activateGoal });
    // Not a replay: the first attempt never committed, so activation runs
    // again (idempotent server-side: setUserGoal with the same goal) and the
    // opening is genuinely regenerated.
    expect(activateGoal).toHaveBeenCalledTimes(2);
    expect(frames2[0].type).toBe("prepare_opening");
    expect(calls).toBe(2);
  });
});
