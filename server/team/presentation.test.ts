import { describe, expect, it } from "vitest";
import type { TeamMember } from "@shared/team";
import { partitionTeamMembers } from "../../client/src/lib/teamPresentation";

const member = (overrides: Partial<TeamMember>): TeamMember => ({
  id: "role", name: "Сотрудник", title: "", code: "", department: "Продукт", mode: null,
  status: "unresolved", statusEvidence: "", portrait: null, nameStatus: null,
  traits: [], motto: null, duties: [], relations: [], tools: [], prohibitions: [],
  model: null, prompt: { text: null, version: null, status: null, acceptedBy: null },
  metrics: { plan: null, fact: null }, lastWork: null, lessons: [], history: [], ...overrides,
});
describe("team display partition without company writes", () => {
  it("keeps the living Katya once among staff and the empty team only in Plans", () => {
    const actual = member({ id: "employee-katya", name: "Катя", kind: "employee",
      status: "autonomous", mode: "secretary", portrait: "/katya.png" });
    const future = member({ id: "planned-secretary", name: "Катя", status: "planned",
      mode: "secretary", portrait: "/katya.png" });
    const before = structuredClone([actual, future]);
    const result = partitionTeamMembers([actual, future]);
    expect(result.staff).toEqual([actual]);
    expect(result.plans).toMatchObject([{ id: "planned-secretary",
      name: "Команда секретаря — будущая", portrait: null, department: "Планы", status: "planned" }]);
    expect([actual, future]).toEqual(before);
  });
  it("moves future team cards, preserving unresolved chat boundaries", () => {
    const result = partitionTeamMembers([
      member({ id: "planned-copilot", name: "Copilot", status: "planned" }),
      member({ id: "planned-translator", name: "Переводчик", status: "planned" }),
      member({ id: "planned-chat", name: "Чат-вход — не разобран", status: "unresolved" }),
    ]);
    expect(result.staff).toEqual([]);
    expect(result.plans.map(m => m.name)).toEqual([
      "Команда Copilot — будущая", "Команда переводчика — будущая", "Чат-вход — не разобран",
    ]);
    expect(result.plans.every(m => m.portrait === null)).toBe(true);
    expect(result.plans[2].status).toBe("unresolved");
  });
  it("does not move real roles merely because they are planned or unresolved", () => {
    const roles = [member({ id: "head-product", status: "unresolved" }),
      member({ id: "ordinary-planned-role", status: "planned" })];
    expect(partitionTeamMembers(roles).staff).toEqual(roles);
  });
  it("keeps external partners separate and preserves their portraits", () => {
    const partners = [member({ id: "external-efim", kind: "external", status: "contractor", portrait: "/efim.png" }),
      member({ id: "external-klavdiy", kind: "external", status: "owner_chat", portrait: "/klavdiy.png" })];
    expect(partitionTeamMembers(partners)).toEqual({ staff: [], external: partners, plans: [] });
  });
});
