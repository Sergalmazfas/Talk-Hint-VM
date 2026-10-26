/**
 * Explicit Dev-only application of the owner's confirmed package-v3 diff.
 * Not startup code, a worker, or a migration. Default is validation only.
 */
import { Pool } from "pg";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import type { WorkNode, WorkLink, OperatingData } from "../shared/operatingModel";
import { unpackModel, activeModelSize } from "../server/projectModel/history";
import { modelSizeBudget } from "../server/projectModel/sizeBudget";
import { readHypothesis, applyHypothesisCommand } from "../server/projectModel/hypotheses";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import type { ProjectModelState } from "../shared/projectModel";

const dir = "generated-artifacts/pbench-v3-review";
const approval = "Сергей явно подтвердил сохранение diff пакета v3 с уточнениями 26.10.2026. Подтверждено описание изменений; не запуск, не приёмка прохода, не покупка и не назначение AI-исполнителя.";
const marker = "PBENCH-V3-OWNER-CONFIRMED";
const roadmapId = "DOC-d4cd67c1-c2ec-4cc1-9dd7-3a4de41ec57d";
const docOrg = "DOC-PORG-OPERATING-PASSPORT";
const expectedRevision = 737;
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const addText = (old: string, text: string) => `${old.trim()}\n\n${text}`.trim();

async function main() {
  const url = process.env.DATABASE_URL;
  assert.ok(url && /^(helium|lithium)$/.test(new URL(url).hostname), "Dev database required");
  const review = JSON.parse(await readFile(`${dir}/TalkHint_PBENCH_v3_diff_rev737.json`, "utf8"));
  const pool = new Pool({ connectionString: url });
  try {
    const rows = (await pool.query(`SELECT owner_key,state,updated_at FROM talkhint_project_models WHERE EXISTS
      (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`)).rows;
    assert.equal(rows.length, 1);
    const { owner_key: owner, state } = rows[0];
    const root = await unpackModel(pool, owner, state);
    // A completed commit must not be repeated if a later artifact/check fails.
    if (root.revision !== expectedRevision) {
      const plan = JSON.parse(await readFile(`${dir}/save-plan.json`, "utf8"));
      assert.equal(root.revision, plan.savedRevision, "Another update exists; reconcile before writing");
      const actual = readHypothesis(root, "new-country");
      const actualOp = actual.operatingModel!.revisions.at(-1)!;
      const beforeSnapshot = JSON.parse(await readFile(`${dir}/current-snapshot.json`, "utf8"));
      assert.equal(actualOp.version, plan.operatingVersion);
      assert.equal(actualOp.data.nodes.filter(n => n.kind === "action" && n.roleId === "benchmark-role-reference").length, 24);
      assert.deepEqual(actual.operatingModel!.revisions.at(-2)!.data.nodes, beforeSnapshot.nodes);
      assert.deepEqual(actual.operatingModel!.revisions.at(-2)!.data.links, beforeSnapshot.links);
      for (const n of plan.newActionIds) assert.ok(actualOp.data.nodes.some(x => x.id === n.id && x.code === n.code && x.roleId === n.roleId));
      assert.equal(actual.analystPreparation!.revisions.at(-1)!.version, plan.preparationVersion);
      assert.ok(actual.documents.find(d => d.id === "DOC-PBENCH-ACTION-RECONCILIATION")!.text.includes(marker));
      assert.ok(actualOp.data.nodes.filter(n => n.kind === "action" && n.roleId === "benchmark-role-reference").every(n => n.acceptorId !== "benchmark-role-reference"));
      await writeFile(`${dir}/save-receipt.json`, JSON.stringify({ ...plan, saved: true, readbackVerified: true,
        recoveredAfterCheck: true, note: "Commit completed once; recovered readback. JSONB property order is not a data change." }, null, 2));
      console.log(JSON.stringify({ savedRevision: root.revision, operatingVersion: actualOp.version, pbenchActions: 24,
        readbackVerified: true, repeatedWrites: 0 }, null, 2));
      return;
    }
    assert.equal(root.revision, expectedRevision, "Source changed; rebuild the approved diff before writing");
    const selected = readHypothesis(root, "new-country");
    const oldOp = selected.operatingModel!.revisions.at(-1)!;
    assert.equal(oldOp.version, 23);
    const data: OperatingData = structuredClone(oldOp.data);
    const index = new Map(data.nodes.map(n => [n.id, n]));
    const codes = new Map(data.nodes.map(n => [n.code, n.id]));
    const id = (code: string) => { const v = codes.get(code); assert.ok(v, `Existing code ${code}`); return v; };
    const get = (code: string) => index.get(id(code))!;
    const benchId = id("P-BENCH"), head = id("HEAD.01"), product = id("P.PRODUCT"), orgHead = id("HEAD.09");
    const bySourceId = (x: string) => { const n = index.get(x); assert.ok(n, x); return n; };
    function link(from: string, to: string, kind: WorkLink["kind"], reason: string) {
      assert.ok(index.has(from) && index.has(to), `Link endpoints ${from} ${to}`);
      const existing = data.links.find(l => l.from === from && l.to === to && l.kind === kind);
      if (existing) { if (!existing.reason.includes(marker)) existing.reason = addText(existing.reason, `${marker}: ${reason}`); return; }
      data.links.push({ id: `LINK-${randomUUID()}`, from, to, kind, reason: `${marker}: ${reason}` });
    }
    const receivingId = (c: string) => codes.get(c) ?? null;
    const outIds = (n: WorkNode) => data.links.filter(l => l.from === n.id && l.kind === "produces").map(l => l.to);
    const defaults = (n: WorkNode) => n.register ?? {
      availability: "Часы и часовой пояс не назначены; описание не дежурство 24/7", period: "Месяц",
      operationsPerPeriod: null, minutesPerOperation: null, estimateBasis: "",
      approval: "discussion" as const, source: "", proposalReason: "",
    };
    const operationalBoundary = `${approval}\nРесурсы/рабочий календарь и часовой пояс не подтверждены. Лимиты платных вызовов не выданы. Оценки времени не являются измерением AI, CPU или стоимости. Паспорта конкурентов ведёт продукт; мобильные тесты выполняет Сергей. Молчание не приёмка.`;
    for (const d of review.existing18ActionDiff) {
      const n = bySourceId(d.id);
      assert.deepEqual(n, d.current, `Approved before-state ${d.code}`);
      const p = d.proposed;
      n.schedule.trigger = p.cadence;
      n.schedule.deadline = p.responseTime && p.responseTime !== "—"
        ? `Стартовый срок ответа: ${p.responseTime}; согласован для описания. Пересмотр 30.11.2026. До передачи указать точку отсчёта, рабочий календарь, дату/время и часовой пояс; без этого автоматическая просрочка не рассчитывается.`
        : "Конкретный срок ответа не задан; до передачи уточнить календарь, точку отсчёта и часовой пояс. Молчание не означает приёмку.";
      n.register = { ...defaults(n), period: "Месяц", operationsPerPeriod: p.operationsPerMonthEstimate,
        minutesPerOperation: p.minutesPerOperationEstimate,
        estimateBasis: "Оценка Claude из пакета v3; Сергей разрешил сохранить с уточнениями. Не измерено. Разовый расход/цикл не равен регулярной нагрузке.",
        approval: "discussion", source: addText(defaults(n).source, marker + ": " + approval),
        proposalReason: "Описаны изменения и оценки; фактическое оснащение/полный паспорт и пробный проход не приняты." };
      n.procedure = addText(n.procedure, `${marker}\nПоказатель: ${p.kpiKey}. Контроль: ${p.controllerText}. Проверка результата следующим шагом: ${p.nextReceivingAction.code || "не указан"}; это не независимая приёмка, если исполнитель совпадает. Внешняя проверка доказательств — MKT.2.12/HEAD.01; достаточность для продукта — PRD.1.2/P.PRODUCT.`);
      n.rules = addText(n.rules, operationalBoundary);
      n.exceptions = addText(n.exceptions, `Согласованное уточнение возврата: ${p.returnCondition || "конкретный вопрос поставщику"}. Получатель фиксирует поле, основание, версию и следующий адресный запрос.`);
      n.questions = addText(n.questions, "Перечень изменений подтверждён владельцем. Не закрыты фактические доступы/оснащение, календарь и часовой пояс, приёмка полного паспорта и прохода. Значения нагрузки — оценочные.");
      if (n.reporting?.templateDocumentId && ["DOC-PBENCH-DAILY-TEMPLATE", "DOC-PBENCH-WEEKLY-TEMPLATE"].includes(n.reporting.templateDocumentId)) {
        n.reporting.templateVersion = "2";
        n.reporting.formStatus = "discussion";
        n.reporting.approvalEvidence = "Сергей подтвердил состав процесса и дополнения; окончательное утверждение формы и приёмка заполненного результата не получены.";
      }
      n.referenceIds = Array.from(new Set([...n.referenceIds, "DOC-PBENCH-ACTION-RECONCILIATION", "DOC-PBENCH-WEEKLY-TEMPLATE"]));
      // Formal acceptance is distinct from the same analyst's next processing step.
      if (n.acceptorId === benchId) {
        data.links = data.links.filter(l => !(l.kind === "acceptance" && [n.id, ...outIds(n)].includes(l.from) && l.to === benchId));
        n.acceptorId = head;
        for (const outputId of outIds(n)) bySourceId(outputId).acceptorId = head;
        link(n.id, id("MKT.2.12"), "acceptance", "Внешний недельный контроль доказательств; внутренний следующий шаг не означает независимую приёмку.");
      }
      const next = receivingId(p.nextReceivingAction.code);
      if (next) {
        link(n.id, next, "handoff", "Парное принимающее действие; получение, внутренний разбор и содержательная приёмка различаются.");
        link(next, n.id, "return", "Вернуть конкретный пробел/вопрос поставщику, не имитировать ответ.");
      }
      link(n.id, id("MKT.2.12"), "accountable_to", "HEAD.01 проверяет доказательства и план-факт еженедельно.");
    }
    const weekly = get("MKT.2.13");
    const outputOf = (code: string) => { const values = outIds(get(code)); assert.ok(values.length, `Output of ${code}`); return values[0]; };
    // Preserve every existing link/history while making the two primary inputs explicit.
    weekly.inputs = ["MKT.2.18", "MKT.2.6"].map(code => ({ name: `${code}: версия журнала/статусов со ссылками на исходные доказательства`,
      sourceId: outputOf(code), freshness: "Тот же отчётный период; версия, дата, источник и ограничения обязательны" }));
    weekly.procedure = addText(weekly.procedure, "Два основных входа: MKT.2.18 и MKT.2.6. Прежние доказательства и ссылки сохраняются, но не являются тридцатью обязательными синхронными входами. Подготовить план-факт, функции/roadmap/отклик, пробелы и предложения продукту.");
    for (const code of ["RM.W.VOC", "RM.W.LING", "RM.W.QUO"])
      get(code).procedure = addText(get(code).procedure, "Общая процедура проверки границ: конкурент/вопрос — параметры. Эта запись остаётся отдельной проверкой конкретного случая со своим ID и свидетельствами; буквальное слияние и удаление не выполняются.");
    for (const code of ["MKT.2.1", "MKT.2.9"]) {
      get(code).procedure = addText(get(code).procedure,
        "Сергей подтвердил состав наблюдения: VocaLingo, AI Phone, AI Call/TaraAI — постоянный; Lingvanex, Guardianly — квартальный. Это состав исследования, не объективный рейтинг близости/качества и не подтверждение всех функций карточек. Quo остаётся адресной находкой по случаю.");
    }
    for (const code of ["MKT.2.7", "MKT.2.8"])
      get(code).procedure = addText(get(code).procedure, "Аналитик сам проверяет комплектность входа. Это не утверждение базы продукта. HEAD.06 готовит исходный паспорт TalkHint; P.PRODUCT отвечает на уточнения и владеет паспортами конкурентов.");

    const makeNode = (nodeId: string, code: string, name: string, kind: WorkNode["kind"], parentId: string | null): WorkNode => ({
      id: nodeId, code, name, kind, parentId, status: "agreed", description: approval, purpose: name,
      clientId: null, roleId: null, executorId: null, recipientId: null, acceptorId: null, nextId: null,
      resourceIds: [], inputs: [], schedule: { days: [], hours: "", timezone: "", trigger: "", deadline: "" },
      procedure: "", rules: operationalBoundary, constraints: "Не запуск и не разрешение расходов; фактическое исполнение/приёмка не подтверждены.",
      success: "", storage: "Существующие документы и работы new-country, версия/ID/источники; не второй каталог.",
      delivery: "Передача через существующую очередь/документы с подтверждением получения; ожидание ответа показывается явно.",
      exceptions: "Недостаточный вход — адресный возврат поставщику. Противоречие — вопрос контролирующему. Расходы/полномочия — Сергей.",
      questions: "Неизвестны календарь/часовой пояс, фактический исполнитель, обеспеченность ресурсами и дата пробного прохождения.",
      resourceState: null, referenceIds: [],
    });
    function insert(n: WorkNode) {
      assert.ok(!index.has(n.id) && !codes.has(n.code), `New stable ID/code ${n.code}`);
      data.nodes.push(n); index.set(n.id, n); codes.set(n.code, n.id); return n;
    }
    function reportFields(template = "DOC-PBENCH-WEEKLY-TEMPLATE", name = "Бенчмаркинг — версия результата и отчётность") {
      return { required: true, formName: name, templateDocumentId: template, templateVersion: "2",
        storage: "Существующие документы/очередь new-country; заполненный результат отдельно от шаблона",
        formStatus: "discussion" as const, approvalEvidence: "Сергей подтвердил содержание процесса и изменения; окончательная форма и факт приёмки результата отдельно." };
    }
    function resultFor(a: WorkNode, recipient: string, acceptor: string) {
      const out = insert(makeNode(`${a.id}-result`, `${a.code}.R`, `Результат: ${a.name}`, "result", a.id));
      Object.assign(out, { clientId: a.clientId, roleId: a.roleId, recipientId: recipient,
        acceptorId: acceptor, nextId: recipient, inputs: [{ name: "Действие-источник и доказательства", sourceId: a.id, freshness: "Версия, дата, автор, период; фактическое выполнение пока отсутствует" }] });
      out.success = "Есть версия и источники, получатель/следующее действие; решение/приёмка только по реальному ответу.";
      link(a.id, out.id, "produces", "Тип выхода действия; узел описывает требование к результату, а не выполненную работу.");
      link(out.id, recipient, "handoff", "Получатель проверяет комплектность; отсутствие ответа не приёмка.");
      link(out.id, acceptor, "acceptance", "Приёмка получателем/контролирующим, не самим автором.");
      return out;
    }
    const newByCode = new Map<string, WorkNode>();
    for (const p of review.sixNewActionProposals) {
      const n = insert(makeNode(p.proposalId, p.proposedCode, p.name, "action", get("MKT.2.11").parentId));
      Object.assign(n, { level: "operation", detailState: "described", workNature: "mixed",
        roleId: benchId, clientId: product, acceptorId: head, recipientId: id(p.receivingAction.code), nextId: id(p.receivingAction.code),
        resourceIds: [...get("MKT.2.11").resourceIds],
        referenceIds: ["DOC-PBENCH-ACTION-RECONCILIATION", "DOC-PBENCH-WEEKLY-TEMPLATE", "DOC-PBENCH-TOOL-READINESS"],
        procedure: `${p.procedure}\n${p.boundary}\nРезультат: ${p.output}\nKPI: ${p.spreadsheetProposal.L}.`,
        purpose: "Дать продукту картину движения функций конкурентов, предполагаемого roadmap и наблюдаемого рыночного отклика.",
        success: `${p.acceptance} Получение, приёмка и продуктовое решение различаются.`,
        reporting: reportFields(),
      });
      n.inputs = [{ name: `База и поставщик ${p.overlapWith.code}; уточнения — адресно`,
        sourceId: p.overlapWith.id, freshness: "Актуальная версия, дата/период; альтернативные входы по применимости" },
        { name: "HEAD.06/P.PRODUCT: актуальное описание, критерии и вопрос решения", sourceId: id("PRD.1.9"),
          freshness: "Статус базы и её ограничения явно указаны" }];
      n.schedule.trigger = p.cadence;
      n.schedule.deadline = `Стартовый срок ответа: ${p.responseTime || "не задан"}; пересмотр 30.11.2026. Рабочий календарь, точку отсчёта и часовой пояс уточнить для работы.`;
      n.register = { ...defaults(n), period: p.sourceCode === "NEW-6" ? "Разово" : "Месяц",
        operationsPerPeriod: p.workload.operations, minutesPerOperation: p.workload.minutesEach,
        estimateBasis: "Оценка Claude из пакета v3, не измерение и не финансовый бюджет.",
        approval: "discussion", source: marker + ": " + approval, proposalReason: "Дополнение к сохранённым действиям для требуемого отчёта." };
      n.exceptions = addText(n.exceptions, p.returnCondition);
      if (p.sourceCode === "NEW-6") {
        n.acceptorId = id("HEAD.08"); n.clientId = orgHead;
        n.procedure = addText(n.procedure, "P-BENCH — исследование пригодности; P.FIN — экономическая оценка, P.LG.TECH — доступ и совместимость; HEAD.08 проверяет стоимость. Итог адресуется HEAD.09/ORG.REG.2; расходы решает Сергей.");
      }
      newByCode.set(n.code, n);
    }
    for (const p of review.sixNewActionProposals) {
      const n = newByCode.get(p.proposedCode)!;
      const r = resultFor(n, n.recipientId!, n.acceptorId!);
      const receiver = bySourceId(n.recipientId!);
      receiver.inputs.push({ name: `${n.code}: пакет/версия и вопрос приёмки`, sourceId: r.id,
        freshness: "По событию или отчётному периоду; не ждать неприменимый вход" });
      receiver.procedure = addText(receiver.procedure, `При поступлении ${n.code}: проверить достаточность/сопоставимость, подтвердить получение либо вернуть конкретный вопрос ${n.code}. Содержательное решение/расходы не имитировать.`);
      link(n.id, id("MKT.2.12"), "accountable_to", "HEAD.01 контролирует доказательства и полноту; методическая/финансовая проверка не разрешает расходы.");
      link(n.id, receiver.id, "depends_on", "Обработка пакета получателем — отдельный этап, не выполненный этим сохранением.");
      link(receiver.id, n.id, "return", "Адресное уточнение с основанием и версией.");
    }
    get("MKT.2.19").procedure = addText(get("MKT.2.19").procedure, "Получить вопросы/черновик MKT.2.24, уточнить сценарий и запрашиваемые материалы; Сергей выполняет мобильный тест после отдельного разрешения расходов; продукт принимает и обновляет тот же паспорт.");
    get("PRD.1.5").procedure = addText(get("PRD.1.5").procedure,
      "После предметного предложения изменения получить инженерную оценку до фиксации сроков roadmap: ENG.CHIEF.1–3 → ENG.CHIEF.9. Сроки, объём, зависимости, риски и ресурсы — оценка, не обещание выпуска. P.LG.TECH подтверждает соответствие текущей реализации. Если инженерная оценка неприменима, записать основание.");
    const techOut = outputOf("PRD.1.5");
    get("ENG.CHIEF.1").inputs.push({ name: "Запрос продукта об оценке предложения и сроков", sourceId: techOut,
      freshness: "Версия предложения и точный вопрос, не разрешение внедрения" });
    link(techOut, id("ENG.CHIEF.1"), "handoff", "Главный инженер получает запрос оценки; приёмка решения и запуск работ отдельно.");
    link(id("ENG.CHIEF.9"), id("PRD.1.5"), "feedback", "Продукт получает инженерные основания перед обновлением плановых сроков.");

    const orgRole = insert(makeNode(review.methodologist.role.proposalId, "P.ORG", "Методолог операционной модели", "role", id("T09")));
    orgRole.managerId = orgHead; orgRole.clientId = orgHead; orgRole.acceptorId = orgHead;
    orgRole.purpose = review.methodologist.role.purpose;
    orgRole.procedure = "Вести цикл изменений существующих ролей по ID: запрос → влияние → diff → реальное согласование → сверка внесения → JSON → разрешённый пробный проход → разбор → доказанные состояния → материал отчёта HEAD.09.\nHEAD.09 отвечает за стандарт/оснащение/доступы; P.COORD ведёт случаи, передачи, блокеры и общий отчёт. Методолог не заменяет эти роли.";
    orgRole.constraints = "Не меняет модель, полномочия, расходы и продуктовые решения самостоятельно. Replit вносит согласованное. Claude/ChatGPT — возможный ручной способ подготовки, не назначенный сотрудник. Нельзя принимать свои проходы за руководителя.";
    orgRole.resourceIds = ["model-resource", "management-resource-tools"].filter(x => index.has(x));
    orgRole.referenceIds = [docOrg];
    orgRole.success = "Каждое состояние роли связано с версией описания, реальным протоколом, фактическим согласованием и ресурсными доказательствами; нет второй базы.";
    orgRole.questions = "Темп одна роль в неделю, порядок обхода и фактический исполнитель не утверждены. Приоритет текущей работы — завершить P-BENCH, а не запускать автоматизацию.";
    const orgActions: WorkNode[] = [];
    for (const p of review.methodologist.tenProposedActions) {
      const r = p.sourceProposal;
      const n = insert(makeNode(p.proposalId, p.proposedCode, p.name, "action", id("ORG.1")));
      Object.assign(n, { level: "operation", detailState: "described", workNature: "mixed", roleId: orgRole.id,
        clientId: orgHead, acceptorId: orgHead, resourceIds: [...orgRole.resourceIds],
        referenceIds: [docOrg], procedure: `${p.responsibilityBoundary}\nВход: ${r.D}; поставщик: ${r.E}.\nРабота: ${r.B}.\nВыход: ${r.F}. KPI: ${r.K}.`,
        success: r.O, reporting: { ...reportFields(docOrg, "Методолог — цикл изменения и проверки должности"), templateVersion: "1" } });
      // Actual approval is a manager action, not the methodologist deciding for them.
      if (n.code === "ORG.CYC.4") { n.roleId = orgHead; n.acceptorId = "owner"; n.clientId = orgRole.id; }
      n.schedule.trigger = r.C;
      n.schedule.deadline = `${r.N}. Это стартовый срок ответа/разбора; дата/календарь/часовой пояс задаются при передаче. Автоматическое расписание не включено.`;
      n.register = { ...defaults(n), period: "Месяц", operationsPerPeriod: Number(r.H), minutesPerOperation: Number(r.I),
        estimateBasis: "Оценка Claude; 32,2475 часа относится ко всему циклу, включая 2 часа действия согласующего руководителя, а не только методологу.",
        approval: "discussion", source: marker + ": " + approval, proposalReason: "Подтверждено описание цикла; оснащение/исполнитель/темп обхода не подтверждены." };
      n.exceptions = addText(n.exceptions, r.P || "Неполный вход — адресный запрос поставщику.");
      orgActions.push(n);
    }
    for (let i = 0; i < orgActions.length; i++) {
      const n = orgActions[i];
      const next = orgActions[i + 1]?.id ?? id("T09.REPORT.WEEK");
      n.nextId = next; n.recipientId = next;
      const r = resultFor(n, next, n.acceptorId!);
      if (i) n.inputs.push({ name: "Версия результата предыдущего шага цикла", sourceId: `${orgActions[i - 1].id}-result`, freshness: "Тот же запрос/роль/версия; реальный автор и дата" });
      else n.inputs.push({ name: "Запрос изменения/отзыв/протокол; поставщик HEAD.09, P.COORD или поддержка", sourceId: id("ORG.REG.1"), freshness: "Источник, дата, должность и причина; дубликаты связать" });
      link(n.id, orgHead, "accountable_to", "Контроль стандарта HEAD.09; граница полномочий и спор — Сергей.");
      if (i < orgActions.length - 1) {
        link(n.id, next, "handoff", "Следующий шаг проверяет свой вход; это не независимая приёмка тем же исполнителем.");
        link(next, n.id, "return", "Адресный возврат по конкретному полю/доказательству.");
      }
      if (n.code === "ORG.CYC.8") {
        link(n.id, id("ORG.CYC.4"), "acceptance", "Методолог предлагает вывод; HEAD.09 организует/фиксирует реальную приёмку соответствующим руководителем, не принимает за него.");
        link(r.id, id("ORG.CYC.1"), "feedback", "Незакрытые пробелы становятся адресными запросами; не бесконечными отчётами о чтении.");
      }
    }
    get("T09.REPORT.WEEK").inputs.push({ name: "План-факт методического цикла и состояния ролей", sourceId: `${id("ORG.CYC.10")}-result`, freshness: "Недельный период; версия роли, протокол и доказательства; отсутствие не выдавать за готовность" });
    get("T09.REPORT.WEEK").procedure = addText(get("T09.REPORT.WEEK").procedure, "Получить ORG.CYC.10, проверить основания состояний и вернуть пробелы методологу; включить только реально подтверждённые результаты. Передача общего отчёта остаётся P.COORD.");
    get("P.COORD").procedure = addText(get("P.COORD").procedure, "P.ORG ведёт методику и доказательства изменения ролей; координатор сохраняет контекст работ, передачи, блокеры и сводный отчёт. Не дублировать каталог должностей.");
    get("HEAD.09").procedure = addText(get("HEAD.09").procedure, "Руководить описанием методического цикла P.ORG; сохранить ORG.REG.1–3 как контроль обязанностей/оснащения/доступов, не подменять ими реальное исполнение прохода. Не объявлять все роли готовыми.");
    get("P-BENCH").procedure = addText(get("P-BENCH").procedure, `${marker}: 18 прежних действий сохранены; добавлены MKT.2.20–25. Основной результат — движение функций, предполагаемый roadmap, рыночный отклик и предметные предложения продукту. Постоянный состав: VocaLingo, AI Phone, TaraAI; Lingvanex/Guardianly — квартально. Приёмка полного паспорта и прохода не получена.`);
    get("P-BENCH").referenceIds = Array.from(new Set([...get("P-BENCH").referenceIds, "DOC-PBENCH-WEEKLY-TEMPLATE", docOrg]));
    orgRole.procedure = addText(orgRole.procedure, "Действия методолога: " + orgActions.filter(n => n.roleId === orgRole.id).map(n => n.code).join(", ") + ". ORG.CYC.4 выполняет руководитель HEAD.09, а не методолог.");
    const acceptedDescription = `\n\n## ${marker} · сохранённое решение владельца
${approval}
18 прежних ID P-BENCH сохранены, шесть дополнений MKT.2.20–25 связаны с результатами и принимающими действиями.
Постоянно VocaLingo, AI Phone, AI Call/TaraAI; квартально Lingvanex/Guardianly. Quo — отдельная находка по случаю.
Два основных входа недельного отчёта: MKT.2.18 и MKT.2.6, исходные доказательства не удалены.
Проверка следующим шагом и внешняя приёмка разделены; HEAD.01 контролирует еженедельно.
VOC/LING/QUO используют общую процедуру, но все три ID и свидетельства случая сохраняются.
Мобильные тесты — Сергей; продукт организует/принимает MKT.2.19; аналитик передаёт вопросы MKT.2.24.
Сроки таблицы — стартовые сроки ответа, пересмотр 30.11.2026; календарь и часовой пояс уточняются до передачи.
Оценки труда не измерены; оснащение/исполнитель/проход не подтверждены. Не применять status=готово ко всем ролям.
P.ORG под HEAD.09: девять исполнительных действий; ORG.CYC.4 — десятое действие цикла у HEAD.09. P.COORD сохраняет координацию и общий отчёт.
Темп обхода/экземпляр AI остаются открытыми. Нет разрешения запуска или расходов.
`;
    const reportSpec = {
      ...review.reportProposal,
      sourceSpecUnchanged: undefined,
      status: "content_confirmed_forms_discussion",
      confirmedBy: "Сергей", confirmation: approval, version: 2,
      selection: { core: ["VocaLingo", "AI Phone", "AI Call / TaraAI"], quarterly: ["Lingvanex", "Guardianly"], caseOnly: ["Quo"] },
      actionCodes: review.sixNewActionProposals.map((p: any) => ({ action: p.proposedCode, sections: p.reportSections, role: "P-BENCH" })),
      monthlyPreparation: ["MKT.2.22", "MKT.2.15", "MKT.2.16", "MKT.2.17", "CTL.1.1"],
      quarterlyPreparation: ["MKT.2.23", "MKT.2.1", "MKT.2.9"],
      ownerTests: { action: "MKT.2.19", questionsFrom: "MKT.2.24", executor: "Сергей", actualResultsAdded: false },
      workloadEstimate: review.workload,
      targetsApproved: false,
    };
    const documents = selected.documents;
    const document = (x: string) => { const d = documents.find(d => d.id === x); assert.ok(d, x); return d; };
    const orgText = `# Методолог операционной модели · паспорт v1\nСтатус: описание роли и цикла подтверждено Сергеем; оснащение, исполнитель, испытание и приёмка результата не подтверждены.\n${approval}\n\nКлиент: HEAD.09 и руководители направлений; польза конечному пользователю — полнота ответственности за проверяемый результат TalkHint, а не документы ради документов.\nПотребность: пригодные для работы роли с источниками входов, результатами, клиентами, ресурсами, контролем и обратной связью.\nОбещание: версионный diff, проверка сохранения, полный JSON и протокол с честными пробелами.\nРуководитель: HEAD.09. P.COORD сохраняет общий контекст и сведение отчётности. ORG.REG.1–3 остаются у HEAD.09.\nПолномочия: подготовить/проверить/передать; не разрешать расходы, не утверждать свои испытания и решения других руководителей. Запись через согласованную работу Replit; молчание не приёмка.\nРесурсы: чтение модели, документы/JSON, методика проверки, разрешённое чтение сайтов. Подключение и лимиты исполнителя не подтверждены.\n\n## Десять действий цикла\n${orgActions.map(n => `${n.code}: ${n.name}\nИсполнительная должность: ${bySourceId(n.roleId!).code}; клиент: ${bySourceId(n.clientId!).code}; контролирующий HEAD.09, граница Сергей.\n${n.procedure}\nПриёмка: ${n.success}\nСрок: ${n.schedule.deadline}\nВозврат: ${n.exceptions}`).join("\n\n")}\n\n## Бланк записи цикла · на обсуждении\nРоль/ID | источник запроса | исходная rev | было/стало | основания | затронутые действия/потребители | решение/автор/дата | новая rev/сверка | JSON/хеш | обычный/неполный вход | протокол/доказательства | приёмка/возврат | блокер/поставщик | следующий шаг.\n## Бланк недели · на обсуждении\nПлан ролей/изменений → факт → расхождения → причина/гипотеза → мера/ответственный/срок; версии/протоколы/основания состояний → HEAD.09/T09.REPORT.WEEK → P.COORD/общий отчёт.\n## Состояния\nОписание, согласование, оснащение, пробный проход и его приёмка, исполнитель — отдельные измерения. Непринятый проход не означает принятую готовность. Критические пробелы блокируют соответствующий сценарий; некритические ограничения указывать явно.\n## KPI без нормативов\nДоля ролей с принятым проходом = уникальные роли с реальной приёмкой протокола / роли согласованного плана; версия/сценарий указываются. Время цикла = медиана от регистрации до проверенного JSON; ожидание отдельно. Точность = изменения без расхождений / проверенные изменения. Повторные пробелы = повторно обнаруженные после заявленного исправления / проверенные пробелы. Нулевой/неизвестный знаменатель = нет данных.\n## Открыто\nПорядок/темп обхода, конкретный AI-исполнитель, ресурсы/доступы, календарь и часовой пояс. Claude в чате не назначен этим паспортом. Оценка цикла 32,2475 ч включает 2 ч руководителя; не стоимость/загрузка AI.\n`;
    let next = root;
    const actor = "Replit · вручную по подтверждению Сергея, Dev";
    const saveDoc = (docId: string, title: string, text: string, existing = true) => {
      assert.ok(text.length <= 50000, `Document size ${docId}: ${text.length}`);
      const old = existing ? document(docId) : null;
      next = applyHypothesisCommand(next, "new-country", { type: existing ? "saveDocument" : "createDocument",
        id: docId, title, text, url: old?.url ?? "/admin/project-model?hypothesis=new-country&section=Процессы%20и%20Crew&workView=team",
        elementIds: old?.elementIds ?? ["TH-PRODUCT"] }, actor);
    };
    saveDoc(docOrg, "Методолог операционной модели P.ORG — паспорт v1 — описание подтверждено, не запущен", orgText, false);
    saveDoc("DOC-PBENCH-WEEKLY-TEMPLATE", "P-BENCH — недельный план-факт, месячная и квартальная отчётность — v2 — формы на обсуждении",
      document("DOC-PBENCH-WEEKLY-TEMPLATE").text.replace(/· v1/g, "· v2") + acceptedDescription +
      "\n## Спецификация отчётности v2\n<!-- PBENCH-REPORT-SPEC-V2 -->\n" + JSON.stringify(reportSpec, null, 2));
    saveDoc("DOC-PBENCH-DAILY-TEMPLATE", "P-BENCH — ежедневный журнал — бланк v2 — на обсуждении",
      document("DOC-PBENCH-DAILY-TEMPLATE").text.replace(/· v1/g, "· v2") + acceptedDescription +
      "\nДополнение к записи: направление предполагаемого roadmap, изменение функции и наблюдаемый рыночный отклик; публичное/гипотеза отдельно; вопрос инженерам и фактический ответ при наличии. Сохранять ссылки для двух основных входов недельного отчёта.");
    saveDoc("DOC-PBENCH-ACTION-RECONCILIATION", "P-BENCH — сверка обязанностей и 18+6 действий — v3 — изменения подтверждены",
      document("DOC-PBENCH-ACTION-RECONCILIATION").text + acceptedDescription +
      "\n## Шесть дополнений\n" + review.sixNewActionProposals.map((p: any) => `${p.proposedCode} [${p.proposalId}] — ${p.name}; ${p.boundary}; принимает ${p.receivingAction.code}.`).join("\n") +
      "\n## 18 существующих строк — сохранённые оценки и сроки\n" + review.existing18ActionDiff.map((d: any) => `${d.code} [${d.id}]: ${d.proposed.cadence}; ${d.proposed.operationsPerMonthEstimate} операций/месяц × ${d.proposed.minutesPerOperationEstimate} мин; KPI ${d.proposed.kpiKey}; ответ ${d.proposed.responseTime}; возврат ${d.proposed.returnCondition}.`).join("\n"));
    saveDoc(roadmapId, "TalkHint — единый roadmap — v17 — P-BENCH и методический цикл описания ролей",
      document(roadmapId).text.replace(/^# TalkHint — единый roadmap, v10/, "# TalkHint — единый roadmap, v17") + acceptedDescription +
      "\n## Текущий этап v17\nСначала полное описание структуры, затем отдельный будущий этап подключения исполнителей. Сейчас сохранены уточнения P-BENCH и описание методического цикла P.ORG. Это не завершение оснащения или принятого прохода.\nСледующий конкретный шаг: получить полный JSON P-BENCH v2, вручную выполнить обычный сценарий и сценарий с недостающим входом, вернуть протокол с доказательствами. Продукт/руководитель принимает по реальному ответу. После разбора — следующий незакрытый вход/должность, не автоматический массовый запуск.\nУсловие готовности: все шаги имеют реальный исход/блокер/поставщика, источники и версии, передача и настоящий ответ получателя либо явное ожидание. KPI без знаменателя не рассчитаны. Формы, календарь, инструменты и полный паспорт сохраняют свои статусы; срок выпуска продукта не выдуман.");
    const prep = selected.analystPreparation!.revisions.at(-1)!;
    const prepData = structuredClone(prep.data);
    prepData.passport.purpose = addText(prepData.passport.purpose, "Основной полезный результат: движение функций конкурентов, предполагаемый roadmap и рыночный отклик для решений продукта.");
    prepData.passport.duties = addText(prepData.passport.duties, acceptedDescription);
    prepData.passport.frequency = addText(prepData.passport.frequency, "День → неделя → месяц → квартал. Частоты и стартовые сроки ответа — в 24 действиях; календарь/часовой пояс уточняются. Это не включённое расписание.");
    prepData.passport.outputs = addText(prepData.passport.outputs, "Материалы месяца MKT.2.22, квартал MKT.2.23, тестовые вопросы MKT.2.24, предложение источников MKT.2.25. Доли и темпы роста помесячно только на сопоставимых данных; рост после релиза не причинность.");
    prepData.passport.quality = addText(prepData.passport.quality, "Следующий шаг проверяет комплектность, HEAD.01 выполняет внешний контроль. Источники, период, платформа, статус и знаменатель обязательны. Публичный roadmap и гипотеза различаются; неизвестное не отсутствие.");
    prepData.passport.handoff = addText(prepData.passport.handoff, "PRD.1.5 → ENG.CHIEF.1–3/9: оценка сроков/ресурсов перед уточнением roadmap. Мобильные тесты MKT.2.19 — Сергей, продукт принимает; фактических ответов/приёмки этим изменением не создаётся.");
    prepData.approvalNotes = addText(prepData.approvalNotes, approval + " Полная операционная готовность и бюджет не утверждены. Критерий принятия протокола требует фактического ответа. Источники подготовки остаются pending, это не отмена утверждённого состава наблюдения.");
    next = applyHypothesisCommand(next, "new-country", { type: "saveAnalystPreparation", baseVersion: prep.version, preparation: prepData }, actor);
    next = applyHypothesisCommand(next, "new-country", { type: "saveOperatingModel", baseVersion: oldOp.version, data }, actor);
    const updated = readHypothesis(next, "new-country");
    const op = updated.operatingModel!.revisions.at(-1)!;
    assert.equal(op.data.nodes.filter(n => n.kind === "action" && n.roleId === benchId).length, 24);
    assert.equal(op.data.nodes.filter(n => n.kind === "action" && n.roleId === orgRole.id).length, 9);
    assert.equal(updated.operatingModel!.revisions.length, selected.operatingModel!.revisions.length + 1);
    assert.deepEqual(updated.operatingModel!.revisions.slice(0, -1), selected.operatingModel!.revisions);
    for (const k of ["competitorDirectory", "elements", "proposals", "relations", "taskDrafts"] as const)
      assert.deepEqual(updated[k], selected[k], `Preserve ${k}, no invented execution/replies`);
    const originalPart = (v: ProjectModelState) => { const { alternatives, revision, ...original } = v; return original; };
    assert.deepEqual(originalPart(next), originalPart(root), "Original hypothesis unchanged");
    assert.equal(activeModelSize(next) <= modelSizeBudget(next), true);
    for (const d of review.existing18ActionDiff) assert.ok(op.data.nodes.some(n => n.id === d.id));
    assert.ok(op.data.nodes.filter(n => n.kind === "action" && n.roleId === benchId).every(n => n.acceptorId !== benchId));
    for (const n of newByCode.values()) {
      assert.ok(data.links.some(l => l.from === n.id && l.kind === "produces"));
      assert.ok(data.links.some(l => l.to === n.id && l.kind === "return"));
    }
    await mkdir(dir, { recursive: true });
    const summary = {
      marker, approvedBy: "Сергей", approval, sourceRevision: root.revision, savedRevision: next.revision,
      operatingVersion: op.version, preparationVersion: updated.analystPreparation!.revisions.at(-1)!.version,
      roles: op.data.nodes.filter(n => n.kind === "role").length,
      actions: op.data.nodes.filter(n => n.kind === "action").length,
      pbenchActions: 24, methodologistActions: 9, managerCycleAction: "ORG.CYC.4",
      newActionIds: [...newByCode.values(), ...orgActions].map(n => ({ id: n.id, code: n.code, roleId: n.roleId })),
      roleId: orgRole.id, updatedDocumentIds: [docOrg, "DOC-PBENCH-WEEKLY-TEMPLATE", "DOC-PBENCH-DAILY-TEMPLATE", "DOC-PBENCH-ACTION-RECONCILIATION", roadmapId],
      noRuntimeChanges: true, trialsRun: false, allPreviousNodeIdsPreserved: data.nodes.length > oldOp.data.nodes.length && oldOp.data.nodes.every(n => index.has(n.id)),
      historyPreserved: true, originalHypothesisUnchanged: true,
      currentStateBytes: activeModelSize(next), budget: modelSizeBudget(next),
      opHash: hash(op), protectedDataUnchanged: true,
    };
    await writeFile(`${dir}/save-plan.json`, JSON.stringify(summary, null, 2));
    if (!process.argv.includes("--apply")) { console.log(JSON.stringify({ ...summary, mode: "validated_not_written" }, null, 2)); return; }
    const saved = await persistModelUpdate(pool, owner, before => {
      assert.equal(before.revision, expectedRevision, "Concurrent update");
      assert.ok(isDeepStrictEqual(before, root), "Before-state mismatch");
      return next;
    }, true);
    const actual = readHypothesis(saved, "new-country");
    assert.deepEqual(actual.operatingModel!.revisions.at(-1), op);
    assert.equal(saved.revision, summary.savedRevision);
    await writeFile(`${dir}/save-receipt.json`, JSON.stringify({ ...summary, saved: true, readbackVerified: true }, null, 2));
    console.log(JSON.stringify({ ...summary, mode: "saved_and_readback_verified" }, null, 2));
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
