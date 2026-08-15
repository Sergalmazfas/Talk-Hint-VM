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
  clearOpeningDedup,
  hasOpeningEntry,
  dedupUserCounts,
  DEDUP_TTL_MS,
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

  // --- Idempotent retry (Task #197): reconnect resends must not duplicate ---

  it("dedups a resend with the same clientMessageId: one Sol call, one committed turn, same reply", async () => {
    const fetchMock = vi.fn(async () =>
      solResponse(JSON.stringify({ reply: "alignment turn", proposed_goal: "" })));
    global.fetch = fetchMock as any;

    const [r1, r2] = await Promise.all([
      prepareMessage("u1", "мой рассказ", "msg-1"),
      prepareMessage("u1", "мой рассказ", "msg-1"),
    ]);
    const r3 = await prepareMessage("u1", "мой рассказ", "msg-1"); // late resend after ack
    expect(r1).toEqual(r2);
    expect(r1).toEqual(r3);
    expect(fetchMock).toHaveBeenCalledOnce();
    // Exactly one user turn committed — no duplicate history entries.
    expect(getPrepareHistory("u1").filter((t) => t.role === "user")).toHaveLength(1);
  });

  it("different clientMessageIds are separate turns", async () => {
    const fetchMock = vi.fn(async () =>
      solResponse(JSON.stringify({ reply: "ok", proposed_goal: "" })));
    global.fetch = fetchMock as any;

    await prepareMessage("u1", "первое", "id-a");
    await prepareMessage("u1", "второе", "id-b");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getPrepareHistory("u1").filter((t) => t.role === "user")).toHaveLength(2);
  });

  it("a FAILED turn is not cached: retry with the same id genuinely re-runs", async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error("network down");
      return solResponse(JSON.stringify({ reply: "получилось", proposed_goal: "" }));
    }) as any;

    await expect(prepareMessage("u1", "hi", "retry-1")).rejects.toBeInstanceOf(PrepareUnavailableError);
    const r = await prepareMessage("u1", "hi", "retry-1");
    expect(r.reply).toBe("получилось");
    expect(calls).toBe(2);
    expect(getPrepareHistory("u1").filter((t) => t.role === "user")).toHaveLength(1);
  });

  it("dedup cache is scoped per user and cleared on reset", async () => {
    const fetchMock = vi.fn(async () =>
      solResponse(JSON.stringify({ reply: "ok", proposed_goal: "" })));
    global.fetch = fetchMock as any;

    await prepareMessage("u1", "hi", "shared-id");
    await prepareMessage("u2", "hi", "shared-id"); // other user: not deduped
    expect(fetchMock).toHaveBeenCalledTimes(2);

    clearPrepareState("u1");
    await prepareMessage("u1", "hi", "shared-id"); // after reset: fresh turn
    expect(fetchMock).toHaveBeenCalledTimes(3);
    clearPrepareState("u2");
  });

  it("never evicts an IN-FLIGHT id, no matter how many other ids arrive", async () => {
    // Regression: the first Sol call hangs while 25 more distinct ids are
    // accepted. FIFO pruning must skip the unsettled first entry, so a resend
    // of the first id still dedups onto the original in-flight promise.
    let releaseFirst: ((v: any) => void) | null = null;
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        await new Promise((res) => { releaseFirst = res; });
      }
      return solResponse(JSON.stringify({ reply: "ok", proposed_goal: "" }));
    }) as any;

    const first = prepareMessage("u1", "первое", "in-flight-id");
    // Wait until the first Sol call is genuinely hanging before piling on.
    while (!releaseFirst) await new Promise((r) => setTimeout(r, 1));
    const others: Promise<any>[] = [];
    for (let i = 0; i < 25; i++) others.push(prepareMessage("u1", `msg ${i}`, `other-${i}`));
    const resend = prepareMessage("u1", "первое", "in-flight-id"); // must dedup
    releaseFirst!(null);
    await Promise.all([first, resend, ...others]);
    // 1 (first) + 25 others — the resend must NOT have scheduled a 27th call.
    expect(calls).toBe(26);
    clearPrepareState("u1");
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

  it("surfaces a proposed goal from the JSON contract (second user turn)", async () => {
    global.fetch = vi.fn(async () =>
      solResponse(JSON.stringify({ reply: "Вот цель:", proposed_goal: "Зачесть $317.80 из внесённых $350 как августовский платёж." })),
    ) as any;
    // First turn already happened — goal proposals are legal from turn 2.
    getPrepareHistory("u1").push(
      { role: "user", content: "рассказ о проблеме" },
      { role: "assistant", content: JSON.stringify({ reply: "правильно понимаю ...?", proposed_goal: "" }) },
    );
    const r = await prepareMessage("u1", "да, именно так");
    expect(r.proposedGoal).toContain("$317.80");
  });

  // 183.1 deterministic gate: the model's "I already understood everything"
  // is NOT trusted — the server suppresses a goal on the first user turn.
  it("first user turn: proposed goal is suppressed even if the model sends one", async () => {
    global.fetch = vi.fn(async () =>
      solResponse(JSON.stringify({
        reply: "Правильно понимаю: главное — зачесть внесённые $350 как августовский платёж?",
        proposed_goal: "Добиться зачёта $350 как августовского платежа.",
      })),
    ) as any;
    const r = await prepareMessage("u1", "Полный рассказ банковской истории одним сообщением...");
    expect(r.proposedGoal).toBeNull(); // gate wins over the model
    expect(r.reply).toContain("Правильно понимаю");
    // Stored history is sanitized so the model won't think it already proposed.
    const stored = getPrepareHistory("u1")[1].content;
    expect(JSON.parse(stored).proposed_goal).toBe("");
  });

  it("second user turn: a goal is allowed but NOT required (second alignment is fine)", async () => {
    global.fetch = vi.fn(async () =>
      solResponse(JSON.stringify({ reply: "Ещё один уточняющий вопрос: возврат — запасной вариант?", proposed_goal: "" })),
    ) as any;
    getPrepareHistory("u1").push(
      { role: "user", content: "рассказ" },
      { role: "assistant", content: JSON.stringify({ reply: "alignment", proposed_goal: "" }) },
    );
    const r = await prepareMessage("u1", "ответ, создающий новую неопределённость");
    // No goal — and that's valid: the server must not force one.
    expect(r.proposedGoal).toBeNull();
    expect(r.reply).toContain("уточняющий вопрос");
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

  // --- Idempotent confirmation (Task #197) ---

  it("a duplicate confirm with the same id replays the ORIGINAL opening (one Sol call), even after state was cleared", async () => {
    const fetchMock = vi.fn(async () =>
      solResponse(JSON.stringify({ opening_phrase_en: "Hi there.", translation: "Привет." })));
    global.fetch = fetchMock as any;

    const o1 = await prepareOpeningPhrase("u1", "цель", "confirm-1");
    expect(hasOpeningEntry("u1", "confirm-1")).toBe(true);
    // State was cleared by success — the replay cache must have survived that.
    const o2 = await prepareOpeningPhrase("u1", "цель", "confirm-1");
    expect(o2).toEqual(o1);
    expect(fetchMock).toHaveBeenCalledOnce();
    clearOpeningDedup("u1");
  });

  it("a FAILED confirmation is not cached: same id re-runs; explicit reset clears the replay cache", async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return solResponse("no json here");
      return solResponse(JSON.stringify({ opening_phrase_en: "Hello.", translation: "Здравствуйте." }));
    }) as any;

    getPrepareHistory("u1").push({ role: "user", content: "context" });
    await expect(prepareOpeningPhrase("u1", "goal", "c-1")).rejects.toBeInstanceOf(PrepareUnavailableError);
    expect(hasOpeningEntry("u1", "c-1")).toBe(false); // failure evicted
    const o = await prepareOpeningPhrase("u1", "goal", "c-1");
    expect(o.phraseEn).toBe("Hello.");
    expect(calls).toBe(2);

    clearOpeningDedup("u1");
    expect(hasOpeningEntry("u1", "c-1")).toBe(false);
  });

  // --- Bounded lifetime (no unbounded per-user retention) ---

  it("a successful opening replay EXPIRES after the TTL and releases the user's map", async () => {
    vi.useFakeTimers();
    try {
      global.fetch = vi.fn(async () =>
        solResponse(JSON.stringify({ opening_phrase_en: "Hi.", translation: "Привет." }))) as any;
      await prepareOpeningPhrase("u-ttl", "цель", "conf-ttl");
      expect(hasOpeningEntry("u-ttl", "conf-ttl")).toBe(true);
      await vi.advanceTimersByTimeAsync(DEDUP_TTL_MS + 1);
      expect(hasOpeningEntry("u-ttl", "conf-ttl")).toBe(false);
      expect(dedupUserCounts().opening).toBe(0); // no empty map retained
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failed operation leaves NO empty per-user dedup map behind", async () => {
    global.fetch = vi.fn(async () => { throw new Error("network down"); }) as any;
    await expect(prepareMessage("u-fail", "hi", "m-1")).rejects.toBeInstanceOf(PrepareUnavailableError);
    await expect(prepareOpeningPhrase("u-fail", "goal", "c-9")).rejects.toBeInstanceOf(PrepareUnavailableError);
    const counts = dedupUserCounts();
    expect(counts.prepare).toBe(0);
    expect(counts.opening).toBe(0);
  });
});
