// Existing documents only. No role/catalogue rebuild, activation, model or Gmail writes.
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
  const verification = JSON.parse(await readFile("generated-artifacts/call-lab-verification/vitest.json", "utf8"));
  assert.equal(verification.success, true);
  const synthetic = JSON.parse(await readFile("generated-artifacts/plab-synthetic/report.json", "utf8"));
  const q = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(q.rowCount, 1);
  const before = await unpackModel(pool, q.rows[0].owner_key, q.rows[0].state);
  const snapshot = readHypothesis(before, "new-country");
  const previous = snapshot.documents.find(d => d.id === pilotId)!;
  const packetDoc = snapshot.documents.find(d => d.id === labPacketId)!;
  assert.ok(previous && packetDoc);
  const packet = JSON.parse(packetDoc.text);
  assert.equal(packet.version, 2); assert.equal(packet.gate.installationAllowed, true);
  const now = new Date().toISOString();
  const facts = {
    ...JSON.parse(previous.text), version: 2, updatedAt: now,
    tests: { typescriptPassed: true, vitestPassed: verification.numPassedTests,
      vitestFailed: verification.numFailedTests, pythonFlowPassed: 6,
      postgresSynthetic: "8 cases, session-local TEMP tables, no fake product calls",
      buildPrepare: "Passed without app boot/publication; Python import/pin gate included",
      providerSynthetic: { stages: synthetic.metrics.usage.map((s: any) => s.stage), qa: synthetic.qa_status } },
    mail: { provider: "Gmail OAuth via Replit connectors SDK",
      connected: true, expectedOwnerMailboxVerified: true, applicationSdkReadVerified: true,
      selfSendOnly: true, recipientInPublicModel: false,
      sendVerified: false, inboxDeliveryVerified: false, testLetter: "Prepared, not sent",
      gate: "Await one explicit owner confirmation for the synthetic self-mail. No Gmail writes in this stage." },
    execution: { workerCodeInstalled: true, queuePrepared: true, outboxPrepared: true,
      automaticProcessingEnabled: false, targetEnvironment: "production after owner publication",
      ownerBinding: "Pinned Gmail connection; resolve/verify existing admin independently in each environment",
      source: "Positive owner/Hint provenance + confirmed call end + existing saved text/telemetry",
      oldCallsBackfilled: false, realCallsPlaced: false, newAudioRecorded: false,
      privateStorage: "Same application DB, environment/owner partition; not a role catalogue",
      dedup: "Deterministic per environment/owner/call/report-version; persisted unique key",
      recovery: "One retry after crashed analysis; lost Gmail response is lookup-only by Message-ID",
      killSwitch: "LAB_ENABLED plus persisted owner control; abort child; recheck before Gmail POST",
      api: ["/api/admin/call-lab/status", "/api/admin/call-lab/reports/:key", "/api/admin/call-lab/disable"],
      reporting: "Per-call results/journal available; automatic daily/weekly/monthly T07 aggregation is not enabled",
      continuousAgentsRunning: false, assignedRoleDoesNotMeanRunningAgent: true,
      runtime: "P.LAB + independent P.LG.QA in child process; outbox is code, not QA acceptor" },
    retention: { rawLabCopyDays: 7, annotationsDays: 90,
      scope: "Lab copies/scratch only; existing calls and Gmail history are not silently deleted" },
    blockers: ["Owner confirmation for ONE synthetic self-mail; Gmail send/SENT not verified yet",
      "Owner publication and a real owner Hint call are still required for production end-to-end proof",
      "Missing confirmed call-end or transcript is a visible data blocker, not a fabricated successful analysis"],
    deployReady: false, workerStarted: false, productionPublished: false,
    source: "Manual Dev implementation/testing by Replit; no autonomous role launch claimed",
  };
  const transform = (root: typeof before) => {
    assert.equal(readHypothesis(root, "new-country").revision, snapshot.revision, "Concurrent update");
    const operating = snapshot.operatingModel!.revisions.at(-1)!;
    const data = structuredClone(operating.data);
    const mailAction = data.nodes.find(n => n.code === "LAB.MAIL.SEND")!;
    const packetAction = packet.actions.find((a: any) => a.id === mailAction.id)!;
    const resource = packet.resources.find((r: any) => r.id === "lab-resource-mail")!;
    const node = data.nodes.find(n => n.id === resource.id)!;
    assert.ok(mailAction && packetAction && resource && node);
    const oldDescription = resource.description;
    const description = "Gmail OAuth через Replit connectors SDK: профиль владельца проверен кодом приложения. Только отправка самому себе; адрес и OAuth не попадают в публичные документы или агентам. Контроль отправки/SENT ждёт подтверждённого теста; автоматический worker выключен.";
    const matches = Object.keys(node).filter(k => (node as any)[k] === oldDescription);
    assert.ok(matches.length > 0 && matches.length <= 2, "Expected existing resource description fields");
    for (const key of matches) (node as any)[key] = description;
    node.questions = "Не подтверждены Gmail POST/SENT и реальный Hint → письмо; connection/read не считать готовой доставкой";
    node.referenceIds = [...new Set([...node.referenceIds, pilotId])];
    const procedure = "Проверить владельца/разрешённый состав и его закреплённый Gmail OAuth. Отправлять только серверным кодом outbox самому себе, не агентом. Перед Gmail POST сверить выключатель. Сохранять Message-ID, provider ID и фактический статус. При неизвестном исходе только сверка точного Message-ID в SENT, без слепого повтора. OAuth/read не доказывает доставку. Outbox не принимает решения QA.";
    mailAction.procedure = procedure;
    packetAction.procedure = procedure;
    resource.description = description;
    resource.proof = `${pilotId} v2: профиль проверен SDK приложения; отправка не проверена`;
    resource.missing = node.questions;
    let next = applyHypothesisCommand(root, "new-country", { type: "saveOperatingModel",
      baseVersion: operating.version, data }, "Сергей подключил Gmail; Replit уточнил существующий почтовый ресурс, не приёмку доставки");
    next = applyHypothesisCommand(next, "new-country", { type: "saveDocument", id: previous.id,
      title: "P.LAB — CrewAI установлен; Gmail подключён; пробная отправка ждёт подтверждения",
      text: JSON.stringify(facts), url: previous.url, elementIds: previous.elementIds }, "Replit: проверенные Dev-факты, не приёмка реального звонка");
    packet.gate = { ...packet.gate, workerStarted: false, mailEnabled: false };
    packet.runtimeReadiness = { status: "Dev-синтетика проверена; ожидается подтверждение тестового письма",
      documentId: pilotId, automaticProcessingEnabled: false, sourceRoutingEnabled: false,
      gmailConnected: true, gmailSendVerified: false, productionEndToEndVerified: false };
    packet.metadata.sourceRevision = readHypothesis(next, "new-country").revision + 1;
    next = applyHypothesisCommand(next, "new-country", { type: "saveDocument", id: packetDoc.id,
      title: packetDoc.title, text: JSON.stringify(packet), url: packetDoc.url, elementIds: packetDoc.elementIds },
    "Replit: ссылка на актуальные доказательства runtime без изменения принятой роли");
    const after = readHypothesis(next, "new-country");
    assert.deepEqual(after.operatingModel!.revisions.slice(0, -1), snapshot.operatingModel!.revisions, "Preserve history");
    assert.deepEqual(after.operatingModel!.revisions.at(-1)!.data.nodes.map(n => n.id),
      operating.data.nodes.map(n => n.id), "No parallel role/action/resource catalogue");
    assert.equal(after.documents.find(d => d.id === "DOC-TALKHINT-CHAPTER-HINT")?.text,
      snapshot.documents.find(d => d.id === "DOC-TALKHINT-CHAPTER-HINT")?.text);
    return next;
  };
  const after = await persistModelUpdate(pool, q.rows[0].owner_key, transform, true);
  console.log(JSON.stringify({ revision: readHypothesis(after, "new-country").revision,
    runtimeDocumentId: pilotId, runtimeVersion: 2, rolesRebuilt: false,
    mailSent: false, automaticProcessingEnabled: false, testsPassed: verification.numPassedTests }));
} finally { await pool.end(); }
