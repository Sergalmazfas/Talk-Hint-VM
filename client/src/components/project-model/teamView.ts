import type { OperatingData, WorkNode } from "@shared/operatingModel";
import type { ProjectModelState } from "@shared/projectModel";

export type TeamLinkIssue = {
  roleId: string;
  roleName: string;
  managerId: string;
  kind: "missing-manager" | "broken-manager" | "cyclic-manager" | "unreachable";
};

export type TeamSnapshot = {
  owner?: WorkNode;
  directions: WorkNode[];
  roles: WorkNode[];
  byId: Map<string, WorkNode>;
  groupForRole: Map<string, string | null>;
  managerIssues: TeamLinkIssue[];
};

/** Builds the planning graph only from the persisted OperatingData snapshot. */
export function buildTeamSnapshot(data: OperatingData): TeamSnapshot {
  const byId = new Map(data.nodes.map((node) => [node.id, node]));
  const owner = byId.get("owner");
  const roles = data.nodes.filter((node) => node.kind === "role" && node.id !== "owner").slice().sort((a, b) => a.code.localeCompare(b.code, "ru"));
  const directions = data.nodes.filter((node) => node.level === "direction").slice().sort((a, b) => a.code.localeCompare(b.code, "ru"));
  const directionIds = new Set(directions.map((node) => node.id));
  const groupForRole = new Map<string, string | null>();
  roles.forEach((role) => {
    let parent = role.parentId;
    const seen = new Set<string>([role.id]);
    let group: string | null = null;
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      if (directionIds.has(parent)) { group = parent; break; }
      parent = byId.get(parent)?.parentId ?? null;
    }
    groupForRole.set(role.id, group);
  });

  const roleIds = new Set(roles.map((role) => role.id));
  const issues: TeamLinkIssue[] = [];
  roles.forEach((role) => {
    const managerId = role.managerId ?? "";
    if (!managerId) {
      issues.push({ roleId: role.id, roleName: role.name, managerId, kind: "missing-manager" });
    } else if (managerId !== owner?.id && !roleIds.has(managerId)) {
      issues.push({ roleId: role.id, roleName: role.name, managerId, kind: "broken-manager" });
    }
  });

  const managerOf = new Map(roles.map((role) => [role.id, role.managerId ?? null]));
  const cyclic = new Set<string>();
  roles.forEach((role) => {
    const path: string[] = [];
    const positions = new Map<string, number>();
    let cursor: string | null = role.id;
    while (cursor && roleIds.has(cursor)) {
      if (positions.has(cursor)) {
        path.slice(positions.get(cursor)!).forEach((id) => cyclic.add(id));
        break;
      }
      positions.set(cursor, path.length);
      path.push(cursor);
      cursor = managerOf.get(cursor) ?? null;
    }
  });
  const issueIds = new Set(issues.map((issue) => issue.roleId));
  cyclic.forEach((roleId) => {
    const role = byId.get(roleId);
    if (role && !issueIds.has(roleId)) issues.push({
      roleId, roleName: role.name, managerId: role.managerId ?? "", kind: "cyclic-manager",
    });
  });

  const reachable = new Set<string>();
  const frontier = [owner?.id].filter((id): id is string => !!id);
  while (frontier.length) {
    const managerId = frontier.shift()!;
    roles.filter((role) => role.managerId === managerId).forEach((role) => {
      if (!reachable.has(role.id)) { reachable.add(role.id); frontier.push(role.id); }
    });
  }
  roles.forEach((role) => {
    if (role.managerId && roleIds.has(role.managerId) && !reachable.has(role.id) && !issueIds.has(role.id) && !cyclic.has(role.id)) {
      issues.push({ roleId: role.id, roleName: role.name, managerId: role.managerId, kind: "unreachable" });
    }
  });
  return { owner, directions, roles, byId, groupForRole, managerIssues: issues };
}

export type PassportSection = { heading: string; text: string };
export function extractTeamPassportSections(markdown: string): PassportSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: PassportSection[] = [];
  let heading = "";
  let body: string[] = [];
  const commit = () => {
    if (heading && body.join("\n").trim()) sections.push({ heading, text: body.join("\n").trim() });
  };
  for (const line of lines) {
    if (/^#{1,3}\s+/.test(line.trim())) {
      commit();
      const candidate = line.replace(/^#{1,3}\s+/, "").trim();
      heading = /^P(?:[-.]|$)[A-Z0-9.-]*(?:\s+·|\s|$)/i.test(candidate) ? candidate : "";
      body = [];
    } else if (heading) {
      body.push(line);
    }
  }
  commit();
  return sections;
}

export function getLinkedTeamDocuments(state: ProjectModelState, referenceIds: Iterable<string>) {
  const references = new Set(referenceIds);
  return state.documents.filter((document) => references.has(document.id));
}

export function teamLinkIssueLabel(issue: TeamLinkIssue, byId: Map<string, WorkNode>) {
  if (issue.kind === "missing-manager") return "Нет managerId";
  if (issue.kind === "broken-manager") return `managerId не разрешён: ${issue.managerId}`;
  if (issue.kind === "cyclic-manager") return `Цикл в managerId · ${byId.get(issue.managerId)?.name ?? issue.managerId}`;
  return `Не достигается от владельца · managerId ${issue.managerId}`;
}
