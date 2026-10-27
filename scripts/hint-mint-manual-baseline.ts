/** Owner-requested ONE manual historical report. Never starts CrewAI or a call. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Pool } from "pg";
import { GmailLabMail } from "../server/callLab/mail";
import { renderProcessLetter } from "../server/callLab/processReport";
import { labKey, messageIdFor, LabStore } from "../server/callLab/store";

const source = JSON.parse(await readFile("/tmp/hint-lab-private/mint-call.json", "utf8"));
const binding = JSON.parse(await readFile("/tmp/hint-lab-private/binding.json", "utf8"));
assert.equal(source.status, "completed");
assert.ok(source.transcript.includes("Mint Mobile"));
const duration = Date.parse(source.ended_at + (source.ended_at.endsWith("Z") ? "" : "Z")) -
  Date.parse(source.started_at + (source.started_at.endsWith("Z") ? "" : "Z"));
assert.ok(duration > 400_000 && duration < 403_000, "Wrong baseline call");
const latency = source.metadata.hintLatency;
assert.equal(latency.summary.hintsSent, 19, "Recheck source before sending");
const observations = {
  prepare_goal: "Цель есть в metadata и на скриншоте. Подтверждённого события принятия в Prepare нет.",
  opening_visible: "На четырёх скриншотах первой фразы нет. Нельзя утверждать, что она не появлялась за весь звонок. Телеметрии нет.",
  speech_recognized: "Транскрипт сохранён. Есть явно подозрительные фразы владельца: «Simpler blade. No signal burst». Эталона аудио нет, WER не вычисляем.",
  hint_created: "В серверном журнале 30 событий: 19 отправок, 11 подавлений. Это не 30 моментов нужности и не доля качества. События 14 и 19 — варианты ответа, 30 — повторное ожидание вместо вариантов результата.",
  hint_before_reply: "Для 19 отправок есть старые ACK. STT-final → ACK: p50 1810 мс, p95 2735 мс; ready → ACK p50 125 мс. Это НЕ от физического конца речи и НЕ доказательство читаемости или показа до ответа.",
  translation_visible: "Русский текст виден на предоставленных скриншотах. В двух карточках вариантов строки обрезаны/наложены. Покрытие всех переводов и время показа неизвестны.",
  hint_used: "Старая эвристика speech-match: 1 полное и 5 частичных совпадений из 19 отправок; её 32% НЕ являются согласованным общим процентом. Рубрика нужности/фактического использования не проверена.",
  goal_achieved: "В конце собеседник ждёт завершения активации и проверки данных. В сохранённом разговоре нет подтверждения восстановления связи; результат неизвестен, не объявляем провалом или успехом.",
};
const report = {
  format: "talkhint.plab.call-report", version: 1, mail_form_version: 3,
  synthetic: false, mode: "hint", environment: "development",
  source_environment: "production", execution: "manual_assistant_review",
  call_id: source.call_id, started_at: source.started_at, ended_at: source.ended_at,
  duration_ms: duration, framework: { executed: false }, model: null,
  qa_status: "НЕЗАВИСИМЫЙ QA НЕ ПРОВОДИЛСЯ",
  qa_issues: ["Это эталон «до», ручной разбор ассистентом. Не результат автономной CrewAI и не приёмка Сергеем."],
  manual_observations: observations,
  analysis: { findings: [
    { category: "UI — подтверждено скриншотами", event_id: "14 / 19", explanation: "Две ветви ответа плохо читаются: текст обрезан и накладывается. Передать iOS-инженеру; проверить узкие экраны и длинные фразы." },
    { category: "Hint — разрыв помощи", event_id: "30", explanation: "После просьбы собеседника сообщить результат снова предлагается ожидание. Нужны условные варианты результата, без угадывания того, что сделал владелец." },
    { category: "STT — требует диагностики", event_id: "owner-transcript", explanation: "В распознанной речи есть подозрительные слова; без записи-эталона нельзя определить причину. STT/аудиоканалы этой правкой не менялись." },
  ], limitations: [
    "Новых звонков, replay, AI-прогонов и независимого QA не было.",
    "Метаданные candidatePipeline.enabled=false, sttEffective=null: эксперимент выключен, фактическая модель STT этим полем не подтверждена.",
    "Результат этого звонка не доказывает результат последующих изменений.",
  ] },
  letter: { limitations_ru: ["Нет эталона STT, подтверждённой iPhone-телеметрии и проверенной рубрики нужности. Общий процент — ?."], proposals_ru: [] },
};
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev only");
  const key = labKey("development", binding.ownerId, `manual-baseline-v3:${source.call_id}`);
  const messageId = messageIdFor(key);
  Object.assign(report, { private_report_path: `/api/admin/call-lab/reports/${key}` });
  await pool.query(`INSERT INTO call_lab_jobs(key,environment,owner_id,call_sid,status,source,report,journal)
    VALUES($1,'development',$2,$3,'manual_baseline_ready',$4::jsonb,$5::jsonb,$6::jsonb)
    ON CONFLICT(key) DO NOTHING`, [key, binding.ownerId, `manual-baseline-v3:${source.call_id}`,
    JSON.stringify({ origin: "production read-only", snapshot: source.started_at, manual: true,
      raw_audio_read: false, source_revision: "historical-before-fix" }), JSON.stringify(report),
    JSON.stringify([{ phase: "owner-requested:manual-baseline", crewExecuted: false }])]);
  await pool.query(`INSERT INTO call_lab_outbox(key,environment,owner_id,message_id)
    VALUES($1,'development',$2,$3) ON CONFLICT(key) DO NOTHING`, [key, binding.ownerId, messageId]);
  const dir = "generated-artifacts/hint-mint-baseline-v3";
  await mkdir(dir, { recursive: true });
  // Downloadable summary has no recipient, phone number, transcript, call SID or tokens.
  const publicReport = { ...report, call_id: undefined, private_report_path: undefined };
  const rendered = renderProcessLetter(publicReport);
  await writeFile(`${dir}/Mint_эталон_до_v3.txt`, `${rendered.subject}\n\n${rendered.body}`);
  await writeFile(`${dir}/Mint_эталон_до_v3.json`, JSON.stringify(publicReport, null, 2));
  if (!process.argv.includes("--send")) {
    console.log(JSON.stringify({ prepared: true, crewExecuted: false, mailSent: false }));
  } else {
    const mail = new GmailLabMail();
    const store = new LabStore(pool);
    const row = (await pool.query("SELECT * FROM call_lab_outbox WHERE key=$1", [key])).rows[0];
    if (row.status !== "prepared") {
      console.log(JSON.stringify({ sentPreviouslyOrUncertain: true, status: row.status, noResend: true }));
    } else {
      const claimed = await pool.query(`UPDATE call_lab_outbox SET status='sending',updated_at=now()
        WHERE key=$1 AND status='prepared' RETURNING key`, [key]);
      assert.equal(claimed.rowCount, 1);
      try {
        const id = await mail.send(binding, messageId, report);
        await store.mailState(key, "gmail_accepted", id);
        const confirmed = await mail.sent(binding, messageId, id);
        await store.mailState(key, confirmed ? "sent_confirmed" : "unknown", id);
        console.log(JSON.stringify({ submitted: true, confirmedInSent: !!confirmed, crewExecuted: false }));
      } catch {
        await store.mailState(key, "unknown");
        console.log(JSON.stringify({ status: "unknown", noBlindRetry: true }));
        process.exitCode = 1;
      }
    }
  }
} finally { await pool.end(); }
