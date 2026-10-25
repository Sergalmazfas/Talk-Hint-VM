import type { OperatingData, WorkLink, WorkNode } from "@shared/operatingModel";

export const resultRelationKinds = [
  "handoff", "depends_on", "acceptance", "return", "escalation",
] as const;

export type ResultRelationKind = typeof resultRelationKinds[number];

export const resultRelationLabels: Record<ResultRelationKind, string> = {
  handoff: "Передача результата",
  depends_on: "Зависимость",
  acceptance: "Плановая приёмка",
  return: "Возврат",
  escalation: "Эскалация",
};

export type ResultsProjection = {
  byId: Map<string, WorkNode>;
  nodes: WorkNode[];
  links: WorkLink[];
  initialWorkId: string | null;
  initialResultId: string | null;
};

/** A read-only projection over the persisted operating-model identities. */
export function buildResultsProjection(data: OperatingData): ResultsProjection {
  const byId = new Map(data.nodes.map((node) => [node.id, node]));
  const initialWork = data.nodes.find((node) => node.code === "RM.W.QUO");
  const initialResult = data.nodes.find((node) => node.code === "RM.W.QUO.R");
  return {
    byId,
    nodes: data.nodes.slice().sort((a, b) => a.code.localeCompare(b.code, "ru")),
    links: data.links.slice(),
    initialWorkId: initialWork?.id ?? null,
    initialResultId: initialResult?.id ?? null,
  };
}

export function resultEndpointLabel(node: WorkNode | undefined, id: string) {
  return node ? `${node.code || "без кода"} · ${node.name}` : `Узел не найден · ${id}`;
}

export function isResultRelation(kind: WorkLink["kind"]): kind is ResultRelationKind {
  return (resultRelationKinds as readonly string[]).includes(kind);
}
