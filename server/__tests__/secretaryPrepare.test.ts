import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  clearOpeningDedup, clearPrepareState, getPrepareHistory,
  prepareMessage, prepareOpeningPhrase,
} from "../prepare";

const originalFetch = global.fetch;
const originalKey = process.env.OPENAI_API_KEY;
const key = "prepare-secretary-test:secretary";

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
  clearPrepareState(key);
  clearOpeningDedup(key);
});
afterEach(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
  clearPrepareState(key);
  clearOpeningDedup(key);
});

it("uses the Hint alignment algorithm with a separate, softer Secretary assignment", async () => {
  let requests = 0;
  global.fetch = vi.fn(async (_url, init: any) => {
    requests++;
    const body = JSON.parse(init.body);
    expect(body.instructions).toContain("Listen, clarify gently");
    expect(body.instructions).not.toContain("mandatory August payment");
    return {
      ok: true,
      json: async () => ({
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({
          reply: requests === 1 ? "Когда это было?" : "Подтвердите поручение",
          proposed_goal: "Узнайте, проверит ли отель депозит, и передайте мне ответ.",
        }) }] }],
      }),
    } as any;
  }) as any;
  const first = await prepareMessage(key, "Спросите об отеле", "s-1", "secretary");
  expect(first.proposedGoal).toBeNull();
  const second = await prepareMessage(key, "Это было в сентябре", "s-2", "secretary");
  expect(second.proposedGoal).toContain("передайте мне ответ");
  expect(getPrepareHistory(key).filter((t) => t.role === "user")).toHaveLength(2);

  const opening = await prepareOpeningPhrase(key, second.proposedGoal!, "s-3", "secretary");
  expect(opening).toEqual({ phraseEn: "", translation: "" });
  expect(requests).toBe(2); // Secretary does not generate an owner opening phrase.
  expect(getPrepareHistory(key)).toEqual([]);
  expect(await prepareOpeningPhrase(key, second.proposedGoal!, "s-3", "secretary")).toEqual(opening);
});