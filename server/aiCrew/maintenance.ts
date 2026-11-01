import type { StateStore } from "./store";
import { enforceTestSafety } from "./testGrant";
import { auditStructure } from "./structureAudit";
import type { ProjectModelState } from "../../shared/projectModel";

/** Separate from a possibly busy provider tick. No provider/model writes.
 * At most one read-only structural snapshot per UTC day, report append only. */
export function startCrewMaintenance(o: { environment: string; store: () => StateStore;
  model: () => Promise<ProjectModelState>; stopLocal: () => void; now?: () => Date }) {
  if (o.environment !== "production") return;
  let busy = false, safetyBusy = false;
  const safety = setInterval(async () => {
    if (safetyBusy) return;
    safetyBusy = true;
    try {
      const at = (o.now?.() ?? new Date()).toISOString(), s = await o.store().read();
      if (!s.testGrant || (!s.control.enabled && !s.runs.some(r => r.testSeriesId === s.testGrant?.id && r.status === "running"))) return;
      await o.store().change(s => enforceTestSafety(s, at));
      if (!(await o.store().read()).control.enabled) o.stopLocal();
    } catch { o.stopLocal(); } finally { safetyBusy = false; }
  }, 15000);
  const daily = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const at = (o.now?.() ?? new Date()).toISOString(), day = at.slice(0, 10);
      const s = await o.store().read();
      if (s.structureReports?.some(r => r.day === day)) return;
      const report = auditStructure(await o.model(), s, at);
      await o.store().change(s => {
        if (!s.structureReports?.some(r => r.day === day)) (s.structureReports ??= []).push(report);
      });
    } catch {
      // A failed read is not "OK". No credentials/exception text in logs.
      console.info("[AI Crew] structure_check_unavailable");
    } finally { busy = false; }
  }, 60000);
  safety.unref(); daily.unref();
  return { safety, daily };
}
