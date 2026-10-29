/** Explicit full-size Dev rehearsal. No production, no external services, no cleanup. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import { CompanyCutover } from "../../server/companyData/cutover/service";
import { cutoverCandidate, type CutoverPolicy } from "../../server/companyData/cutover/policy";
import { lockCompanyWrite, checkpointRoot } from "../../server/companyData/cutover/guard";
import { payloadTables, physicalTable } from "../../server/companyData/v3/schema";
import { IncrementalCompanyRepository } from "../../server/companyData/v3/repository";
import { CommandCompanyRepository } from "../../server/companyData/v3/commands";
import { PgModelRepository } from "../../server/projectModel/repository";
import { ProductCrewService } from "../../server/productCrew/service";
import { activeCompanyDocument } from "../../server/companyData/active";
import { semanticHash } from "../../server/companyData/valueTree";
assert.equal(process.env.NODE_ENV, "development");
assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium");
const directory = "generated-artifacts/company-cutover-secure";
await mkdir(directory, { recursive: true });
const retained = JSON.parse(await readFile("generated-artifacts/data-platform-publish2/PERF_RETAINED_COPY.json", "utf8"));
const id = randomUUID(), owner = `cutover-protected:${id}`, workspace = `company-cutover-protected-${id}`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const policy: CutoverPolicy = { ...cutoverCandidate, owner, workspace, environment: "development" };
const control = new CompanyCutover(pool, "development", policy, policy);
const pg = new PgModelRepository(async () => pool);
const raw = new IncrementalCompanyRepository(pool, "development"), commands = new CommandCompanyRepository(raw);
const report: any = { owner, workspace, sourceWorkspace: retained.workspace, productionTouched: false,
  approvalInProduction: null, cleanup: false, steps: [], measurements: [], protectedByDurableControl: true };
const stamp = async (name: string, fn: () => Promise<any>) => {
  const start = performance.now(); const result = await fn();
  report.steps.push({ name, ms: performance.now() - start, result });
  await writeFile(`${directory}/REHEARSAL.json`, JSON.stringify(report, null, 2));
  console.log(name, Math.round(performance.now() - start), "ms"); return result;
};
const execute = async (action: any) => {
  const status = await control.status(owner);
  const grant = await control.grant(owner, action, status.source);
  const operation = await control.enqueue(owner, action, status.source, grant);
  await assert.rejects(() => control.enqueue(owner, action, status.source, grant), /разрешение|Операция|фаза|источника/);
  return control.perform(owner, operation);
};
try {
  await stamp("clone_full_retained_baseline_no_original_changes", async () => {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const src = (await db.query("SELECT * FROM company_v3_workspaces WHERE workspace_id=$1", [retained.workspace])).rows[0];
      assert.equal(Number(src.current_revision), 912); assert.equal(src.root_hash, policy.rootHash);
      await db.query(`INSERT INTO company_v3_workspaces
        (workspace_id,owner_key,environment,label,generation,current_revision,root_hash)
        VALUES($1,$2,'development','PROTECTED CUTOVER REHEARSAL — RETAIN FOR OWNER','shadow',912,$3)`,
      [workspace, owner, policy.rootHash]);
      const tables = ["company_v3_text_snapshots", ...payloadTables.map(physicalTable),
        "company_v3_payload_text_refs", "company_v3_frames", "company_v3_revision_heads",
        "company_v3_document_heads", "company_v3_archive_refs", "company_v3_size_budgets"];
      let count = 0;
      for (const table of tables) {
        const columns = (await db.query(`SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table])).rows.map(r => r.column_name);
        assert(columns.every((c: string) => /^[a-z0-9_]+$/.test(c)));
        const boundary = table === "company_v3_revision_heads" ? " AND revision<=912" :
          table === "company_v3_document_heads" ? " AND valid_from<=912" : "";
        count += (await db.query(`INSERT INTO ${table} (${columns.map((c: string) => `"${c}"`).join(",")})
          SELECT ${columns.map((c: string) => c === "workspace_id" ? "$1::text" : `"${c}"`).join(",")}
          FROM ${table} WHERE workspace_id=$2${boundary}`, [workspace, retained.workspace])).rowCount ?? 0;
      }
      await db.query("COMMIT"); return { physicalRows: count };
    } catch (e) { await db.query("ROLLBACK"); throw e; } finally { db.release(); }
  });
  await stamp("unapproved_release_refuses_then_protect_shadow_owner_from_seed", async () => {
    const status = await control.status(owner);
    const noApproval = new CompanyCutover(pool, "development", policy, null);
    await assert.rejects(() => noApproval.grant(owner, "activate", status.source), /не разрешено/);
    const grant = await control.grant(owner, "activate", status.source);
    await assert.rejects(() => pg.read(owner, "new-country"), /seed запрещён/);
    assert.equal((await pool.query("SELECT 1 FROM talkhint_project_models WHERE owner_key=$1", [owner])).rowCount, 0);
    await assert.rejects(() => control.enqueue(owner, "activate",
      { ...status.source, revision: 913 }, grant), /CAS/);
    const operation = await control.enqueue(owner, "activate", status.source, grant);
    await control.perform(owner, operation);
    await assert.rejects(() => control.enqueue(owner, "activate", status.source, grant));
    return { noSeed: true, baselineActivation: true, oneUseAndCAS: true };
  });
  await stamp("baseline_readers_and_write_barrier_before_probe", async () => {
    const root = await raw.readRoot(owner); assert.equal(semanticHash(root), policy.semanticHash);
    let count = 0;
    for (const h of [{ id: "original", model: root }, ...(root.alternatives ?? [])]) {
      for (const d of h.model.documents) {
        const direct = await raw.readDocumentSnapshot(owner, h.id, d.id);
        assert.equal(semanticHash(direct.document), semanticHash(d)); count++;
      }
    }
    assert.equal(count, 84);
    const book = await pg.read(owner, "new-country"); assert.equal(book.documents.length, 50);
    const journal = book.documents.find(d => d.id === "DOC-TALKHINT-IMPROVEMENT-JOURNAL")!;
    const service = new ProductCrewService(pg);
    const result = await service.call(owner, "get_document", { documentId: journal.id });
    assert.equal(result.text, journal.text);
    assert.equal((await activeCompanyDocument(pool, owner, "development", journal.id))!.text, journal.text);
    await assert.rejects(() => commands.update(owner, 912, { type: "saveDocument", id: journal.id,
      title: journal.title, text: journal.text, url: journal.url, elementIds: journal.elementIds }, "new-country"),
    /Запись модели временно закрыта/);
    return { revision: 912, semanticHash: policy.semanticHash, documents: count, directJournal: true, writesClosed: true };
  });
  await stamp("narrow_technical_probe_and_compensation_only", () => execute("probe"));
  await stamp("explicit_open_writes", () => execute("open_writes"));
  await stamp("ordinary_document_and_role_writes", async () => {
    // Read once explicitly for a benchmark; write responses must stay incremental.
    let state = await commands.read(owner, "new-country");
    const doc = state.documents.find(d => d.id === policy.probeDocumentId)!;
    for (const kind of ["document", "role"]) for (let trial = 1; trial <= 2; trial++) {
      let command: any;
      if (kind === "document") command = { type: "saveDocument", id: doc.id, title: doc.title,
        text: `${doc.text}\nProtected rehearsal retained trial ${trial}`, url: doc.url, elementIds: doc.elementIds };
      else {
        const last = state.operatingModel!.revisions.at(-1)!, data = structuredClone(last.data);
        data.nodes.find(n => n.kind === "role")!.description += `\nProtected rehearsal ${trial}`;
        command = { type: "saveOperatingModel", baseVersion: last.version, data };
      }
      const start = performance.now();
      state = await commands.updateMany(owner, state.revision, [command], "new-country");
      report.measurements.push({ kind, trial, revision: state.revision, ms: performance.now() - start });
    }
    return { latestRevision: state.revision, incrementalResponses: true };
  });
  await stamp("drain_inflight_writer_before_rollback_grant", async () => {
    const db = await pool.connect(); await db.query("BEGIN");
    await lockCompanyWrite(db, owner, "development");
    const status = await control.status(owner);
    let settled = false;
    const waiting = control.grant(owner, "rollback", status.source).then(g => { settled = true; return g; });
    await new Promise(resolve => setTimeout(resolve, 150)); assert.equal(settled, false);
    await db.query("COMMIT"); db.release();
    const grant = await waiting;
    const operation = await control.enqueue(owner, "rollback", status.source, grant);
    return { waitedForInFlight: true, operation };
  });
  await stamp("rollback_latest_to_owner_bound_checkpoint_no_seed", async () => {
    const last = report.steps.at(-1).result.operation;
    const before = await raw.readDocumentSnapshot(owner, "new-country", policy.probeDocumentId);
    const result = await control.perform(owner, last);
    const root = await checkpointRoot(pool, owner, "development"); assert(root);
    const status = await control.status(owner); assert.equal(status.phase, "checkpoint"); assert.equal(status.writesOpen, false);
    const doc = await pg.readDocumentSnapshot(owner, "new-country", policy.probeDocumentId);
    assert.equal(semanticHash(doc!.document), semanticHash(before.document));
    const book = await pg.read(owner, "new-country"); assert.equal(book.revision, before.revision);
    const journal = await activeCompanyDocument(pool, owner, "development", "DOC-TALKHINT-IMPROVEMENT-JOURNAL");
    assert(journal && journal.revision === before.revision);
    assert.equal((await pool.query("SELECT 1 FROM talkhint_project_models WHERE owner_key=$1", [owner])).rowCount, 0);
    return { ...result, latestSemanticHash: semanticHash(root), checkpointSHA: status.checkpoint!.semanticHash,
      latestTextPreserved: true, liveLegacyRows: 0, ownerScopedDirectJournal: true };
  });
  await stamp("reactivate_checkpoint_head_not_old_912", () => execute("reactivate"));
  report.finalStatus = await control.status(owner);
  assert.equal(report.finalStatus.phase, "verifying"); assert.equal(report.finalStatus.writesOpen, false);
  assert.equal((await pool.query("SELECT current_revision,root_hash FROM company_v3_workspaces WHERE workspace_id=$1",
    [retained.workspace])).rows[0].root_hash, policy.rootHash);
  report.sourceUnchanged = true; report.finished = true;
} catch (e) {
  report.finished = false; report.error = e instanceof Error ? e.message : "Unknown failure";
  throw e;
} finally {
  report.maxRssKiB = process.resourceUsage().maxRSS;
  await writeFile(`${directory}/REHEARSAL.json`, JSON.stringify(report, null, 2));
  await pool.end();
}
