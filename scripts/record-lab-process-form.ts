// Documentation-only Dev update. No worker, mail, phone or deployment operations.
import assert from "node:assert/strict";
import { Pool } from "pg";
import { unpackModel } from "../server/projectModel/history";
import { readHypothesis, applyHypothesisCommand } from "../server/projectModel/hypotheses";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { labFormId, labPacketId } from "../server/projectModel/research/labRole";

const source = "attached_assets/Pasted---1793075625082_1793075625084.txt";
const marker = "hint-process-plan-fact-v1";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev only");
  const rows = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(rows.rowCount, 1);
  const before = await unpackModel(pool, rows.rows[0].owner_key, rows.rows[0].state);
  const snapshot = readHypothesis(before, "new-country");
  const formDoc = snapshot.documents.find(d => d.id === labFormId)!;
  const packetDoc = snapshot.documents.find(d => d.id === labPacketId)!;
  assert.ok(formDoc && packetDoc);
  const form = JSON.parse(formDoc.text);
  if (form.processPlanFact?.id === marker) {
    console.log(JSON.stringify({ unchanged: true, revision: snapshot.revision, formVersion: form.version }));
  } else {
    const packet = JSON.parse(packetDoc.text);
    const current = snapshot.operatingModel!.revisions.at(-1)!;
    const data = structuredClone(current.data);
    const steps = [
      ["prepare_goal", "Цель задана в Prepare", "Звонки с ожидаемым использованием Prepare",
        "goalText может быть сохранён; наличие не доказывает подтверждение именно в Prepare",
        "Связать подтверждённую версию цели Prepare с call_id и временем подтверждения"],
      ["opening_visible", "Первая фраза показана на экране звонка", "Звонки с подготовленной первой фразой",
        "В текущем входе лаборатории нет доказательства отображения первой фразы",
        "Событие отображения на iOS: call_id, opening_id/version, build, visible_at"],
      ["speech_recognized", "Речь собеседника распознана", "Разрешённые реплики или слова проверенного эталона",
        "Транскрипт есть; reference_verified=false. Точность распознавания неизвестна",
        "Разрешённый проверенный reference, сопоставление реплик; WER отдельно по (S+D+I)/N"],
      ["hint_created", "Подсказка создана, где была нужна", "Реплики, где необходимость установлена по версии рубрики",
        "Сохранённый журнал неполный; полного знаменателя необходимости нет",
        "Проверенный размеченный набор нужных подсказок и полный журнал generation/result"],
      ["hint_before_reply", "Подсказка показана до ответа владельца", "Нужные подсказки с сопоставимыми временами",
        "sent_at/delivered_at возможны; отправка и ACK не доказывают видимость до ответа",
        "Событие видимости hint_id на iOS и начало ответа владельца; сверить часы/погрешность"],
      ["translation_visible", "Русский перевод показан", "Подсказки, для которых русский перевод включён и требуется",
        "Текущий вход не содержит подтверждений видимости русского перевода",
        "translation_id/hint_id, язык, настройка перевода, visible_at и build; OFF = неприменимо"],
      ["hint_used", "Подсказка использована", "Показанные и независимо оценённые подсказки",
        "Совпадение речи с подсказкой не равно подтверждённой пользе; уверенный факт отсутствует",
        "Отзыв владельца или оценка по рубрике с доказательством; AI-гипотеза отдельно"],
      ["goal_achieved", "Цель разговора достигнута", "Звонки с заданным критерием достижения цели",
        "AI-вывод из текста не равен подтверждению владельца или внешнему результату",
        "Критерий цели, свидетельство результата и отдельное подтверждение; частично/неизвестно допустимы"],
    ].map(([id, name, denominator, evidenceNow, missingTelemetry]) => ({
      id, name, target: "100% для применимых случаев; целевой принцип, не измеренный факт",
      numerator: null, denominator: null, denominatorDefinition: denominator,
      actual: null, display: "?", evidenceNow, missingTelemetry,
      sourceStatus: "Код адаптера проверен; реальная полнота данных звонка не проверялась",
    }));
    form.version += 1;
    form.status = "Принцип план-факт согласован владельцем; детальные формулы и общий показатель требуют решения";
    form.subject = "[Hint] {длительность|?} · процесс {процент|нет данных} · слабое звено {подтверждённое|не установлено} · {QA}";
    form.sections = ["Итог одной строкой", "Таблица: звено / план / факт / доказательство или пробел",
      "Где сломалось: 1–3 подтверждённых отклонения; причины и гипотезы раздельно",
      "Кто разбирает: существующая роль и принимающее действие; назначение исправления не имитировать",
      "Ссылка на полный приватный разбор с версией и статусом QA"];
    form.processPlanFact = {
      id: marker, source, scope: "Hint; остальные режимы — отдельные будущие цепочки",
      steps, overall: { value: null, status: "Ждёт решения владельца",
        rule: "Не усреднять восемь разнородных процентов. Общий процент только после выбора формулы, применимости и знаменателя; неизвестное не 0 и не успех",
        proposal: "Показывать отдельно покрытие измерений и число полностью успешных звонков / число звонков с полной проверкой всех применимых обязательных звеньев; всегда показывать размер полной и неполной когорты" },
      timing: "По событию завершения и поступления данных без намеренной отсрочки; это не обещание нулевого времени вычислений",
      runtimeApplied: false,
      runtimeNote: "Сейчас изменены только описание и форма. Шаблон worker и фактически отправляемое письмо не менялись. Новый формат требует отдельного внедрения и проверки.",
      telemetryStatus: "Только перечень потребностей, новые события не добавлены",
    };
    form.rules.push("План-факт по звеньям процесса, не пересказ. Примерные 50/70/90/94% не данные.",
      "Неприменимо, неизвестно и подтверждённый отказ различаются. Нет Prepare/перевода по разрешённой настройке не автоматически дефект.",
      "Слабое звено определять по доказанному отклонению; без данных — не установлено. Причину не выводить из одного совпадения.");
    form.periodForm.processPlanFact = {
      sourceFormVersion: form.version, periods: ["день", "неделя", "месяц"],
      columns: ["звено", "план", "числитель", "знаменатель", "факт", "покрытие измерений", "неизвестно", "неприменимо", "отклонение", "доказательство", "причина/гипотеза", "мера", "ответственный", "принимающий", "следующий шаг"],
      rule: "Одинаковые режим/определение/сборка/период; дедупликация call_id/report_version. Считать из исходных числителей и знаменателей, не усреднять проценты. При неполной когорте явно показывать покрытие.",
      automation: "Описание формы; автоматические дневные/недельные/месячные сводки не включены",
    };
    // Keep the complete form in its existing document; the role packet has a
    // strict 50k-character document limit, so embed the executable short form.
    packet.form = {
      version: form.version, status: form.status, documentId: labFormId,
      subject: form.subject, sections: form.sections,
      steps: steps.map(s => s.name),
      rules: ["Неизвестное = ?, не 0; неприменимое отдельно",
        "Общий процент только после согласования формулы и знаменателя",
        "Доказательства/причины/гипотезы раздельно; нет данных не дефект",
        "Отправка/ACK не доказательство показа; AI-оценка не приёмка владельца"],
      periods: ["день", "неделя", "месяц"],
      runtimeApplied: false,
      fullFormUrl: `/api/product-crew/documents/${labFormId}/download?format=json`,
    };
    for (const code of ["LAB.MAIL.PREPARE", "LAB.REPORT", "LAB.REPORT.RECEIVE"]) {
      const node = data.nodes.find(n => n.code === code)!;
      const action = packet.actions.find((a: any) => a.id === node.id)!;
      assert.ok(node && action);
      const addition = `\n[${marker}] Форма ${labFormId} v${form.version}: план-факт звеньев, неизвестное ≠ 0; общий % не согласован. Только описание, не runtime.`;
      node.procedure += addition;
      action.procedure = node.procedure;
      action.reportingTemplateVersion = String(form.version);
    }
    const after = await persistModelUpdate(pool, rows.rows[0].owner_key, root => {
      assert.equal(readHypothesis(root, "new-country").revision, snapshot.revision, "Concurrent update");
      let next = applyHypothesisCommand(root, "new-country",
        { type: "saveOperatingModel", baseVersion: current.version, data }, "Владелец: отчёт лаборатории — план-факт по звеньям; только описание");
      next = applyHypothesisCommand(next, "new-country", { type: "saveDocument", id: formDoc.id,
        title: `P.LAB — форма письма v${form.version} — план-факт Hint`, text: JSON.stringify(form),
        url: formDoc.url, elementIds: formDoc.elementIds }, `Источник: ${source}; условные цифры не факты`);
      packet.metadata.sourceRevision = readHypothesis(next, "new-country").revision + 1;
      assert.ok(JSON.stringify(packet).length <= 50000, "Role packet document size");
      next = applyHypothesisCommand(next, "new-country", { type: "saveDocument", id: packetDoc.id,
        title: packetDoc.title, text: JSON.stringify(packet), url: packetDoc.url, elementIds: packetDoc.elementIds },
      "Форма синхронизирована; версия принятой роли сохранена, runtime без изменений");
      const saved = readHypothesis(next, "new-country");
      assert.deepEqual(saved.operatingModel!.revisions.at(-1)!.data.nodes.map(n => n.id), current.data.nodes.map(n => n.id));
      assert.equal(JSON.parse(saved.documents.find(d => d.id === labFormId)!.text).processPlanFact.steps.length, 8);
      return next;
    }, true);
    console.log(JSON.stringify({ revision: readHypothesis(after, "new-country").revision,
      formId: labFormId, formVersion: form.version, rolePacketVersion: packet.version,
      changedActions: ["LAB.MAIL.PREPARE", "LAB.REPORT", "LAB.REPORT.RECEIVE"], runtimeChanged: false }));
  }
} finally { await pool.end(); }
