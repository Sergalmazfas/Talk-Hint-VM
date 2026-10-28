/** Historical documentation only. No product/model provider settings are written. */
import assert from "node:assert/strict";
import { Pool } from "pg";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { applyHypothesisCommand, readHypothesis } from "../server/projectModel/hypotheses";
import { unpackModel } from "../server/projectModel/history";
import { ProductCrewService } from "../server/productCrew/service";

const dir = "generated-artifacts/hint-model-history";
const caseId = "HINT-MODEL-HISTORY-001";
const docId = "DOC-HINT-MODEL-HISTORY-001";
const marker = "HEAD07-HINT-MODEL-HISTORY";
const at = new Date().toISOString();
await mkdir(dir, { recursive: true });
const raw = JSON.parse(await readFile(`${dir}/benchmark-source.json`, "utf8"));
const switchAt = "2026-08-16T00:56:10Z";
const commits = [
  { short: "598f7ab", utc: "2026-06-08T16:40:03Z", denver: "2026-06-08T10:40:03-06:00", from: "gpt-4o-mini", to: "gpt-4.1-mini" },
  { short: "fc67c9c", utc: "2026-06-08T16:54:56Z", denver: "2026-06-08T10:54:56-06:00", from: "gpt-4.1-mini", to: "gemini-2.5-flash-lite" },
  { short: "eb8efa4", utc: "2026-07-01T01:18:09Z", denver: "2026-06-30T19:18:09-06:00", from: "gemini-2.5-flash-lite", to: "gpt-4.1-mini" },
  { short: "9d7fcd9", utc: switchAt, denver: "2026-08-15T18:56:10-06:00", from: "gpt-4.1-mini", to: "gpt-5.6-terra" },
].map(c => {
  const full = execFileSync("git", ["rev-parse", c.short], { encoding: "utf8" }).trim();
  execFileSync("git", ["merge-base", "--is-ancestor", full, "HEAD"]);
  const patch = execFileSync("git", ["show", full, "--", "server/websocket.ts"], { encoding: "utf8" });
  assert(patch.includes(`-const HINT_MODEL = process.env.HINT_MODEL || "${c.from}"`));
  assert(patch.includes(`+const HINT_MODEL = process.env.HINT_MODEL || "${c.to}"`));
  return { ...c, commit: full, subject: execFileSync("git", ["show", "-s", "--format=%s", full], { encoding: "utf8" }).trim(),
    source: "git / server/websocket.ts", scope: "Default в исходниках, не подтверждённая дата публикации или runtime звонка" };
});
const quantile = (a: number[], q: number) => a.length ? Math.round([...a].sort((x, y) => x - y)[Math.ceil(a.length * q) - 1]) : null;
const runs = raw.filter((r: any) => r.run_type === "brain").map((r: any) => {
  assert(new Date(r.finished_at).getTime() < new Date(switchAt).getTime());
  const turns = r.results?.turnResults ?? [];
  return { id: r.id, startedAt: r.started_at, finishedAt: r.finished_at,
    fixtureIds: r.fixture_ids, promptVersion: r.prompt_version,
    judgeModel: r.results?.judgeModel ?? null, notes: r.results?.notes ?? [],
    candidates: (r.scorecard?.candidates ?? []).map((c: any) => {
      const rows = turns.filter((t: any) => t.candidateId === c.candidateId);
      const timed = rows.filter((t: any) => typeof t.fullOutputMs === "number" && !t.error);
      const judged = rows.filter((t: any) => typeof t.judge?.scores?.overall_live_copilot_quality === "number");
      return { model: c.model, attempts: rows.length, successfulTimed: timed.length,
        avgFullOutputMs: c.avgFullOutputMs, avgFirstTokenMs: c.avgFirstTokenMs,
        p50FullOutputMs: quantile(timed.map((t: any) => t.fullOutputMs), .5),
        p95FullOutputMs: quantile(timed.map((t: any) => t.fullOutputMs), .95),
        aiQualityMeanOutOf10: c.judgeAverages?.overall_live_copilot_quality ?? null,
        aiQualityRatings: judged.length,
        selfJudgedRatings: judged.filter((t: any) => t.judge.selfJudged).length,
        clientRenderMeasured: false, clientRenderEstimateMs: c.clientRenderEstimateMs };
    }),
    interpretation: turns.length
      ? "Offline BRAIN по Real Call Fixture #2: качество оценивал AI, не участник звонка; это не live A/B и не измерение экрана."
      : "Первый запуск 14.08: нет ответов BRAIN, модели недоступны из-за quota; скорость и качество не получены." };
});
const report: any = {
  format: "talkhint.hint-model-history", version: 1, caseId, documentId: docId,
  role: "HEAD.07", reconstructedAt: at, status: "Исторический случай; факты восстановлены с ограничениями",
  timeline: commits,
  switch: { commit: commits.at(-1)!.commit, utc: switchAt, denver: commits.at(-1)!.denver,
    sourceFiles: ["server/websocket.ts", "server/benchmark/candidates.ts", "server/hintProvider.ts", "server/__tests__/hintProvider.test.ts"],
    gitRecordedReason: "Комментарий LIVE BRAIN switch (benchmark-driven); выбран тот же профиль API, что в BRAIN benchmark: reasoning_effort=none, max_completion_tokens, без temperature.",
    whyExactlyTerra: "причина не зафиксирована",
    qualification: "Общая ссылка на benchmark есть; явного сравнительного обоснования выбора именно Terra, порогов качества или отдельного решения с датой не найдено.",
    taskId: null, taskFinding: "Отдельная задача переключения с подтверждённым ID в доступных планах/коммите не найдена.",
    intermediateAfterMiniReturn: "Между возвратом на Mini 01.07 UTC и коммитом Terra других кодовых default не найдено.",
    deploymentAt: null, actualDecisionAt: null },
  ownerExplanation: {
    source: "владелец", statementDate: "2026-10-27", recordedAt: at,
    statement: "Terra выбрана как средний вариант по скорости и качеству; качество тогда на реальных звонках не измерялось.",
    independence: "Слова владельца сохранены отдельно от git, без заднего числа и без выдуманной ссылки на прежнее решение.",
    distinction: "Найдены offline AI-оценки по записи реального звонка. Они не подтверждают измерение качества в живом разговоре, использование подсказок владельцем или доступность на iPhone." },
  measurementsBeforeCodeSwitch: runs,
  measurementLimitations: [
    "Прогоны завершились до коммита; время самого решения не найдено, поэтому связь «именно эти замеры стали основанием» не доказана.",
    "14.08 нет успешных BRAIN-кандидатов: docs/benchmark-run-1-report.md, Judge none, quota exhausted.",
    "15.08 два offline-прогона: по 19 моментов, 5 кандидатов, brain-v2; Sol судит и себя, это self-judged.",
    "Количество AI-оценок меньше числа сгенерированных ответов из-за ошибок judge; знаменатели сохранены по кандидатам.",
    "Это другой benchmark envelope, не точный live-запрос. Перенос того же API-профиля не доказывает равенство промптов.",
    "В отчёте client render +75 мс — оценка, не измерение телефона. Скорость полного ответа модели не равна end-to-end задержке.",
    "Сохранённый отчёт рекомендует Sol, а не Terra; во втором прогоне Luna быстрее Terra и имеет более высокий AI-балл. Формального обоснования выбора Terra эти таблицы сами по себе не дают.",
    "В отчётах есть устаревший текст «нет реальных аудиофикстур»; он не отменяет наличие BRAIN-прогонов по Real Call Fixture #2 и не доказывает отсутствие записи.",
    "Git восстанавливает кодовый default. HINT_MODEL, set_model/UI и per-user candidate override могли задавать иную runtime-модель; история их включения/публикаций не восстановлена.",
  ],
  relatedPlans: [
    { path: ".local/tasks/live-ears-brain-benchmark.md", fact: "Baseline gpt-4.1-mini; скорость, judge и deterministic проверки запрошены; production автоматически не переключается." },
    { path: ".local/tasks/live-brain-gold-standard.md", fact: "Походовый Fixture #2, качество/скорость/цена и золотая середина; production-модель менять вне scope." },
    { path: ".local/tasks/live-hint-policy-v2-1-adaptive-types.md", fact: "Более поздняя работа уже предполагает Terra; это не исходное разрешение переключения." },
  ],
  evidence: [
    "git log -G HINT_MODEL -- server/websocket.ts; git show указанных коммитов, проверена принадлежность HEAD",
    "Dev PostgreSQL benchmark_runs: три BRAIN-записи 14–15.08; только SELECT, новые прогоны не запускались",
    "docs/benchmark-run-1-report.md",
    ".agents/memory/benchmark-bench.md: изоляция стенда и отсутствие автоматического переключения",
  ],
  runtimeChanged: false, newModelCalls: 0, productionChanged: false,
};
await writeFile(`${dir}/history-report.json`, JSON.stringify(report, null, 2));
assert(new URL(process.env.DATABASE_URL!).hostname === "helium");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const q = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(q.rows.length, 1);
  const owner = q.rows[0].owner_key;
  const before = readHypothesis(await unpackModel(pool, owner, q.rows[0].state), "new-country");
  assert(!before.documents.some(d => d.id === docId), "Historical case already exists; do not duplicate");
  const d = before.documents.find(d => d.id === "DOC-TALKHINT-IMPROVEMENT-JOURNAL")!;
  const chapterDoc = before.documents.find(d => d.id === "DOC-TALKHINT-CHAPTER-HINT")!;
  const journal = JSON.parse(d.text), chapter = JSON.parse(chapterDoc.text);
  assert(!journal.cases.some((c: any) => c.caseId === caseId));
  const entry = { at, role: "HEAD.07", marker, caseId, documentId: docId,
    note: "Восстановлена история default и замеров. Владелец 27.10 — отдельный источник. Runtime не изменён.",
    productionChanged: false };
  journal.cases.push({ caseId, mode: "Hint", title: "История выбора модели подсказок", status: "исторический случай — восстановлено с ограничениями",
    source: "Поручение владельца; git и сохранённые замеры", documentId: docId,
    historicalSwitch: { atUTC: switchAt, atDenver: commits.at(-1)!.denver, commit: commits.at(-1)!.commit,
      from: "gpt-4.1-mini", to: "gpt-5.6-terra", exactChoiceReason: "причина не зафиксирована", gitComment: "benchmark-driven", taskId: null },
    ownerExplanation: report.ownerExplanation, evidenceRunIds: runs.map((r: any) => r.id),
    conclusion: "Кодовый default сменён 15.08 Denver / 16.08 UTC. До коммита есть offline AI-оценки, но доказательств live-проверки качества/экрана и точного основания решения нет.",
    history: [entry], runtimeChanged: false });
  journal.history.push(entry); journal.version++;
  chapter.version++;
  chapter.updatedAt = at;
  const line = "История default: 08.06.2026 gpt-4.1-mini → Gemini Flash-Lite; 30.06 Denver → gpt-4.1-mini; 15.08 18:56 Denver / 16.08 00:56 UTC, 9d7fcd9: → gpt-5.6-terra. Git: benchmark-driven; причина выбора именно Terra не зафиксирована. Владелец, 27.10: средний вариант скорости/качества; live-качество тогда не измерялось. Offline AI-оценки 15.08 найдены, это не live-приёмка. История: DOC-HINT-MODEL-HISTORY-001.";
  chapter.layers.workflow.summary += `\n\n${line}`;
  chapter.sources.push({ id: "hint-model-history", type: "git + сохранённый стенд + владелец отдельно",
    title: "История default Hint", location: docId, date: at.slice(0, 10),
    evidence: "9d7fcd9; BRAIN 14–15.08; слова владельца 27.10", limitation: "Default не доказывает runtime/Publish." });
  const jt = JSON.stringify(journal), ct = JSON.stringify(chapter), rt = JSON.stringify(report);
  assert(jt.length <= 50_000 && ct.length <= 50_000 && rt.length <= 50_000,
    `Document limit: journal=${jt.length}, chapter=${ct.length}, report=${rt.length}`);
  await persistModelUpdate(pool, owner, root => {
    const current = readHypothesis(root, "new-country");
    assert.equal(current.revision, before.revision, "Source changed; reconcile first");
    const actor = "HEAD.07: восстановление истории Hint по поручению владельца, без изменения продукта";
    let next = applyHypothesisCommand(root, "new-country", { type: "createDocument", id: docId,
      title: "Hint — история выбора модели — v1 — git, стенд и объяснение владельца",
      url: "", text: rt, elementIds: ["TH-PRODUCT"] }, actor);
    next = applyHypothesisCommand(next, "new-country", { type: "saveDocument", id: d.id,
      title: `TalkHint — журнал улучшений — v${journal.version} — исторический выбор модели Hint`,
      url: d.url, text: jt, elementIds: d.elementIds }, actor);
    next = applyHypothesisCommand(next, "new-country", { type: "saveDocument", id: chapterDoc.id,
      title: `TalkHint — глава Hint — v${chapter.version} — история модели по git и замерам`,
      url: chapterDoc.url, text: ct, elementIds: chapterDoc.elementIds }, actor);
    assert.deepEqual(readHypothesis(next, "new-country").operatingModel, before.operatingModel);
    return next;
  }, true);
  const q2 = await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", [owner]);
  const after = readHypothesis(await unpackModel(pool, owner, q2.rows[0].state), "new-country");
  for (const old of before.documents) if (![d.id, chapterDoc.id].includes(old.id))
    assert.deepEqual(after.documents.find(d => d.id === old.id), old);
  const svc = new ProductCrewService({ read: async () => after, update: async () => { throw Error("Read only"); } });
  for (const [id, text] of [[docId, rt], [d.id, jt], [chapterDoc.id, ct]])
    assert.equal((await svc.call(owner, "get_document", { documentId: id })).text, text);
  await writeFile(`${dir}/APPLICATION_RESULT.json`, JSON.stringify({
    sourceRevision: before.revision, finalRevision: after.revision,
    journalVersion: journal.version, hintChapterVersion: chapter.version,
    caseId, documentId: docId, operatingModelUnchanged: true,
    unrelatedDocumentsUnchanged: true, readerVerified: true, runtimeChanged: false,
    sourceLimits: "История git и Dev-стенда; не история Publish/env/UI и не доказательство live-качества",
  }, null, 2));
  console.log(await readFile(`${dir}/APPLICATION_RESULT.json`, "utf8"));
} finally { await pool.end(); }
