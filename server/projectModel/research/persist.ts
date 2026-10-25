import type { Pool } from "pg";
import { isDeepStrictEqual } from "node:util";
import type { CompetitorSnapshot } from "../../../shared/projectCompetitors";
import { competitorSnapshotSchema } from "../competitorSchema";
import { persistModelUpdate } from "../materialImport";
import { applyHypothesisCommand, readHypothesis } from "../hypotheses";

/** Explicit owner-scoped Dev content update; no route, timer, external calls or new storage. */
export async function persistResearchCard(pool: Pool, owner: string, appId: string,
  prepare: (existing?: CompetitorSnapshot) => CompetitorSnapshot) {
  let savedId = "", version = 0;
  const state = await persistModelUpdate(pool, owner, root => {
    const before = readHypothesis(root, "new-country");
    const records = before.competitorDirectory?.records ?? [];
    const matches = records.filter(row => row.revisions.at(-1)!.snapshot.appStore.match(/\/id(\d+)/)?.[1] === appId);
    if (matches.length > 1) throw new Error("Duplicate product identities require manual resolution");
    const record = matches[0], latest = record?.revisions.at(-1);
    const snapshot = competitorSnapshotSchema.parse(prepare(latest?.snapshot)) as CompetitorSnapshot;
    if (snapshot.appStore.match(/\/id(\d+)/)?.[1] !== appId) throw new Error("Product identity changed");
    const next = applyHypothesisCommand(root, "new-country", {
      type: "saveCompetitor", ...(record ? { id: record.id } : {}), baseVersion: latest?.version ?? 0,
      reason: "Согласованное углублённое исследование открытых источников 25.10.2026; без покупок, регистрации и живых тестов",
      snapshot,
    }, owner);
    const after = readHypothesis(next, "new-country");
    const saved = after.competitorDirectory!.records.find(row => row.revisions.at(-1)!.snapshot.appStore.match(/\/id(\d+)/)?.[1] === appId)!;
    if (!isDeepStrictEqual(root.elements, next.elements) || !isDeepStrictEqual(root.documents, next.documents) ||
      !isDeepStrictEqual(root.relations, next.relations) || root.primaryHypothesisId !== next.primaryHypothesisId ||
      !isDeepStrictEqual(root.alternatives?.filter(item => item.id !== "new-country"), next.alternatives?.filter(item => item.id !== "new-country")) ||
      !isDeepStrictEqual(before.elements.filter(item => item.id !== "TH-PILOT-COMPETITORS"), after.elements.filter(item => item.id !== "TH-PILOT-COMPETITORS")) ||
      !isDeepStrictEqual(before.documents, after.documents) || !isDeepStrictEqual(before.relations, after.relations) ||
      !isDeepStrictEqual(before.competitorDirectory?.quarters, after.competitorDirectory?.quarters) ||
      !records.filter(row => row.id !== record?.id).every(row => isDeepStrictEqual(row, after.competitorDirectory!.records.find(item => item.id === row.id))) ||
      (record && !isDeepStrictEqual(record.revisions, saved.revisions.slice(0, -1)))) throw new Error("Preservation guard failed");
    savedId = saved.id; version = saved.revisions.at(-1)!.version;
    return next;
  }, true);
  return { id: savedId, version, revision: state.revision, completeReadback: true, otherMaterialsPreserved: true };
}
