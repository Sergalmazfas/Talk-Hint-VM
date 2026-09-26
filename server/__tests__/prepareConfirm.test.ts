// Protocol-level lost-ack regression for prepare_confirm_goal (Task #197).
//
// Scenario under test: the client confirms the goal, the server processes it,
// but the client misses BOTH response frames (goal_set + prepare_opening)
// because the socket dropped. On reconnect the client resends the SAME
// confirmation id. The client must end up with the confirmed goal and the
// ORIGINAL opening exactly once — no duplicate goal activation, no second
// opening generation.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { authorizeSecretaryConfirmation, handlePrepareConfirmGoal, isSecretaryConfirmationCurrent } from "../prepareConfirm";
import { clearPrepareState, clearOpeningDedup, prepareOpeningPhrase, getPrepareHistory } from "../prepare";
import { prepareMessage } from "../prepare";

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

describe("Secretary confirmation proposal authorization", () => {
  const secretaryUser = "owner-1:secretary";
  const goal = "Call the hotel and ask whether the September reservation can be changed.";

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    clearPrepareState(secretaryUser);
    clearOpeningDedup(secretaryUser);
  });
  afterEach(() => {
    global.fetch = realFetch;
    clearPrepareState(secretaryUser);
    clearOpeningDedup(secretaryUser);
  });

  async function createProposal() {
    const replies = [
      { reply: "I understand. Which hotel?", proposed_goal: "" },
      { reply: "I will prepare that assignment.", proposed_goal: goal },
    ];
    global.fetch = vi.fn(async () => solResponse(JSON.stringify(replies.shift()))) as any;
    await prepareMessage(secretaryUser, "Please call the hotel.", "secretary-turn-1", "secretary");
    const proposal = await prepareMessage(secretaryUser, "Ask about my September booking.", "secretary-turn-2", "secretary");
    expect(proposal.proposedGoal).toBe(goal);
  }

  it("rejects an arbitrary client goal and a mismatched proposal", async () => {
    await createProposal();
    expect(authorizeSecretaryConfirmation(secretaryUser, "Forged assignment", "forged-id")).toBeNull();
    expect(authorizeSecretaryConfirmation(secretaryUser, `${goal} Extra`, "mismatch-id")).toBeNull();
    expect(authorizeSecretaryConfirmation(secretaryUser, goal, "valid-id")).toMatchObject({ goal, replay: false });
  });

  it("invalidates an unconfirmed proposal on a new turn and reset", async () => {
    await createProposal();
    global.fetch = vi.fn(async () => solResponse(JSON.stringify({ reply: "What should I ask?", proposed_goal: "" }))) as any;
    await prepareMessage(secretaryUser, "One more detail.", "secretary-turn-3", "secretary");
    expect(authorizeSecretaryConfirmation(secretaryUser, goal, "stale-after-turn")).toBeNull();

    await createProposal();
    clearPrepareState(secretaryUser);
    expect(authorizeSecretaryConfirmation(secretaryUser, goal, "stale-after-reset")).toBeNull();
  });

  it("accepts a current server proposal and permits only its idempotent resend", async () => {
    await createProposal();
    const authorization = authorizeSecretaryConfirmation(secretaryUser, goal, "secretary-confirm-1");
    expect(authorization).toMatchObject({ goal, replay: false });

    const frames: any[] = [];
    const activateGoal = vi.fn();
    await handlePrepareConfirmGoal(secretaryUser, goal, "secretary-confirm-1", {
      sendFrame: (frame) => frames.push(frame),
      activateGoal,
      isConfirmationCurrent: () => !!authorization && isSecretaryConfirmationCurrent(
        secretaryUser,
        goal,
        authorization.generation,
        "secretary-confirm-1",
      ),
    }, "secretary");
    expect(activateGoal).toHaveBeenCalledTimes(1);
    expect(frames).toEqual([{ type: "prepare_opening", phraseEn: "", translation: "", clientMessageId: "secretary-confirm-1" }]);
    expect(authorizeSecretaryConfirmation(secretaryUser, goal, "secretary-confirm-1")).toMatchObject({ goal, replay: true });
    expect(authorizeSecretaryConfirmation(secretaryUser, "Forged replacement", "secretary-confirm-1")).toBeNull();
  });

  it("rejects a claimed confirmation invalidated before its serialized opening runs without clearing a newer turn", async () => {
    await createProposal();

    let releaseFetch!: (response: any) => void;
    let fetchCalls = 0;
    global.fetch = vi.fn(async () => {
      fetchCalls++;
      if (fetchCalls === 1) {
        return new Promise((resolve) => { releaseFetch = resolve; }) as any;
      }
      return solResponse(JSON.stringify({ reply: "Fresh conversation.", proposed_goal: "" }));
    }) as any;

    // Hold this conversation's serialized queue with a failing Hint opening;
    // unlike a new PREPARE turn, it does not invalidate the Secretary proposal.
    const blocker = prepareOpeningPhrase(secretaryUser, "hint blocker", "hint-blocker", "hint");
    await vi.waitFor(() => expect(releaseFetch).toBeTypeOf("function"));

    const authorization = authorizeSecretaryConfirmation(secretaryUser, goal, "queued-secretary-confirm");
    expect(authorization).toMatchObject({ goal, replay: false });
    const frames: any[] = [];
    const activateGoal = vi.fn();
    const queuedConfirmation = handlePrepareConfirmGoal(secretaryUser, goal, "queued-secretary-confirm", {
      sendFrame: (frame) => frames.push(frame),
      activateGoal,
      isConfirmationCurrent: () => !!authorization && isSecretaryConfirmationCurrent(
        secretaryUser,
        goal,
        authorization.generation,
        "queued-secretary-confirm",
      ),
    }, "secretary");

    // Simulate prepare_reset followed by a fresh turn before the queued
    // Secretary opening gets execution time.
    clearPrepareState(secretaryUser);
    clearOpeningDedup(secretaryUser);
    const newTurn = prepareMessage(secretaryUser, "A new assignment after reset.", "new-turn-after-reset", "secretary");
    releaseFetch(solResponse("not valid opening JSON"));

    await expect(blocker).rejects.toBeTruthy();
    await queuedConfirmation;
    await newTurn;
    expect(frames.some((frame) => frame.type === "prepare_opening" && frame.confirmationToken)).toBe(false);
    expect(frames).toContainEqual(expect.objectContaining({ type: "prepare_error" }));
    expect(activateGoal).not.toHaveBeenCalled();
    expect(getPrepareHistory(secretaryUser).some((turn) => turn.role === "user" && turn.content === "A new assignment after reset.")).toBe(true);
  });
});
