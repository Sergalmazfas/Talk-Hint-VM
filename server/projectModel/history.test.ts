import { describe, expect, it } from "vitest";
import { activeModelSize, packModel, unpackModel } from "./history";
import { initialModel } from "./seed";
import { applyCommand } from "./domain";
import { defaultOperatingModel } from "../../shared/operatingModelTemplate";
import { randomUUID } from "node:crypto";
import { crewCoordinationSchema } from "../../shared/productCrew";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import OperatingModelView from "../../client/src/components/project-model/OperatingModelView";

function archivedReader(chunks: Map<string, unknown>, expectedOwner = "owner") {
  return { query: async (_sql: string, values: any[]) => ({
    rows: values[0] === expectedOwner ? Array.from(chunks, ([key, payload]) => ({ key, payload })) : [],
  }) } as any;
}
describe("lossless project-model history", () => {
  it("lets legacy audit exceed 5M without exempting a large working set", async () => {
    const old = initialModel();
    old.decisions = Array.from({ length: 110 }, (_, i) => ({
      id: `DEC-${i}`, at: "2026-10-25", actor: "owner", action: "Legacy audit",
      reason: "Юникод".repeat(10000), elementIds: [],
    }));
    const original = structuredClone(old);
    const next = applyCommand(old, { type: "saveDocument", title: "New intake", text: "Evidence, not worker execution", url: "", elementIds: [] }, "owner");
    expect(JSON.stringify(next).length).toBeGreaterThan(5_000_000);
    expect(activeModelSize(next)).toBeLessThan(100_000);
    const packed = packModel(next);
    expect(JSON.stringify(packed.state).length).toBeLessThan(100_000);
    expect(await unpackModel(archivedReader(packed.chunks), "owner", packed.state)).toEqual(next);
    expect(old).toEqual(original);
    (old as any).activePayload = "x".repeat(5_000_001);
    expect(() => applyCommand(old, { type: "saveDocument", title: "Too large", text: "", url: "", elementIds: [] }, "owner")).toThrow("CPU/RAM");
  });
  it("keeps organisation versions, UI history and canonical audit references after repeated packing", async () => {
    let state = initialModel();
    for (let i = 0; i < 40; i++) {
      const data = defaultOperatingModel();
      data.nodes[0].description = `Organisation revision ${i + 1}`;
      state = applyCommand(state, { type: "saveOperatingModel", baseVersion: i, data }, "owner");
    }
    const packed = packModel(state);
    const restored = await unpackModel(archivedReader(packed.chunks), "owner", JSON.parse(JSON.stringify(packed.state)));
    expect(restored).toEqual(state);
    const repacked = packModel(restored);
    expect(repacked).toEqual(packed);
    expect(restored.operatingModel!.revisions[0].data.nodes[0].description).toBe("Organisation revision 1");
    const html = renderToStaticMarkup(React.createElement(OperatingModelView, { state: restored, submit: async () => {} }));
    expect(html).toContain("История");
    expect(html).toContain("v40");
    const previous = { ...restored, operatingModel: { revisions: restored.operatingModel!.revisions.slice(0, 1) } };
    expect(renderToStaticMarkup(React.createElement(OperatingModelView, { state: previous, submit: async () => {} }))).toContain("v1");
  });
  it("fails closed on missing, corrupted or cross-owner chunks; never writes partial history", async () => {
    const state = initialModel();
    state.decisions = [0, 1].map(i => ({ id: `D${i}`, at: "", actor: "owner", action: "", reason: "private", elementIds: [] }));
    const packed = packModel(state);
    await expect(unpackModel(archivedReader(packed.chunks), "other", packed.state)).rejects.toThrow("Архив");
    await expect(unpackModel(archivedReader(new Map()), "owner", packed.state)).rejects.toThrow("Архив");
    const damaged = new Map(Array.from(packed.chunks, ([key, payload]) => [key, { ...payload, items: [] }]));
    await expect(unpackModel(archivedReader(damaged), "owner", packed.state)).rejects.toThrow("Архив");
    expect(() => packModel(packed.state)).toThrow("архивом");
  });
  it("retains receipts beyond 100 passport updates instead of losing retry identities", () => {
    const operations = Array.from({ length: 120 }, () => ({ id: randomUUID(), fingerprint: "a".repeat(64), at: new Date().toISOString() }));
    expect(crewCoordinationSchema.parse({ kind: "role_passport", state: "accepted", roleId: "role",
      processId: "process", relatedIds: [], nextStep: "Next", origin: "owner_chatgpt", operations }).operations).toEqual(operations);
  });
});
