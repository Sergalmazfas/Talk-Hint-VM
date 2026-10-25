import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), setup: vi.fn(), prepare: vi.fn(), connect: vi.fn() }));
vi.mock("../../db", () => ({ pool: { query: f.query, connect: f.connect } }));
vi.mock("./outgoing", () => ({ outgoingSettings: f.setup, prepareOutgoingContext: f.prepare }));
import { initializeOwnerSecretaryDefaults, ownerSecretaryRelease, outgoingDefault,
  prepareDefaultCall, confirmedOutgoingContext, contextHash } from "./defaults";
import { releaseKatyaV2 } from "./katyaV2";
import { callPresentation } from "../../chatgpt/callPresentation";

const binding = { personalityId: "katya-id", version: 2, mode: "personal",
  snapshot: { name: "Катя", rules: "approved rules", examples: ["approved example"] } };
const context = { version: 1, numberId: "personal-id", fromNumber: "+15555550123", scope: "personal",
  personality: binding, cards: [], cardIds: [] };
beforeEach(() => {
  vi.resetAllMocks();
  f.connect.mockResolvedValue({ query: f.query, release: f.release });
  f.query.mockResolvedValue({ rows: [], rowCount: 0 });
  f.setup.mockResolvedValue({ ...context, assignment: binding });
  f.prepare.mockResolvedValue(structuredClone(context));
});
describe("shared owner outgoing defaults", () => {
  it("does not fall back to legacy GPT when a configured line is no longer owned", async () => {
    f.query.mockResolvedValue({ rows: [{ number_id: "revoked-line" }] });
    f.setup.mockRejectedValue(Object.assign(new Error("Owned line unavailable"), { status: 404 }));
    await expect(prepareDefaultCall("owner", { voiceProvider: "openai" })).rejects.toMatchObject({ status: 404 });
    expect(f.setup).toHaveBeenCalledWith("owner", "revoked-line");
    expect(f.prepare).not.toHaveBeenCalled();
  });
  it("has no default for another account and preserves its legacy provider", async () => {
    expect(await outgoingDefault("other-owner")).toBeUndefined();
    expect(await prepareDefaultCall("other-owner", {})).toEqual({ voiceProvider: "openai" });
    expect(f.query.mock.calls.every(c => c[1][0] === "other-owner")).toBe(true);
    expect(f.prepare).not.toHaveBeenCalled();
  });
  it("resolves the saved owned line, pins Katya v2 and hides full rules/cards from a signed draft", async () => {
    f.query.mockResolvedValue({ rows: [{ number_id: "personal-id" }] });
    const draft = await prepareDefaultCall("owner", { voiceProvider: "openai", instruction: "Call about a meeting" });
    expect(draft).toMatchObject({ voiceProvider: "retell", secretaryNumberId: "personal-id",
      outgoingContextHash: contextHash(context), outgoingSummary: {
        fromNumber: context.fromNumber, personality: { id: "katya-id", name: "Катя", version: 2 } } });
    expect(f.prepare).toHaveBeenCalledWith("owner", "personal-id", "retell");
    expect(JSON.stringify(draft)).not.toContain("approved rules");
    expect(callPresentation("retell", draft.outgoingSummary)).toMatchObject({
      model: "gpt-6.1-sol", reasoning: "medium", voice: "retell-Merritt",
      outgoing: { personality: { version: 2 } },
    });
  });
  it("reconstructs exactly the confirmed context and detects changed facts, permissions and character", async () => {
    const input = { voiceProvider: "retell", secretaryNumberId: "personal-id", outgoingContextHash: contextHash(context) };
    expect(await confirmedOutgoingContext("owner", input)).toEqual(context);
    for (const altered of [
      { ...context, cardIds: ["different"] },
      { ...context, personality: { ...binding, version: 3 } },
      { ...context, scope: "work" },
    ]) {
      f.prepare.mockResolvedValueOnce(altered);
      await expect(confirmedOutgoingContext("owner", input)).rejects.toMatchObject({ status: 409 });
    }
  });
  it("rejects incomplete bindings while allowing recovery of previously approved legacy drafts", async () => {
    await expect(confirmedOutgoingContext("owner", { voiceProvider: "retell", secretaryNumberId: "x" })).rejects.toMatchObject({ status: 409 });
    expect(await confirmedOutgoingContext("owner", { voiceProvider: "openai" })).toBeUndefined();
    expect(f.prepare).not.toHaveBeenCalled();
  });
  it("canonical hash ignores object key order but not conversational content", () => {
    expect(contextHash({ a: 1, b: { c: 2 } })).toBe(contextHash({ b: { c: 2 }, a: 1 }));
    expect(contextHash(context)).not.toBe(contextHash({ ...context, personality: null }));
  });
  it("refuses to seed when the approved owner no longer owns the personal line", async () => {
    await expect(initializeOwnerSecretaryDefaults()).rejects.toMatchObject({ status: 503 });
    expect(f.query).toHaveBeenCalledWith(expect.stringContaining("user_id=$2 AND type='personal'"),
      [ownerSecretaryRelease.numberId, ownerSecretaryRelease.ownerId]);
    expect(f.query.mock.calls.some(c => c[0].includes("INSERT"))).toBe(false);
    expect(f.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("seeds only the explicit owner and preserves existing assignments, facts and edits", async () => {
    f.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT id FROM phone_numbers") || sql.startsWith("SELECT id FROM secretary_personalities"))
        return { rowCount: 1, rows: [{ id: "expected" }] };
      if (sql.startsWith("SELECT content")) return { rows: [{ content: releaseKatyaV2 }] };
      return { rowCount: 1, rows: [] };
    });
    await initializeOwnerSecretaryDefaults();
    const inserts = f.query.mock.calls.filter(c => c[0].startsWith("INSERT"));
    expect(inserts).toHaveLength(5);
    expect(inserts.every(c => c[0].includes("ON CONFLICT") && c[0].includes("DO NOTHING"))).toBe(true);
    expect(inserts.some(c => c[0].includes("UPDATE"))).toBe(false);
    expect(f.query).toHaveBeenLastCalledWith("COMMIT");
    expect(inserts.find(c => c[0].includes("secretary_outgoing_settings"))?.[0]).toContain("'[]'::jsonb");
  });
});
