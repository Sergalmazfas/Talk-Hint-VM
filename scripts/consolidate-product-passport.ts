/**
 * Bounded, manually invoked Dev documentation operation, not application startup.
 * Default: prepare/validate export. --save: archive and save existing documents.
 */
import { Pool } from "pg";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { unpackModel, activeModelSize } from "../server/projectModel/history";
import { modelSizeBudget } from "../server/projectModel/sizeBudget";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { readHypothesis, applyHypothesisCommand } from "../server/projectModel/hypotheses";
import { readProductBook, productBookText, productBookDocumentId } from "../shared/productBook";
import { engineeringFacts } from "../server/projectModel/research/engineeringAuditSpec";
import type { ModelCommand } from "../shared/projectModel";

const techId = "DOC-TALKHINT-TECHNICAL-PASSPORT";
const roadmapId = "DOC-d4cd67c1-c2ec-4cc1-9dd7-3a4de41ec57d";
const marker = "PRODUCT-PASSPORT-CONSOLIDATION-2026-10-26";
const sourceMaterial = "attached_assets/Pasted--TalkHint-Xcode-iPhone-Hint-Translator-Copilo-179303719_1793037191265.txt";
const outDir = "generated-artifacts/product-passport";
const digest = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const checkedAt = new Date().toISOString();
const actor = "Replit · ручная сборка паспорта по поручению Сергея, Dev";
const caveat = "Чтение исходников/конфигурации, не испытание на устройстве и не подтверждение пользовательской приёмки.";
const paths = [
  "ios/project.yml", "ios/README.md", "ios/TalkHint/App/SceneDelegate.swift", "ios/TalkHint/UI/Theme.swift",
  "ios/TalkHint/UI/TranslatorViewController.swift", "ios/TalkHint/UI/CopilotViewController.swift",
  "ios/TalkHint/UI/SecretaryViewController.swift", "ios/TalkHint/UI/CallHistoryViewController.swift",
  "ios/TalkHint/UI/TutorViewController.swift", "apps/secretary-mobile/README.md",
  "apps/secretary-mobile/app.json", "apps/secretary-mobile/eas.json", "apps/secretary-mobile/src/config.ts",
  "apps/secretary-mobile/src/navigation.tsx", "apps/secretary-mobile/src/screens/PrepareScreen.tsx",
  "server/mobileSecretary/routes.ts", "server/mobileSecretary/live.ts", "server/mobileSecretary/store.ts",
  "server/secretary/retellPhone.ts", "server/secretary/conversationEngine.ts", "server/secretary/voice.ts",
  "server/secretaryLab/RETELL-ENGINE.md", "server/routes.ts", "shared/schema.ts",
  "docs/roadmap/mobile-production-handoff.md", "server/publicSite.ts", "talkhint/public-site/app.js",
  "talkhint/public-site/index.html", "server/productCrew/service.ts", "client/src/components/project-model/ProductBookView.tsx",
  "client/src/components/project-model/ProductBookView.css", "docs/secretary-retell-phone.md",
  "docs/talkhint-chatgpt-card-recovery.md",
];
async function main() {
  assert.match(new URL(process.env.DATABASE_URL!).hostname, /^(helium|lithium)$/);
  const sourceIndex = await Promise.all(paths.map(async path => {
    const bytes = await readFile(path);
    return { path, sha256: digest(bytes), scope: caveat };
  }));
  const sourceText = await readFile(sourceMaterial, "utf8");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const q = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
      (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
    assert.equal(q.rows.length, 1, "Existing unique model required");
    const owner = q.rows[0].owner_key;
    const before = await unpackModel(pool, owner, q.rows[0].state);
    const selected = readHypothesis(before, "new-country");
    const document = (id: string) => {
      const found = selected.documents.find(d => d.id === id); assert.ok(found, id); return found;
    };
    assert.ok(!document(techId).text.includes(marker), "Already applied; read the existing result, do not repeat");
    const book = readProductBook(document(productBookDocumentId))!;
    assert.ok(book?.version >= 3);
    const oldBookVersion = book.version;
    const oldFeatureIds = book.features.map(f => f.id);
    const currentOp = selected.operatingModel!.revisions.at(-1)!;
    const operating = structuredClone(currentOp.data);
    const directions = operating.nodes.filter(n => n.level === "direction" && /^T\d\d$/.test(n.code));
    assert.equal(directions.length, 10, "Ten existing directions required");
    const teamReferences = operating.nodes.filter(n => n.kind === "role" || directions.some(d => d.id === n.id));
    for (const node of teamReferences)
      node.referenceIds = Array.from(new Set([...node.referenceIds, productBookDocumentId, techId]));
    const deptResponsibilities = [
      ["T01", "HEAD.01", "Сегменты, функции/планы конкурентов, заявления/тесты, дата/источник и неизвестное → P.PRODUCT; не обновлять паспорт конкурента за продукт."],
      ["T02", "HEAD.02", "Проверить аудиторию/обещания/каналы по текущему паспорту; не рекламировать запланированное как доступное."],
      ["T03", "HEAD.03", "Сценарий регистрации/покупки/первой пользы и ограничения; запросить принятую цену у финансов/продукта."],
      ["T04", "HEAD.04", "Поручение/звонок/результат: фактический сценарий, платформа, качество и затраты; передать продукту ограничения."],
      ["T05", "HEAD.05", "Обращения, ошибки, отмены/удержание; свидетельство и обратная связь → продукт/техника; не выдавать один случай за рынок."],
      ["T06", "HEAD.06", "Владелец содержания книги; P.PRODUCT сводит вклад, различает текущее/план и принимает достаточность; дизайн даёт карту экранов/состояний."],
      ["T07", "HEAD.07", "Код/архитектура/backend/frontend/mobile/QA/эксплуатация; сборки и доказательства, реализация против испытания; Replit выполняет эту сборку вручную."],
      ["T08", "HEAD.08", "Себестоимость сценария/тариф/лимиты, валюта и допущения; поставщик тарифов не утверждает цену TalkHint."],
      ["T09", "HEAD.09", "Ресурсы и доступы должностей, действительность инструкций; роль/исполнитель/запуск отдельно; P.ORG не принимает продукт за продукт."],
      ["T10", "HEAD.10", "Сверка полноты/противоречий/приёмки и отчёт руководству; неизвестное не выполнено, молчание не согласование."],
    ].map(([code, headCode, contribution]) => {
      const direction = directions.find(n => n.code === code)!;
      const head = operating.nodes.find(n => n.code === headCode); assert.ok(head, headCode);
      return { directionId: direction.id, code, name: direction.name, headRoleId: head.id, contribution,
        status: "Описанная ответственность; новый ответ, согласование или автономное исполнение не создавались" };
    });
    const edition = Number(/— v(\d+)/.exec(document(roadmapId).title)?.[1] ?? 17) + 1;
    const assemblyNote = `\n\n## ${marker}\nСборка текущего паспорта: ${checkedAt}; исходное подтверждение владельца 25.10.2026 не заменено. Источник: ${sourceMaterial}, SHA-256 ${digest(sourceText)}.
Продукт «В разработке», документ «На согласовании». Вложенный текст — входящий материал; неподтверждённые утверждения не становятся результатами теста.
### Состав и связи
Swift iOS: ios/project.yml — конфигурация 1.0.0(1), iOS 15.0+, не версия установленного приложения. SceneDelegate.swift:77–111 — пять вкладок Hint/Translator/Copilot/Secretary/History.
Отдельный Secretary-клиент: apps/secretary-mobile, Expo 0.1.0 (настройки исходников), iOS/Android/web; Secretary → Prepare/бриф → явное подтверждение, Cards/History/Settings. README не подтверждает нативную установку. Конкретная Samsung/iPhone-сборка неизвестна.
Клиентский origin выбирается конфигурацией/входом; README и docs/roadmap/mobile-production-handoff.md указывают talkhint.app. Документированный origin не гарантирует настройки установленной копии.
Retell+Engine: server/secretary/retellPhone.ts:24–34 ведёт Custom LLM WebSocket в /retell-phone-engine на origin TalkHint; server/secretary/conversationEngine.ts — рассуждение OpenAI, Retell — голосовой транспорт. Отдельный сервер Engine из этих исходников не следует. Retell — внешний провайдер, не наш второй сервер.
Метаданные publishing проверены 26.10: https://talkhint.app, Reserved VM, успешный build, публичный вход. GET /api/mobile-secretary/me → 401 «Mobile client sign-in required»; это только наличие защищённого маршрута, не проверка клиента/звонка. Учётные записи и production-данные не читались.
Исторический внешний Tutor Engine отключён (replit.md, server/tutorConnectionPolicy.ts); он не Secretary Engine. Иной сервер/отдельный репозиторий из сообщения владельца не идентифицирован: нужен адрес/название и read-only выгрузка его владельца, без ключей.
### Дизайн, функции, доступность
Карта Swift — SceneDelegate; стиль — ios/TalkHint/UI/Theme.swift. Expo — src/navigation.tsx и src/screens; веб книги — ProductBookView.tsx/.css. Это инвентаризация исходников, не просмотр всех экранов/состояний на устройстве.
«Скрытый аватар 2.5D с губами» — утверждение во вложении, не подтверждено этой ревизией. Найден исторический TutorViewController с web 3D; не приравнивать его к аватару Кати.
Переводчик/Copilot/Катя подтверждены владельцем ранее. Номера, входящие, языки, SMS/MMS, ChatGPT-итог — по матрице выше, не универсально приняты. Expo умеет подготовку с уточнением по исходникам; это не единый чат почты/задач. Календарь: подключение/выбор описаны; booking недоступен в README.
### Данные и правовая часть
shared/schema.ts: задачи/звонки/транскрипты/попытки, контакты/карточки/назначения номеров; mobileSecretary/store.ts: scoped sessions/reviews/TEST. SecureStore native и sessionStorage web описаны клиентом. Срок технического review не срок хранения звонков.
Retell-конфигурация basic_attributes_only не доказывает все договорные гарантии хранения/удаления. Право записи, сообщения, идентификация отправителя, OAuth и разрешение календаря — отдельные основания.
Найдены /privacy и /terms: server/publicSite.ts и talkhint/public-site/app.js. Наличие страниц не правовая приёмка. Версии B2C/B2B, территории, согласия, удаление, обработчики/передачи требуют PB-GAP-LEGAL и ENG-REQ-CHANNELS. Судебные материалы/выводы этой ревизией не исследованы; практика конкурентов — не правовое основание. AI-роль не лицензированный юрист.
### Закрытие сборки
Каждое направление читает тот же паспорт по referenceIds. HEAD.06/P.PRODUCT сводят; техника/QA подтверждают свою область, финансы — стоимость, правовая роль — основания/вопросы, дизайн — экраны/состояния, бенчмарк — датированные источники. Ответа этих ролей не имитируем.
Открыто: фактические установленная сборка и API origin обоих клиентов; доступ/идентичность иного сервера; device-протоколы; аватар; тексты/правовая приёмка; тариф/лимиты/себестоимость; полный пользовательский маршрут. Сроки не назначены.
Полный технический JSON и читаемая сводка — датированный экспорт этой редакции, не второй каталог. Новые функции/экраны/звонки/платные вызовы/публикация не выполнялись.
`;
    const technicalText = document(techId).text + assemblyNote;
    assert.ok(technicalText.length <= 50000, `Technical document limit: ${technicalText.length}`);
    book.version++;
    book.updatedAt = checkedAt;
    book.status = "На согласовании"; book.lifecycle = "В разработке";
    book.current = "Сборка паспорта: Swift iOS, Expo Secretary, общий backend. Переводчик/Copilot/Катя подтверждены владельцем. Сборки и иной сервер неизвестны; код не приёмка.";
    book.nextStage = "Свести приложения, серверы, дизайн, данные, право и экономику по вкладам 10 направлений; согласовать с Сергеем. Основания — технический паспорт v2. Не запускать функции/crew.";
    book.completion = "У каждого сценария — версия/окружение, источник/дата, код/проверка/доступность/приёмка отдельно, пробел/поставщик/получатель. Сборки и сервер сопоставлены. Приёмка только явная.";
    book.responsibilities += "\nСборка паспорта — общий текущий фокус. Все 10 направлений и 40 существующих ролей имеют ссылку на эту книгу и её технические основания; это не новые полномочия, не ответы и не запуск.";
    book.contradictions = book.contradictions.replace(/актуальная связанная запись — v12/, `актуальная связанная запись — v${edition}`) +
      "\nОтдельный сервер второго приложения из вложения не установлен: клиентская документация указывает talkhint.app, Secretary Engine найден здесь. Аватар 2.5D не подтверждён; не путать с историческим Tutor.";
    book.legal += "\nВ коде найдены /privacy и /terms (publicSite.ts, public-site/app.js), не юридическое одобрение. Судебные материалы/официальные правовые основания — открытый вход юристам, не проведённое исследование.";
    book.roadmap += `\nТекущий этап: сборка паспорта v${book.version}; единый roadmap v${edition}. Сначала база/сборки/связи и согласование; новые продуктовые функции — после решения. Срок неизвестен.`;
    const f = (key: string) => { const v = book.features.find(x => x.id === key); assert.ok(v, key); return v; };
    f("secretary").platform = "Исходники Swift iOS и Expo iOS/Android/web. Backend TalkHint; установленная сборка и её origin неизвестны. DOC-TALKHINT-TECHNICAL-PASSPORT v2.";
    f("translator").platform = "Swift iOS: отдельная вкладка; версия проекта 1.0.0(1) — не доказательство установленной сборки. В Expo Secretary переводчик не заявлен.";
    f("copilot").platform = "Swift iOS: Hint и Copilot — отдельные вкладки в SceneDelegate. Device-проверка и установленная сборка неизвестны.";
    f("chat").implementation += "\nExpo Prepare содержит уточнение поручения (README); не единый чат с почтой.";
    f("calendar").implementation += "\nExpo README: connect/select есть по описанию, booking недоступен.";
    f("results").platform = "Swift History; Expo History/TaskDetail; веб и ChatGPT — отдельные клиенты. Наличие экранов не проверка доставки полного итога.";
    assert.deepEqual(book.features.map(f => f.id), oldFeatureIds);
    const bookText = productBookText(book);
    assert.ok(bookText.length <= 50000, `Book limit: ${bookText.length}`);
    const cmds: ModelCommand[] = [
      { type: "saveDocument", id: productBookDocumentId, title: `TalkHint — живая книга продукта — v${book.version} — сборка текущего состояния — на согласовании`,
        text: bookText, url: "/admin/project-model?hypothesis=new-country&view=book", elementIds: document(productBookDocumentId).elementIds },
      { type: "saveDocument", id: techId, title: "TalkHint — технический паспорт и главный инженер — v2 — сборка компонентов — на согласовании",
        text: technicalText, url: "/admin/project-model?hypothesis=new-country&view=book&chapter=documents", elementIds: document(techId).elementIds },
      { type: "saveDocument", id: roadmapId, title: `TalkHint — единый roadmap — v${edition} — текущий фокус: сборка паспорта`,
        text: document(roadmapId).text + `\n\n## ${marker}\nВладелец сменил текущий фокус на сборку полного актуального паспорта. Существующая книга v${book.version}, технический паспорт v2; все 10 направлений используют те же записи. P-BENCH/его проход и прежние материалы не удалены; автоматизация не запущена.\nСейчас: собраны доступные исходники/документы и metadata общего backend, выявлены неизвестные устройства и отдельный сервер. Следующий один шаг: получить фактическую версию/сборку/API origin используемых владельцем клиентов в рамках ENG-REQ-IOS-EVIDENCE; если это другой backend — его имя/адрес и read-only паспорт от владельца сервера. Критерий: оба клиента однозначно сопоставлены с версией и сервером либо явно установлен отсутствующий компонент. Не звонить, не менять настройки, не требовать ключей.\nДалее: технические/QA доказательства → дизайн экранов → данные/правовые и финансовые основания с имеющимися PB-GAP → продукт сводит и возвращает Сергею на согласование. Это порядок подготовки, не утверждённый релизный календарь.`, url: document(roadmapId).url, elementIds: document(roadmapId).elementIds },
      { type: "saveOperatingModel", baseVersion: currentOp.version, data: operating },
    ];
    let updated = before;
    for (const command of cmds) updated = applyHypothesisCommand(updated, "new-country", command, actor);
    const newSelected = readHypothesis(updated, "new-country");
    assert.deepEqual(newSelected.elements, selected.elements, "No invented replies, role acceptance or requests");
    assert.deepEqual(newSelected.competitorDirectory, selected.competitorDirectory);
    assert.deepEqual(newSelected.analystPreparation, selected.analystPreparation);
    assert.deepEqual(newSelected.operatingModel!.revisions.slice(0, -1), selected.operatingModel!.revisions);
    assert.deepEqual(operating.nodes.map(n => n.id), currentOp.data.nodes.map(n => n.id));
    assert.deepEqual(operating.links, currentOp.data.links);
    for (let i = 0; i < operating.nodes.length; i++) {
      const { referenceIds: _, ...rest } = operating.nodes[i];
      const { referenceIds: __, ...previous } = currentOp.data.nodes[i];
      assert.deepEqual(rest, previous, "Only passport references change in the team");
    }
    const original = (r: typeof before) => { const { alternatives, revision, ...v } = r; return v; };
    assert.deepEqual(original(before), original(updated));
    for (const old of before.alternatives!.filter(h => h.id !== "new-country"))
      assert.deepEqual(updated.alternatives!.find(h => h.id === old.id), old);
    assert.ok(activeModelSize(updated) <= modelSizeBudget(updated));
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const dossier = {
      format: "TalkHint consolidated product passport snapshot", version: book.version,
      status: "На согласовании", lifecycle: "В разработке", checkedAt,
      sourceRevision: before.revision, savedRevision: updated.revision,
      sourceCommit: commit, bookDocumentId: productBookDocumentId, technicalDocumentId: techId,
      roadmapDocumentId: roadmapId, roadmapVersion: edition, operatingVersion: currentOp.version + 1,
      caveat, sourceIndex, ownerMaterial: { path: sourceMaterial, sha256: digest(sourceText),
        classification: "Переданное описание и предлагаемая форма; спорные утверждения не подтверждены автоматически" },
      systemComposition: [
        { id: "native-ios", kind: "Swift iOS", root: "ios", buildConfig: "1.0.0 (1), target iOS 15.0+",
          installedBuild: null, actualApiOrigin: null, connectsTo: ["talkhint-backend"], evidence: "ios/project.yml; App/SceneDelegate.swift",
          status: "source_read_not_device_test", owner: "Сергей; код в текущем проекте, техническая ответственность HEAD.07" },
        { id: "secretary-client", kind: "Expo iOS/Android/web", root: "apps/secretary-mobile", buildConfig: "0.1.0; internal development/preview",
          installedBuild: null, actualApiOrigin: null, documentedApiOrigin: "https://talkhint.app", connectsTo: ["talkhint-backend"],
          status: "source_read_not_device_test", owner: "Сергей; копия клиента здесь, состояние отдельного проекта неизвестно" },
        { id: "talkhint-backend", kind: "TalkHint server + Secretary Engine + mobile adapter", root: "server",
          url: "https://talkhint.app", deployment: { verified: true, type: "vm", successfulBuild: true, visibility: "public", checkedAt },
          metadataCheck: { method: "GET", path: "/api/mobile-secretary/me", httpStatus: 401,
            interpretation: "Защищённый endpoint отвечает; это не авторизованная проверка функций/звонков" },
          connectsTo: ["retell", "twilio", "openai", "postgres"], owner: "Сергей; техническая ответственность HEAD.07" },
        { id: "retell", kind: "External voice provider", source: "server/secretary/retellPhone.ts",
          callback: "/retell-phone-engine/<runtime-ticket-not-exported>", customerAccountAudited: false,
          languageConfig: ["en-US", "ru-RU", "es-ES"], owner: "Внешний провайдер; фактические аккаунт/настройки не проверялись" },
        { id: "reported-other-server", kind: "Сообщённый отдельный сервер", url: null, version: null,
          status: "unidentified", missing: "Имя/адрес, владелец/доступ и read-only паспорт; не просить токены в чате" },
      ],
      features: book.features.map(row => ({ ...row, codeEvidence: engineeringFacts.find(f => f.id === row.id) ?? null,
        installedBuild: null, deviceTestAt: null, acceptanceEvidence: null, costPerMinute: null })),
      additionalUserInterfaceRows: [
        { featureId: "copilot", screen: "Hint", platform: "Swift iOS", evidence: "SceneDelegate.swift:81–84", state: "source_read" },
        { featureId: "secretary", screen: "Prepare / бриф / уточнение", platform: "Expo",
          evidence: "apps/secretary-mobile/README.md:42; src/screens/PrepareScreen.tsx", state: "source_read_not_live_test" },
        { featureId: "contacts", screen: "Cards", platform: "Expo", evidence: "src/navigation.tsx", state: "source_read" },
        { featureId: "account", screen: "Settings", platform: "Expo", evidence: "src/navigation.tsx", state: "source_read" },
        { screen: "Аватар 2.5D / губы", platform: null, state: "reported_unverified", source: sourceMaterial,
          caveat: "Tutor 3D найден исторически, но не подтверждает аватар Кати; не считать готовой скрытой функцией" },
      ],
      design: { sources: ["ios/TalkHint/UI/Theme.swift", "ios/TalkHint/App/SceneDelegate.swift",
        "apps/secretary-mobile/src/navigation.tsx", "client/src/components/project-model/ProductBookView.tsx"],
        visualDeviceEvidence: null, statesMissing: ["permission_denied", "offline", "processing", "failed", "recovery", "empty"],
        acceptance: null, actualBrandbookApproved: null, nextSupplier: "P.UX / mobile / Сергей, без создания нового тестировщика" },
      buildsAndRelease: { iosConfiguredVersion: "1.0.0 (1)", expoConfiguredVersion: "0.1.0",
        installedIos: null, installedAndroid: null, testFlight: null, storeRelease: null,
        macBuildOrDeviceRunInThisAudit: false, publicationPerformed: false,
        evidence: ["ios/project.yml", "apps/secretary-mobile/eas.json", "ENG-REQ-IOS-EVIDENCE"] },
      dataAndRights: { source: ["shared/schema.ts", "server/mobileSecretary/store.ts", "apps/secretary-mobile/src/storage.ts"],
        storedTypes: ["tasks", "call_history", "transcript_turns", "attempt_snapshots", "contacts", "knowledge_cards", "line_assignments", "scoped_mobile_sessions_and_reviews"],
        ownerScoping: "Реализация фильтров/сессий найдена; новая проверка с реальными владельцами не выполнялась",
        actualRetentionPeriods: null, deletionLegalAcceptance: null, providerDeletionVerified: false,
        recordingConsent: "Отдельный допуск; запись не включалась", technicalSessionExpiryIsCallRetention: false },
      legal: { publicPagesFound: ["/privacy", "/terms"], evidence: ["server/publicSite.ts:48", "talkhint/public-site/app.js:322–325"],
        legalApproval: null, legalTerritories: null, competitorPoliciesReviewedInThisAudit: false,
        courtResearchPerformed: false, gaps: ["B2C/B2B terms", "message/participant consent", "processor/transfer map", "retention/deletion", "subscriptions/cancellation"],
        receivingRequests: ["PB-GAP-LEGAL", "ENG-REQ-CHANNELS"] },
      finance: { productPrices: null, limits: null, unitEconomics: null, perMinuteActualCost: null,
        costComponents: ["telephony", "numbers", "LLM", "speech", "hosting", "storage", "support"], sourceRequest: "PB-GAP-FINANCE" },
      departmentContributions: deptResponsibilities,
      incomingFindings: { benchmarking: "Существующие карточки и P-BENCH; полученный внешний trial rev744 ещё не импортирован/не принят",
        support: "Существующий landing-gear случай и ошибка итога ChatGPT; не закрываются этим паспортом",
        technical: "Ручная ревизия Replit; не автономный ответ всех инженерных ролей" },
      rawOrUnknown: ["Установленные сборки и origin", "Идентичность другого сервера", "Device/ChatGPT-host/PSTN приёмка",
        "Скрытый аватар", "Полный voice-chat/email", "SMS против MMS/фото", "Договорные сроки хранения",
        "Принятый пользовательский тариф и себестоимость", "Готовность рынков/языковых пар"],
      openRequests: selected.elements.filter(e => /^(ENG-REQ-|PB-GAP-)/.test(e.id)).map(e => ({
        id: e.id, title: e.title, state: e.coordination?.state ?? null, roleId: e.coordination?.roleId ?? null,
        nextStep: e.coordination?.nextStep ?? null, status: "Ответ/приёмка этим аудитом не создавались" })),
      book, technicalPassport: { id: techId, title: "Технический паспорт v2", text: technicalText },
      nextOneStep: "ENG-REQ-IOS-EVIDENCE: получить фактические версии/сборки и API origin двух используемых клиентов; если backend другой — read-only паспорт его владельца",
      forbiddenActionsPerformed: [],
    };
    await mkdir(outDir, { recursive: true });
    const stem = `TalkHint_product_passport_v${book.version}_rev${updated.revision}`;
    const json = JSON.stringify(dossier, null, 2);
    assert.ok(!json.includes(owner), "Do not export private account locator");
    const currentBookChars = bookText.length, technicalChars = technicalText.length;
    console.log(JSON.stringify({ mode: process.argv.includes("--save") ? "save_requested" : "dry_run", sourceRevision: before.revision,
      savedRevision: updated.revision, bookVersion: book.version, technicalVersion: 2, roadmapVersion: edition,
      operatingVersion: currentOp.version + 1, directionCount: directions.length, referencedTeamNodes: teamReferences.length,
      oldFeatureIdsPreserved: true, linksUnchanged: true, bookChars: currentBookChars, technicalChars,
      snapshotPath: `${outDir}/${stem}.json` }, null, 2));
    if (!process.argv.includes("--save")) return;
    const saved = await persistModelUpdate(pool, owner, actualBefore => {
      assert.deepEqual(actualBefore, before, "Concurrent update; no write");
      return updated;
    }, true);
    assert.deepEqual(readHypothesis(saved, "new-country"), newSelected);
    await writeFile(`${outDir}/${stem}.json`, json);
    await writeFile(`${outDir}/${stem}.md`, `# TalkHint — сборка паспорта v${book.version}\n\nСостояние: на согласовании. Rev${saved.revision}; технический паспорт v2; roadmap v${edition}.\n\n${assemblyNote}\n\n## Вклад существующих направлений\n${deptResponsibilities.map(d => `### ${d.code} · ${d.name}\n${d.contribution}\n${d.status}`).join("\n\n")}\n\n## Матрица возможностей\n${book.features.map(f => `### ${f.name}\nСейчас: ${f.actual}\nПлатформа: ${f.platform}\nРеализация: ${f.implementation}\nПроверка: ${f.verification}\nПриёмка: ${f.acceptance}\nОграничения: ${f.limitations}`).join("\n\n")}\n`);
    console.log(JSON.stringify({ saved: true, readbackVerified: true, revision: saved.revision,
      jsonSha256: digest(json), originalHypothesisUnchanged: true, oldHistoryPreserved: true, sourceIndexCount: sourceIndex.length }));
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
