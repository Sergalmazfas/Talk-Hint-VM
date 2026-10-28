import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { unpackModel, packModel, activeModelSize } from "../../server/projectModel/history";
import { readHypothesis, applyHypothesisCommand } from "../../server/projectModel/hypotheses";
import { modelSizeBudget } from "../../server/projectModel/sizeBudget";
import { ProductCrewService } from "../../server/productCrew/service";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const dir = "generated-artifacts/data-platform-stage0";
assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev only");
const db = await pool.connect();
try {
  await db.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await db.query("SET LOCAL statement_timeout='90s'");
  const found = await db.query(`SELECT revision,state,owner_key FROM talkhint_project_models
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) a
      WHERE a->>'id'='new-country')`);
  assert.equal(found.rowCount, 1);
  const row = found.rows[0];
  const source = await unpackModel(db, row.owner_key, row.state);
  const packed = packModel(source);
  const reader = { query: async (_sql: string, params: any[]) => ({
    rows: params[0] === row.owner_key ? [...packed.chunks].map(([key, payload]) => ({ key, payload })) : [],
  }) } as any;
  const restored = await unpackModel(reader, row.owner_key, JSON.parse(JSON.stringify(packed.state)));
  assert.deepEqual(restored, source);
  const selected = readHypothesis(restored, "new-country");
  const service = new ProductCrewService({
    read: async (_owner, hypothesis) => {
      assert.equal(_owner, row.owner_key);
      assert.equal(hypothesis, "new-country");
      return selected;
    },
    update: async () => { throw Error("Read only"); },
  });
  const documents = [];
  for (const d of selected.documents) {
    const actual = await service.call(row.owner_key, "get_document", { documentId: d.id });
    assert.equal(actual.id, d.id);
    assert.equal(actual.text, d.text);
    documents.push({ id: d.id, textLength: d.text.length, sha256: actual.snapshotHash });
  }
  const start = performance.now();
  const candidate = applyHypothesisCommand(source, "new-country", { type: "saveDocument",
    title: "Stage 0 in-memory validation only", text: "not saved", url: "", elementIds: [] }, "HEAD.07");
  const mutationMs = performance.now() - start;
  assert.equal(readHypothesis(candidate, "new-country").documents.length, documents.length + 1);
  assert.deepEqual(source, restored);
  const data = selected.operatingModel!.revisions.at(-1)!.data;
  const counts = {
    documents: documents.length, nodes: data.nodes.length, links: data.links.length,
    operatingRevisions: selected.operatingModel!.revisions.length,
    decisions: selected.decisions.length,
  };
  const proof = {
    capturedAt: new Date().toISOString(), environment: "development", sourceRevision: row.revision,
    databaseWrites: 0, runtimeHintChanges: false, currentStateModified: false,
    completeRoundTripEqual: true, completeModelSha256: hash(source),
    nodeIdsSha256: hash(data.nodes.map(n => n.id).sort()),
    linkIdsSha256: hash(data.links.map(l => l.id).sort()), counts, documents,
    documentReader: "ProductCrewService.get_document on an immutable actual database snapshot; not authenticated browser verification",
    workingLength: activeModelSize(selected), budget: modelSizeBudget(selected),
    headroom: modelSizeBudget(selected) - activeModelSize(selected),
    envelopeLength: activeModelSize(source), envelopeBudget: modelSizeBudget(source),
    inMemoryMutationMs: Math.round(mutationMs),
    checks: ["all fields preserved by pack/unpack", "all current document IDs/text hashes preserved",
      "existing get_document service returns full saved text", "new write validates in memory without saving"],
  };
  await db.query("ROLLBACK");
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/VERIFICATION.json`, JSON.stringify(proof, null, 2));
  console.log(JSON.stringify({ ...proof, documents: `${documents.length} hashes in VERIFICATION.json` }));
} finally {
  db.release();
  await pool.end();
}
