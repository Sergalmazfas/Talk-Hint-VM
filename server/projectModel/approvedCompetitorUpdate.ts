import { isDeepStrictEqual } from "node:util";
import type { ProjectModelState } from "../../shared/projectModel";
import { normalizeCompetitorSnapshot, type CompetitorSnapshot } from "../../shared/projectCompetitors";
import { competitorSnapshotSchema } from "./competitorSchema";
import { applyHypothesisCommand, readHypothesis } from "./hypotheses";

/** Explicit Dev update only; never registered as a startup seed, timer or external integration. */
export function applyApprovedCompetitors(root: ProjectModelState, snapshots: CompetitorSnapshot[], actor: string) {
  let next = root;
  const results: { name: string; id: string; action: "created" | "updated" | "unchanged" }[] = [];
  const appId = (value: string) => value.match(/^https:\/\/apps\.apple\.com\/.*\/id(\d+)/)?.[1];
  for (const raw of snapshots) {
    const snapshot = normalizeCompetitorSnapshot(competitorSnapshotSchema.parse(raw) as CompetitorSnapshot);
    const records = readHypothesis(next, "new-country").competitorDirectory?.records ?? [];
    const candidates = records.filter(record => {
      const saved = record.revisions.at(-1)?.snapshot;
      return saved && ((appId(snapshot.appStore) && appId(saved.appStore) === appId(snapshot.appStore)) ||
        saved.name.trim().toLowerCase() === snapshot.name.trim().toLowerCase());
    });
    if (candidates.length > 1) throw new Error(`Найдены прежние дубликаты ${snapshot.name}; автоматическое объединение запрещено`);
    const record = candidates[0], latest = record?.revisions.at(-1);
    if (latest && isDeepStrictEqual(latest.snapshot, snapshot)) {
      results.push({ name: snapshot.name, id: record.id, action: "unchanged" }); continue;
    }
    // Do not replace an independently enriched card with a bounded supplied dataset.
    if (latest && latest.snapshot.checkedAt > snapshot.checkedAt)
      throw new Error(`У ${snapshot.name} есть более свежая карточка; нужна ручная сверка, а не перезапись`);
    next = applyHypothesisCommand(next, "new-country", {
      type: "saveCompetitor", ...(record ? { id: record.id } : {}),
      baseVersion: latest?.version ?? 0,
      reason: "Согласованные Lingvanex/VocaLingo: сведения сессии 24.10 и сверка официальных публичных источников 25.10.2026; без live-проверки",
      snapshot,
    }, actor);
    const savedRecords = readHypothesis(next, "new-country").competitorDirectory!.records;
    results.push({ name: snapshot.name, id: record?.id ?? savedRecords.at(-1)!.id, action: record ? "updated" : "created" });
  }
  return { state: next, results };
}
