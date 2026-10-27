/** Description-only update of the existing Dev crew. No media, model, mail or call execution. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { unpackModel } from "../server/projectModel/history";
import { readHypothesis, applyHypothesisCommand } from "../server/projectModel/hypotheses";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { mediaProtocolId, mediaRoles, prepareLabMediaRoles } from "../server/projectModel/research/labMediaRoles";
import { productBookText, readProductBook } from "../shared/productBook";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev-only operation");
  const q = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(q.rowCount, 1, "Owner/model must be unambiguous");
  const root = await unpackModel(pool, q.rows[0].owner_key, q.rows[0].state);
  const state = readHypothesis(root, "new-country");
  const documentIds = [...mediaRoles.map(r => r.documentId), mediaProtocolId];
  assert.equal(documentIds.filter(id => state.documents.some(d => d.id === id)).length, 0,
    "Extension already exists: read it, do not import/recreate or repeat history");
  const current = state.operatingModel!.revisions.at(-1)!;
  const at = new Date().toISOString();
  const extension = prepareLabMediaRoles(current.data, at);
  const bookDoc = state.documents.find(d => d.id === "DOC-TALKHINT-PRODUCT-PASSPORT")!;
  const book = readProductBook(bookDoc)!;
  assert.ok(book, "Actual book reader must parse the existing book");
  const nextBook = structuredClone(book);
  nextBook.version += 1;
  nextBook.updatedAt = at;
  nextBook.current += `\n27.10.2026: P.LAB.VIDEO и P.LAB.AUDIO описаны; ${mediaProtocolId}. Файлы, инструменты и QA-проход не выданы/не выполнены.`;
  nextBook.responsibilities += "\nP.LAB → P.LAB.VIDEO / P.LAB.AUDIO; независимая P.LG.QA → P.LAB → общий отчёт. Gemini — кандидат, не подключён.";
  const audioDoc = state.documents.find(d => d.id === "DOC-TALKHINT-AUDIO-PASSPORT")!;
  const roadmapDoc = state.documents.find(d => d.id === "DOC-d4cd67c1-c2ec-4cc1-9dd7-3a4de41ec57d")!;
  const nextRevision = state.revision + 7; // operating + three packages + existing book/audio/roadmap
  for (const d of extension.documents) Object.assign(d.packet, {
    sourceModelRevision: state.revision, savedModelRevision: nextRevision, operatingVersion: current.version + 1,
  });
  const protocol = { ...extension.protocol, sourceModelRevision: state.revision,
    savedModelRevision: nextRevision, operatingVersion: current.version + 1,
    roleDocumentIds: mediaRoles.map(r => r.documentId),
    receivingActions: extension.data.nodes.filter(n => ["lab-action-qa", "lab-av-accept-reviewed",
      "lab-av-accept-period", "lab-action-supply", "lab-action-period"].includes(n.id)),
    links: extension.data.links.filter(l => l.id.startsWith("lab-av:")) };
  const newBookText = productBookText(nextBook);
  assert.equal(readProductBook({ ...bookDoc, text: newBookText })?.version, nextBook.version);
  const docUrl = (id: string) => {
    assert.match(process.env.REPLIT_DEV_DOMAIN ?? "", /^[a-z0-9.-]+$/i);
    return `https://${process.env.REPLIT_DEV_DOMAIN}/api/admin/product-crew/documents/${id}/download?format=json`;
  };
  const result = await persistModelUpdate(pool, q.rows[0].owner_key, r => {
    assert.equal(readHypothesis(r, "new-country").revision, state.revision, "Concurrent change; reread first");
    let n = r;
    const save = (id: string, title: string, text: string, url: string) => {
      assert.ok(text.length <= 50000, `Document size: ${id} (${text.length})`);
      const exists = readHypothesis(n, "new-country").documents.some(d => d.id === id);
      n = applyHypothesisCommand(n, "new-country", { type: exists ? "saveDocument" : "createDocument",
        id, title, text, url, elementIds: ["TH-PRODUCT"] },
      "Обязанности и ресурсы описаны; формы на сверке, исполнители не подключены, фактическая приёмка отсутствует.");
    };
    for (const d of extension.documents) save(d.id, d.title, JSON.stringify(d.packet), docUrl(d.id));
    save(mediaProtocolId, "P.LAB — видео/звук: общий протокол, ресурсы и формы v1 — на сверке",
      JSON.stringify(protocol), docUrl(mediaProtocolId));
    // The real domain validator resolves referenceIds against documents already
    // present in this transaction. Register packages before the crew references.
    n = applyHypothesisCommand(n, "new-country", {
      type: "saveOperatingModel", baseVersion: current.version, data: extension.data,
    }, "Владелец: описать два направления видео/звук в crew. Никакого подключения/исполнения/приёмки.");
    save(bookDoc.id, `TalkHint — живая книга продукта — v${nextBook.version} — обязанности видео/звука — на согласовании`,
      newBookText, bookDoc.url);
    save(audioDoc.id, "TalkHint — паспорт работы со звуком — v2 — обязанности медиаанализа связаны — на согласовании",
      audioDoc.text.replace("Версия 1;", "Версия 2;") +
      `\n\n## 27.10.2026 — обязанности crew для звука и видео\nP.LAB.AUDIO: дорожки/стороны, reference, STT, задержки, перевод по реальным источникам. P.LAB.VIDEO: кадры, видимый Hint и сопоставление событий. Пакеты: ${mediaRoles.map(r => r.documentId).join(", ")}; формы/оснащение: ${mediaProtocolId}. Описано, не реализовано и не принято; автоматическая запись/анализ не включены. Принятый P.LAB v2 сохранён без замены.\n`, audioDoc.url);
    save(roadmapDoc.id, "TalkHint — единый roadmap — v24 — обязанности видео/звука",
      roadmapDoc.text + `\n\n## 27.10.2026 — LAB.MEDIA.EXTENSION, описание без запуска\nДве функции под P.LAB, 16 специализированных действий и 2 парных принимающих действия P.LAB. Рабочие JSON: ${documentIds.join(", ")}. Сейчас: описание/формы. Следующий вход: разрешённый manifest+медиа, ответ техники по инструментам и Gemini, выдача ресурсов. Далее — ручной JSON-проход и независимая QA. Запись, API, бюджеты, сроки, расписания и публикация не включались и не считаются согласованными.\n`, roadmapDoc.url);
    return n;
  }, true);
  const saved = readHypothesis(result, "new-country");
  assert.equal(saved.revision, nextRevision);
  assert.equal(saved.operatingModel!.revisions.at(-1)!.version, current.version + 1);
  for (const n of current.data.nodes) assert.ok(saved.operatingModel!.revisions.at(-1)!.data.nodes.some(x => x.id === n.id));
  for (const id of ["DOC-PLAB-WORK-PACKAGE", "DOC-TALKHINT-CHAPTER-HINT"])
    assert.equal(saved.documents.find(d => d.id === id)!.text, state.documents.find(d => d.id === id)!.text);
  assert.equal(readProductBook(saved.documents.find(d => d.id === bookDoc.id))?.version, nextBook.version);
  const dir = "generated-artifacts/lab-media-roles";
  await mkdir(dir, { recursive: true });
  for (const id of documentIds) {
    const d = saved.documents.find(d => d.id === id)!;
    const packet = JSON.parse(d.text);
    assert.equal(packet.savedModelRevision, saved.revision);
    await writeFile(`${dir}/${id}.json`, JSON.stringify(packet, null, 2));
  }
  const manifest = { revision: saved.revision, operatingVersion: current.version + 1, bookVersion: nextBook.version,
    roles: mediaRoles, documents: documentIds.map(id => ({ id, version: 1, url: docUrl(id) })),
    actionsAdded: 18, resourcesAdded: 4, execution: protocol.execution,
    existingCoreLabV2Unchanged: true, existingHintChapterUnchanged: true };
  await writeFile(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest));
} finally { await pool.end(); }
