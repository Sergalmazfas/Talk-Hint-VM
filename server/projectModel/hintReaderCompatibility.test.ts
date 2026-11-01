import { describe, expect, it } from "vitest";
import { readProductBook, productBookMarker, productBookText, productBookDocumentId } from "../../shared/productBook";
import { passportChapterSchema, readPassportChapter, getPassportChapterPacket } from "../../shared/passportChapter";
import { initialModel } from "./seed";

const at = "2026-11-01T00:00:00.000Z";
const document = (id: string, text: string) => ({ id, text, title: "Fixture", url: "", elementIds: [], updatedAt: at });
function chapter() {
  const layer = () => ({ title: "Layer", summary: "Description",
    progress: { described: true, implemented: null, verified: null, accepted: null, planned: true },
    leadRoleId: null, participantRoleIds: [], assignment: "Not activated", actionIds: [],
    inputs: "Source", output: "Report", receiver: "Owner", acceptance: "Separate",
    next: "Review", sourceIds: [], unknown: [] });
  return {
    format: "talkhint.passport-chapter", version: 1, mode: "hint", title: "Hint",
    status: "На согласовании", bookDocumentId: productBookDocumentId,
    relatedFeatureIds: [], snapshotDate: at, capturedAt: at, sourceRevision: 1046,
    scope: "Descriptions", identityNote: "No activation",
    schedule: { startedOn: at, dueOn: "Not set", basis: "Owner" },
    layers: { product: layer(), workflow: layer(), lab: layer(), metrics: layer(), bench: layer(), design: layer() },
    sources: [], metrics: [], labs: [], runs: [], procedures: [], requests: [],
    reviewProtocol: [], nextChapters: [], limitations: [],
    labHistory: { status: "предложение", proposal: "Review first", fields: [], noImplementation: "No runtime" },
    katyaDuration: { milliseconds: 300000, scope: "Historical", evidence: "Source",
      remoteVerified: false, separateSilenceTimeout: true },
  };
}
function book() {
  return { version: 14, updatedAt: at, snapshotDate: at, status: "На согласовании", lifecycle: "Draft",
    purpose: "Purpose", vision: "Vision", b2c: "B2C", b2b: "B2B", current: "Current", nextStage: "Review",
    completion: "Owner", features: [], legal: "No change", finance: "No change",
    responsibilities: "Roles", contradictions: "Unknown", roadmap: "Roadmap",
    previousPassport: `Original ${productBookMarker} including "quotes", [braces] and {objects}`,
    chapterRefs: { hint: "DOC-TALKHINT-CHAPTER-HINT" },
    futureBookMetadata: { keep: true }, preservedSourceSuffix: "an existing extension",
  };
}
describe("non-destructive Hint readers", () => {
  it("preserves extra root and nested chapter fields without weakening known validation", () => {
    const c = chapter() as any;
    c.ownerFeedback = { keep: ["owner note"] }; c.updatedAt = at;
    c.layers.lab.future = { nested: true }; c.layers.lab.progress.detail = "keep";
    c.schedule.extra = "keep"; c.katyaDuration.other = "keep";
    const doc = document("DOC-TALKHINT-CHAPTER-HINT", JSON.stringify(c)), before = structuredClone(doc);
    expect(readPassportChapter(doc)).toEqual(c);
    expect(doc).toEqual(before);
    expect(passportChapterSchema.safeParse({ ...c, sourceRevision: "1046" }).success).toBe(false);
    expect(passportChapterSchema.safeParse({ ...c, mode: "secretary" }).success).toBe(false);
    c.layers.lab.progress.described = "yes";
    expect(readPassportChapter(document(doc.id, JSON.stringify(c)))).toBeNull();
  });
  it("reads markers inside quoted previousPassport and retains appended owner text on round trip", () => {
    const b = book(), suffix = '\n\n## Правила v3 и единый журнал улучшений\nPreserve me. {"not":"the root"}';
    const doc = document(productBookDocumentId, `Preamble\n${productBookMarker}\n${JSON.stringify(b)}${suffix}`);
    const before = structuredClone(doc), parsed = readProductBook(doc)!;
    expect(parsed).not.toBeNull();
    expect(parsed.previousPassport).toBe(b.previousPassport);
    expect(parsed.futureBookMetadata).toEqual(b.futureBookMetadata);
    expect(parsed.preservedSourceSuffix).toBe("an existing extension");
    expect(parsed._preservedSourceSuffix).toBe(suffix);
    expect(readProductBook(document(doc.id, productBookText(parsed)))).toEqual(parsed);
    expect(doc).toEqual(before);
  });
  it("does not rewrite oversized canonical metadata to meet a Markdown budget", () => {
    const b = { ...book(), futureBookMetadata: { keep: true, text: "x".repeat(52000) } };
    const doc = document(productBookDocumentId, `${productBookMarker}\n${JSON.stringify(b)}`);
    const parsed = readProductBook(doc)!;
    expect(readProductBook(document(doc.id, productBookText(parsed)))).toEqual(b);
    expect(JSON.stringify(parsed)).toContain("x".repeat(52000));
  });
  it.each(["", "{}", '{"version":14,', '[]', '{"version":14,"features":[],"previousPassport":12}'])(
    "rejects missing or malformed known book data %#", text => {
      expect(readProductBook(document(productBookDocumentId, `${productBookMarker}\n${text}`))).toBeNull();
    });
  it("resolves only the canonical selected book pointer, preserves extra data, never substitutes a different chapter", () => {
    const s = initialModel(), c = { ...chapter(), future: { keep: true } };
    (c.layers as any).futureMetadata = { notARoleLayer: true };
    s.documents = [document(productBookDocumentId, `${productBookMarker}\n${JSON.stringify(book())}\n\n## Правила v3 и единый журнал улучшений\nOwner note`),
      document("DOC-TALKHINT-CHAPTER-HINT", JSON.stringify(c))];
    const before = structuredClone(s);
    expect(getPassportChapterPacket(s, "hint")?.chapter).toEqual(c);
    expect(getPassportChapterPacket(s, "translator")).toBeNull();
    expect(s).toEqual(before);
    s.documents[1].id = "DIFFERENT-DOC";
    expect(getPassportChapterPacket(s, "hint")).toBeNull();
  });
});
