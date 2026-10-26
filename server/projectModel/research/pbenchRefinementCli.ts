import { Pool } from "pg";
import { isDeepStrictEqual } from "node:util";
import { unpackModel } from "../history";
import { persistModelUpdate } from "../materialImport";
import { readHypothesis } from "../hypotheses";
import { ProductCrewService } from "../../productCrew/service";
import type { ModelRepository } from "../repository";
import { refinePbench, finishPbenchHandoff, pbenchRequests } from "./pbenchRefinement";
import { pbenchDocs, pbenchRole } from "./pbenchRefinementSpec";
import { actionChainGaps } from "../../../shared/actionChainCoverage";

async function main() {
  const url = process.env.DATABASE_URL;
  if (process.env.NODE_ENV !== "development" || !url || !/helium|lithium/.test(new URL(url).hostname))
    throw Error("Explicit Dev database only; no production fallback");
  const pool = new Pool({ connectionString: url });
  try {
    const rows = (await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
      (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`)).rows;
    if (rows.length !== 1) throw Error("Ambiguous workspace; no namespace created");
    const owner = rows[0].owner_key;
    const before = await unpackModel(pool, owner, rows[0].state);
    const check = process.argv.includes("--check");
    const expected = Number(process.argv.find(a => a.startsWith("--expect="))?.split("=")[1]);
    if (!check && (!Number.isSafeInteger(expected) || expected !== before.revision))
      throw Error("Pass current --expect revision; reread and reconcile concurrent edits");
    const transform = (root: typeof before) => {
      if (!check && root.revision !== expected) throw Error("Concurrent model update; no changes saved");
      return finishPbenchHandoff(refinePbench(root, owner), owner);
    };
    const saved = check ? transform(before) : await persistModelUpdate(pool, owner, transform, true);
    const old = readHypothesis(before, "new-country"), model = readHypothesis(saved, "new-country");
    const prev = old.operatingModel!.revisions.at(-1)!, rev = model.operatingModel!.revisions.at(-1)!;
    const original = (root: typeof before) => { const { alternatives, revision, ...rest } = root; return rest; };
    const conserved = {
      original: isDeepStrictEqual(original(before), original(saved)),
      otherHypotheses: isDeepStrictEqual(before.alternatives!.filter(a => a.id !== "new-country"), saved.alternatives!.filter(a => a.id !== "new-country")),
      competitorPassports: isDeepStrictEqual(old.competitorDirectory, model.competitorDirectory),
      productBook: isDeepStrictEqual(old.documents.find(d => d.id === "DOC-TALKHINT-PRODUCT-PASSPORT"), model.documents.find(d => d.id === "DOC-TALKHINT-PRODUCT-PASSPORT")),
      operatingHistory: isDeepStrictEqual(old.operatingModel!.revisions, model.operatingModel!.revisions.slice(0, old.operatingModel!.revisions.length)),
      previousPassportHistory: isDeepStrictEqual(old.analystPreparation!.revisions, model.analystPreparation!.revisions.slice(0, old.analystPreparation!.revisions.length)),
      limits: isDeepStrictEqual(old.analystPreparation!.revisions.at(-1)!.data.limits, model.analystPreparation!.revisions.at(-1)!.data.limits),
      roleIds: isDeepStrictEqual(prev.data.nodes.filter(n => n.kind === "role").map(n => n.id), rev.data.nodes.filter(n => n.kind === "role").map(n => n.id)),
      allActionIds: isDeepStrictEqual(prev.data.nodes.filter(n => n.kind === "action").map(n => n.id), rev.data.nodes.filter(n => n.kind === "action").map(n => n.id)),
    };
    if (Object.values(conserved).some(v => !v)) throw Error("Conservation check failed: " + JSON.stringify(conserved));
    const owned = rev.data.nodes.filter(n => n.kind === "action" && n.roleId === pbenchRole);
    if (actionChainGaps(rev.data, new Set(owned.map(n => n.id))).length) throw Error("Formal contract gap");
    const readers = new ProductCrewService({ read: async (_owner: string, hypothesis: string) => {
      if (_owner !== owner || hypothesis !== "new-country") throw Error("Wrong scope");
      return model;
    }} as unknown as ModelRepository);
    const reads: string[] = [];
    for (const id of Object.values(pbenchDocs)) {
      const result = await readers.call(owner, "get_document", { documentId: id });
      if (result.id !== id || !result.text) throw Error("MCP document read failed");
      reads.push(id);
    }
    for (const q of pbenchRequests) {
      const result = await readers.call(owner, "get_work", { recordId: q.id });
      if (result.record.coordination.state !== "blocked") throw Error("Unexpected acceptance or state");
    }
    console.log(JSON.stringify({ savedAndReread: !check, revision: saved.revision,
      operatingVersion: rev.version, passportVersion: model.analystPreparation!.revisions.at(-1)!.version,
      actionCount: owned.length, formalGaps: 0, conserved, serviceReadDocumentIds: reads,
      queuedRequests: pbenchRequests.map(q => q.id), idempotent: refinePbench(saved, owner) === saved,
      autonomousLaunches: 0, approvals: 0, paidConnections: 0 }, null, 2));
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Update failed"); process.exitCode = 1; });
