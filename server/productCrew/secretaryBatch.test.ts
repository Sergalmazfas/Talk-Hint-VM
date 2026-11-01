import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ModelCommand } from "../../shared/projectModel";
import { buildCompanyStructure } from "../../shared/companyStructure";
import { defaultOperatingModel } from "../../shared/operatingModelTemplate";
import { initialModel } from "../projectModel/seed";
import { applyCommand } from "../projectModel/domain";
import { PgModelRepository } from "../projectModel/repository";
import { CompanyModelRepository } from "../companyData/repository";
import { CommandCompanyRepository } from "../companyData/v3/commands";
import { assertTransactionBatch, assertRevisionAdvance, authorizeSecretaryDepartmentBatch,
  bindSecretaryDepartmentPreparation } from "../projectModel/transactionBatch";
import { ProductCrewService } from "./service";

const boundary = new Error("isolated storage boundary");
async function packet() {
  const state = applyCommand(initialModel(), { type: "saveOperatingModel", baseVersion: 0,
    data: buildCompanyStructure(defaultOperatingModel()) }, "owner");
  state.operatingModel!.revisions.at(-1)!.data.nodes.find(n => n.id === "head-product")!.managerId = "owner";
  let commands: ModelCommand[] = [];
  const repo = { read: async () => state, update: vi.fn(),
    updateMany: async (_owner: string, _revision: number, cs: ModelCommand[]) => {
      commands = cs;
      throw boundary; // Capture the actual service-produced, authorized packet without SQL.
    } };
  await expect(new ProductCrewService(repo, { production: true }).call("owner",
    "create_secretary_department_structure", { revision: state.revision, requestId: randomUUID(),
      reason: "Структура", ownerDecisionRef: "Решение владельца" })).rejects.toBe(boundary);
  return { commands, revision: state.revision };
}

function repository(kind: string) {
  const reachedStorage = vi.fn().mockRejectedValue(boundary);
  if (kind === "pg") {
    const r = new PgModelRepository(reachedStorage);
    return { reachedStorage, call: r.updateMany.bind(r) };
  }
  if (kind === "normalized") {
    const r = new CompanyModelRepository(reachedStorage, "production");
    return { reachedStorage, call: r.updateMany.bind(r) };
  }
  const data = { commitDelta: reachedStorage,
    pool: { query: reachedStorage }, environment: "production" } as any;
  const r = new CommandCompanyRepository(data);
  return { reachedStorage, call: kind === "v3-write" ? r.writeMany.bind(r) : r.updateMany.bind(r) };
}
const kinds = ["pg", "normalized", "v3-write", "v3-update"];

describe("Secretary packet crosses actual repository guards, not a replacement size check", () => {
  it.each(kinds)("%s admits the actual fixed seven-command service packet", async kind => {
    const { commands, revision } = await packet(), r = repository(kind);
    expect(commands).toHaveLength(7);
    await expect(r.call("owner", revision, commands, "new-country")).rejects.toBe(boundary);
    expect(r.reachedStorage).toHaveBeenCalledOnce();
  });
  it.each(kinds)("%s rejects a JSON copy of the same packet before storage", async kind => {
    const { commands, revision } = await packet(), r = repository(kind);
    await expect(r.call("owner", revision, JSON.parse(JSON.stringify(commands)), "new-country"))
      .rejects.toMatchObject({ status: 400 });
    expect(r.reachedStorage).not.toHaveBeenCalled();
  });
  it.each(kinds)("%s preserves ordinary one-to-three, rejects zero/four/seven/eight untrusted commands", async kind => {
    const { commands, revision } = await packet(), r = repository(kind);
    for (const n of [1, 2, 3])
      await expect(r.call("owner", revision, commands.slice(0, n), "new-country")).rejects.toBe(boundary);
    r.reachedStorage.mockClear();
    for (const n of [0, 4, 7, 8]) {
      const arbitrary = Array.from({ length: n }, (_, i) => commands[i % commands.length]);
      await expect(r.call("owner", revision, arbitrary, "new-country")).rejects.toMatchObject({ status: 400 });
    }
    expect(r.reachedStorage).not.toHaveBeenCalled();
  });
  it.each(kinds)("%s binds the exception to owner, revision and new-country", async kind => {
    const { commands, revision } = await packet(), r = repository(kind);
    for (const [owner, pin, hypothesis] of [["other", revision, "new-country"],
      ["owner", revision + 1, "new-country"], ["owner", revision, "original"]] as const)
      await expect(r.call(owner, pin, commands, hypothesis)).rejects.toMatchObject({ status: 400 });
    expect(r.reachedStorage).not.toHaveBeenCalled();
  });
  it.each(["nested", "receipt", "extra", "shortened"])("rejects %s mutation after authorization", async change => {
    const { commands, revision } = await packet();
    if (change === "nested" && commands[0].type === "saveOperatingModel")
      commands[0].data.nodes[0].name = "tampered";
    if (change === "receipt" && commands[6].type === "createElement")
      commands[6].element.coordination!.state = "accepted";
    if (change === "extra") commands.push(commands[0]);
    if (change === "shortened") commands.splice(3);
    expect(() => assertTransactionBatch("owner", revision, commands, "new-country")).toThrow();
  });
  it("cannot authorize a different destination, receipt acceptance or batch shape", async () => {
    const original = await packet();
    for (const change of ["destination", "accepted", "missing", "extra"]) {
      const cs = structuredClone(original.commands);
      if (change === "destination" && "id" in cs[1]) cs[1].id = "DOC-OTHER";
      if (change === "accepted" && cs[6].type === "createElement") cs[6].element.coordination!.state = "accepted";
      if (change === "missing") cs.pop();
      if (change === "extra") cs.push(cs[0]);
      expect(() => authorizeSecretaryDepartmentBatch("owner", original.revision, cs)).toThrow();
    }
  });
});

describe("v3 revision-advance guard retains its independent bound", () => {
  it("carries the exact seven-command exception only to its bound preparation", async () => {
    const { commands, revision } = await packet(), prepare = async () => {};
    bindSecretaryDepartmentPreparation("owner", revision, commands, "new-country", prepare);
    expect(() => assertRevisionAdvance("owner", revision, prepare, 7)).not.toThrow();
    for (const advance of [0, 1, 3, 6, 8, Infinity, 7.5])
      expect(() => assertRevisionAdvance("owner", revision, prepare, advance)).toThrow();
    expect(() => assertRevisionAdvance("other", revision, prepare, 7)).toThrow();
    expect(() => assertRevisionAdvance("owner", revision + 1, prepare, 7)).toThrow();
    expect(() => assertRevisionAdvance("owner", revision, async () => {}, 7)).toThrow();
  });
  it("does not raise the generic delta advance above three", () => {
    const prepare = async () => {};
    for (const n of [1, 2, 3]) expect(() => assertRevisionAdvance("owner", 1, prepare, n)).not.toThrow();
    for (const n of [0, 4, 7, 8, Infinity, 1.5])
      expect(() => assertRevisionAdvance("owner", 1, prepare, n)).toThrow();
  });
  it("rechecks the authorized source packet at the delta boundary", async () => {
    const { commands, revision } = await packet(), prepare = async () => {};
    bindSecretaryDepartmentPreparation("owner", revision, commands, "new-country", prepare);
    if (commands[1].type === "createDocument") commands[1].text = "tampered";
    expect(() => assertRevisionAdvance("owner", revision, prepare, 7)).toThrow();
  });
  it("real v3 writeMany binds its own preparation before reaching the delta store", async () => {
    const { commands, revision } = await packet();
    const commitDelta = vi.fn(async (owner, pin, prepare) => {
      expect(() => assertRevisionAdvance(owner, pin, prepare, 7)).not.toThrow();
      expect(() => assertRevisionAdvance(owner, pin, async () => {}, 7)).toThrow();
      throw boundary;
    });
    const r = new CommandCompanyRepository({ commitDelta } as any);
    await expect(r.writeMany("owner", revision, commands, "new-country")).rejects.toBe(boundary);
    expect(commitDelta).toHaveBeenCalledOnce();
  });
});
