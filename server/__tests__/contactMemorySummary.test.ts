import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Coverage for the post-call summarization step (server/contactMemory.ts):
//   - parseContactSummary: the pure parse/normalize rules for the model's
//     output (JSON extraction, trimming, importance normalization, the empty
//     guard, and unparseable/non-JSON inputs).
//   - summarizeAndSaveContactMemory: the orchestration that calls the model,
//     parses it, and upserts memory. The model call (`generate`) and the
//     storage write (`save`) are injected, so this runs with no live
//     OpenAI/Gemini call and no Postgres — consistent with the other tests.
// ---------------------------------------------------------------------------

const {
  parseContactSummary,
  summarizeAndSaveContactMemory,
  buildTranscriptConvo,
} = await import("../contactMemory");

const TRANSCRIPT = [
  { speaker: "Owner", text: "Hi, thanks for calling the studio." },
  { speaker: "Guest", text: "I'd like to book a massage for next Tuesday evening." },
];

const USER_ID = "user-a";
const PHONE = "+15559998888";

describe("parseContactSummary", () => {
  it("parses valid JSON and trims summary/notes", () => {
    const parsed = parseContactSummary(
      JSON.stringify({
        summary: "  Returning client booking a massage.  ",
        notes: "  Prefers Tuesday evenings.  ",
        importance: "high",
      }),
    );
    expect(parsed).toEqual({
      summary: "Returning client booking a massage.",
      notes: "Prefers Tuesday evenings.",
      importance: "high",
    });
  });

  it("extracts the JSON object even when wrapped in prose / markdown fences", () => {
    const raw =
      "Sure, here's the summary:\n```json\n" +
      JSON.stringify({ summary: "Wants a quote.", notes: "", importance: "low" }) +
      "\n```\nHope that helps!";
    const parsed = parseContactSummary(raw);
    expect(parsed).toMatchObject({ summary: "Wants a quote.", importance: "low" });
  });

  it("normalizes an unknown importance value to 'medium'", () => {
    const parsed = parseContactSummary(
      JSON.stringify({ summary: "Generic call.", notes: "x", importance: "URGENT" }),
    );
    expect(parsed!.importance).toBe("medium");
  });

  it("normalizes a missing/non-string importance to 'medium'", () => {
    expect(
      parseContactSummary(JSON.stringify({ summary: "s", notes: "n" }))!.importance,
    ).toBe("medium");
    expect(
      parseContactSummary(JSON.stringify({ summary: "s", notes: "n", importance: 5 }))!.importance,
    ).toBe("medium");
  });

  it("lower-cases and trims a valid importance value", () => {
    const parsed = parseContactSummary(
      JSON.stringify({ summary: "s", notes: "", importance: "  HIGH  " }),
    );
    expect(parsed!.importance).toBe("high");
  });

  it("returns null when both summary and notes are empty/whitespace", () => {
    expect(
      parseContactSummary(JSON.stringify({ summary: "   ", notes: "", importance: "high" })),
    ).toBeNull();
  });

  it("returns null for output with no JSON object", () => {
    expect(parseContactSummary("I could not summarize this call.")).toBeNull();
    expect(parseContactSummary("")).toBeNull();
  });

  it("returns null for malformed / unparseable JSON", () => {
    expect(parseContactSummary("{ summary: 'no quotes', importance: high }")).toBeNull();
    expect(parseContactSummary('{"summary": "truncated", "notes":')).toBeNull();
  });
});

describe("buildTranscriptConvo", () => {
  it("flattens speakers and caps at 6000 chars", () => {
    const convo = buildTranscriptConvo(TRANSCRIPT);
    expect(convo).toBe(
      "Owner: Hi, thanks for calling the studio.\nGuest: I'd like to book a massage for next Tuesday evening.",
    );

    const huge = [{ speaker: "Guest", text: "x".repeat(10000) }];
    expect(buildTranscriptConvo(huge).length).toBe(6000);
  });
});

describe("summarizeAndSaveContactMemory", () => {
  it("saves trimmed summary/notes and normalized importance for valid output", async () => {
    const generate = vi.fn(async () =>
      JSON.stringify({
        summary: "  Returning client booking a massage.  ",
        notes: "  Prefers evenings.  ",
        importance: "HIGH",
      }),
    );
    const save = vi.fn(async () => ({ id: "cm-1" }));
    const now = new Date("2026-06-09T12:00:00Z");

    await summarizeAndSaveContactMemory(USER_ID, PHONE, TRANSCRIPT, {
      generate,
      save,
      now: () => now,
    });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({
      userId: USER_ID,
      phoneNumber: PHONE,
      summary: "Returning client booking a massage.",
      notes: "Prefers evenings.",
      importance: "high",
      lastCallAt: now,
    });
  });

  it("stores null for an empty notes field while keeping the summary", async () => {
    const save = vi.fn(async () => ({ id: "cm-2" }));
    await summarizeAndSaveContactMemory(USER_ID, PHONE, TRANSCRIPT, {
      generate: async () => JSON.stringify({ summary: "Wants a quote.", notes: "", importance: "low" }),
      save,
    });

    expect(save).toHaveBeenCalledTimes(1);
    const arg = save.mock.calls[0][0];
    expect(arg.summary).toBe("Wants a quote.");
    expect(arg.notes).toBeNull();
    expect(arg.importance).toBe("low");
  });

  it("skips the save when summary and notes are both empty", async () => {
    const save = vi.fn(async () => ({ id: "nope" }));
    await summarizeAndSaveContactMemory(USER_ID, PHONE, TRANSCRIPT, {
      generate: async () => JSON.stringify({ summary: "  ", notes: "", importance: "high" }),
      save,
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("does not save for non-JSON / unparseable model output and does not throw", async () => {
    const save = vi.fn(async () => ({ id: "nope" }));

    await expect(
      summarizeAndSaveContactMemory(USER_ID, PHONE, TRANSCRIPT, {
        generate: async () => "Sorry, I can't help with that.",
        save,
      }),
    ).resolves.toBeUndefined();
    expect(save).not.toHaveBeenCalled();

    await expect(
      summarizeAndSaveContactMemory(USER_ID, PHONE, TRANSCRIPT, {
        generate: async () => "{ broken json",
        save,
      }),
    ).resolves.toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  });

  it("skips the model call entirely when the transcript is empty", async () => {
    const generate = vi.fn(async () => "{}");
    const save = vi.fn(async () => ({ id: "nope" }));

    await summarizeAndSaveContactMemory(USER_ID, PHONE, [], { generate, save });

    expect(generate).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("never throws when the model call rejects", async () => {
    const save = vi.fn(async () => ({ id: "nope" }));
    const log = vi.fn();

    await expect(
      summarizeAndSaveContactMemory(USER_ID, PHONE, TRANSCRIPT, {
        generate: async () => {
          throw new Error("model down");
        },
        save,
        log,
      }),
    ).resolves.toBeUndefined();

    expect(save).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });

  it("never throws when the storage save rejects", async () => {
    const log = vi.fn();

    await expect(
      summarizeAndSaveContactMemory(USER_ID, PHONE, TRANSCRIPT, {
        generate: async () => JSON.stringify({ summary: "ok", notes: "", importance: "low" }),
        save: async () => {
          throw new Error("db down");
        },
        log,
      }),
    ).resolves.toBeUndefined();

    expect(log).toHaveBeenCalled();
  });
});
