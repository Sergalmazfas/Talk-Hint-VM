// Explicit Dev-only, one-time documentation import. Never imported by app boot.
// Dry run: npx tsx scripts/document-hint-chapter.ts
// Save:    npx tsx scripts/document-hint-chapter.ts --save
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Pool } from "pg";
import { prepareHintChapter } from "../server/projectModel/research/hintChapter";
import { readHypothesis } from "../server/projectModel/hypotheses";
import { unpackModel } from "../server/projectModel/history";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { hintChapterDocumentId, getPassportChapterPacket } from "../shared/passportChapter";
import { productBookDocumentId, readProductBook } from "../shared/productBook";
import { ProductCrewService } from "../server/productCrew/service";

const save = process.argv.includes("--save");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  assert.ok(["helium", "lithium"].includes(new URL(process.env.DATABASE_URL!).hostname), "Dev database only");
  const rows = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(rows.rowCount, 1, "Unambiguous existing owner required");
  const owner = rows.rows[0].owner_key;
  const root = await unpackModel(pool, owner, rows.rows[0].state);
  const selected = readHypothesis(root, "new-country");
  const historical = await pool.query(`SELECT id,run_type,status,corpus_hash,config,prompt_version,scorecard,started_at,finished_at
    FROM benchmark_runs ORDER BY started_at DESC LIMIT 201`);
  assert.ok(historical.rows.length <= 200, "History too large; explicit review required, do not silently truncate");
  const protocol = JSON.parse(execFileSync("unzip", ["-p",
    "attached_assets/0_P-BENCH_trial_protocol_rev744_1793036943949.zip",
    "P-BENCH_trial_protocol_rev744.json"], { maxBuffer: 4_000_000 }).toString());
  const now = new Date().toISOString();
  const make = (before: typeof root) => {
    const s = readHypothesis(before, "new-country");
    assert.equal(s.revision, selected.revision, "Concurrent model edit; re-read before saving");
    const next = prepareHintChapter(before, historical.rows, protocol, now);
    const after = readHypothesis(next, "new-country");
    assert.deepEqual(after.elements, s.elements);
    assert.deepEqual(after.relations, s.relations);
    assert.deepEqual(after.operatingModel, s.operatingModel, "Do not change roles/actions");
    for (const d of s.documents) {
      if (![productBookDocumentId, "DOC-d4cd67c1-c2ec-4cc1-9dd7-3a4de41ec57d"].includes(d.id))
        assert.deepEqual(after.documents.find(x => x.id === d.id), d, `Unexpected document change ${d.id}`);
    }
    assert.deepEqual(readProductBook(after.documents.find(d => d.id === productBookDocumentId))!.features,
      readProductBook(s.documents.find(d => d.id === productBookDocumentId))!.features, "Preserve all features including Copilot");
    assert.deepEqual(next.alternatives?.filter(h => h.id !== "new-country"), before.alternatives?.filter(h => h.id !== "new-country"));
    assert.equal(after.documents.filter(d => d.id === hintChapterDocumentId).length, 1);
    return next;
  };
  const prepared = make(root);
  const persisted = save ? await persistModelUpdate(pool, owner, make, true) : prepared;
  const state = readHypothesis(persisted, "new-country");
  const packet = getPassportChapterPacket(state, "hint")!;
  assert.ok(packet);
  assert.deepEqual(packet.context.missingRoleIds, []);
  assert.deepEqual(packet.context.missingActionIds, []);
  const service = new ProductCrewService({
    read: async () => state,
    update: async () => { throw Error("Readback must not write"); },
    updateMany: async () => { throw Error("Readback must not write"); },
  });
  const mcp = await service.call(owner, "get_product_chapter", { mode: "hint" }) as any;
  assert.deepEqual(mcp, packet, "UI and MCP must resolve the same chapter");
  const canonical = await service.call(owner, "get_document", { documentId: hintChapterDocumentId }) as any;
  assert.deepEqual(JSON.parse(canonical.text), packet.chapter);
  const dir = save ? "generated-artifacts/hint-chapter" : "/tmp/hint-chapter-dry-run";
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/TalkHint-Hint-chapter-v1.json`, JSON.stringify(packet, null, 2));
  await writeFile(`${dir}/README.txt`, `TalkHint · Hint v1 · На согласовании\nКнига v${packet.bookVersion}; rev${packet.revision}.\nDev: /admin/project-model?hypothesis=new-country&view=book&chapter=hint\nMCP: get_product_chapter {"mode":"hint"}\nДокумент: ${hintChapterDocumentId}; get_document {"documentId":"${hintChapterDocumentId}"}\nJSON и интерфейс читают одну каноническую главу, а файл — датированный снимок. Отметки приёмки не заполнены вместо владельца. Прогоны не запускались.\n`);
  console.log(JSON.stringify({ saved: save, revision: packet.revision, bookVersion: packet.bookVersion,
    chapterId: packet.document.id, chapterVersion: packet.chapter.version, historicalRuns: packet.chapter.runs.length,
    documentLength: canonical.text.length, exportPath: `${dir}/TalkHint-Hint-chapter-v1.json`, readback: "same canonical JSON via UI/MCP/get_document" }));
} finally { await pool.end(); }
