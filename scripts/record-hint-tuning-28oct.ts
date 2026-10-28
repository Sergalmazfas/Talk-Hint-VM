/** Existing model only. No runtime activation, mail, model calls or publishing. */
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { Pool } from "pg";
import { unpackModel } from "../server/projectModel/history";
import { readHypothesis, applyHypothesisCommand } from "../server/projectModel/hypotheses";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { ProductCrewService } from "../server/productCrew/service";
const dir = "generated-artifacts/hint-tuning-28oct";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev only");
  await mkdir(dir, { recursive: true });
  const q = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(q.rowCount, 1);
  const owner = q.rows[0].owner_key;
  const before = readHypothesis(await unpackModel(pool, owner, q.rows[0].state), "new-country");
  const ids = ["DOC-TALKHINT-PRODUCT-PASSPORT", "DOC-TALKHINT-CHAPTER-HINT",
    "DOC-TALKHINT-IMPROVEMENT-JOURNAL", "DOC-PLAB-WORK-PACKAGE", "DOC-PPRODUCT-WORK-PACKAGE",
    "DOC-PLAB-CALL-LETTER", "DOC-OWNER-CALLS"];
  const docs = ids.map(id => {
    const d = before.documents.find(d => d.id === id); assert(d, id);
    return { ...d, value: id === ids[0] || id === ids[1] ? { content: d.text } : JSON.parse(d.text) };
  });
  if (!process.argv.includes("--apply") && !process.argv.includes("--verified") && !process.argv.includes("--topics")) {
    if (!process.argv.includes("--status"))
      await writeFile(`${dir}/before.json`, JSON.stringify({ revision: before.revision, docs }, null, 2));
    console.log(JSON.stringify({ revision: before.revision,
      docs: docs.map(d => ({ id: d.id, size: d.text.length, version: d.value.version })),
      cases: docs[2].value.cases.map((c: any) => ({ id: c.caseId, label: c.label, entries: c.history?.length })) }));
  } else {
    const at = new Date().toISOString();
    const topics = process.argv.includes("--topics");
    const verified = process.argv.includes("--verified") || topics;
    const marker = `hint-tuning-28oct:${topics ? "topic-index" : verified ? "verified" : "approved-dev"}`;
    const journal = docs[2].value;
    assert(!journal.history.some((h: any) => h.marker === marker), "Already recorded");
    // The root is already 49,996/50,000 chars. Preserve the reference workflow
    // verbatim in a canonical appendix; cases and all their history stay here.
    const workflowId = "DOC-TALKHINT-IMPROVEMENT-JOURNAL-WORKFLOW";
    const appendix = !verified && Array.isArray(journal.existingWorkflow) ? {
      id: workflowId, title: "Журнал улучшений — справочная схема работы",
      text: JSON.stringify({ format: "journal-workflow-appendix", parent: docs[2].id,
        sourceRevision: before.revision, existingWorkflow: journal.existingWorkflow }),
      url: "", elementIds: docs[2].elementIds, value: {} as any,
    } : null;
    if (appendix) {
      assert(!before.documents.some(d => d.id === workflowId), "Do not overwrite an existing appendix");
      journal.existingWorkflow = { documentId: workflowId, preservedVerbatim: true, sourceRevision: before.revision };
    }
    const caseIds = ["HINT-UI-VISIBILITY", "HINT-WAIT-STATE", "HINT-CURRENT-QUESTION"];
    const changes = [
      "D1: сброс прокрутки каждой новой карточки; отметка показа в том же main-turn. 23958 мс — разрыв серверных отметок, не доказанная задержка экрана.",
      "D2: checking без явного ожидания не включает wait_state; checking in / let me know — вопрос к владельцу.",
      "D3: новый явный вопрос вытесняет старый в carryover; stale-фильтр перед любым показом, включая wait ACK.",
    ];
    const tests = verified ? JSON.parse(await readFile(`${dir}/verification.json`, "utf8")) : null;
    for (let i = 0; i < caseIds.length; i++) {
      let c = journal.cases.find((c: any) => c.caseId === caseIds[i]);
      if (!c) {
        c = { caseId: caseIds[i], label: changes[i].split(":")[1], history: [],
          accepted: false, ownerEvaluationOfImplementedChange: null };
        journal.cases.push(c);
      }
      c.problemKey = ["ios_display", "trigger", "filter"][i];
      c.history.push({ at, role: "HEAD.07", marker, stage: verified ? "verified_dev" : "implemented_dev",
        source: "владелец 28.10.2026: 1 да, 2 да, 3 да",
        decisionId: `CA7a637dc0c893d613e63d74437d135f3f:D${i + 1}`, ownerDecision: "yes",
        callId: "CA7a637dc0c893d613e63d74437d135f3f", note: changes[i],
        evidence: "generated-artifacts/hint-tuning-28oct/CODE.diff",
        ...(verified ? { verification: tests } : {}),
        productionChanged: false, published: false, ownerEffect: "неизвестен до следующего звонка" });
    }
    journal.version++;
    journal.history.push({ at, marker, role: "HEAD.07 / P.PRODUCT", sourceRevision: before.revision });
    const changed = [docs[2]];
    if (!verified) {
      const rule = "Письмо v4: только воронка → где сломалось → что пробовали именно по этой проблеме → Нужно решение. Предложение: что изменить → эффект → варианты → рекомендация; если сначала проверка, назвать последующее исправление. История — отдельные попытки по теме, не весь случай; нет попыток в доступном журнале: «раньше не пробовали». Версии, инженерная сверка и event_id QA — в полном разборе. D1–D3 звонка 5:24 одобрены владельцем 28.10; Dev, без Publish и без оценки эффекта.";
      for (const d of docs.slice(3)) {
        if (Array.isArray(d.value.actions))
          for (const a of d.value.actions)
            if (["lab-action-letter", "company-action-product-decision", "lab-action-product-receive"].includes(a.id))
              a.procedure = "DOC-PLAB-CALL-LETTER v4, revision 2: конкретное улучшение/эффект/варианты/рекомендация; история именно проблемы. Подробности и QA — по ссылке, четыре блока письма. D1–D3 одобрены владельцем 28.10, Dev до Publish.";
        d.value.perCallLetterRefinement = { at, source: "владелец, чат", ref: "DOC-PLAB-CALL-LETTER", revision: 2 };
        if (["DOC-PLAB-CALL-LETTER", "DOC-OWNER-CALLS"].includes(d.id))
          d.value.perCallLetterRefinement.rule = rule;
        if (d.value.metadata) d.value.metadata.operatingVersion = before.operatingModel!.revisions.at(-1)!.version + 1;
        if (d.id === "DOC-OWNER-CALLS") d.value.labRelease = { version: "owner-calls-v6", decision: "2026-10-28", framework: "crewai@1.15.30" };
        changed.push(d);
      }
    }
    for (const d of changed) { d.text = JSON.stringify(d.value); assert(d.text.length <= 50000, `${d.id}: ${d.text.length}`); }
    if (appendix) changed.push(appendix);
    const afterRoot = await persistModelUpdate(pool, owner, root => {
      const current = readHypothesis(root, "new-country");
      assert.equal(current.revision, before.revision);
      let next = root;
      if (!verified) {
        const op = current.operatingModel!.revisions.at(-1)!;
        const data = structuredClone(op.data);
        for (const d of changed) for (const a of d.value.actions ?? [])
          if (["lab-action-letter", "company-action-product-decision", "lab-action-product-receive"].includes(a.id)) {
            const node = data.nodes.find(n => n.id === a.id); assert(node); node.procedure = a.procedure;
          }
        next = applyHypothesisCommand(next, "new-country", { type: "saveOperatingModel", baseVersion: op.version, data }, marker);
      }
      for (const d of changed) next = applyHypothesisCommand(next, "new-country",
        { type: d.id === workflowId && appendix ? "createDocument" : "saveDocument",
          id: d.id, title: d.title, text: d.text, url: d.url, elementIds: d.elementIds }, marker);
      return next;
    }, true);
    const after = readHypothesis(afterRoot, "new-country");
    const reader = new ProductCrewService({ read: async () => after, update: async () => { throw Error("read only"); } });
    for (const d of changed) assert.equal((await reader.call(owner, "get_document", { documentId: d.id })).text, d.text);
    await writeFile(`${dir}/${verified ? "verified" : "applied"}.json`, JSON.stringify({
      revision: after.revision, sourceRevision: before.revision, marker, readerVerified: true,
      documents: changed.map(({ id, title, text }) => ({ id, title, text })),
    }, null, 2));
    console.log(JSON.stringify({ revision: after.revision, readerVerified: true }));
  }
} finally { await pool.end(); }
