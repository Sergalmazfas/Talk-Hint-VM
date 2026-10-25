import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OperatingData } from "../../shared/operatingModel";
import { defaultOperatingModel, emptyWorkNode } from "../../shared/operatingModelTemplate";
import { buildCompanyStructure } from "../../shared/companyStructure";
import { initialModel } from "./seed";
import { applyCommand } from "./domain";
import { refineT01 } from "./research/refineT01";
import { defineMkt1Result } from "./research/defineMkt1Result";
import { prepareLandingGearCase } from "./research/landingGearCase";
import { prepareCrewRoadmap } from "./research/crewRoadmap";
import { readHypothesis } from "./hypotheses";
import {
  buildResultsProjection, isResultRelation, resultEndpointLabel, resultRelationKinds,
} from "../../client/src/components/project-model/teamResults";
import TeamResultsView from "../../client/src/components/project-model/TeamResultsView";

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function roadmap() {
  const root = initialModel();
  const model = applyCommand(initialModel(), {
    type: "saveOperatingModel", baseVersion: 0,
    data: buildCompanyStructure(defaultOperatingModel()),
  }, "owner");
  model.analystPreparation = { revisions: [] };
  root.alternatives = [{ id: "new-country", title: "New", model }];
  return readHypothesis(prepareCrewRoadmap(prepareLandingGearCase(
    defineMkt1Result(refineT01(root, "owner"), "owner"), "owner",
  ), "owner"), "new-country");
}

describe("read-only results representation", () => {
  it("retains canonical node/link identities, order and fields without mutating a frozen snapshot", () => {
    const state = freeze(roadmap());
    const data = state.operatingModel!.revisions.at(-1)!.data;
    const before = JSON.stringify(state);
    const projection = buildResultsProjection(data);
    expect(projection.nodes).not.toBe(data.nodes);
    expect(projection.links).not.toBe(data.links);
    expect(projection.links).toEqual(data.links);
    for (const node of projection.nodes) expect(node).toBe(data.nodes.find(n => n.id === node.id));
    for (const link of projection.links) expect(link).toBe(data.links.find(l => l.id === link.id));
    renderToStaticMarkup(React.createElement(TeamResultsView, { data, state, onHierarchy() {} }));
    expect(JSON.stringify(state)).toBe(before);
  });

  it("resolves the real Quo work/result and preserves its pending acceptance rather than inventing an event", () => {
    const state = roadmap();
    const data = state.operatingModel!.revisions.at(-1)!.data;
    const projection = buildResultsProjection(data);
    expect(projection.initialWorkId).toBe("crew-research-quo");
    expect(projection.initialResultId).toBe("crew-research-output-quo");
    expect(projection.byId.get(projection.initialWorkId!)!.referenceIds).toContain("INFO-LG-QUO");
    expect(projection.byId.get(projection.initialResultId!)!.description).toContain("приёмка ожидается");
    expect(projection.links.some(l => l.from === projection.initialResultId && l.kind === "acceptance")).toBe(true);
    const html = renderToStaticMarkup(React.createElement(TeamResultsView, { data, state, onHierarchy() {} }));
    for (const label of ["INFO-LG-QUO / RM.W.QUO", "Плановая приёмка", "не журнал фактических событий", "Подтверждённых событий", "Связь ≠ подчинение"])
      expect(html).toContain(label);
    expect(html).not.toContain("Сохранить");
    expect(html).not.toContain("Запустить");
  });

  it("distinguishes all five result relations without treating accountability as a handoff", () => {
    expect(resultRelationKinds).toEqual(["handoff", "depends_on", "acceptance", "return", "escalation"]);
    resultRelationKinds.forEach(kind => expect(isResultRelation(kind)).toBe(true));
    expect(isResultRelation("accountable_to")).toBe(false);
    const nodes = [emptyWorkNode("role", "P1", "Роль", "role"), emptyWorkNode("work", "A1", "Работа", "action")];
    const data: OperatingData = { nodes, stageReports: [], links: resultRelationKinds.map(kind => ({
      id: `canonical-${kind}`, kind, from: "work", to: "role", reason: kind,
    })) };
    const html = renderToStaticMarkup(React.createElement(TeamResultsView, { data, state: initialModel(), onHierarchy() {} }));
    for (const kind of resultRelationKinds) expect(html).toContain(`relation-${kind}`);
    expect(nodes[0].managerId).toBeUndefined();
  });

  it("does not create Quo or acceptance links from recipient fields, and makes broken endpoints explicit", () => {
    const work = emptyWorkNode("custom-work", "OTHER", "Другая работа", "action");
    work.recipientId = "missing-role";
    work.acceptorId = "missing-role";
    const data: OperatingData = {
      nodes: [work], links: [{ id: "broken", kind: "handoff", from: work.id, to: "missing-role", reason: "" }], stageReports: [],
    };
    const projection = buildResultsProjection(freeze(data));
    expect(projection.initialWorkId).toBeNull();
    expect(projection.initialResultId).toBeNull();
    expect(projection.links).toHaveLength(1);
    expect(resultEndpointLabel(undefined, "missing-role")).toContain("Узел не найден");
    const html = renderToStaticMarkup(React.createElement(TeamResultsView, { data, state: initialModel(), onHierarchy() {} }));
    expect(html).toContain("Работа RM.W.QUO отсутствует");
    expect(html).toContain("Узел не найден · missing-role");
    expect(html).not.toContain("relation-acceptance");
    expect(data.nodes).toHaveLength(1);
  });

  it("does not replace a missing saved revision with a template or invent data for an empty revision", () => {
    const props = { state: initialModel(), onHierarchy() {} };
    const html = renderToStaticMarkup(React.createElement(TeamResultsView, { ...props, data: null }));
    expect(html).toContain("Сохранённых передач пока нет");
    const projection = buildResultsProjection({ nodes: [], links: [], stageReports: [] });
    expect(projection.nodes).toEqual([]);
    expect(projection.links).toEqual([]);
  });
});
