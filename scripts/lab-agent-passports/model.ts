/** Manual proposal export/registration only; never imports the runtime lab service. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { unpackModel } from "../../server/projectModel/history";
import { readHypothesis, applyHypothesisCommand } from "../../server/projectModel/hypotheses";
import { persistModelUpdate } from "../../server/projectModel/materialImport";
import { ProductCrewService } from "../../server/productCrew/service";
import { activeModelSize, modelSizeBudget } from "../../server/projectModel/sizeBudget";

const dirArg = process.argv.indexOf("--dir");
const dir = dirArg < 0 ? "generated-artifacts/lab-agent-passports" : process.argv[dirArg + 1];
assert(dir?.startsWith("generated-artifacts/") && !dir.includes(".."), "Generated output directory required");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev model only");
  await mkdir(dir, { recursive: true });
  const q = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(q.rowCount, 1, "Unambiguous existing model required");
  const row = q.rows[0];
  const before = readHypothesis(await unpackModel(pool, row.owner_key, row.state), "new-country");
  if (process.argv.includes("--budget")) {
    console.log(JSON.stringify({ revision: before.revision, size: activeModelSize(before),
      budget: modelSizeBudget(before), available: modelSizeBudget(before) - activeModelSize(before) }));
  } else if (process.argv.includes("--revise")) {
    const candidate = JSON.parse(await readFile(`${dir}/REVISION.json`, "utf8"));
    assert.equal(before.revision, candidate.sourceRevision, "Concurrent model change; re-read first");
    assert.equal(candidate.runtimeActivation, false);
    const allowed = new Set(["DOC-HINT-LAB-AGENT-PROMPT-PACKAGE",
      "DOC-PLAB-PROMPT-PROPOSAL", "DOC-PLG-QA-PROMPT-PROPOSAL"]);
    assert.equal(candidate.documents.length, allowed.size);
    const originals = new Map(before.documents.map(d => [d.id, d]));
    for (const d of candidate.documents) {
      assert(allowed.delete(d.id) && originals.has(d.id), "Only existing proposal IDs");
      assert.equal(JSON.parse(d.text).version, 2);
      assert.equal(JSON.parse(d.text).runtimeActivation, false);
      assert(d.text.length <= 50_000);
    }
    assert.equal(allowed.size, 0);
    const journal = originals.get("DOC-TALKHINT-IMPROVEMENT-JOURNAL")!;
    const j = JSON.parse(journal.text);
    const c = j.cases.find((v: any) => v.caseId === "HINT-LAB-AGENT-PASSPORTS");
    assert(c, "Extend existing case only");
    assert(!c.history.some((h: any) => h.reviewSha256 === candidate.reviewSha256), "Review already recorded");
    c.history.push({ at: candidate.createdAt, role: "HEAD.07",
      stage: candidate.preparationDecision ? "owner_preparation_approved" : "manual_pass_corrections",
      reviewSha256: candidate.reviewSha256,
      ...(candidate.preparationDecision ? { decision: candidate.preparationDecision }
        : { reviewVerdict: "принять с исправлениями" }),
      proposalVersion: 2, sourceRevision: before.revision, runtimeActivation: false,
      openDecisions: candidate.preparationDecision ? [] : ["R2", "R4"],
      namesSelected: !!candidate.preparationDecision });
    j.version++;
    j.history.push({ at: candidate.createdAt, role: "HEAD.07", sourceRevision: before.revision,
      marker: "lab-agent-prompts-review-v2", caseId: c.caseId });
    assert(JSON.stringify(j).length <= 50_000, "Never truncate journal");
    const transform = (root: any) => {
      assert.equal(readHypothesis(root, "new-country").revision, before.revision);
      let next = root;
      for (const d of candidate.documents) {
        const old = originals.get(d.id)!;
        next = applyHypothesisCommand(next, "new-country", { type: "saveDocument",
          id: d.id, title: d.title, text: d.text, url: old.url, elementIds: old.elementIds },
          "Manual review corrections; draft only");
      }
      return applyHypothesisCommand(next, "new-country", { type: "saveDocument",
        id: journal.id, title: journal.title, text: JSON.stringify(j), url: journal.url,
        elementIds: journal.elementIds }, "Extend existing review case; no activation");
    };
    const preview = readHypothesis(transform({
      ...await unpackModel(pool, row.owner_key, row.state),
    }), "new-country");
    console.log(JSON.stringify({ preflight: true, revision: before.revision,
      remaining: modelSizeBudget(preview) - activeModelSize(preview) }));
    const result = await persistModelUpdate(pool, row.owner_key, transform, true);
    const after = readHypothesis(result, "new-country");
    assert.deepEqual(after.operatingModel, before.operatingModel);
    const changedIds = new Set([...candidate.documents.map((d: any) => d.id), journal.id]);
    for (const [id, d] of originals)
      if (!changedIds.has(id)) assert.deepEqual(after.documents.find(v => v.id === id), d);
    const afterJournal = JSON.parse(after.documents.find(v => v.id === journal.id)!.text);
    for (const old of JSON.parse(journal.text).cases) {
      const saved = afterJournal.cases.find((v: any) => v.caseId === old.caseId);
      if (old.caseId !== c.caseId) assert.deepEqual(saved, old);
      else assert.deepEqual(saved.history.slice(0, old.history.length), old.history);
    }
    const reader = new ProductCrewService({ read: async () => after, update: async () => { throw Error("read only"); } });
    for (const d of candidate.documents)
      assert.equal((await reader.call(row.owner_key, "get_document", { documentId: d.id })).text, d.text);
    await writeFile(`${dir}/REGISTERED.json`, JSON.stringify({
      sourceRevision: before.revision, revision: after.revision, version: 2, readerVerified: true,
      operatingModelUnchanged: true, activePassportsUnchanged: true, oldCasesPreserved: true,
      runtimeActivation: false, remainingCapacity: modelSizeBudget(after) - activeModelSize(after),
    }, null, 2));
    console.log(JSON.stringify({ revision: after.revision, runtimeActivation: false }));
  } else if (!process.argv.includes("--register")) {
    const reader = new ProductCrewService({ read: async () => before, update: async () => { throw Error("read only"); } });
    const ids = before.documents.filter(d =>
      /PLAB|PLG|LAB|HINT|PPRODUCT|PRODUCT-PASSPORT|IMPROVEMENT-JOURNAL|OWNER-CALLS/.test(d.id));
    const documents = [];
    for (const d of ids) {
      assert.equal((await reader.call(row.owner_key, "get_document", { documentId: d.id })).text, d.text);
      documents.push({ id: d.id, title: d.title, text: d.text, elementIds: d.elementIds, url: d.url });
    }
    await writeFile(`${dir}/source-model.json`, JSON.stringify({
      capturedAt: new Date().toISOString(), revision: before.revision, modelId: "new-country",
      operatingModel: before.operatingModel!.revisions.at(-1),
      documents, readerVerified: true,
    }, null, 2));
    console.log(JSON.stringify({ revision: before.revision,
      operatingVersion: before.operatingModel!.revisions.at(-1)!.version,
      documents: documents.map(d => ({ id: d.id, size: d.text.length })) }));
  } else {
    const candidate = JSON.parse(await readFile(`${dir}/REGISTRATION.json`, "utf8"));
    assert.equal(before.revision, candidate.sourceRevision, "Re-read/rebuild after concurrent changes");
    assert.equal(candidate.runtimeActivation, false);
    const opBefore = JSON.stringify(before.operatingModel);
    const activeDocsBefore = new Map(before.documents.map(d => [d.id, d.text]));
    const journal = before.documents.find(d => d.id === "DOC-TALKHINT-IMPROVEMENT-JOURNAL")!;
    const j = JSON.parse(journal.text);
    assert(!j.cases.some((c: any) => c.caseId === candidate.caseId), "Already registered; do not duplicate");
    j.cases.push({ caseId: candidate.caseId, label: "Промпты и характеры P.LAB/P.LG.QA",
      accepted: false, ownerEvaluationOfImplementedChange: null,
      history: [{ at: candidate.createdAt, role: "HEAD.07 / P.PRODUCT",
        stage: "proposal_prepared", documentId: candidate.indexDocumentId,
        sourceRevision: before.revision, runtimeActivation: false,
        note: "Подготовка на ручной проход; инструменты, память, промпты и роли не включены." }] });
    j.version++;
    j.history.push({ at: candidate.createdAt, role: "HEAD.07", sourceRevision: before.revision,
      marker: "lab-agent-passports-proposal", documentId: candidate.indexDocumentId });
    const journalText = JSON.stringify(j);
    assert(journalText.length <= 50_000, "Never truncate the existing journal");
    for (const d of candidate.documents) {
      assert(!activeDocsBefore.has(d.id), "Never overwrite an existing passport/proposal");
      assert(d.text.length <= 50_000, `Document too large: ${d.id}`);
    }
    const result = await persistModelUpdate(pool, row.owner_key, root => {
      assert.equal(readHypothesis(root, "new-country").revision, before.revision);
      let next = root;
      for (const d of candidate.documents)
        next = applyHypothesisCommand(next, "new-country", { type: "createDocument", ...d },
          "Draft only; manual acceptance and activation remain separate");
      return applyHypothesisCommand(next, "new-country", { type: "saveDocument", id: journal.id,
        title: journal.title, text: journalText, url: journal.url, elementIds: journal.elementIds },
        "Document-only proposal; no runtime change");
    }, true);
    const after = readHypothesis(result, "new-country");
    assert.equal(JSON.stringify(after.operatingModel), opBefore, "Operating model must be unchanged");
    for (const [id, text] of activeDocsBefore)
      if (id !== journal.id) assert.equal(after.documents.find(d => d.id === id)!.text, text);
    const afterJournal = JSON.parse(after.documents.find(d => d.id === journal.id)!.text);
    for (const c of JSON.parse(journal.text).cases)
      assert.deepEqual(afterJournal.cases.find((v: any) => v.caseId === c.caseId), c);
    const reader = new ProductCrewService({ read: async () => after, update: async () => { throw Error("read only"); } });
    for (const d of candidate.documents)
      assert.equal((await reader.call(row.owner_key, "get_document", { documentId: d.id })).text, d.text);
    await writeFile(`${dir}/REGISTERED.json`, JSON.stringify({
      sourceRevision: before.revision, revision: after.revision, readerVerified: true,
      operatingModelUnchanged: true, activePassportsUnchanged: true, oldCasesPreserved: true,
      caseId: candidate.caseId, runtimeActivation: false,
      documents: candidate.documents.map((d: any) => ({ id: d.id, characters: d.text.length })),
    }, null, 2));
    console.log(JSON.stringify({ revision: after.revision, readerVerified: true, runtimeActivation: false }));
  }
} finally { await pool.end(); }
