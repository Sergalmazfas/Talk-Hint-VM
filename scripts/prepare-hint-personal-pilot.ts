/** Preparation/export only: Dev documents, never user settings or provider requests. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { unpackModel } from "../server/projectModel/history";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { applyHypothesisCommand, readHypothesis } from "../server/projectModel/hypotheses";
import { ProductCrewService } from "../server/productCrew/service";

const apply = process.argv.includes("--save-preparation");
const dir = "generated-artifacts/hint-personal-pilot-v1";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const rows = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(rows.rows.length, 1);
  const owner = rows.rows[0].owner_key;
  const before = readHypothesis(await unpackModel(pool, owner, rows.rows[0].state), "new-country");
  const parent = before.documents.find(d => d.id === "DOC-HINT-UNIFIED-REPLAY")!;
  const linked = before.documents.find(d => d.id === "DOC-HINT-UNIFIED-RESCORE-PREFLIGHT")!;
  const journal = before.documents.find(d => d.id === "DOC-TALKHINT-IMPROVEMENT-JOURNAL")!;
  const packet = JSON.parse(parent.text), detail = JSON.parse(linked.text), j = JSON.parse(journal.text);
  const reference = before.documents.filter(d =>
    [parent.id, linked.id, journal.id, "DOC-TALKHINT-PRODUCT-PASSPORT", "DOC-TALKHINT-CHAPTER-HINT"].includes(d.id)
    || /P\.PRODUCT|P-PRODUCT|P\.LAB|P-LAB/.test(d.title));
  const summary = reference.map(d => {
    let value: any; try { value = JSON.parse(d.text); } catch {}
    return { id: d.id, title: d.title, version: value?.version ?? null,
      chars: d.text.length, sha256: hash(d.text),
      fields: value ? Object.keys(value) : [],
      relevantContent: JSON.stringify({state:value?.state, purpose:value?.purpose, scope:value?.scope,
        role:value?.role && {code:value.role.code,purpose:value.role.purpose,status:value.role.status},
        actions:value?.actions?.filter((a:any) => ["LAB.1","LAB.QA","LAB.REPORT","PRD.1.14"].includes(a.code))
          .map((a:any) => ({id:a.id,code:a.code,purpose:a.purpose,acceptorId:a.acceptorId,recipientId:a.recipientId}))}).slice(0,1800) };
  });
  if (process.argv.includes("--finalize-titles")) {
    assert(packet.personalPilot?.status === "prepared_not_activated");
    const targets = [
      {doc:parent,title:`Hint — единая линейка моделей — v${packet.version} — личный пилот подготовлен, выключен`},
      {doc:linked,title:`Hint — калибровка и досверка — v${detail.version} — пакет личного пилота`},
      {doc:journal,title:`TalkHint — журнал улучшений — v${j.version}`},
    ];
    await persistModelUpdate(pool, owner, root => {
      assert.equal(readHypothesis(root, "new-country").revision, before.revision);
      for(const x of targets) root=applyHypothesisCommand(root,"new-country",{
        type:"saveDocument",id:x.doc.id,title:x.title,text:x.doc.text,url:x.doc.url,elementIds:x.doc.elementIds,
      },"P.PRODUCT: выровнены отображаемые версии подготовленного пакета");
      return root;
    },true);
    const fresh=await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1",[owner]);
    const after=readHypothesis(await unpackModel(pool,owner,fresh.rows[0].state),"new-country");
    assert.deepEqual(before.operatingModel,after.operatingModel);
    for(const d of before.documents){
      const actual=after.documents.find(x=>x.id===d.id)!;
      const target=targets.find(x=>x.doc.id===d.id);
      if(target){assert.equal(actual.text,d.text);assert.equal(actual.title,target.title);}
      else assert.deepEqual(actual,d);
    }
    const receipt=JSON.parse(await readFile(`${dir}/READBACK.json`,"utf8"));
    receipt.revision=after.revision;
    receipt.displayTitlesVerified=true;
    await writeFile(`${dir}/READBACK.json`,JSON.stringify(receipt,null,2));
    console.log(JSON.stringify(receipt));
  } else if (!apply) {
    console.log(JSON.stringify({ revision: before.revision, documents: summary,
      modelKeys: Object.keys(before.operatingModel) }, null, 2));
  } else {
    const marker = "hint-personal-pilot:preparation-v1";
    assert(!packet.executionHistory.some((x: any) => x.marker === marker), "Already saved; do not duplicate");
    const at = new Date().toISOString();
    const analysis = JSON.parse(await readFile("generated-artifacts/hint-unified-rescore-final/ANALYSIS.json", "utf8"));
    const candidateSource = await readFile("server/candidatePipeline.ts", "utf8");
    const routeSource = await readFile("server/benchmark/routes.ts", "utf8");
    const match = candidateSource.match(/export const CANDIDATE_BRAIN_MODELS = \[([\s\S]*?)\] as const/);
    assert(match);
    const allowed = [...match[1].matchAll(/"([^"]+)"/g)].map(x => x[1]);
    assert(!allowed.includes("gpt-4.1-mini"), "Reinspect readiness: Mini support has changed");
    assert(routeSource.includes('const base = "/api/admin/benchmark"'));
    const pilot = {
      id: "HINT-MODEL-HISTORY-001:PERSONAL-PILOT", version: 1, preparedAt: at,
      caseId: "HINT-MODEL-HISTORY-001", status: "prepared_not_activated",
      ownerAuthorization: { source: "Прямой ответ владельца", answer: "Да, только подготовить",
        preparationOnly: true, activationAuthorized: false, callsAuthorized: false,
        publishAuthorized: false, paidModelRequestsAuthorized: false },
      baseline: { model: "gpt-5.6-terra", verifyEffectiveModelBeforeEveryCall: true },
      candidate: { model: "gpt-4.1-mini", supportedByExistingPersonalSelector: false },
      unchanged: ["Hint prompt", "STT profile", "goal preparation", "iOS behavior", "other accounts",
        "Copilot", "Translator", "Secretary", "recording/consent settings", "lab/ops activation"],
      evidence: { sourceDocumentId: linked.id, sourceDocumentVersion: detail.version,
        sourceRevision: before.revision, commonTextMoments: analysis.sameUsableMomentsAcrossAllFive,
        miniFasterIsNotProofOfBetterQuality: true, liveEffectUnknown: true },
      technicalReadiness: {
        existingPersonalPipeline: true, personalEndpoint: "/api/admin/benchmark/candidate-pipeline",
        auth: "requireBenchmarkAdmin; target user is the authenticated user, not a supplied user ID",
        activeAccountOrProductionConfigurationRead: false,
        miniRejectedByCurrentValidator: true, originalAllowedModels: allowed,
        blocker: "Mini отсутствует в CANDIDATE_BRAIN_MODELS; текущий PUT вернёт 400. Активировать существующим селектором сейчас нельзя.",
        preparedCodeChangesApplied: false,
        requiredEngineeringWork: [
          "Согласовать и подготовить ограниченный доступ Mini только владельцу; простого расширения списка для всех администраторов недостаточно.",
          "Обновить устаревший тест, где Mini объявлена production и ожидается её запрет.",
          "Проверить все пути выдачи: основной BRAIN, fast/wait/closing/ask/library; отметить обходящие модель, исключить их из сравнения BRAIN.",
          "Зафиксировать реально использованную модель и fallback на уровне события. Подмена или неизвестный источник делает попытку несравнимой.",
          "Офлайн-тесты: чужой аккаунт запрещён, неверная модель 400, per-call override, STT не меняется, rollback восстанавливает исходную конфигурацию."
        ],
        releaseGate: "Сначала отдельный Dev diff и проверки; выпуск и включение — отдельное разрешение владельца."
      },
      sequence: [
        { step: 1, role: "HEAD.07", input: "Этот пакет; исходные личные настройки перед будущим включением",
          output: "Dev diff, offline checks, snapshot rollback", recipient: "P.PRODUCT",
          acceptance: "Mini изолирована владельцем; все проверки пройдены, флаги не включены",
          state: "in_plan" },
        { step: 2, role: "P.PRODUCT", input: "Принятый технический пакет и ресурсы P.LAB/P.OPS",
          output: "Нужно решение: выпуск при необходимости, число звонков, расходы и личное включение",
          recipient: "Владелец", acceptance: "Явный ответ по строкам; молчание не согласие", state: "awaiting_future_gate" },
        { step: 3, role: "HEAD.07", input: "Отдельное разрешение и сохранённая исходная конфигурация",
          output: "Подтверждение выбранной модели только владельца и неизменного STT", recipient: "P.LAB",
          acceptance: "Проверка перед каждым звонком; неизвестная runtime-модель блокирует сравнение", state: "not_authorized" },
        { step: 4, role: "Владелец", input: "Разрешённый сценарий, модель и проверка готовности",
          output: "Свой разговор и отзыв", recipient: "P.LAB",
          acceptance: "Новых звонков сейчас не поручено; сторонние участники и запись — по действующим правилам", state: "not_authorized" },
        { step: 5, role: "P.LAB", input: "Снимок звонка и кодовая телеметрия; версия модели/промпта/STT",
          output: "Счётчики и помеченная AI-оценка, отдельные неизвестные", recipient: "P.LG.QA",
          acceptance: "Нет оценок показа/использования из ACK; нет нулей вместо неизвестного", state: "not_run" },
        { step: 6, role: "P.LG.QA", input: "Разбор, фактические доказательства и общая рубрика",
          output: "Реальный независимый вердикт либо возврат с конкретными расхождениями", recipient: "P.LAB",
          acceptance: "Независимость исполнителя проверена, решения не имитируются", state: "not_run" },
        { step: 7, role: "P.LAB / P.OPS", input: "Разбор, QA и существующий outbox",
          output: "Короткое письмо и контроль доставки/сбоя в рамках выданных полномочий", recipient: "Владелец",
          acceptance: "SENT отдельно от прочтения и оценки; при сбое AI кодовые цифры остаются", state: "not_run" },
        { step: 8, role: "P.PRODUCT", input: "Все попытки, несравнимые звонки, QA и отзыв владельца",
          output: "Одна таблица план/факт, решение по пилоту и история того же случая", recipient: "HEAD.07 / владелец",
          acceptance: "Принятая техническая передача + отдельная оценка владельца; без глобального переключения", state: "not_run" }
      ],
      proposedDesign: { approved: false,
        minimumCompletedCalls: 4, order: ["Terra", "Mini", "Mini", "Terra"],
        reason: "Минимум две попытки на модель, порядок ABBA уменьшает простой эффект привыкания, но не устраняет различие собеседников.",
        durationOrFixedDeadline: null, deadlineStatus: "Не назначено; после разрешения и готовности",
        fixedScriptForReplaysOnly: true, liveCallsNotIdenticalOrRandomized: true,
        priorMintAndCoffee: "Только исторический ориентир, не подмена нового контроля Terra.",
        moneyCapUSD: null, moneyStatus: "Новый бюджет живого пилота не согласован; остаток стенда не переносится автоматически.",
        modelComparisonDoesNotAuthorizePromptChange: true },
      metrics: [
        { name: "Подсказки", method: "code", fields: ["created", "sent", "suppressedByReason", "ack", "iPhoneRendered", "hintTranslationRendered", "guestTranslationRendered"], missing: null },
        { name: "Задержки", method: "code", fields: ["sttFinalToBrainTrigger", "brainFullOutput", "wsSendToIPhoneRender", "sttFinalToIPhoneRender"], statistics: ["n", "p50", "p95"], missing: null,
          limitation: "Нет доказанного времени физического конца речи; final уже включает STT/EOT. p95 малой выборки не устойчивый SLA." },
        { name: "Качество", method: "AI rubric + separate owner rating",
          fields: ["goalRetention", "unsupportedFacts", "speakingForOwner", "goalFactsUse", "wordsPerCard", "cardCount", "ownerUsedHints", "ownerRating"],
          speakingForOwner: "Утверждение о состоянии/действии владельца без факта в цели или его предыдущей речи; выбор, вопрос и подтверждённый факт исключены.",
          ownerRating: ["хуже", "так же", "лучше", "отлично"], missing: null }
      ],
      comparisonRules: [
        "Сначала результаты по каждому звонку; агрегировать только сопоставимые профили и категории, показывать размер выборки.",
        "Исключение всегда с причиной: неизвестная/другая модель, fallback, library/static hint, смена STT/промпта, сбой телеметрии. Звонок и его ошибки не удалять.",
        "Процент использования = использованные подсказки / моменты нужности по рубрике; пока нужность не оценена или знаменатель равен нулю — null.",
        "ACK, показ, выбор карточки, ручное скрытие и произнесение — разные события. Факт использования не выдумывать.",
        "Завершение плана не равно успеху модели. Численные пороги полезности/задержки не утверждены."
      ],
      stopAndRollback: {
        stopWhen: ["Воздействие на чужой аккаунт или другой режим", "Нет подтверждения фактической модели или изменился профиль сравнения",
          "Критическая подсказка с неподтверждённым состоянием/потерей цели", "Сбой звонка, утрата отчёта/QA, отсутствие необходимых данных",
          "Потолок отдельно согласованных расходов", "Владелец просит остановить"],
        action: "Остановить пилот, сохранить неуспешную попытку, сообщить владельцу и HEAD.07/P.PRODUCT; не продолжать вслепую.",
        rollback: "Восстановить исходный snapshot личной candidate-конфигурации, а не сбрасывать чужие или глобальные настройки; проверить следующее фактическое состояние.",
        snapshotAvailable: false, rollbackExecuted: false
      },
      resources: [
        { name: "Существующий API модели проекта", supplier: "HEAD.07", readiness: "Ключ не читается и не выдаётся документом; живой доступ перед пилотом не проверен" },
        { name: "Личный селектор модели", supplier: "HEAD.07", readiness: "Есть код, Mini пока не поддерживается" },
        { name: "iPhone и установленная сборка", supplier: "Владелец", readiness: "Точная версия/телеметрия для будущего пилота не проверена" },
        { name: "Разбор, независимая QA, self-mail и дежурный Hint", supplier: "P.LAB / P.OPS",
          readiness: "Существующие контуры, актуальное живое прохождение в этой подготовке не проверялось; ничего не включалось" }
      ],
      handoffs: [
        { from: "P.PRODUCT", to: "HEAD.07", request: "Техническая подготовка владельческой изоляции Mini и протокол возврата", status: "prepared_not_executed" },
        { from: "HEAD.07", to: "P.LAB / P.OPS", request: "Подтверждение источников модели/экранных отметок и готовности отчёта/контроля", status: "awaiting_future_readiness_check" },
        { from: "P.PRODUCT", to: "Владелец", request: "После Dev-проверок: отдельное решение по выпуску, включению, звонкам и расходам", status: "not_requested_now" }
      ],
      trialProtocol: [],
      forms: {
        preCall: { callId: null, arm: null, effectiveModel: null, configSnapshotRef: null, promptHash: null, sttProfile: null, appBuild: null, readinessEvidence: null },
        result: { callId: null, comparable: null, exclusionReason: null, codeCounters: null, latencySamples: null, aiAssessment: null, qaStatus: null, emailStatus: null, ownerUsedHints: null, ownerRating: null },
        summary: { plannedByArm: null, completedByArm: null, comparableByArm: null, unknowns: [], qualityAndLatency: null, ownerFeedback: null, recommendation: null, ownerDecision: null }
      },
      activationState: { enabled: false, settingsWritten: false, productionChanged: false, runtimeCodeChanged: false,
        providerRequests: 0, newCalls: 0, mailSent: false, independentQA: "not_run", ownerAcceptance: "not_received" }
    };
    // One authoritative object in the existing appendix. Retain its existing
    // compact JSON storage format; pretty-print only the downloadable export.
    detail.personalPilot = pilot;
    detail.version++;
    packet.personalPilot = { version: pilot.version, status: pilot.status,
      documentId: linked.id, documentVersion: detail.version, field: "personalPilot",
      enabled: false, blocker: pilot.technicalReadiness.blocker };
    packet.version++;
    packet.executionHistory.push({ at, marker, role: "P.PRODUCT / HEAD.07",
      ownerSource: "Да, только подготовить", outcome: "Пакет подготовлен; Mini в существующем селекторе запрещена; ничего не включено" });
    const c = j.cases.find((x: any) => x.caseId === pilot.caseId);
    assert(c);
    c.unifiedReplayVersion = packet.version;
    j.version++;
    const detailText = JSON.stringify(detail);
    assert.deepEqual(JSON.parse(detailText), detail);
    const changes = [{ doc: parent, value: packet }, { doc: journal, value: j }]
      .map(x => ({ ...x, text: JSON.stringify(x.value) }));
    changes.push({doc: linked, value: detail, text: detailText});
    assert(changes.every(x => x.text.length <= 50_000), changes.map(x => `${x.doc.id}:${x.text.length}`).join(", "));
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/INPUTS.json`, JSON.stringify({ revision: before.revision, documents: summary }, null, 2));
    await persistModelUpdate(pool, owner, root => {
      assert.equal(readHypothesis(root, "new-country").revision, before.revision, "Model changed; reread");
      for (const x of changes) root = applyHypothesisCommand(root, "new-country",
        { type: "saveDocument", id: x.doc.id, title: x.doc.title, text: x.text, url: x.doc.url, elementIds: x.doc.elementIds },
        "P.PRODUCT: " + marker);
      return root;
    }, true);
    const fresh = await pool.query("SELECT state FROM talkhint_project_models WHERE owner_key=$1", [owner]);
    const after = readHypothesis(await unpackModel(pool, owner, fresh.rows[0].state), "new-country");
    assert.deepEqual(before.operatingModel, after.operatingModel);
    for (const d of before.documents) if (!changes.some(x => x.doc.id === d.id))
      assert.deepEqual(after.documents.find(x => x.id === d.id), d);
    const service = new ProductCrewService({ read: async () => after, update: async () => { throw Error("read only"); } });
    for (const x of changes) assert.equal((await service.call(owner, "get_document", { documentId: x.doc.id })).text, x.text);
    const saved = JSON.parse((await service.call(owner, "get_document", {documentId: linked.id})).text).personalPilot;
    assert.deepEqual(saved, pilot);
    await writeFile(`${dir}/PILOT.json`, JSON.stringify(saved, null, 2));
    const receipt = { revision: after.revision, documentId: parent.id, documentVersion: packet.version,
      journalVersion: j.version, pilotDocumentId: linked.id, pilotDocumentVersion: detail.version,
      pilotVersion: pilot.version, sourceRevision: before.revision,
      readerVerified: true, operatingModelUnchanged: true, unrelatedDocumentsUnchanged: true,
      runtimeSettingsWrites: 0, providerRequests: 0, activated: false,
      serializedChars: changes.map(x => ({ documentId: x.doc.id, chars: x.text.length })) };
    await writeFile(`${dir}/READBACK.json`, JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify(receipt));
  }
} finally { await pool.end(); }
