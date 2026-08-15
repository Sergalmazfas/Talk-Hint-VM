import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// PREPARE stage (Task #183) — provider policy v1 behaviors that matter:
//  - one Sol conversation per user, state kept across turns until confirmation
//  - proposed goal only when the model proposes one (JSON contract)
//  - HONEST errors: Sol unavailable => PrepareUnavailableError, never another model
//  - a failed turn does not poison the history (user can resend)
//  - opening phrase parses + clears the conversation state

import {
  prepareMessage,
  prepareOpeningPhrase,
  clearPrepareState,
  getPrepareHistory,
  PrepareUnavailableError,
  PREPARE_MODEL,
} from "../prepare";

const originalFetch = global.fetch;
const originalKey = process.env.OPENAI_API_KEY;

function solResponse(text: string) {
  return {
    ok: true,
    json: async () => ({
      output: [{ type: "message", content: [{ type: "output_text", text }] }],
    }),
  } as any;
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
  clearPrepareState("u1");
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
  clearPrepareState("u1");
});

describe("prepareMessage", () => {
  it("sends the fixed model and returns reply without a goal when none proposed", async () => {
    const fetchMock = vi.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      expect(body.model).toBe(PREPARE_MODEL);
      expect(body.instructions).toContain("TalkHint Call Preparation Assistant");
      return solResponse(JSON.stringify({ reply: "Правильно понимаю, возврат — запасной вариант?", proposed_goal: "" }));
    });
    global.fetch = fetchMock as any;

    const r = await prepareMessage("u1", "Я заплатил $200 и $150, банк считает их additional payments");
    expect(r.reply).toContain("запасной вариант");
    expect(r.proposedGoal).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps one conversation state across turns (history grows, same user)", async () => {
    let seenInput: any[] = [];
    global.fetch = vi.fn(async (_url: any, init: any) => {
      seenInput = JSON.parse(init.body).input;
      return solResponse(JSON.stringify({ reply: "ok", proposed_goal: "" }));
    }) as any;

    await prepareMessage("u1", "первое сообщение");
    await prepareMessage("u1", "второе сообщение");
    // Second call must carry the whole dialog: user1, assistant1, user2.
    expect(seenInput.map((t: any) => t.role)).toEqual(["user", "assistant", "user"]);
    expect(seenInput[0].content).toBe("первое сообщение");
    expect(seenInput[2].content).toBe("второе сообщение");
  });

  it("surfaces a proposed goal from the JSON contract", async () => {
    global.fetch = vi.fn(async () =>
      solResponse(JSON.stringify({ reply: "Вот цель:", proposed_goal: "Зачесть $317.80 из внесённых $350 как августовский платёж." })),
    ) as any;
    const r = await prepareMessage("u1", "всё рассказал");
    expect(r.proposedGoal).toContain("$317.80");
  });

  it("honest error on HTTP failure — PrepareUnavailableError, no fallback call", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 503, text: async () => "down" }) as any);
    global.fetch = fetchMock as any;
    await expect(prepareMessage("u1", "hi")).rejects.toBeInstanceOf(PrepareUnavailableError);
    // Exactly one attempt to ONE model — no silent retry with another model.
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse((fetchMock.mock.calls[0] as any)[1].body).model).toBe(PREPARE_MODEL);
  });

  it("failed turn does not poison the history", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, text: async () => "" }) as any);
    await expect(prepareMessage("u1", "will fail")).rejects.toBeInstanceOf(PrepareUnavailableError);
    expect(getPrepareHistory("u1")).toHaveLength(0);
  });

  it("missing API key is an honest error too", async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(prepareMessage("u1", "hi")).rejects.toBeInstanceOf(PrepareUnavailableError);
  });

  it("falls back to raw text when the model ignores the JSON contract", async () => {
    global.fetch = vi.fn(async () => solResponse("просто текст без JSON")) as any;
    const r = await prepareMessage("u1", "hi");
    expect(r.reply).toBe("просто текст без JSON");
    expect(r.proposedGoal).toBeNull();
  });
});

describe("concurrency & reset", () => {
  it("serializes concurrent turns from the same user (no interleaved history)", async () => {
    let calls = 0;
    global.fetch = vi.fn(async (_url: any, init: any) => {
      const n = ++calls;
      // First request resolves SLOWER than the second — without serialization
      // the commits would land out of order.
      await new Promise((r) => setTimeout(r, n === 1 ? 30 : 1));
      const input = JSON.parse(init.body).input;
      return solResponse(JSON.stringify({ reply: `reply${n} to ${input[input.length - 1].content}`, proposed_goal: "" }));
    }) as any;

    const [r1, r2] = await Promise.all([
      prepareMessage("u1", "msg1"),
      prepareMessage("u1", "msg2"),
    ]);
    expect(r1.reply).toContain("msg1");
    expect(r2.reply).toContain("msg2");
    const h = getPrepareHistory("u1");
    expect(h[0].content).toBe("msg1");
    expect(h[2].content).toBe("msg2");
    expect(h).toHaveLength(4);
  });

  it("a reset during an in-flight turn discards the stale commit", async () => {
    let resolveFetch: (v: any) => void;
    global.fetch = vi.fn(() => new Promise((r) => { resolveFetch = r; })) as any;
    const p = prepareMessage("u1", "old message");
    await new Promise((r) => setTimeout(r, 5));
    clearPrepareState("u1"); // e.g. call ended -> prepare_reset
    resolveFetch!(solResponse(JSON.stringify({ reply: "late", proposed_goal: "" })));
    await expect(p).rejects.toBeInstanceOf(PrepareUnavailableError);
    expect(getPrepareHistory("u1")).toHaveLength(0);
  });
});

describe("prepareOpeningPhrase", () => {
  it("returns the opening phrase + translation and clears the state", async () => {
    global.fetch = vi.fn(async () =>
      solResponse(JSON.stringify({
        opening_phrase_en: "Hi, I'm calling about my August payment.",
        translation: "Здравствуйте, я звоню по поводу августовского платежа.",
      })),
    ) as any;
    getPrepareHistory("u1").push({ role: "user", content: "context" });
    const o = await prepareOpeningPhrase("u1", "Зачесть $317.80 как августовский платёж");
    expect(o.phraseEn).toMatch(/August payment/);
    expect(o.translation).toMatch(/августовского/);
    expect(getPrepareHistory("u1")).toHaveLength(0); // state cleared after confirmation
  });

  it("unparseable opening output is an honest error and keeps the state intact", async () => {
    global.fetch = vi.fn(async () => solResponse("no json here")) as any;
    getPrepareHistory("u1").push({ role: "user", content: "context" });
    await expect(prepareOpeningPhrase("u1", "goal")).rejects.toBeInstanceOf(PrepareUnavailableError);
    expect(getPrepareHistory("u1")).toHaveLength(1); // confirmation turn rolled back
  });
});
