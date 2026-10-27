// Record the single owner-approved self-mail and subsequent owner confirmation.
// No Gmail writes, production DB writes or agent/phone launches.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { unpackModel } from "../server/projectModel/history";
import { readHypothesis, applyHypothesisCommand } from "../server/projectModel/hypotheses";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { labPacketId } from "../server/projectModel/research/labRole";
import { pilotId } from "../server/projectModel/research/labPilotApproval";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev only");
  const receipt = JSON.parse(await readFile("/tmp/hint-lab-private/self-mail-receipt.json", "utf8"));
  const tests = JSON.parse(await readFile("generated-artifacts/call-lab-verification/mail-verified.json", "utf8"));
  assert.ok(receipt.confirmedInSent && receipt.inboxVerified && receipt.ownerReadingConfirmed && receipt.providerLookupVerified);
  assert.equal(tests.success, true);
  const q = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(q.rowCount, 1);
  const before = await unpackModel(pool, q.rows[0].owner_key, q.rows[0].state);
  const snapshot = readHypothesis(before, "new-country");
  const current = snapshot.operatingModel!.revisions.at(-1)!;
  const data = structuredClone(current.data);
  const runtimeDoc = snapshot.documents.find(d => d.id === pilotId)!;
  const packetDoc = snapshot.documents.find(d => d.id === labPacketId)!;
  const runtime = JSON.parse(runtimeDoc.text), packet = JSON.parse(packetDoc.text);
  assert.equal(packet.version, 2);
  const version = runtime.version + 1;
  const description = "Gmail OAuth через Replit connectors SDK: один разрешённый synthetic self-mail отправлен; SENT, INBOX и получение владельцем подтверждены. Известный provider ID проверяется metadata-запросом с контролем получателя; исходный RFC Message-ID на проверенном пути заменён. Адрес/OAuth не публикуются и не выдаются агентам. Production-контур после публикации ещё не проверен.";
  const mailResource = packet.resources.find((r: any) => r.id === "lab-resource-mail")!;
  const node = data.nodes.find(n => n.id === mailResource.id)!;
  for (const key of Object.keys(node)) if ((node as any)[key] === mailResource.description) (node as any)[key] = description;
  node.questions = "После публикации проверить production binding, завершённый Hint владельца и письмо; автономный запуск ещё не подтверждён";
  const action = data.nodes.find(n => n.code === "LAB.MAIL.SEND")!;
  const procedure = "Проверить закреплённый Gmail владельца и разрешённый состав. Отправлять кодом outbox только самому себе, после проверки выключателя. Сохранить ID Gmail; подтвердить metadata этого ID, SENT и получателя. Исходный RFC Message-ID может быть заменён транспортом. Если ответ потерян, ограниченная read-only сверка; отсутствие результата НЕ разрешает повторную отправку, затем needs_review. Outbox не принимает QA и не выдаёт SENT за прочтение.";
  action.procedure = procedure;
  packet.actions.find((a: any) => a.id === action.id).procedure = procedure;
  Object.assign(mailResource, { description, proof: `${pilotId} v${version}: Gmail send/SENT/INBOX + подтверждение владельца`,
    missing: node.questions });
  runtime.version = version;
  runtime.updatedAt = new Date().toISOString();
  runtime.mail = { ...runtime.mail, sendVerified: true, inboxDeliveryVerified: true,
    ownerReceiptConfirmed: true, ownerReceiptSource: "Владелец в чате подтвердил получение и прислал начало письма",
    testLetter: "One owner-approved synthetic self-mail sent; no further messages",
    gate: "Transport test passed; automatic processing remains off until owner publication",
    reconciliation: "Known Gmail ID → metadata/SENT/self-recipient; lost provider response → no blind retry",
    observedRfcMessageIdRewrite: true, providerIdLookupVerified: true };
  runtime.tests = { ...runtime.tests, baselineFullSuitePassed: runtime.tests.vitestPassed,
    latestMailSubsetPassed: tests.numPassedTests, latestMailSubsetFailed: tests.numFailedTests,
    buildPrepare: "Passed after provider-ID fix; no app boot/publication" };
  runtime.publication = { nextPublishPrepared: true, deploymentType: "vm",
    activation: "Next publish run sets LAB_ENABLED=true and production target; Dev stays off",
    currentProductionChanged: false, productionControlTableExistsBeforePublish: false,
    schemaDiffVerified: { structuralLoss: false, incompatible: false,
      additions: ["call_lab_controls", "call_lab_jobs", "call_lab_outbox", "talkhint_project_model_history"],
      note: "Read-only diff; no production migration executed" } };
  runtime.blockers = ["Owner publication, then real owner Hint call and end-to-end report proof",
    "If confirmed call end/transcript or Gmail binding is missing, pause/report a real blocker; never fabricate success"];
  runtime.deployReady = true; // Ready for owner publication/pilot, NOT production verified.
  packet.runtimeReadiness = { ...packet.runtimeReadiness, status: "Dev проверен; один self-mail получен; ждёт публикации владельцем",
    gmailSendVerified: true, gmailInboxVerified: true, ownerReceiptConfirmed: true,
    nextPublishPrepared: true, productionEndToEndVerified: false };
  const transform = (root: typeof before) => {
    assert.equal(readHypothesis(root, "new-country").revision, snapshot.revision, "Concurrent update");
    let next = applyHypothesisCommand(root, "new-country", { type: "saveOperatingModel", baseVersion: current.version, data },
      "Replit: Gmail подтверждён self-mail и владельцем; уточнена сверка без повторной отправки");
    next = applyHypothesisCommand(next, "new-country", { type: "saveDocument", id: runtimeDoc.id,
      title: "P.LAB — Gmail проверен; Hint-пилот подготовлен к публикации владельцем",
      text: JSON.stringify(runtime), url: runtimeDoc.url, elementIds: runtimeDoc.elementIds },
    "Replit: фактическая проверка одного письма; production ещё не запущен");
    packet.metadata.sourceRevision = readHypothesis(next, "new-country").revision + 1;
    next = applyHypothesisCommand(next, "new-country", { type: "saveDocument", id: packetDoc.id,
      title: packetDoc.title, text: JSON.stringify(packet), url: packetDoc.url, elementIds: packetDoc.elementIds },
    "Replit: актуальные доказательства почтового ресурса; версия роли v2 сохранена");
    assert.deepEqual(readHypothesis(next, "new-country").operatingModel!.revisions.at(-1)!.data.nodes.map(n => n.id),
      current.data.nodes.map(n => n.id), "Preserve IDs");
    return next;
  };
  const after = await persistModelUpdate(pool, q.rows[0].owner_key, transform, true);
  console.log(JSON.stringify({ revision: readHypothesis(after, "new-country").revision,
    runtimeDocumentId: pilotId, runtimeVersion: version, mailSentCount: 1, ownerReceiptConfirmed: true,
    productionPublished: false, productionEndToEndVerified: false, nextPublishPrepared: true }));
} finally { await pool.end(); }
