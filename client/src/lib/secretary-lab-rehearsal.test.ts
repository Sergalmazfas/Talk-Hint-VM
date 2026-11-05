import { describe, expect, it } from "vitest";
import type { RehearsalResult, RehearsalVersion } from "@shared/rehearsal";
import {
  canStartRehearsalVersion,
  parsePastedRehearsalPlan,
  rehearsalVersionReason,
  sameRehearsalSceneSnapshot,
  selectRehearsalVersion,
  serializeRehearsalResult,
  shouldAnalyseRehearsal,
  shouldContinueRehearsalPolling,
} from "./rehearsal-helpers";

function result(overrides: Partial<RehearsalResult> = {}): RehearsalResult {
  return {
    id: "session-a", status: "ended", createdAt: "2026-01-03T12:00:00Z",
    instruction: "owner plan", model: "dev-model", voice: "dev-voice", turns: [],
    rehearsal: {
      scene: { id: "scene-1", title: "Проверка", hash: "scene-hash-1", plan: {
        goal: "Проверить запись", ownerFacts: [], sayAsk: [], expectedQuestions: [], unknowns: [],
        disclosurePolicy: { allowed: [], forbidden: [] }, language: "ru", executor: "hint",
      } },
      version: { id: "dev-a", label: "Dev A", source: "dev-a", hash: "version-hash-a", available: true, productionVerified: false },
      review: { status: "not_started" },
      audio: { status: "pending" },
      recordingConsent: true,
      codeVersion: "commit-a",
    },
    ...overrides,
  };
}

describe("rehearsal helpers", () => {
  it("retains canonical plan array items, including commas and semicolons", () => {
    const raw = {
      goal: "Позвонить по сценарию",
      ownerFacts: ["первый факт, с запятой", "второй; с точкой с запятой"],
      sayAsk: ["пункт один; не делить", "пункт два, тоже один пункт"],
      expectedQuestions: [{ q: "Сколько стоит?", answer: "10; 20, 30" }],
      unknowns: ["неизвестное, целиком"],
      disclosurePolicy: { allowed: ["можно; сообщить"], forbidden: ["нельзя, раскрывать"] },
      language: "ru", executor: "hint",
    };
    const parsed = parsePastedRehearsalPlan(JSON.stringify(raw));
    expect(parsed.ownerFacts).toEqual(raw.ownerFacts);
    expect(parsed.sayAsk).toEqual(raw.sayAsk);
    expect(parsed.expectedQuestions).toEqual(raw.expectedQuestions);
    expect(parsed.unknowns).toEqual(raw.unknowns);
    expect(parsed.disclosurePolicy).toEqual(raw.disclosurePolicy);
  });

  it("rejects JSON when required canonical plan fields are missing", () => {
    expect(() => parsePastedRehearsalPlan(JSON.stringify({ goal: "Есть только цель" }))).toThrow(/CallPlan/);
  });

  it("compares scene identity and immutable hash, not display labels", () => {
    const sameLabelsDifferentSceneId = result({
      rehearsal: { ...result().rehearsal, scene: { ...result().rehearsal.scene, id: "scene-2" } },
    });
    const sameIdDifferentHash = result({
      rehearsal: { ...result().rehearsal, scene: { ...result().rehearsal.scene, hash: "scene-hash-2" } },
    });
    expect(sameRehearsalSceneSnapshot(result(), result())).toBe(true);
    expect(sameRehearsalSceneSnapshot(result(), sameLabelsDifferentSceneId)).toBe(false);
    expect(sameRehearsalSceneSnapshot(result(), sameIdDifferentHash)).toBe(false);
  });

  it("does not substitute another profile when a selected version is unavailable", () => {
    const versions: RehearsalVersion[] = [
      { id: "prod", label: "Profile", source: "production-profile-code", hash: "p", available: false, reason: "Сборка недоступна", productionVerified: false },
      { id: "dev", label: "Dev", source: "dev", hash: "d", available: true, productionVerified: false },
    ];
    const selected = selectRehearsalVersion(versions, 0);
    expect(selected?.id).toBe("prod");
    expect(canStartRehearsalVersion(selected)).toBe(false);
    expect(selectRehearsalVersion(versions, 2)).toBeNull();
    expect(rehearsalVersionReason(versions[0])).toMatch(/Сборка недоступна/);
    expect(rehearsalVersionReason(versions[0])).toMatch(/productionVerified=false/);
    const unverifiedProductionCode = { ...versions[0], available: true, reason: undefined };
    expect(canStartRehearsalVersion(unverifiedProductionCode)).toBe(true);
    expect(rehearsalVersionReason(unverifiedProductionCode)).toContain("не подтверждена");
    expect(rehearsalVersionReason(unverifiedProductionCode)).toMatch(/productionVerified=false/);
  });

  it("exports the immutable scene and version snapshots with the report", () => {
    const saved = result();
    const exported = JSON.parse(serializeRehearsalResult(saved));
    expect(exported.rehearsal.scene).toEqual(saved.rehearsal.scene);
    expect(exported.rehearsal.version).toEqual(saved.rehearsal.version);
  });

  it("keeps polling an ended call through review running and analyses only once-state", () => {
    const endedUnanalysed = result();
    const reviewRunning = result({ rehearsal: { ...result().rehearsal, review: { status: "running" } } });
    const reviewComplete = result({ rehearsal: { ...result().rehearsal, review: { status: "completed" } } });
    const reviewUnknown = result({ rehearsal: { ...result().rehearsal, review: { status: "unknown" } } });
    expect(shouldAnalyseRehearsal(endedUnanalysed)).toBe(true);
    expect(shouldContinueRehearsalPolling(endedUnanalysed)).toBe(true);
    expect(shouldAnalyseRehearsal(reviewRunning)).toBe(false);
    expect(shouldContinueRehearsalPolling(reviewRunning)).toBe(true);
    expect(shouldContinueRehearsalPolling(reviewComplete)).toBe(false);
    expect(shouldContinueRehearsalPolling(reviewUnknown)).toBe(false);
    expect(shouldAnalyseRehearsal(result({ status: "unknown" }))).toBe(false);
  });
});
