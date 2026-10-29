/** Review metadata and a pending append to the EXISTING journal. No model writes. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { textHash } from "../../server/companyData/valueTree";
import { reviewedAccountBinding } from "../../server/companyData/v3/importApproval";
const out = "generated-artifacts/data-platform-publish2";
assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev only");
const pool = new Pool({connectionString: process.env.DATABASE_URL, max: 1});
try {
  const proof = JSON.parse(await readFile(`${out}/SOURCE_PROOF.json`, "utf8"));
  const docId = "DOC-TALKHINT-IMPROVEMENT-JOURNAL";
  const r = await pool.query(`SELECT * FROM company_document_versions WHERE workspace_id=$1
    AND hypothesis_id='new-country' AND document_id=$2 AND revision=$3`,
  [reviewedAccountBinding.sourceBWorkspace, docId, proof.revision]);
  assert.equal(r.rowCount, 1);
  const d = r.rows[0], body = JSON.parse(d.text_body);
  assert.equal(textHash(d.text_body), proof.documents.find((x: any) => x.hypothesis === "new-country" && x.id === docId).sha256);
  const marker = "owner-accept-unused-B-FK-2026-10-28";
  const entry = {
    at: "2026-10-28", marker, role: "HEAD.07 / P.OPS", source: "владелец; сообщение после сверки Claude",
    decision: "11 отличий deferred-FK неиспользуемых таблиц B принять как есть. B не используется. Production DDL не трогать.",
    accountBinding: "Подтверждена только модель new-country; не разрешение импорта или активации original.",
    importAuthorized: false, activationAuthorized: false, selfAcceptance: false,
  };
  assert(Array.isArray(body.cases) && Array.isArray(body.history));
  const caseId = "DATA-PLATFORM-MIGRATION";
  let c = body.cases.find((x: any) => x.caseId === caseId);
  if (!c) {c = {caseId, label: "Переезд платформы данных", history: [], accepted: false}; body.cases.push(c);}
  if (!c.history.some((x: any) => x.marker === marker)) c.history.push(entry);
  if (!body.history.some((x: any) => x.marker === marker)) body.history.push(entry);
  body.version = Number(body.version) + 1;
  const links = await pool.query(`SELECT element_id FROM company_document_links WHERE workspace_id=$1
    AND hypothesis_id='new-country' AND document_id=$2 AND revision=$3 ORDER BY ordinal`,
  [reviewedAccountBinding.sourceBWorkspace, docId, proof.revision]);
  await writeFile(`${out}/JOURNAL_APPEND.json`, JSON.stringify({
    status: "PREPARED_NOT_APPLIED", targetDocumentId: docId, caseId,
    expectedBaseRevision: proof.revision, expectedDocumentSha256: textHash(d.text_body),
    idempotencyMarker: marker, entry,
    command: {type: "saveDocument", id: docId, title: d.title, url: d.url,
      elementIds: links.rows.map(x => x.element_id), text: JSON.stringify(body)},
    applyWhen: "After reviewed import, before separate cutover, into the same journal; re-read target CAS/sha, refuse silent overwrite.",
    reasonNotAppliedNow: "Preserve frozen accepted B snapshot and its 242 archive records; not a second journal.",
  }, null, 2));
  await writeFile(`${out}/ACCOUNT_BINDING_CONFIRMED.json`, JSON.stringify({
    ...reviewedAccountBinding, source: "owner confirmation after Claude review",
    importApproved: false, activationApproved: false, originalActivationApproved: false,
  }, null, 2));
  const measured = JSON.parse(await readFile(`${out}/WRITER_FIXED_PROBE.json`, "utf8"));
  assert.equal(measured.passed, true);
  const kinds = ["valid-json-document", "malformed-document-like-previous-probe", "role"];
  const range = (key: string, rows: any[]) => [Math.min(...rows.map(r => r[key])), Math.max(...rows.map(r => r[key]))]
    .map(n => (n / 1000).toFixed(3)).join("–");
  let md = "# Контроль writer на зафиксированной копии\n\n";
  md += "Все повторы начинаются с одной зафиксированной головы 932. "
    + "Физическая копия сохранена; пробные изменения откатились. "
    + "Это не source переноса — source остаётся настоящим shadow B 912.\n\n";
  md += "| Операция | Повторов | Writer, с | Полный ответ, с | Прочитано записей* |\n|---|---:|---:|---:|---:|\n";
  for (const kind of kinds) {
    const rows = measured.results.filter((r: any) => r.kind === kind);
    md += `| ${kind} | ${rows.length} | ${range("writerMs", rows)} | ${range("totalMs", rows)} | ${rows[0].sqlReads} |\n`;
  }
  md += "\n*Это logical-record reads счётчика store, НЕ количество SQL-запросов. "
    + "Реальные вызовы SQL и время по группам, CPU, flush, время ответа и полный SHA-readback — в JSON.\n\n"
    + "B2: документ 0,283–0,328 с; первая роль 4,068 с. Предыдущий после-Publish probe: "
    + "документ 1,671 с, роль 7,504 с. На нынешнем контроле такие времена не воспроизвелись.\n\n"
    + "**Причина прежнего пика не установлена фактами.** Старые прогоны выполнялись на разных "
    + "головах/при разных операциях, без CPU/SQL-профиля для прямой сверки. Гипотеза, что "
    + "замедление вызвала невалидность JSON, отдельным контролем НЕ подтвердилась. "
    + "Нельзя записывать её как причину. Аналогично, нагрузку/кэш нельзя объявлять "
    + "причиной без старых показателей. Сейчас документ близок к B2, роль 4,29–4,69 с; "
    + "это два повтора, не доказательство постоянной задержки и не приёмка производительности.\n\n"
    + "Полного чтения после commit нет. Ответ собирается из точного кэша до записи и "
    + "подтверждённой дельты. Холодное чтение ДО записи и HTTP-сериализация в эти тёплые "
    + "замеры не входят. Переход на живой источник остаётся отдельным решением.\n";
  await writeFile(`${out}/WRITER_COMPARISON.md`, md);
  console.log("Metadata prepared, journal append NOT applied; source B unchanged.");
} finally {await pool.end();}
