/** Apply the owner's 28 October per-call process to existing IDs; Dev only. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { unpackModel } from "../server/projectModel/history";
import { readHypothesis, applyHypothesisCommand } from "../server/projectModel/hypotheses";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { ProductCrewService } from "../server/productCrew/service";
import { perCallPolicy, buildProductFollowup } from "../server/callLab/productFollowup";
import { renderProcessLetter, completeLabReport } from "../server/callLab/processReport";
import { authorizedHintSource } from "../server/callLab/source";
import { labRelease } from "../server/callLab/policy";

const dir = "generated-artifacts/per-call-decisions";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev only");
  const q = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
  assert.equal(q.rowCount, 1);
  const owner = q.rows[0].owner_key;
  const root = await unpackModel(pool, owner, q.rows[0].state);
  const before = readHypothesis(root, "new-country");
  const ids = ["DOC-PLAB-WORK-PACKAGE", "DOC-PPRODUCT-WORK-PACKAGE", "DOC-PLAB-CALL-LETTER", "DOC-OWNER-CALLS"];
  const docs = ids.map(id => { const d = before.documents.find(d => d.id === id); assert(d, id); return { ...d, value: JSON.parse(d.text) }; });
  const [lab, product, form, policy] = docs.map(d => d.value);
  assert(!policy.perCallDecisions, "Already applied; read back rather than reapply");
  const at = new Date().toISOString(), marker = perCallPolicy.id;
  const contract = {
    ...perCallPolicy, approvedAt: "2026-10-28", source: "Прямое решение владельца в чате",
    scope: "каждый личный звонок, не другие пользователи; без ожидания недельной сводки",
    sequence: [
      { role: "P.LAB", action: "lab-action-analyze", output: "цифры кода, разбор/сбой и фактический статус независимой QA", recipient: "lab-action-product-receive" },
      { role: "P.PRODUCT", action: "lab-action-product-receive", input: "каждое где сломалось, возврат QA, инцидент P.OPS, отзыв владельца", output: "случай/дополнение существующего случая; история попыток и сравнение; причины не выдумывать" },
      { role: "P.PRODUCT", action: "company-action-product-decision", input: "журнал с версиями, прежние звонки, факты P.LAB", output: "Нужно решение: ID, предложение настройки, основание, исполнитель, проверка эффекта, да/нет", acceptor: "владелец" },
      { role: "P.LAB", action: "lab-action-letter", input: "воронка, QA, вклад P.PRODUCT", output: "одно письмо по звонку; нет истории → честный пробел и адресный запрос роли", recipient: "lab-action-send" },
      { role: "P.PRODUCT", action: "company-action-dispatch", input: "явное да/нет по ID из чата", output: "да → HEAD.07 Dev, проверки, ближайшая публикация владельцем; нет → сохранить отказ, не выполнять", acceptor: "HEAD.07; не самоприёмка P.PRODUCT" },
      { role: "P.PRODUCT / P.LAB", action: "management-action-impact", input: "следующий звонок после реально опубликованной версии", output: "было → стало по тому же признаку и оценка владельца; отсутствие повторения не доказательство причинности" },
    ],
    journal: "DOC-TALKHINT-IMPROVEMENT-JOURNAL: один случай на проблему, история источник/доказательства/решение/Dev/версия публикации/следующий звонок/оценка; текущий вход и решения также сохраняются в product_followup и журнале выполнения звонка, не во второй базе",
    resources: [
      { resource: "существующий журнал и главы", owner: "P.PRODUCT", status: "runtime читает при доступности в текущем окружении; иначе явно недоступно" },
      { resource: "сохранённые отчёты звонков", owner: "P.LAB", status: "owner_id + environment, до трёх предыдущих более ранних несинтетических отчётов; без доступа к чужим звонкам" },
      { resource: "ответ владельца", owner: "владелец → P.PRODUCT", status: "чат доступен; автоматическое чтение Gmail не подключается" },
      { resource: "исполнитель P.PRODUCT", owner: "P.PRODUCT", status: "Replit временно исполняет роль в чате; нового автономного CrewAI-агента не включать; runtime готовит детерминированный вход/таблицу, не утверждает решения" },
    ],
    forms: {
      decision: { columns: ["id", "проблема/доказательство/неизвестное", "что пробовали и помогло ли", "предложение настройки", "исполнитель", "критерий следующего звонка", "ответ владельца да/нет"],
        status: "awaiting_owner", noResponse: "не согласовано; не выполнять" },
      effect: { fields: ["caseId", "decisionId", "предыдущий звонок/версия/значение", "Dev diff/проверки", "факт публикации", "следующий звонок/версия/значение", "сопоставимость/ограничения", "хуже/так же/лучше/отлично"],
        unknown: "нет сравнения → неизвестно; QA, ACK и зелёный тест не оценка владельца" },
    },
    runtimeBoundary: "Никаких новых моделей, провайдеров, расходов, звонков, автоматической приёмки или выпуска. Вносится только цепочка подготовки письма в Dev. Следующий звонок не запускается искусственно.",
  };
  policy.perCallDecisions = contract;
  policy.history.push({ at, role: "P.PRODUCT / P.LAB", decision: marker, source: "владелец, чат 28.10", productionChanged: false });
  policy.labRelease = labRelease;
  lab.perCallPolicyRef = "DOC-OWNER-CALLS#perCallDecisions";
  product.perCallPolicyRef = lab.perCallPolicyRef;
  lab.version = 3; product.version = 3;
  lab.metadata.sourceRevision = product.metadata.sourceRevision = before.revision;
  for (const a of lab.actions) {
    if (a.id === "lab-action-letter")
      a.procedure = "После каждого личного звонка, без ожидания сводки: цифры кода/воронка, где сломалось, вклад P.PRODUCT «Что уже пробовали» и «Нужно решение». DOC-PLAB-CALL-LETTER v4 и DOC-OWNER-CALLS#perCallDecisions. Сбой AI/возврат QA не задерживает письмо; непроверенное помечено. Нет истории → адресный запрос P.PRODUCT, не выдуманные попытки. Отправка отдельно, SENT не чтение. Чужие звонки не включать.";
    if (a.id === "lab-action-product") {
      a.inputs = [{ name: "Результат каждого личного звонка: цифры кода, QA/возврат/сбой и ограничения", sourceId: "lab-result-run", freshness: "по завершении события, не по неделе" }];
      a.procedure = "Каждый результат сразу передать P.PRODUCT: и принятую QA оценку, и непринятый сигнал/сбой. Статусы не смешивать; неподтверждённую причину не объявлять фактом. Пределы, формы и адреса — DOC-OWNER-CALLS#perCallDecisions.";
      a.success = "Вход продукта зафиксирован для звонка; возврат QA не потерян, принятие не имитируется.";
    }
    if (a.id === "lab-action-product-receive")
      a.procedure = "P.PRODUCT принимает каждый вход звонка, читает журнал прежних попыток, готовит адресные предложения настройки и сравнение; ответ владельца — в чат. DOC-OWNER-CALLS#perCallDecisions. Нет принятой QA → кандидат/неизвестно, не доказанный дефект.";
  }
  const newProcedures: Record<string, string> = {
    "lab-action-product-receive": "Каждый личный звонок — немедленный вход, включая отказ QA/сбой. Зарегистрировать/дополнить случай без дубля; прочитать прежние попытки и результат из журнала. Не ждать недели. Непроверенный сигнал не причина.",
    "company-action-product-decision": "После каждого звонка одна таблица «Нужно решение», ID и да/нет; сначала промпт, триггеры, iOS, паузы, фильтры. Без доказанной недостаточности настройки в журнале либо новой находки P.TECH модель/связку/провайдера не предлагать. Решает владелец в чате.",
    "company-action-dispatch": "После явного да по ID сразу HEAD.07 в Dev и ближайшую публикацию владельцем. Нет/молчание не разрешают внедрение. Записать решение, diff/проверки и версию; приёмка HEAD.07 не заменяет независимую QA и оценку владельца.",
    "management-action-impact": "Следующий звонок после публикации сверяет тот же признак «было → стало» и ограничения сопоставимости; запросить оценку владельца. Отсутствующий эффект неизвестен. Запись в существующем случае и паспорте после технических проверок; не закрывать по одному зелёному тесту.",
    "company-action-product-notify": "Ответ источнику и владельцу — после события/решения, не раз в неделю. Недельная сводка только итог уже принятых решений и проверок, не очередь для согласования. Существующая передача HEAD.06/T06.REPORT.WEEK остаётся.",
  };
  for (const a of product.actions) if (newProcedures[a.id])
    a.procedure = `${newProcedures[a.id]} Подробности: DOC-OWNER-CALLS#perCallDecisions.`;
  product.forms.decisionRequest.perCallPolicyRef = lab.perCallPolicyRef;
  product.forms.weeklyProductReport.perCallPolicyRef = lab.perCallPolicyRef;
  form.version = 4;
  form.perCallDecision = contract.forms;
  form.policyRef = lab.perCallPolicyRef;
  form.rules.push?.("Решение владельца 28.10: каждое письмо содержит прежние попытки с подтверждённым эффектом/неизвестно и таблицу да/нет; неделя только итог. Разрыв серверных отметок не задержка физического экрана.");
  const op = before.operatingModel!.revisions.at(-1)!;
  lab.metadata.operatingVersion = product.metadata.operatingVersion = op.version + 1;
  const data = structuredClone(op.data);
  const actionDocs = [...lab.actions.filter((a: any) => ["lab-action-letter", "lab-action-product", "lab-action-product-receive"].includes(a.id)),
    ...product.actions.filter((a: any) => newProcedures[a.id])];
  for (const a of actionDocs) {
    const n = data.nodes.find(n => n.id === a.id); assert(n, a.id);
    // Supersede the procedure in place; previous model revisions retain history.
    n.procedure = a.procedure;
  }
  for (const d of docs) { d.text = JSON.stringify(d.value); assert(d.text.length <= 50000, `${d.id}: ${d.text.length}`); }
  const receipt: any = { sourceRevision: before.revision, sourceOperatingVersion: op.version, documents: docs.map(d => ({ id: d.id, characters: d.text.length })), policy: marker, newCalls: 0, modelCalls: 0, productionChanged: false };
  await writeFile(`${dir}/proposed-documents.json`, JSON.stringify(docs.map(({ id, title, text }) => ({ id, title, text })), null, 2));
  if (process.argv.includes("--apply")) {
    const afterRoot = await persistModelUpdate(pool, owner, root => {
      assert.equal(readHypothesis(root, "new-country").revision, before.revision);
      let next = applyHypothesisCommand(root, "new-country", { type: "saveOperatingModel", baseVersion: op.version, data }, "P.PRODUCT / P.LAB: " + marker);
      for (const d of docs) next = applyHypothesisCommand(next, "new-country",
        { type: "saveDocument", id: d.id, title: d.title, text: d.text, url: d.url, elementIds: d.elementIds }, marker);
      return next;
    }, true);
    const after = readHypothesis(afterRoot, "new-country");
    const reader = new ProductCrewService({ read: async () => after, update: async () => { throw Error("read only"); } });
    for (const d of docs) assert.equal((await reader.call(owner, "get_document", { documentId: d.id })).text, d.text);
    receipt.appliedRevision = after.revision;
    receipt.readerVerified = true;
  }
  await writeFile(`${dir}/MODEL_RECEIPT.json`, JSON.stringify(receipt, null, 2));
  const snapshot = JSON.parse(await readFile("generated-artifacts/owner-call-28oct/snapshot.json", "utf8"));
  const original = JSON.parse(await readFile("generated-artifacts/owner-call-28oct/review/report.json", "utf8"));
  const source = authorizedHintSource(snapshot.call, snapshot.control, snapshot.control.environment);
  assert(source);
  const example = completeLabReport({ ...original, lab_release: labRelease }, source, original.private_report_path.split("/").at(-1));
  const journal = JSON.parse(before.documents.find(d => d.id === "DOC-TALKHINT-IMPROVEMENT-JOURNAL")!.text);
  const prior = await pool.query(`SELECT report FROM (SELECT DISTINCT ON (call_sid) report,call_sid
    FROM call_lab_jobs WHERE owner_id=$1 AND call_sid<>$2 AND environment=$4
    AND report->>'mode'='hint' AND report IS NOT NULL AND coalesce(report->>'synthetic','false')='false'
    AND (report->>'ended_at')::timestamptz < $3::timestamptz ORDER BY call_sid,created_at DESC) previous_calls
    ORDER BY (report->>'ended_at')::timestamptz DESC LIMIT 3`,
  [snapshot.call.user_id, example.call_id, example.ended_at, "development"]);
  example.product_followup = buildProductFollowup(example, source, { status: "available", revision: receipt.appliedRevision ?? before.revision, cases: journal.cases, previous: prior.rows.map(r => r.report) });
  await writeFile(`${dir}/EXAMPLE.json`, JSON.stringify({ ...example, input_lab_release: original.lab_release,
    exampleOnly: true, mailStatus: "NOT_SENT", independentReviewReused: true }, null, 2));
  const letter = renderProcessLetter(example);
  await writeFile(`${dir}/LETTER_EXAMPLE.txt`, "ПРИМЕР НОВОЙ ФОРМЫ. НЕ ОТПРАВЛЕН. Новый AI-разбор не запускался; прежний возврат QA сохранён.\n\n" + letter.subject + "\n\n" + letter.body);
  console.log(JSON.stringify(receipt));
} finally { await pool.end(); }
