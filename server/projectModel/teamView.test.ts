import { describe, expect, it } from "vitest";
import { emptyWorkNode } from "../../shared/operatingModelTemplate";
import type { OperatingData } from "../../shared/operatingModel";
import {
  buildTeamSnapshot, extractTeamPassportSections,
} from "../../client/src/components/project-model/teamView";

function fixture(): OperatingData {
  const owner = emptyWorkNode("owner", "OWNER", "Сергей", "client", null);
  const ceo = emptyWorkNode("ai-ceo", "CEO", "AI CEO", "role", null);
  ceo.managerId = owner.id;
  const direction = emptyWorkNode("direction", "T01", "Исследования", "capability", null);
  direction.level = "direction";
  const department = emptyWorkNode("department", "D01", "Исследовательский отдел", "department", direction.id);
  const head = emptyWorkNode("head", "HEAD.01", "Руководитель", "role", direction.id);
  head.managerId = ceo.id;
  const analyst = emptyWorkNode("analyst", "P-BENCH", "Аналитик", "role", department.id);
  analyst.managerId = head.id;
  return { nodes: [owner, ceo, direction, department, head, analyst], links: [], stageReports: [] };
}

describe("read-only team model projection", () => {
  it("keeps the real identities and does not change the canonical model", () => {
    const data = fixture();
    const before = JSON.stringify(data);
    const view = buildTeamSnapshot(data);
    expect(view.owner?.id).toBe("owner");
    expect(view.roles.map(role => role.id).sort()).toEqual(["ai-ceo", "analyst", "head"]);
    expect(view.directions.map(direction => direction.id)).toEqual(["direction"]);
    expect(view.managerIssues).toEqual([]);
    expect(JSON.stringify(data)).toBe(before);
  });

  it("resolves direction grouping without replacing the immediate manager", () => {
    const data = fixture();
    const view = buildTeamSnapshot(data);
    expect(view.groupForRole.get("analyst")).toBe("direction");
    expect(view.byId.get("analyst")?.managerId).toBe("head");
    expect(view.groupForRole.get("ai-ceo")).toBeNull();
  });

  it("marks missing and unresolved managers instead of inventing superiors", () => {
    const data = fixture();
    data.nodes.find(node => node.id === "head")!.managerId = null;
    data.nodes.find(node => node.id === "analyst")!.managerId = "unresolved-id";
    const view = buildTeamSnapshot(data);
    expect(view.managerIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ roleId: "head", kind: "missing-manager" }),
      expect.objectContaining({ roleId: "analyst", kind: "broken-manager" }),
    ]));
    expect(view.byId.has("unresolved-id")).toBe(false);
  });

  it("detects cyclic management and roles disconnected from the owner", () => {
    const data = fixture();
    data.nodes.find(node => node.id === "head")!.managerId = "analyst";
    const child = emptyWorkNode("child", "P-CHILD", "Подчинённая роль", "role", "department");
    child.managerId = "head";
    data.nodes.push(child);
    const view = buildTeamSnapshot(data);
    expect(view.managerIssues.filter(issue => issue.kind === "cyclic-manager").map(issue => issue.roleId).sort())
      .toEqual(["analyst", "head"]);
    expect(view.managerIssues).toContainEqual(expect.objectContaining({ roleId: "child", kind: "unreachable" }));
  });

  it("does not fabricate an owner or data for an empty saved model", () => {
    const view = buildTeamSnapshot({ nodes: [], links: [], stageReports: [] });
    expect(view.owner).toBeUndefined();
    expect(view.roles).toEqual([]);
    expect(view.directions).toEqual([]);
  });

  it("does not hang on a containment cycle or treat it as line management", () => {
    const data = fixture();
    data.nodes.find(node => node.id === "department")!.parentId = "analyst";
    const view = buildTeamSnapshot(data);
    expect(view.groupForRole.get("analyst")).toBeNull();
    expect(view.managerIssues).toEqual([]);
  });

  it("does not infer runtime execution from an assigned executor", () => {
    const data = fixture();
    const role = data.nodes.find(node => node.id === "analyst")!;
    role.executorId = "replit-current-dev-session";
    role.status = "proposal";
    const projected = buildTeamSnapshot(data).byId.get(role.id)!;
    expect(projected.status).toBe("proposal");
    expect(projected.executorId).toBe("replit-current-dev-session");
    expect(projected).not.toHaveProperty("running", true);
  });
});

describe("existing passport section boundaries", () => {
  it("keeps another role's duties out of the selected passport", () => {
    const sections = extractTeamPassportSections([
      "### P-BENCH · Аналитик",
      "- Клиент результата: продукт.",
      "### P-04 · Принимающий исследование",
      "- Обязательный выход: независимая проверка.",
      "### P.PRODUCT · Менеджер продукта",
      "- Клиент результата: владелец.",
      "## Следующий этап",
      "Этот текст не является паспортом менеджера.",
    ].join("\n"));
    expect(sections.find(section => section.heading.startsWith("P-BENCH"))?.text)
      .toBe("- Клиент результата: продукт.");
    expect(sections.find(section => section.heading.startsWith("P-04"))?.text)
      .toBe("- Обязательный выход: независимая проверка.");
    expect(sections.find(section => section.heading.startsWith("P.PRODUCT"))?.text)
      .toBe("- Клиент результата: владелец.");
  });

  it("supports additional existing role codes without a second hardcoded role list", () => {
    const sections = extractTeamPassportSections("### P.FUTURE.17 · Существующая роль\n- Ресурсы: общий документ.\n");
    expect(sections).toEqual([{ heading: "P.FUTURE.17 · Существующая роль", text: "- Ресурсы: общий документ." }]);
  });
});
