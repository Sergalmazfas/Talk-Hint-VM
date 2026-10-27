// Approved Dev-only documentation update; no model, email, phone or publish calls.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { unpackModel } from "../server/projectModel/history";
import { readHypothesis, applyHypothesisCommand } from "../server/projectModel/hypotheses";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { labFormId, labPacketId } from "../server/projectModel/research/labRole";
import { pilotId } from "../server/projectModel/research/labPilotApproval";
import { renderProcessLetter } from "../server/callLab/processReport";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev only");
  const q = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(q.rowCount, 1);
  const before = await unpackModel(pool, q.rows[0].owner_key, q.rows[0].state);
  const s = readHypothesis(before, "new-country");
  const formDoc = s.documents.find(d => d.id === labFormId)!;
  const packetDoc = s.documents.find(d => d.id === labPacketId)!;
  const runtimeDoc = s.documents.find(d => d.id === pilotId)!;
  const form = JSON.parse(formDoc.text), packet = JSON.parse(packetDoc.text), runtime = JSON.parse(runtimeDoc.text);
  const marker = "approved-used-over-needed-v1";
  if (form.processPlanFact.overall.id !== marker) {
    form.status = "Принцип и формула согласованы владельцем; измерения и iOS-приёмка не завершены";
    form.processPlanFact.overall = {
      id: marker, status: "Согласовано владельцем в чате",
      formula: "использованные подсказки / моменты, где подсказка была нужна по рубрике × 100%",
      value: null, numerator: null, denominator: null,
      rule: "До проверенной оценки моментов нужности и использования — ?. Цель разговора отдельно. Нет данных не 0. Для воронки один учтённый факт использования на момент нужности, не сумма дублей.",
      evidence: "Версия рубрики, перечень оценённых моментов/подсказок, подтверждение независимой проверки; текущий runtime такого полного входа не имеет",
    };
    form.processPlanFact.runtimeApplied = true;
    form.processPlanFact.runtimeNote = "Dev почтовый код переключён на v3. Production требует публикации владельцем; новых писем в этой задаче не отправлялось.";
    form.processPlanFact.telemetryStatus = "Подготовлен diff iOS и owner-scoped приём отметок; Xcode/TestFlight не выполнялись. Экран звонка игнорирует prepareOpening — показ первой фразы не подтверждается и поведение не менялось. Время ответа владельца не сопоставлено с часами iPhone.";
    form.rules = form.rules.filter((r: string) => !r.includes("Общий процент") && !r.includes("общий процент"));
    form.rules.push(form.processPlanFact.overall.rule);
    packet.form.status = form.status;
    packet.form.runtimeApplied = true;
    packet.form.rules = packet.form.rules.filter((r: string) => !r.includes("Общий процент"));
    packet.form.rules.push("Общий % = использованные подсказки / нужные моменты ×100; без проверенной рубрики — ?. Цель отдельно.");
    runtime.version += 1;
    runtime.updatedAt = new Date().toISOString();
    runtime.reportingV3 = {
      formulaApproved: true, formVersion: 3, devRendererChanged: true,
      productionVerified: false, sentNewEmail: false,
      ios: { codePrepared: true, xcodeBuilt: false, testFlightPublished: false,
        actualDeviceVerified: false, openingVisible: "blocked: existing call UI ignores prepareOpening" },
      gaps: ["Проверенная разметка нужности/использования", "Показ первой фразы на экране звонка — отдельное продуктовое решение",
        "Проверка iOS и сопоставление времён до ответа", "Публикация владельцем и реальный звонок"],
    };
    const current = s.operatingModel!.revisions.at(-1)!;
    const data = structuredClone(current.data);
    for (const code of ["LAB.MAIL.PREPARE", "LAB.REPORT", "LAB.REPORT.RECEIVE"]) {
      const node = data.nodes.find(n => n.code === code)!;
      node.procedure = node.procedure.replace("общий % не согласован. Только описание, не runtime.",
        "Общий % = использованные/нужные по проверенной рубрике; без неё ?. Форма v3 в Dev; production не проверен.");
      packet.actions.find((a: any) => a.id === node.id).procedure = node.procedure;
    }
    assert.ok(JSON.stringify(packet).length <= 50000, "Packet document limit");
    const next = await persistModelUpdate(pool, q.rows[0].owner_key, root => {
      assert.equal(readHypothesis(root, "new-country").revision, s.revision, "Concurrent update");
      let n = applyHypothesisCommand(root, "new-country", { type: "saveOperatingModel", baseVersion: current.version, data },
        "Владелец согласовал used/needed; цель отдельно, неизвестное не 0");
      for (const [doc, text] of [[formDoc, form], [runtimeDoc, runtime]] as const) {
        n = applyHypothesisCommand(n, "new-country", { type: "saveDocument", id: doc.id, title: doc.title,
          text: JSON.stringify(text), url: doc.url, elementIds: doc.elementIds }, "Форма v3, Dev-код и открытые проверки iOS; без публикации и отправки");
      }
      packet.metadata.sourceRevision = readHypothesis(n, "new-country").revision + 1;
      return applyHypothesisCommand(n, "new-country", { type: "saveDocument", id: packetDoc.id,
        title: packetDoc.title, text: JSON.stringify(packet), url: packetDoc.url, elementIds: packetDoc.elementIds },
      "Согласованная формула и актуальная форма; идентичность роли сохранена");
    }, true);
    console.log(JSON.stringify({ revision: readHypothesis(next, "new-country").revision,
      formVersion: 3, runtimeVersion: runtime.version, packetVersion: packet.version }));
  } else console.log(JSON.stringify({ unchanged: true, revision: s.revision }));

  const report = { synthetic: true, duration_ms: 120000, qa_status: "НЕ ПРОВЕРЕНО QA",
    analysis: { findings: [], limitations: ["Демонстрация формы, а не новый CrewAI-прогон. Нет реального звонка, device-событий и проверенной рубрики."] } };
  const letter = renderProcessLetter(report);
  const escape = (text: string) => text.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const directory = "generated-artifacts/hint-letter-v3";
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/Hint_письмо_v3.txt`, `${letter.subject}\n\n${letter.body}`);
  await writeFile(`${directory}/Hint_письмо_v3.html`, `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hint · письмо v3 · пример</title><style>body{margin:0;background:#f4f7f7;color:#182b2b;font:16px/1.6 system-ui}main{max-width:760px;margin:auto;padding:24px}h1{font-size:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;background:white;padding:20px;border-radius:12px;border:1px solid #d4dddd}</style><main><h1>${escape(letter.subject)}</h1><pre>${escape(letter.body)}</pre></main></html>`);
  await writeFile(`${directory}/synthetic_report.json`, JSON.stringify(report, null, 2));
} finally { await pool.end(); }
