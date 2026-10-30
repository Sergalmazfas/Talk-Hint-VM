import { describe, it, expect } from "vitest";
import { characters, DIRECTORY, JOURNAL, proposedStep, TEAM_PLAN_HASH, TEAM_ROOTS } from "./plan";
import { portraitManifest } from "./portraits";
import { completedSteps } from "./repository";
import { teamView } from "./view";
import { TeamRepository } from "./repository";

export function baseContext(): any {
  return { workspace: "company-import-7cf8767b-fbeb-4e97-939f-cc2c3767cf3a",
    owner: "47704265", revision: 914, rootHash: TEAM_ROOTS[0], phase: "active", writesOpen: true,
    actor: "prior", documents: [], profiles: [], roles: [], prompts: [], jobs: [], controls: [], revisions: [],
    operating: { version: 41, at: "2026-10-28T00:00:00Z", actor: "prior", data: { nodes: [], links: [], stageReports: [] } } };
}
describe("reviewed owner team recipe", () => {
  it("pin calibration is impossible in production or on a non-test repository", () => {
    expect(() => new TeamRepository({} as any, "production", true, true)).toThrow("isolated Dev-test");
    expect(() => new TeamRepository({} as any, "development", false, true)).toThrow("isolated Dev-test");
  });
  const operating: any = { version: 41, at: "old", actor: "old", data: { links: [], stageReports: [],
    nodes: characters.map(c => ({ id: c.role, code: c.code, name: `Existing ${c.code}`, kind: "role",
      managerId: "existing-manager", executorId: null, resourceIds: [], constraints: "", metrics: [] })) } };
  const lab: any = { id: "DOC-PLAB-PROMPT-PROPOSAL", title: "lab", text: JSON.stringify({
    version: 2, prompt: { model: "existing-model", rules: "keep byte-identical" },
    visualPassport: { roleId: "laboratory-engineer-role", character: { traits: ["a", "b", "c"], motto: "old" } },
  }), updatedAt: "old", url: "", elementIds: [] };
  it("does not mutate inputs, append a graph, appoint executors or activate existing prompts", () => {
    const before = JSON.stringify({ operating, lab });
    const p = proposedStep(3, [lab], operating, portraitManifest);
    expect(JSON.stringify({ operating, lab })).toBe(before);
    expect(p.operating).toEqual(operating);
    const updatedLab = JSON.parse(p.documents.find(d => d.id === lab.id)!.text);
    expect(updatedLab.prompt).toEqual(JSON.parse(lab.text).prompt);
    expect(updatedLab.visualPassport.character.traits).toEqual(["a", "b", "c"]);
    expect(updatedLab.mode).toBe("hint");
    const maria = JSON.parse(p.documents.find(d => d.id === "DOC-TEAM-HEAD06")!.text);
    expect(maria.visualPassport.selectedName).toBe("Мария Соболь");
    expect(maria.visualPassport.character.traits).toEqual(characters[0].traits);
    expect(maria.visualPassport.character.motto).toBe("Сначала человек, потом функция");
    expect(maria.prompt).toBeUndefined();
    const tikhon = JSON.parse(p.documents.find(d => d.id === "DOC-TEAM-POPS")!.text);
    expect(tikhon.mode).toBe("company");
    expect(tikhon.visualPassport.character.traits).toEqual([null, null, null]);
    const coordinator = JSON.parse(p.documents.find(d => d.id === "DOC-TEAM-PCOORD")!.text);
    expect(coordinator.visualPassport.selectedName).toBeNull();
    const directory = JSON.parse(p.documents.find(d => d.id === DIRECTORY)!.text);
    expect(directory.packageHash).toBe(TEAM_PLAN_HASH);
    expect(directory.teams).toHaveLength(4);
    for (const t of directory.teams) {
      expect(t.members).toEqual([]); expect(t.executors).toEqual([]);
      expect(t.schedules).toEqual([]); expect(t.jobs).toEqual([]);
    }
  });
  it("records the three cases separately and refuses an existing case", () => {
    let d: any = { id: JOURNAL, text: JSON.stringify({ version: 28, cases: [], history: [] }), updatedAt: "old", url: "", elementIds: [], title: "old" };
    for (let step = 0; step < 3; step++) {
      const p = proposedStep(step, [d], operating, portraitManifest);
      expect(p.operating).toBeNull();
      d = p.documents[0];
      expect(JSON.parse(d.text).version).toBe(29 + step);
      expect(JSON.parse(d.text).cases).toHaveLength(step + 1);
      expect(() => proposedStep(step, [d], operating, portraitManifest)).toThrow("Case already exists");
    }
    expect(JSON.parse(d.text).cases[0].accepted).toBe(false);
    expect(JSON.parse(d.text).cases[0].history[0].activationAuthorized).toBe(false);
    expect(() => proposedStep(4, [d], operating, portraitManifest)).toThrow();
  });
  it("requires existing exact role identifiers/codes; no invented positions", () => {
    expect(() => proposedStep(3, [], { ...operating, data: { ...operating.data, nodes: [] } }, portraitManifest))
      .toThrow("Existing role missing");
  });
  it("pins every intermediate root, not only revision/actor", () => {
    const c = baseContext();
    expect(completedSteps(c)).toBe(0);
    c.rootHash = "f".repeat(64); expect(completedSteps(c)).toBe(-1);
    c.revision = 915; c.actor = `team-package:${TEAM_PLAN_HASH}:0`;
    expect(completedSteps(c)).toBe(-1);
    c.rootHash = TEAM_ROOTS[1]; expect(completedSteps(c)).toBe(1);
    c.actor = "some-other-writer"; expect(completedSteps(c)).toBe(-1);
  });
  it("never treats a declared connected resource as proof of an autonomous agent", () => {
    const c = baseContext();
    c.operating.data.nodes = [
      { id: "role", kind: "role", name: "role", code: "R", parentId: "dept", executorId: "worker",
        managerId: null, resourceIds: [], constraints: "" },
      { id: "dept", kind: "department", name: "Existing department" },
      { id: "worker", kind: "resource", name: "declared worker", resourceState: "connected" },
    ];
    const member = teamView(c, "production").members[0];
    expect(member.status).toBe("disconnected");
    expect(member.department).toBe("Existing department");
    expect(member.model).toBeNull(); expect(member.traits).toEqual([null, null, null]);
    expect(member.prompt.text).toBeNull();
  });
  it("fails honestly if the current profile has no matching normalized projection", () => {
    const c = baseContext();
    c.operating = operating;
    c.documents = [lab];
    expect(() => teamView(c, "production")).toThrow("Employee projection unavailable");
  });
});
