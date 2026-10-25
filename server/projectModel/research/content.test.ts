import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CompetitorDossierView } from "../../../client/src/components/project-model/CompetitorDossier";
import Workbench from "../../../client/src/components/project-model/CompetitorResearchWorkbench";
import { initialAIPhoneSnapshot, initialTalkHintBaseline } from "../competitorInitial";
import { lingvanexSnapshot } from "../competitorLingvanex";
import { vocalingoSnapshot } from "../competitorVocalingo";
import { dossierSections } from "../../../shared/competitorDossier";
import { normalizeCompetitorSnapshot } from "../../../shared/projectCompetitors";
import { researchFor, researchRows } from "../../../shared/competitorResearch";
import { competitorSnapshotSchema } from "../competitorSchema";
import { enrichVocalingo } from "./vocalingo";
import { enrichLingvanex } from "./lingvanex";
import { aiCallSnapshot } from "./aicall";
import { enrichAiPhone } from "./aiphone";
import { guardianlySnapshot } from "./guardianly";

const snapshots = [
  enrichVocalingo(vocalingoSnapshot()), enrichLingvanex(lingvanexSnapshot()),
  aiCallSnapshot(), enrichAiPhone(initialAIPhoneSnapshot), guardianlySnapshot(),
].map(normalizeCompetitorSnapshot);
describe("approved five competitor research, not production app changes", () => {
  it.each(snapshots)("validates all six sections, sourced estimates and separate conclusion for $name", snapshot => {
    expect(competitorSnapshotSchema.safeParse(snapshot).success).toBe(true);
    const markup = renderToStaticMarkup(React.createElement(CompetitorDossierView, { snapshot, research: researchFor(snapshot) }));
    const headings = dossierSections.map(label => markup.indexOf(`<h3>${label}</h3>`));
    expect(headings.every((value, i) => value >= 0 && (i === 0 || value > headings[i - 1]))).toBe(true);
    expect(markup.indexOf('<h3>Стратегический вывод</h3>')).toBeGreaterThan(headings.at(-1)!);
    expect(markup).toContain("Раунды, инвесторы и суммы не подтверждены");
    expect(markup).toContain("Независимая оценка");
    expect(snapshot.dossier!.avatar.presence?.value).toBeNull();
    expect(snapshot.dossier!.scale.paying?.value).toBeNull();
    expect(snapshot.dossier!.scale.active?.value).toBeNull();
    for (const source of snapshot.sources) {
      expect(source.url).toMatch(/^https:\/\//);
      expect(source.url).not.toMatch(/visit_token|api_key|access_token|referrer=/i);
    }
  });
  it("preserves original price rows and input snapshots, distinguishes channels and ambiguous periods", () => {
    const before = structuredClone(initialAIPhoneSnapshot);
    expect(enrichAiPhone(initialAIPhoneSnapshot).plans).toEqual(before.plans);
    expect(initialAIPhoneSnapshot).toEqual(before);
    const ai = snapshots[2];
    expect(ai.plans.find(plan => plan.price === 59.99)?.period).toBe("unknown");
    expect(ai.plans.find(plan => plan.id === "credits-450")?.includedUnits).toEqual({ unit: "credits", amount: 450 });
    const voca = snapshots[0];
    expect(voca.plans.find(plan => plan.purchaseChannel === "US App Store" && plan.period === "year")?.price).toBe(99.99);
    expect(voca.dossier!.technical.find(row => row.id === "research-media-pipeline")?.scope).toBe("file_tool");
  });
  it("does not turn traffic estimates into proof of autonomous functions or current positioning", () => {
    const directory = { records: snapshots.map((snapshot, i) => ({
      id: `research-${i}`, revisions: [{ version: 1, savedAt: "2026-10-25", reason: "Public sources, not live test", snapshot }],
    })), talkhint: initialTalkHintBaseline };
    const rows = researchRows(directory);
    expect(rows.filter(row => row.kind === "competitor")).toHaveLength(5);
    expect(new Set(snapshots.map(snapshot => snapshot.appStore.match(/id(\d+)/)![1])).size).toBe(5);
    const markup = renderToStaticMarkup(React.createElement(Workbench, {
      directory, initialSelectedIds: directory.records.map(row => row.id), submit: vi.fn(),
    }));
    for (const snapshot of snapshots) expect(markup).toContain(snapshot.name.replaceAll("&", "&amp;"));
    expect(markup).toContain("Нет точек с достаточными проверяемыми данными");
    expect(researchFor(snapshots[1]).features.history?.status).toBe("official_claim");
    expect(researchFor(snapshots[3]).features.secretary_outgoing?.status).toBe("unknown");
    expect(researchFor(snapshots[4]).features.calendar?.status).toBe("unknown");
  });
});
