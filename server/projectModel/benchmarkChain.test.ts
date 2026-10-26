import { describe, expect, it } from "vitest";
import { initialModel } from "./seed";
import { applyCommand } from "./domain";
import { defaultOperatingModel, emptyWorkNode } from "../../shared/operatingModelTemplate";
import { buildCompanyStructure } from "../../shared/companyStructure";
import { refineT01 } from "./research/refineT01";
import { defineMkt1Result } from "./research/defineMkt1Result";
import { prepareLandingGearCase } from "./research/landingGearCase";
import { prepareCrewRoadmap } from "./research/crewRoadmap";
import { prepareCrewSetup } from "./research/crewSetup";
import { prepareStructureFirst } from "./research/structureFirst";
import { prepareActionRegister } from "./research/actionRegister";
import { prepareBenchmarkChain, benchmarkRoadmapTitle } from "./research/benchmarkChain";
import { benchmarkChain, chainId, chainResult } from "./research/benchmarkChainSpec";
import { readHypothesis } from "./hypotheses";
import { actionChainGaps, inputSupplier } from "../../shared/actionChainCoverage";
import { ProductCrewService } from "../productCrew/service";
import type { ModelRepository } from "./repository";
import { prepareBenchmarkForms, candidatesFormId, decisionFormId, formsRoadmapTitle } from "./research/benchmarkForms";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ActionRegister from "../../client/src/components/project-model/ActionRegister";
import { prepareLegalChain, legalRoleId, legalProcessId, legalRoadmapTitle } from "./research/legalChain";
import { legalChain, legalActionId, legalResultId, legalForms } from "./research/legalChainSpec";
import { prepareCompanyRegister, companyRegisterTitle, companyReportActions, managementActionId } from "./research/companyRegister";
import { companyActions, companyDirections, reportingPeriods } from "./research/companyRegisterSpec";
import { actionDirection, effortMinutes } from "../../shared/actionRegister";
import { companyCoverage } from "../../shared/operatingModel";
import { benchmarkReadinessSpecs, benchmarkReadinessTitle, prepareBenchmarkReadiness } from "./research/benchmarkReadiness";
function fixture() {
  const root = initialModel();
  const model = applyCommand(initialModel(), { type: "saveOperatingModel", baseVersion: 0,
    data: buildCompanyStructure(defaultOperatingModel()) }, "owner");
  model.analystPreparation = { revisions: [] };
  root.alternatives = [{ id: "new-country", title: "New", model }, { id: "other", title: "Other", model: initialModel() }];
  return prepareActionRegister(prepareStructureFirst(prepareCrewSetup(prepareCrewRoadmap(
    prepareLandingGearCase(defineMkt1Result(refineT01(root, "owner"), "owner"), "owner"), "owner"), "owner"), "owner"), "owner", "2026-10-26");
}
describe("benchmark analyst preparation is management work, not execution", () => {
  const before = () => prepareCompanyRegister(prepareLegalChain(
    prepareBenchmarkForms(prepareBenchmarkChain(fixture(), "owner"), "owner"), "owner"), "owner");
  it("updates the one canonical roadmap, preserves all history and hypotheses, and is idempotent", () => {
    const root = before(), snapshot = structuredClone(root);
    const next = prepareBenchmarkReadiness(root, "owner");
    expect(root).toEqual(snapshot);
    expect(next.elements).toEqual(root.elements);
    expect(next.alternatives![1]).toEqual(root.alternatives![1]);
    const a = readHypothesis(root, "new-country"), b = readHypothesis(next, "new-country");
    expect(b.documents).toHaveLength(a.documents.length);
    expect(b.competitorDirectory).toEqual(a.competitorDirectory);
    expect(b.analystPreparation).toEqual(a.analystPreparation);
    const oldDoc = a.documents.find(d => d.title === companyRegisterTitle)!;
    const newDoc = b.documents.find(d => d.title === benchmarkReadinessTitle)!;
    expect(newDoc.id).toBe(oldDoc.id);
    expect(b.decisions.some(d => d.documentBefore?.text === oldDoc.text)).toBe(true);
    expect(b.operatingModel!.revisions.slice(0, -1)).toEqual(a.operatingModel!.revisions);
    const old = a.operatingModel!.revisions.at(-1)!.data, data = b.operatingModel!.revisions.at(-1)!.data;
    expect(data.nodes.filter(n => n.kind === "role")).toEqual(old.nodes.filter(n => n.kind === "role"));
    expect(data.nodes.filter(n => n.kind === "crew")).toEqual(old.nodes.filter(n => n.kind === "crew"));
    for (const n of old.nodes) expect(data.nodes.some(x => x.id === n.id && x.code === n.code)).toBe(true);
    expect(newDoc.text.length).toBeLessThan(50000);
    expect(prepareBenchmarkReadiness(next, "owner")).toBe(next);
  });
  it("has complete chains, actual resource IDs, explicit blockers and no fabricated acceptance", () => {
    const next = prepareBenchmarkReadiness(before(), "owner");
    const m = readHypothesis(next, "new-country"), data = m.operatingModel!.revisions.at(-1)!.data;
    const ids = new Set(benchmarkReadinessSpecs.map(s => s.id));
    expect(actionChainGaps(data, ids)).toEqual([]);
    expect(companyCoverage(data)).not.toContain("Не представлены все десять направлений");
    for (const s of benchmarkReadinessSpecs) {
      const n = data.nodes.find(n => n.id === s.id)!;
      expect(n.executorId).toBeNull();
      expect(n.register?.approval).toBe("discussion");
      expect(n.register?.operationsPerPeriod).toBeNull();
      expect(n.register?.minutesPerOperation).toBeNull();
      expect(n.register?.source).toContain("Поручение Сергея");
      expect(n.procedure).toContain("Нет разрешения");
      expect(n.description).toContain(s.state);
      for (const id of [n.parentId, n.roleId, ...n.resourceIds])
        expect(data.nodes.some(x => x.id === id)).toBe(true);
      expect(n.reporting?.formStatus).not.toBe("approved");
    }
    const node = (id: string) => data.nodes.find(n => n.id === `benchmark-ready-${id}`)!;
    expect(node("search").nextId).toBe("benchmark-ready-qa");
    expect(node("search-key").procedure).toContain("Только если");
    expect(node("search-key").procedure).toContain("Не просить ключ в чате");
    expect(node("browser").procedure).toContain("не дают доступа к установленным iOS/Android");
    expect(node("qa").description).toContain("Заблокировано");
    expect(node("forms-review").acceptorId).toBe("owner");
    expect(node("forms").procedure).toContain("ChatGPT готовит");
    expect(node("runtime").procedure).toContain("не новый запуск");
    expect(node("storage").procedure).toContain("owner/new-country");
    const doc = m.documents.find(d => d.title === benchmarkReadinessTitle)!;
    expect(doc.text).toContain("Совместный разговор втроём не доказан");
    expect(doc.text).toContain("В текущем проходе заново не перепроверены");
    expect(doc.text).toContain("40 требований");
  });
  it("fails closed without the existing namespace or with conflicting identities", () => {
    expect(() => prepareBenchmarkReadiness(initialModel(), "owner")).toThrow();
    const root = before();
    readHypothesis(root, "new-country").operatingModel!.revisions.at(-1)!.data.nodes
      .push({ ...emptyWorkNode("collision", "ENG.BENCH.1", "collision", "action", "crew-equipment") });
    expect(() => prepareBenchmarkReadiness(root, "owner")).toThrow("Duplicate identity");
  });
});
describe("company action register and management reporting requirements", () => {
  function before() {
    return prepareLegalChain(prepareBenchmarkForms(prepareBenchmarkChain(fixture(), "owner"), "owner"), "owner");
  }
  it("preserves all identities, old report paths, hypotheses and full revisions; replays without another write", () => {
    const root = before(), snapshot = structuredClone(root);
    const next = prepareCompanyRegister(root, "owner");
    expect(root).toEqual(snapshot);
    expect(next.alternatives![1]).toEqual(root.alternatives![1]);
    expect(next.elements).toEqual(root.elements);
    const a = readHypothesis(root, "new-country"), b = readHypothesis(next, "new-country");
    expect(b.documents).toHaveLength(a.documents.length);
    const doc = b.documents.find(d => d.title === companyRegisterTitle)!;
    const oldDoc = a.documents.find(d => d.id === doc.id)!;
    expect(doc.text.startsWith(oldDoc.text)).toBe(true);
    expect(b.decisions.some(d => d.documentBefore?.text === oldDoc.text)).toBe(true);
    expect(b.operatingModel!.revisions.slice(0, -1)).toEqual(a.operatingModel!.revisions);
    const old = a.operatingModel!.revisions.at(-1)!.data, data = b.operatingModel!.revisions.at(-1)!.data;
    expect(data.nodes.filter(n => n.kind === "department")).toEqual(old.nodes.filter(n => n.kind === "department"));
    for (const n of old.nodes) expect(data.nodes.some(x => x.id === n.id && x.code === n.code)).toBe(true);
    for (const id of ["company-action-weekly-prepare", "company-action-monthly-prepare"])
      expect(data.nodes.find(n => n.id === id)!.nextId).toBe(old.nodes.find(n => n.id === id)!.nextId);
    expect(prepareCompanyRegister(next, "owner")).toBe(next);
    expect(doc.text.length).toBeLessThanOrEqual(50000);
  });
  it("maps forty requirements to canonical actions with all receivers, control and unknown effort", () => {
    const root = before(), next = prepareCompanyRegister(root, "owner");
    const old = readHypothesis(root, "new-country").operatingModel!.revisions.at(-1)!.data;
    const data = readHypothesis(next, "new-country").operatingModel!.revisions.at(-1)!.data;
    expect(companyCoverage(data)).not.toContain("Не представлены все десять направлений");
    expect(data.nodes.find(n => n.id === managementActionId("sales-plan"))!.level).toBe("direction");
    expect(actionDirection(data, data.nodes.find(n => n.id === managementActionId("sales-plan"))!)?.id).toBe("dir-sales");
    const reports = companyReportActions(data);
    expect(reports).toHaveLength(40);
    expect(new Set(reports.map(n => n.id)).size).toBe(40);
    for (const [key] of companyDirections) for (const [, , unit] of reportingPeriods) {
      expect(reports.filter(n => actionDirection(data, n)?.id === `dir-${key}` && n.register?.period === unit)).toHaveLength(1);
    }
    const ids = new Set(data.nodes.filter(n => n.kind === "action" && !old.nodes.some(x => x.id === n.id)).map(n => n.id));
    reports.forEach(n => ids.add(n.id));
    expect(actionChainGaps(data, ids)).toEqual([]);
    for (const n of data.nodes.filter(n => ids.has(n.id))) {
      expect(n.executorId).toBeNull();
      expect(n.register?.operationsPerPeriod).toBeNull();
      expect(n.register?.minutesPerOperation).toBeNull();
      expect(effortMinutes(n)).toBeNull();
      expect(n.reporting?.formStatus).toBe("required");
      expect(n.reporting?.templateDocumentId).toBeNull();
      expect(n.register?.approval).not.toBe("approved");
    }
    for (const n of reports) {
      expect(n.procedure).toContain("B2C/B2B");
      expect(n.procedure).toContain("подтверждённая причина либо гипотеза");
      expect(n.procedure).toContain("утверждение — Сергей");
    }
  });
  it("keeps legal/provider and two improvement inputs linked without inventing APIs, figures or compliance", () => {
    const next = prepareCompanyRegister(before(), "owner");
    const m = readHypothesis(next, "new-country"), data = m.operatingModel!.revisions.at(-1)!.data;
    const node = (key: string) => data.nodes.find(n => n.id === managementActionId(key))!;
    expect(node("service-issue").nextId).toBe("company-action-product");
    expect(node("prototype").nextId).toBe("company-action-product-decision");
    expect(node("finance-reconcile").procedure).toContain("EBITDA");
    expect(node("finance-reconcile").procedure).toContain("денежный поток");
    expect(node("cohorts").procedure).toContain("знаменатель");
    expect(node("market-finance").procedure).toContain("3 млн/100 не данные");
    expect(data.nodes.find(n => n.id === "management-resource-tools")!.resourceState).toBe("required");
    expect(data.links.some(l => l.from === legalResultId("channels-study") && l.to === managementActionId("report-engineering-day"))).toBe(true);
    const doc = m.documents.find(d => d.title === companyRegisterTitle)!;
    expect(doc.text).toContain("Бинарный Excel и построчные данные не получены");
    expect(doc.text).toContain("формы НЕ разработаны");
    expect(data.nodes.filter(n => n.id.startsWith("management-role-")).every(n =>
      n.kind === "role" && n.status === "proposal" && n.managerId && n.executorId === null)).toBe(true);
    expect(companyActions.every(s => node(s.key).procedure.includes(s.work))).toBe(true);
  });
});
describe("benchmarking through receiving actions, control and reports", () => {
  it("preserves all existing identities, roles, other hypotheses, documents and exact history; updates the one roadmap and replays safely", () => {
    const root = fixture(), snapshot = structuredClone(root);
    const next = prepareBenchmarkChain(root, "owner");
    expect(root).toEqual(snapshot);
    expect(next.alternatives![1]).toEqual(root.alternatives![1]);
    expect(next.elements).toEqual(root.elements);
    const a = readHypothesis(root, "new-country"), b = readHypothesis(next, "new-country");
    expect(b.documents).toHaveLength(a.documents.length);
    const doc = b.documents.find(d => d.title === benchmarkRoadmapTitle)!;
    const oldDoc = a.documents.find(d => d.id === doc.id)!;
    expect(b.decisions.some(d => d.documentBefore?.text === oldDoc.text)).toBe(true);
    expect(doc.text.length).toBeLessThan(45000);
    expect(b.operatingModel!.revisions.slice(0, -1)).toEqual(a.operatingModel!.revisions);
    const ad = a.operatingModel!.revisions.at(-1)!.data, bd = b.operatingModel!.revisions.at(-1)!.data;
    expect(bd.nodes.filter(n => n.kind === "role")).toEqual(ad.nodes.filter(n => n.kind === "role"));
    for (const n of ad.nodes) expect(bd.nodes.some(x => x.id === n.id && x.code === n.code)).toBe(true);
    expect(prepareBenchmarkChain(next, "owner")).toBe(next);
  });
  it("every scoped action has supplier, planned executor, resources, output, receiver, controller, acceptance/return and next step", () => {
    const m = readHypothesis(prepareBenchmarkChain(fixture(), "owner"), "new-country");
    const data = m.operatingModel!.revisions.at(-1)!.data;
    const ids = new Set(benchmarkChain.map(s => chainId(s.key)));
    expect(actionChainGaps(data, ids)).toEqual([]);
    expect(actionChainGaps(data).length).toBeGreaterThan(0); // No invented whole-company completeness.
    for (const id of ids) {
      const n = data.nodes.find(n => n.id === id)!;
      expect(n.executorId).toBeNull();
      expect(n.questions).toContain("требуется разработать");
      expect(n.register!.operationsPerPeriod).toBeNull();
      expect(n.register!.minutesPerOperation).toBeNull();
      expect(n.register!.approval).not.toBe("approved");
      expect(n.inputs.every(i => inputSupplier(data, i.sourceId))).toBe(true);
      expect(data.links.some(l => l.from === id && l.kind === "accountable_to")).toBe(true);
    }
    for (const l of data.links.filter(l => l.kind === "handoff" && ids.has(l.to)))
      expect(data.nodes.find(n => n.id === l.to)!.inputs.some(i => i.sourceId === l.from)).toBe(true);
  });
  it("models finite separate control and alternative branches without changing permissions", () => {
    const m = readHypothesis(prepareBenchmarkChain(fixture(), "owner"), "new-country");
    const data = m.operatingModel!.revisions.at(-1)!.data;
    for (const key of ["benchmark-control", "product-control", "technical-control"]) {
      expect(data.nodes.find(n => n.id === chainId(key))!.kind).toBe("action");
      expect(data.links.some(l => l.from === chainId(key) && l.to === "owner" && l.kind === "accountable_to")).toBe(true);
    }
    for (const [from, to] of [["context-check", "product-reference"], ["product-sufficiency", "product-return"], ["product-return", "support"], ["product-benefit", "product-decision"]])
      expect(data.links.some(l => l.from === chainResult(from) && l.to === chainId(to) && l.kind === "handoff")).toBe(true);
    const decision = data.nodes.find(n => n.id === chainId("product-decision"))!;
    expect(decision.procedure).toContain("фактическое решение Сергея");
    for (const key of ["common-aggregate", "common-accept", "finance-method", "monthly-receive"]) {
      const n = data.nodes.find(n => n.id === chainId(key))!;
      expect(n.status).toBe("proposal");
      expect(n.register!.approval).toBe("draft");
    }
  });
  it("preserves independent user input and planned weekly/monthly prepare-check-send-receive cycles", () => {
    const m = readHypothesis(prepareBenchmarkChain(fixture(), "owner"), "new-country");
    const data = m.operatingModel!.revisions.at(-1)!.data;
    const receive = data.nodes.find(n => n.id === chainId("product"))!;
    expect(receive.inputs.some(i => i.sourceId === chainResult("handoff"))).toBe(true);
    expect(receive.inputs.some(i => i.sourceId === chainResult("support"))).toBe(true);
    expect(receive.procedure).toContain("альтернативные");
    for (const key of ["weekly-prepare", "benchmark-control", "weekly-send", "weekly-receive", "monthly-prepare", "monthly-check", "monthly-send", "monthly-receive"])
      expect(data.nodes.some(n => n.id === chainId(key))).toBe(true);
    expect(data.nodes.find(n => n.id === chainId("weekly-prepare"))!.schedule.trigger).toContain("Еженедельно");
    expect(data.nodes.find(n => n.id === chainId("monthly-prepare"))!.schedule.trigger).toContain("Ежемесячно");
    expect(m.documents.find(d => d.title === benchmarkRoadmapTitle)!.text).toContain("не доказывает причинность");
  });
  it("ChatGPT sees suppliers, accountability and formal gaps from the same model", async () => {
    const m = readHypothesis(prepareBenchmarkChain(fixture(), "owner"), "new-country");
    const service = new ProductCrewService({ read: async () => m } as ModelRepository);
    const reply = await service.call("owner", "get_roadmap", {});
    expect(reply.next).toContain("PRD.1.9");
    const n = reply.actionRegister.find((n: any) => n.id === chainId("context-receive"));
    expect(n.inputs[0].supplierId).toBe("product-manager-specialist");
    expect(n.controllerIds).toContain("head-market");
    expect(n.nextId).toBe(chainId("context-check"));
    expect(reply.descriptionContractGaps.length).toBeGreaterThan(0);
  });
});
describe("existing benchmarking forms, not a parallel catalogue", () => {
  const root = () => prepareBenchmarkChain(fixture(), "owner");
  it("adds two draft documents; preserves identities, roles, competitor facts and exact previous roadmap in history", () => {
    const before = root(), snapshot = structuredClone(before), after = prepareBenchmarkForms(before, "owner");
    expect(before).toEqual(snapshot);
    expect(after.alternatives![1]).toEqual(before.alternatives![1]);
    const a = readHypothesis(before, "new-country"), b = readHypothesis(after, "new-country");
    const ad = a.operatingModel!.revisions.at(-1)!.data, bd = b.operatingModel!.revisions.at(-1)!.data;
    expect(b.competitorDirectory).toEqual(a.competitorDirectory);
    expect(bd.nodes.filter(n => n.kind === "role")).toEqual(ad.nodes.filter(n => n.kind === "role"));
    for (const n of ad.nodes) expect(bd.nodes.some(x => x.id === n.id && x.code === n.code)).toBe(true);
    expect(bd.nodes.filter(n => n.kind === "action")).toHaveLength(ad.nodes.filter(n => n.kind === "action").length);
    expect(b.documents).toHaveLength(a.documents.length + 2);
    expect(bd.nodes.filter(n => n.reporting?.templateDocumentId).map(n => n.reporting!.templateDocumentId).sort()).toEqual([candidatesFormId, decisionFormId].sort());
    expect(bd.nodes.filter(n => n.reporting)).toHaveLength(35);
    expect(bd.nodes.filter(n => n.reporting?.formStatus === "approved")).toHaveLength(0);
    expect(bd.nodes.find(n => n.id === chainId("list-review"))!.status).toBe("proposal");
    expect(bd.nodes.find(n => n.id === chainId("list-review"))!.roleId).toBe("head-market");
    expect(bd.nodes.find(n => n.id === chainId("scan"))!.resourceIds).toContain("search-resource");
    expect(bd.nodes.filter(n => n.id.startsWith("benchmark-resource-")).every(n => n.resourceState === "required")).toBe(true);
    expect(actionChainGaps(bd, new Set(benchmarkChain.map(s => chainId(s.key))))).toEqual([]);
    const doc = b.documents.find(d => d.title === formsRoadmapTitle)!;
    expect(doc.id).toBe(a.documents.find(d => d.title === benchmarkRoadmapTitle)!.id);
    expect(b.decisions.some(d => d.documentBefore?.text === a.documents.find(d => d.title === benchmarkRoadmapTitle)!.text)).toBe(true);
    expect(prepareBenchmarkForms(after, "owner")).toBe(after);
  });
  it("validates form references in the selected hypothesis and does not allow approval without explicit evidence", () => {
    const m = readHypothesis(prepareBenchmarkForms(root(), "owner"), "new-country");
    const rev = m.operatingModel!.revisions.at(-1)!, data = structuredClone(rev.data);
    const n = data.nodes.find(n => n.id === chainId("scan"))!;
    n.reporting!.templateDocumentId = "OTHER-OWNER-DOC";
    expect(() => applyCommand(m, { type: "saveOperatingModel", baseVersion: rev.version, data }, "owner")).toThrow();
    n.reporting!.templateDocumentId = candidatesFormId; n.reporting!.formStatus = "approved";
    expect(() => applyCommand(m, { type: "saveOperatingModel", baseVersion: rev.version, data }, "owner")).toThrow();
  });
  it("renders reporting on desktop and mobile, only links resolvable forms; marks legacy and not-yet-developed forms honestly", () => {
    const m = readHypothesis(prepareBenchmarkForms(root(), "owner"), "new-country");
    const data = m.operatingModel!.revisions.at(-1)!.data;
    const props = { data, selectedId: null, search: "", onSelect: () => {}, documents: m.documents };
    const html = renderToStaticMarkup(React.createElement(ActionRegister, props));
    expect(html).toContain("Найденные кандидаты в конкуренты");
    expect(html).toContain(`/api/product-crew/documents/${candidatesFormId}/download`);
    expect(html).toContain("Черновик");
    expect(html).toContain("Требуется разработать");
    expect(html).toContain("Отчётность не");
    const missing = renderToStaticMarkup(React.createElement(ActionRegister, { ...props, documents: [] }));
    expect(missing).not.toContain(`/api/product-crew/documents/${candidatesFormId}/download`);
  });
});
describe("legal documents across the existing company, not a compliance claim", () => {
  const root = () => prepareBenchmarkForms(prepareBenchmarkChain(fixture(), "owner"), "owner");
  it("adds one proposed role inside the existing ten directions; preserves identities, roles, documents and historical roadmap", () => {
    const before = root(), snapshot = structuredClone(before), after = prepareLegalChain(before, "owner");
    expect(before).toEqual(snapshot);
    expect(after.alternatives![1]).toEqual(before.alternatives![1]);
    const a = readHypothesis(before, "new-country"), b = readHypothesis(after, "new-country");
    const ad = a.operatingModel!.revisions.at(-1)!.data, bd = b.operatingModel!.revisions.at(-1)!.data;
    for (const n of ad.nodes) expect(bd.nodes.some(x => x.id === n.id && x.code === n.code)).toBe(true);
    expect(bd.nodes.filter(n => n.kind === "department")).toEqual(ad.nodes.filter(n => n.kind === "department"));
    expect(bd.nodes.filter(n => n.kind === "role" && n.id !== legalRoleId).map(n => {
      const copy = structuredClone(n); copy.resourceIds = ad.nodes.find(a => a.id === n.id)!.resourceIds; return copy;
    })).toEqual(ad.nodes.filter(n => n.kind === "role"));
    const role = bd.nodes.find(n => n.id === legalRoleId)!;
    expect(role.managerId).toBe("head-control"); expect(role.parentId).toBe("dir-control");
    expect(role.status).toBe("proposal"); expect(role.executorId).toBeNull();
    expect(bd.nodes.find(n => n.id === legalProcessId)!.parentId).toBe("dir-control");
    expect(b.competitorDirectory).toEqual(a.competitorDirectory);
    expect(b.documents).toHaveLength(a.documents.length);
    const doc = b.documents.find(d => d.title === legalRoadmapTitle)!;
    expect(doc.id).toBe(a.documents.find(d => d.title === formsRoadmapTitle)!.id);
    expect(doc.text.length).toBeLessThanOrEqual(50000);
    expect(b.decisions.some(d => d.documentBefore?.text === a.documents.find(d => d.title === formsRoadmapTitle)!.text)).toBe(true);
    expect(prepareLegalChain(after, "owner")).toBe(after);
  });
  it("every handoff/control has receiving sources, responsibility, acceptance, return and a next step; original chain stays connected", () => {
    const m = readHypothesis(prepareLegalChain(root(), "owner"), "new-country"), d = m.operatingModel!.revisions.at(-1)!.data;
    expect(actionChainGaps(d, new Set(legalChain.map(s => legalActionId(s.key))))).toEqual([]);
    expect(actionChainGaps(d, new Set(benchmarkChain.map(s => chainId(s.key))))).toEqual([]);
    for (const l of d.links.filter(l => l.id.startsWith("legal-chain:") && ["handoff", "acceptance"].includes(l.kind))) {
      const target = d.nodes.find(n => n.id === l.to)!;
      if (target.kind === "action") expect(target.inputs.some(i => i.sourceId === l.from)).toBe(true);
    }
    for (const s of legalChain) {
      const n = d.nodes.find(n => n.id === legalActionId(s.key))!;
      expect(n.executorId).toBeNull(); expect(n.register!.approval).not.toBe("approved");
      expect(n.reporting!.formStatus).toBe("required"); expect(n.reporting!.templateDocumentId).toBeNull();
      expect(Object.values(legalForms)).toContain(n.reporting!.formName);
      expect(n.inputs.every(i => inputSupplier(d, i.sourceId))).toBe(true);
    }
    expect(d.links.some(l => l.from === legalResultId("benchmark-send") && l.to === legalActionId("product-list-receive"))).toBe(true);
    expect(d.links.some(l => l.from === legalResultId("product-list-send") && l.to === legalActionId("list-receive"))).toBe(true);
  });
  it("separates authorization, messaging consent and sender registration; owner authority and qualified review are explicit blockers", () => {
    const m = readHypothesis(prepareLegalChain(root(), "owner"), "new-country"), d = m.operatingModel!.revisions.at(-1)!.data;
    const study = d.nodes.find(n => n.id === legalActionId("channels-study"))!;
    expect(study.procedure).toContain("три самостоятельных");
    const review = d.nodes.find(n => n.id === legalActionId("owner-review"))!;
    expect(review.procedure).toContain("без полномочия утверждать вместо Сергея");
    expect(review.procedure).toContain("без её доказательства");
    expect(d.nodes.find(n => n.id === "legal-resource-qualified-review")!.resourceState).toBe("required");
    expect(d.nodes.find(n => n.id === legalActionId("collect"))!.procedure).toContain("не правовое основание");
    expect(d.nodes.find(n => n.id === legalActionId("channels-implement"))!.procedure).toContain("этим описанием не разрешены");
  });
  it("reuses a legal role if one already exists rather than adding another catalogue entry", () => {
    const before = root();
    const model = before.alternatives!.find(h => h.id === "new-country")!.model;
    const d = model.operatingModel!.revisions.at(-1)!.data;
    d.nodes.push({ ...structuredClone(d.nodes.find(n => n.id === "crew-channel-specialist")!),
      id: "existing-legal-role", code: "P.EXISTING.LEGAL", name: "Специалист по правовым вопросам и документам",
      parentId: "dir-control", managerId: "head-control" });
    const after = readHypothesis(prepareLegalChain(before, "owner"), "new-country").operatingModel!.revisions.at(-1)!.data;
    expect(after.nodes.some(n => n.id === legalRoleId)).toBe(false);
    expect(after.nodes.find(n => n.id === legalActionId("collect"))!.roleId).toBe("existing-legal-role");
  });
});
