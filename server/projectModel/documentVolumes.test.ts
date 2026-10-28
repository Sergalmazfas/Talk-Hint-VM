import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { splitDocumentText, documentVolumeManifest, documentTextLimit } from "./documentVolumes";
import { initialModel } from "./seed";
import { applyCommand } from "./domain";
import { activeModelSize, packModel, unpackModel } from "./history";
import { ProductCrewService } from "../productCrew/service";
import { defaultOperatingModel } from "../../shared/operatingModelTemplate";

const reader = (chunks: Map<string, unknown>, owner = "owner") => ({
  query: async (_sql: string, params: any[]) => ({
    rows: params[0] === owner ? [...chunks].map(([key, payload]) => ({ key, payload })) : [],
  }),
}) as any;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

describe("stage 0 document volumes, existing identity and readers", () => {
  it("preserves exact text including surrogate boundaries and hashes", () => {
    const text = "я".repeat(49_999) + "🔬" + "a".repeat(50_001);
    const parts = splitDocumentText(text);
    expect(parts.join("")).toBe(text);
    expect(parts.every(p => p.length <= 50_000)).toBe(true);
    const manifest = documentVolumeManifest("DOC-TEST", text);
    expect(manifest.digest).toBe(hash(text));
    expect(manifest.volumes.map(p => p.digest)).toEqual(parts.map(hash));
  });
  it("round-trips large and historical documents through storage, export and get_document", async () => {
    const old = initialModel();
    old.documents = []; old.decisions = [];
    const first = applyCommand(old, { type: "createDocument", id: "DOC-TEST",
      title: "Book", text: "original", url: "", elementIds: [] }, "owner");
    const next = applyCommand(first, { type: "saveDocument", id: "DOC-TEST",
      title: "Book", text: "Стенд 🔬\n".repeat(20_000), url: "", elementIds: [] }, "owner");
    const packed = packModel(next);
    expect(packed.state.documents[0].text).toBe("");
    expect(packed.chunks.size).toBeGreaterThan(1);
    const restored = await unpackModel(reader(packed.chunks), "owner",
      JSON.parse(JSON.stringify(packed.state)));
    expect(restored).toEqual(next);
    expect(packModel(restored)).toEqual(packed);
    expect(activeModelSize(restored)).toBe(activeModelSize(next)); // No fake capacity savings.
    expect(first.documents[0].text).toBe("original");
    expect(restored.decisions).toEqual(next.decisions);
    const readable = applyCommand(restored, { type: "saveOperatingModel", baseVersion: 0,
      data: defaultOperatingModel() }, "owner");
    const service = new ProductCrewService({ read: async () => readable,
      update: async () => { throw Error("read only"); } });
    const actual: any = await service.call("owner", "get_document", { documentId: "DOC-TEST" });
    expect(actual.id).toBe("DOC-TEST");
    expect(actual.text).toBe(next.documents[0].text);
    expect(actual.snapshotHash).toBe(hash(actual.text));
    expect(actual.volumeManifest.digest).toBe(hash(actual.text));
    expect(JSON.parse(JSON.stringify(restored)).documents[0].text).toBe(actual.text);
  });
  it("fails closed for missing, corrupt, cross-owner and incomplete volumes", async () => {
    const state = initialModel();
    state.decisions = [];
    state.documents = [{ id: "DOC-TEST", title: "Book", text: "я".repeat(80_000),
      url: "", elementIds: [], updatedAt: "" }];
    const packed = packModel(state);
    await expect(unpackModel(reader(new Map()), "owner", packed.state)).rejects.toThrow("Архив");
    await expect(unpackModel(reader(packed.chunks), "foreign", packed.state)).rejects.toThrow("Архив");
    const damaged = structuredClone(packed.chunks);
    const [key, payload] = [...damaged][0];
    damaged.set(key, { ...payload, items: ["changed"] });
    await expect(unpackModel(reader(damaged), "owner", packed.state)).rejects.toThrow("Архив");
    const bad = structuredClone(packed.state) as any;
    bad.documents[0].__modelHistoryV1.text.digest = "invalid";
    await expect(unpackModel(reader(packed.chunks), "owner", bad)).rejects.toThrow("сумма");
    expect(() => packModel(packed.state)).toThrow("архивом");
  });
  it("keeps old documents unchanged and enforces the whole-document limit atomically", async () => {
    const state = initialModel();
    state.documents = []; state.decisions = [];
    const next = applyCommand(state, { type: "createDocument", id: "DOC-TEST",
      title: "Old", text: "старый", url: "", elementIds: [] }, "owner");
    const packed = packModel(next);
    expect(packed.state.documents).toEqual(next.documents);
    expect(packed.chunks.size).toBe(0);
    expect(await unpackModel(reader(packed.chunks), "owner", packed.state)).toEqual(next);
    expect(() => applyCommand(next, { type: "saveDocument", id: "DOC-TEST", title: "Too large",
      text: "x".repeat(documentTextLimit + 1), url: "", elementIds: [] }, "owner")).toThrow();
    expect(next.documents[0].text).toBe("старый");
  });
});
