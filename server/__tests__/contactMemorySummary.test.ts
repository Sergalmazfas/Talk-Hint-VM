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

describe("parseContactSummary (robust JSON extraction)", () => {
  const OBJ = { name: "John", summary: "Bank support call", notes: "case #1", importance: "high" };

  it("parses JSON wrapped in a markdown code fence", () => {
    const parsed = parseContactSummary("```json\n" + JSON.stringify(OBJ) + "\n```");
    expect(parsed?.summary).toBe(OBJ.summary);
  });

  it("parses JSON surrounded by prose — even prose containing extra braces", () => {
    const raw = `Here is the memory:\n${JSON.stringify(OBJ)}\nHope this helps { extra } trailing.`;
    // The old greedy first-{…last-} regex captured through the trailing brace
    // and returned null here.
    const parsed = parseContactSummary(raw);
    expect(parsed?.notes).toBe(OBJ.notes);
  });

  it("skips a broken brace block and parses the next valid object", () => {
    const raw = `{oops not json} ${JSON.stringify(OBJ)}`;
    expect(parseContactSummary(raw)?.summary).toBe(OBJ.summary);
  });

  it("handles braces inside JSON string values", () => {
    const withBraces = { ...OBJ, notes: 'said "{account} blocked"' };
    expect(parseContactSummary(JSON.stringify(withBraces))?.notes).toBe(withBraces.notes);
  });

  it("classifies parse failures without exposing content", async () => {
    const { classifySummaryParseFailure, summarizeAndSaveContactMemory } = await import("../contactMemory");
    expect(classifySummaryParseFailure("")).toBe("empty_output");
    expect(classifySummaryParseFailure("I cannot summarize this call.")).toBe("no_json_object");
    expect(classifySummaryParseFailure("{broken")).toBe("unparseable_json");
    expect(classifySummaryParseFailure('{"summary":"","notes":""}')).toBe("empty_summary_fields");

    // PII guard: the failure log must never contain transcript-derived model
    // output — only safe metadata (length + reason category).
    const secret = "SSN 123-45-6789 John Doe account 4242";
    const log = vi.fn();
    await summarizeAndSaveContactMemory(
      "u1",
      "+15550000000",
      [{ speaker: "Guest", text: "hello" }],
      { generate: async () => `refusal mentioning ${secret}`, save: vi.fn(), log },
    );
    const logged = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("no usable summary");
    expect(logged).toContain("reason=no_json_object");
    expect(logged).not.toContain("123-45-6789");
    expect(logged).not.toContain("John Doe");
  });

  it("still returns null for refusals / plain text / empty output", () => {
    expect(parseContactSummary("I cannot summarize this call.")).toBeNull();
    expect(parseContactSummary("")).toBeNull();
    expect(parseContactSummary('{"summary":"","notes":""}')).toBeNull();
  });
});

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
      name: "",
      summary: "Returning client booking a massage.",
      notes: "Prefers Tuesday evenings.",
      importance: "high",
    });
  });

  it("extracts and trims the contact's name when present", () => {
    const parsed = parseContactSummary(
      JSON.stringify({
        name: "  John  ",
        summary: "Caller introduced himself.",
        notes: "",
        importance: "low",
      }),
    );
    expect(parsed!.name).toBe("John");
  });

  it("returns an empty name when none is provided or it isn't a string", () => {
    expect(
      parseContactSummary(JSON.stringify({ summary: "s", notes: "n" }))!.name,
    ).toBe("");
    expect(
      parseContactSummary(JSON.stringify({ name: 42, summary: "s", notes: "n" }))!.name,
    ).toBe("");
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

  it("passes the model-extracted name to the upsert (which fills it atomically)", async () => {
    const save = vi.fn(async () => ({ id: "cm-name" }));

    await summarizeAndSaveContactMemory(USER_ID, PHONE, TRANSCRIPT, {
      generate: async () =>
        JSON.stringify({ name: "John", summary: "Caller introduced himself.", notes: "", importance: "low" }),
      save,
    });

    expect(save).toHaveBeenCalledTimes(1);
    // The "never overwrite a user-set name" guarantee now lives in the upsert
    // (COALESCE), so the summarizer always forwards the extracted name and lets
    // the single atomic write decide — no read-then-write step here.
    expect(save.mock.calls[0][0].name).toBe("John");
  });

  it("does not send a name when the model extracted none", async () => {
    const save = vi.fn(async () => ({ id: "cm-noname" }));

    await summarizeAndSaveContactMemory(USER_ID, PHONE, TRANSCRIPT, {
      generate: async () => JSON.stringify({ summary: "Wants a quote.", notes: "", importance: "low" }),
      save,
    });

    // Without an extracted name the upsert must not touch the name column at all.
    expect(save.mock.calls[0][0]).not.toHaveProperty("name");
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
