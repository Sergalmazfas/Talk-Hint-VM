import { describe, expect, it } from "vitest";
import vm from "node:vm";
import { commandFailure } from "./commandError";
import { configureSecretary, SECRETARY_AGENTS } from "./secretaryReview";
import { initialState } from "./domain";
import { crewControlPage } from "./controlPage";

describe("owner command diagnostics", () => {
  it.each(["STALE_REVISION", "OTHER_CREW_WORK_REQUIRES_OWNER_DECISION",
    "SECRETARY_MODELS_UNVERIFIED", "SECRETARY_OWNER_CHARACTER_UNAVAILABLE"])("preserves %s", code => {
    expect(commandFailure(Error(code), "command").error).toBe(code);
    expect(commandFailure(Error(code), "command").message).toBeTruthy();
  });
  it("reproduces production: a completed pilot still binds the global control", () => {
    const s = initialState();
    s.control.testSeriesId = "old-series";
    const before = structuredClone(s);
    expect(() => configureSecretary(s, true, 20e6, "owner", "2026-11-03T00:00:00Z",
      SECRETARY_AGENTS.map(a => a.modelId), 1e6))
      .toThrow("HINT_PILOT_REQUIRES_SEPARATE_OWNER_DECISION");
    expect(s).toEqual(before);
  });
  it.each(["models", "characters", "evidence", "command"] as const)("never leaks raw errors at %s", stage => {
    const result = commandFailure(Error("secret=DO_NOT_EXPOSE SQL provider response"), stage);
    expect(JSON.stringify(result)).not.toContain("DO_NOT_EXPOSE");
    expect(result.error).not.toBe("COMMAND_NOT_CONFIRMED_RELOAD_STATE");
  });
  it("renders only counts initially, details are collapsed, uses textContent", () => {
    const source = crewControlPage.slice(crewControlPage.indexOf("function renderStructure("),
      crewControlPage.indexOf("function render(data)"));
    const els: Record<string, any> = {
      crewStructureSummary: {}, crewStructureResult: {}, crewStructureDetails: { open: true },
    };
    const ctx: any = { $: (id: string) => els[id] };
    vm.runInNewContext(source, ctx);
    ctx.renderStructure({ summary: { ok: 8, problems: 2 }, findings: [{ where: "<script>bad</script>" }] });
    expect(els.crewStructureSummary.textContent).toBe("OK: 8 · проблем: 2 · без моделей");
    expect(els.crewStructureDetails.open).toBe(false);
    expect(els.crewStructureResult.textContent).toContain("<script>bad</script>");
    ctx.renderStructure(null);
    expect(els.crewStructureSummary.textContent).toContain("недоступна");
    expect(els.crewStructureResult.textContent).toBe("");
    expect(crewControlPage).toContain('<summary>Подробнее</summary>');
  });
});
