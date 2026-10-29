import { describe, expect, it, vi } from "vitest";
import { ProductCrewService } from "../productCrew/service";
import { documentVolumeLength } from "../projectModel/documentVolumes";

describe("same MCP document contract through the normalized source", () => {
  it("reads one exact document without expanding all operating history", async () => {
    const document = { id: "D", title: "Книга", text: "a".repeat(documentVolumeLength + 1),
      url: "", elementIds: [], updatedAt: "2026-10-28T00:00:00.000Z" };
    const read = vi.fn(async () => { throw new Error("Full model must not be loaded"); });
    const snapshot = vi.fn(async () => ({ revision: 912, document }));
    const service = new ProductCrewService({ read, readDocumentSnapshot: snapshot, update: vi.fn() });
    const out = await service.call("owner", "get_document", { documentId: "D" });
    expect(snapshot).toHaveBeenCalledWith("owner", "new-country", "D");
    expect(read).not.toHaveBeenCalled();
    expect(out).toMatchObject({ ...document, revision: 912, mimeType: "text/markdown",
      downloadPath: "/api/admin/product-crew/documents/D/download" });
    expect(out.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(out.volumeManifest).toBeDefined();
  });
  it("does not silently fall back when an active normalized source refuses a document", async () => {
    const read = vi.fn();
    const service = new ProductCrewService({ read, update: vi.fn(),
      readDocumentSnapshot: async () => { throw new Error("Digest mismatch"); } });
    await expect(service.call("owner", "get_document", { documentId: "D" })).rejects.toThrow("Digest mismatch");
    expect(read).not.toHaveBeenCalled();
  });
});
