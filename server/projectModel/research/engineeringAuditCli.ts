import { Pool } from "pg";
import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { unpackModel } from "../history";
import { persistModelUpdate } from "../materialImport";
import { readHypothesis } from "../hypotheses";
import { prepareEngineeringAudit } from "./engineeringAudit";
import { engineeringDoc, engineeringRole, engineeringRoadmap } from "./engineeringAuditSpec";
import { ProductCrewService } from "../../productCrew/service";
import type { ModelRepository } from "../repository";
import { actionChainGaps } from "../../../shared/actionChainCoverage";
import { readProductBook, productBookDocumentId } from "../../../shared/productBook";

async function main() {
  const url = process.env.DATABASE_URL;
  if (process.env.NODE_ENV !== "development" || !url || !/^(helium|lithium)$/.test(new URL(url).hostname))
    throw Error("Explicit Dev database only");
  const log = readFileSync("/tmp/chief-tests.log", "utf8");
  if (!log.includes("2300 passed") || !log.includes("16 skipped")) throw Error("Actual baseline test evidence required");
  const evidence = { commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    at: new Date().toISOString(),
    tests: `npm test фактически выполнен ${statSync("/tmp/chief-tests.log").mtime.toISOString()}: 225 файлов passed/4 skipped; 2300 тестов passed/16 skipped. Это Vitest, не Xcode/PSTN/device/ChatGPT-host. TypeScript и специализированные проверки импорта проверяются отдельно.` };
  const pool = new Pool({ connectionString: url });
  try {
    const rows = (await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
      (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`)).rows;
    if (rows.length !== 1) throw Error("Ambiguous workspace");
    const owner = rows[0].owner_key, before = await unpackModel(pool, owner, rows[0].state);
    const check = process.argv.includes("--check");
    const expected = Number(process.argv.find(v => v.startsWith("--expect="))?.split("=")[1]);
    if (!check && expected !== before.revision) throw Error("Expected revision mismatch; no write");
    const transform = (root: typeof before) => {
      if (!check && root.revision !== expected) throw Error("Concurrent update; reread before saving");
      return prepareEngineeringAudit(root, owner, evidence);
    };
    const saved = check ? transform(before) : await persistModelUpdate(pool, owner, transform, true);
    const old = readHypothesis(before, "new-country"), m = readHypothesis(saved, "new-country");
    const prev = old.operatingModel!.revisions.at(-1)!, op = m.operatingModel!.revisions.at(-1)!;
    const original = (r: typeof before) => { const { revision, alternatives, ...rest } = r; return rest; };
    const checks = {
      original: isDeepStrictEqual(original(before), original(saved)),
      otherHypotheses: isDeepStrictEqual(before.alternatives!.filter(a => a.id !== "new-country"), saved.alternatives!.filter(a => a.id !== "new-country")),
      competitors: isDeepStrictEqual(old.competitorDirectory, m.competitorDirectory),
      analystPassport: isDeepStrictEqual(old.analystPreparation, m.analystPreparation),
      allExistingActions: prev.data.nodes.filter(n => n.kind === "action").every(n => op.data.nodes.some(x => x.id === n.id && x.roleId === n.roleId && x.code === n.code)),
      allRoleIds: isDeepStrictEqual(prev.data.nodes.filter(n => n.kind === "role").map(n => n.id), op.data.nodes.filter(n => n.kind === "role").map(n => n.id)),
      operatingHistory: isDeepStrictEqual(old.operatingModel!.revisions, m.operatingModel!.revisions.slice(0, old.operatingModel!.revisions.length)),
      otherDocuments: old.documents.filter(d => ![engineeringDoc, productBookDocumentId, engineeringRoadmap].includes(d.id))
        .every(d => isDeepStrictEqual(d, m.documents.find(x => x.id === d.id))),
    };
    if (Object.values(checks).some(v => !v)) throw Error("Conservation failed: " + JSON.stringify(checks));
    const owned = op.data.nodes.filter(n => n.kind === "action" && n.roleId === engineeringRole);
    const gaps = actionChainGaps(op.data, new Set(owned.map(n => n.id)));
    if (gaps.length) throw Error("Chief contracts incomplete");
    const service = new ProductCrewService({ read: async (who: string, hypothesis: string) => {
      if (who !== owner || hypothesis !== "new-country") throw Error("Scope denied"); return m;
    }} as unknown as ModelRepository);
    const doc = await service.call(owner, "get_document", { documentId: engineeringDoc });
    const work = await service.call(owner, "get_work", { recordId: "ENG-REVIEW-2026-10-26" });
    if (!doc.text || work.record.coordination.state !== "awaiting_review" || work.result?.id !== engineeringDoc)
      throw Error("MCP document/work read mismatch");
    console.log(JSON.stringify({ savedAndReread: !check, revision: saved.revision, operatingVersion: op.version,
      chiefActions: owned.map(n => ({ id: n.id, code: n.code })), formalGaps: gaps.length,
      bookVersion: readProductBook(m.documents.find(d => d.id === productBookDocumentId))!.version,
      roadmap: m.documents.find(d => d.id === engineeringRoadmap)!.title,
      technicalPassportId: doc.id, workId: work.record.id, checks,
      requests: m.elements.filter(e => ["BENCH-REQ-PRODUCT-BASE", "PB-GAP-TECH", "ENG-REQ-IOS-EVIDENCE",
        "ENG-REQ-QA-MATRIX", "ENG-REQ-FINANCE-CAPACITY", "ENG-REQ-CHANNELS"].includes(e.id))
        .map(e => ({ id: e.id, version: e.version, state: e.coordination?.state })),
      idempotent: prepareEngineeringAudit(saved, owner, evidence) === saved }, null, 2));
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e instanceof Error ? e.stack : "Engineering snapshot failed"); process.exitCode = 1; });
