import type { OperatingData, WorkNode } from "./operatingModel";
export const levelNames = { strategy: "Стратегический", direction: "Тактический", operation: "Операционный" };
export const approvalNames = { draft: "Черновик", discussion: "К обсуждению", approved: "Утверждено" };
export function defaultRegister(): NonNullable<WorkNode["register"]> {
  return { availability: "", period: "", operationsPerPeriod: null, minutesPerOperation: null,
    estimateBasis: "", approval: "draft", source: "", proposalReason: "" };
}
export function effortMinutes(node: WorkNode): number | null {
  const r = node.register;
  if (!r || !r.period || r.operationsPerPeriod === null || r.minutesPerOperation === null) return null;
  return r.operationsPerPeriod * r.minutesPerOperation;
}
export function actionDirection(data: OperatingData, node: WorkNode): WorkNode | undefined {
  const map = new Map(data.nodes.map(n => [n.id, n]));
  let current: WorkNode | undefined = node;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.kind === "department" && current.level === "direction") return current;
    if (current.level === "direction" && current.kind !== "role") return current;
    current = current.parentId ? map.get(current.parentId) : undefined;
  }
  // A role's organisational parent is a fallback, never inferred from executor.
  const role = node.roleId ? map.get(node.roleId) : undefined;
  if (role && !seen.has(role.id)) return actionDirection({ ...data, nodes: data.nodes.filter(n => n.id !== node.id) }, role);
  return undefined;
}
export function actionOutputs(data: OperatingData, id: string): WorkNode[] {
  const ids = new Set(data.links.filter(l => l.from === id && l.kind === "produces").map(l => l.to));
  return data.nodes.filter(n => ids.has(n.id));
}
