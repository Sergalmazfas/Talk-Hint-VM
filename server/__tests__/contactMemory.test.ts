import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Coverage for the pure Contact Memory helpers (server/contactMemory.ts):
//   - deriveOtherPartyPhone: the "which number is the OTHER party" rule that
//     decides where memory is keyed (outgoing -> toNumber, incoming ->
//     fromNumber), skipping "client:" identities and non-E.164 numbers.
//   - formatContactMemory: rendering a saved row into CONTACT_CONTEXT text.
//   - buildContextSections: USER_CONTEXT must come BEFORE CONTACT_CONTEXT in
//     the assembled live-hint prompt.
// These are dependency-free, so no DB / Deepgram / server bootstrap is needed.
// ---------------------------------------------------------------------------

const {
  deriveOtherPartyPhone,
  formatContactMemory,
  buildContextSections,
  buildUserContextSection,
  buildContactContextSection,
} = await import("../contactMemory");

describe("deriveOtherPartyPhone", () => {
  it("uses the dialed number (toNumber) for an outgoing call", () => {
    const phone = deriveOtherPartyPhone({
      direction: "outgoing",
      toNumber: "+15559998888",
      fromNumber: "+15550001111",
    });
    expect(phone).toBe("+15559998888");
  });

  it("uses the caller (fromNumber) for an incoming call", () => {
    const phone = deriveOtherPartyPhone({
      direction: "incoming",
      toNumber: "+15550001111",
      fromNumber: "+15559998888",
    });
    expect(phone).toBe("+15559998888");
  });

  it("treats any non-outgoing direction as incoming (uses fromNumber)", () => {
    // direction can be null / other values; only "outgoing" flips to toNumber.
    expect(
      deriveOtherPartyPhone({ direction: null, toNumber: "+1999", fromNumber: "+1222" }),
    ).toBe("+1222");
  });

  it("rejects a 'client:' identity (browser/iOS leg, not a real number)", () => {
    expect(
      deriveOtherPartyPhone({
        direction: "outgoing",
        toNumber: "client:user-abc",
        fromNumber: "+15550001111",
      }),
    ).toBeNull();
  });

  it("rejects a non-E.164 number (must start with +)", () => {
    expect(
      deriveOtherPartyPhone({
        direction: "incoming",
        toNumber: "+15550001111",
        fromNumber: "15559998888",
      }),
    ).toBeNull();
  });

  it("returns null when the relevant field is missing", () => {
    expect(
      deriveOtherPartyPhone({ direction: "outgoing", toNumber: null, fromNumber: "+1222" }),
    ).toBeNull();
    expect(
      deriveOtherPartyPhone({ direction: "incoming", toNumber: "+1999", fromNumber: undefined }),
    ).toBeNull();
  });
});

describe("formatContactMemory", () => {
  it("renders all populated fields in a stable order", () => {
    const text = formatContactMemory({
      name: "John from accounting",
      lastCallAt: new Date("2026-01-15T10:30:00Z"),
      importance: "high",
      summary: "Regular client booking a massage.",
      notes: "Prefers evenings; allergic to lavender.",
    });
    expect(text).toBe(
      [
        "Name: John from accounting",
        "Last call: 2026-01-15",
        "Importance: high",
        "Summary: Regular client booking a massage.",
        "Notes: Prefers evenings; allergic to lavender.",
      ].join("\n"),
    );
  });

  it("omits a whitespace-only name and trims a populated one", () => {
    expect(formatContactMemory({ name: "   ", summary: "x" })).toBe("Summary: x");
    expect(formatContactMemory({ name: "  Jane  " })).toBe("Name: Jane");
  });

  it("omits empty / whitespace-only / missing fields", () => {
    const text = formatContactMemory({
      lastCallAt: null,
      importance: "  ",
      summary: "Just a summary.",
      notes: null,
    });
    expect(text).toBe("Summary: Just a summary.");
  });

  it("returns an empty string when nothing is known", () => {
    expect(formatContactMemory({})).toBe("");
  });

  it("accepts a date string for lastCallAt", () => {
    const text = formatContactMemory({ lastCallAt: "2026-06-09T00:00:00Z" });
    expect(text).toBe("Last call: 2026-06-09");
  });
});

describe("buildContextSections (prompt ordering)", () => {
  it("places CONTACT_CONTEXT AFTER USER_CONTEXT", () => {
    const contactContext = formatContactMemory({
      importance: "high",
      summary: "Returning customer.",
    });
    const block = buildContextSections("I run a massage studio.", contactContext);

    const userIdx = block.indexOf("USER_CONTEXT");
    const contactIdx = block.indexOf("CONTACT_CONTEXT");

    expect(userIdx).toBeGreaterThanOrEqual(0);
    expect(contactIdx).toBeGreaterThan(userIdx);
  });

  it("builds the CONTACT_CONTEXT block from the loaded/rendered memory", () => {
    const contactContext = formatContactMemory({
      summary: "Wants a Tuesday slot.",
      notes: "VIP.",
    });
    const block = buildContextSections("", contactContext);

    expect(block).toContain("CONTACT_CONTEXT");
    expect(block).toContain("Wants a Tuesday slot.");
    expect(block).toContain("VIP.");
  });

  it("emits each section only when its context is non-empty", () => {
    expect(buildContextSections("", "")).toBe("");
    expect(buildContextSections("   ", "  ")).toBe("");

    const onlyUser = buildContextSections("user info", "");
    expect(onlyUser).toContain("USER_CONTEXT");
    expect(onlyUser).not.toContain("CONTACT_CONTEXT");

    const onlyContact = buildContextSections("", "contact info");
    expect(onlyContact).toContain("CONTACT_CONTEXT");
    expect(onlyContact).not.toContain("USER_CONTEXT");
  });

  it("buildContextSections is exactly user-section followed by contact-section", () => {
    const u = "studio owner";
    const c = "returning client";
    expect(buildContextSections(u, c)).toBe(
      buildUserContextSection(u) + buildContactContextSection(c),
    );
  });
});
