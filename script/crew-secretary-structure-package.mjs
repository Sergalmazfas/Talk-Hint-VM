import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const dir = "generated-artifacts/secretary-structure";
const out = `${dir}/review`;
await fs.mkdir(`${out}/empty-cards`, { recursive: true });
const read = async name => JSON.parse(await fs.readFile(`${dir}/${name}.json`, "utf8"));
const team = await read("team"), roadmap = await read("roadmap"), tools = await read("tools");
if (team.revision !== roadmap.revision) throw Error("Read revisions differ; do not present a consistent snapshot.");
const save = (name, value) => fs.writeFile(`${out}/${name}`, JSON.stringify(value, null, 2));
const ownerScope = { stage: 1, applicationStatus: "NOT_APPLIED",
  environment: "production", model: "new-country", readRevision: team.revision,
  productionWriteOperations: 0, source: "Решение владельца; проект, не существующие сотрудники." };
const definitions = [
  ["secretary_project_head", "secretary-project-head", "Руководитель проекта «Секретарь»", "Сева Секретарев", "maria",
    "Ставит задачи команде, принимает результат, отвечает за каталог секретарей."],
  ["secretary_lab_engineer", "secretary-lab-engineer", "Инженер лаборатории Секретаря", "Лёва Секретарев", "secretary_project_head",
    "Руководит стендом, разбирает звонки, собирает отзывы пользователей."],
  ["secretary_qa", "secretary-qa", "Проверяющая отдела «Секретарь»", "Тома Секретарева", "secretary_project_head",
    "Перепроверяет разборы Лёвы."],
];
const cards = definitions.map(([key, suggestedStableId, position, name, reportsToKey, ownerProvidedScope]) => ({
  format: "talkhint.department.empty-card.proposal", version: 1, ...ownerScope,
  key, suggestedStableId, existingModelRoleId: null, mode: "secretary", position, reportsToKey,
  name: { proposed: name, status: "proposed", accepted: null },
  ownerProvidedScope, duties: [], tasks: [], schedules: [], executorId: null,
  connectedAgentId: null, resourceAssignments: [], expenses: [], budget: null,
  portrait: null, character: { traits: [null, null, null], motto: null },
  knowledgeBook: { reference: null, state: "reserved_empty", isolationKey: key },
  prompt: { reference: null, text: null, state: "reserved_empty", isolationKey: key },
  active: false, accepted: false,
}));
for (const c of cards) await save(`empty-cards/${c.key}.json`, c);
const slots = ["work_phone", "personal_phone"].map(kind => ({
  format: "talkhint.secretary.catalog-slot.proposal", version: 1, ...ownerScope,
  key: `future_secretary_${kind}`, catalogKey: "secretary_catalog",
  label: kind === "work_phone" ? "Будущий секретарь — рабочий телефон" : "Будущий секретарь — личный телефон",
  usage: kind, secretaryIdentityId: null, name: null, personaId: null,
  executorId: null, tasks: [], schedules: [], expenses: [], active: false,
  knowledgeBook: { reference: null, text: null }, prompt: { reference: null, text: null },
  note: "Это незанятое место, не новый персонаж и не назначение на номер. Рабочий/личный контекст не является личностью.",
}));
for (const s of slots) await save(`empty-cards/${s.key}.json`, s);
await save("Secretary_empty_cards.json", { ...ownerScope, roles: cards, catalogSlots: slots });
const catalog = {
  format: "talkhint.secretary.catalog-structure.proposal", version: 1, ...ownerScope,
  key: "secretary_catalog", reportsToKey: "secretary_project_head",
  sourceCatalog: "Существующий каталог Secretary personalities; не второй каталог персонажей.",
  extensibleEntries: true, fixedEmployeeCount: false,
  perEntry: {
    stableIdentity: "Стабильный ID существующего персонажа, не имя и не номер телефона.",
    knowledgeBook: "Отдельная версионируемая книжка для каждого секретаря; содержимое не создаётся на этапе 1.",
    prompt: "Отдельная ссылка на промпт/слои каждого секретаря; действующая политика и права не расширяются.",
    personaVersion: "Назначение закрепляет редакцию; новая редакция не меняет старые звонки.",
  },
  entries: [{ key: "katya_existing", projectionId: "employee-katya",
    createEmployee: false, createPersona: false, name: "Катя", requestedManagerKey: "secretary_project_head",
    reportedRuntime: { source: "owner_statement", provider: "Retell", personaVersion: 2,
      verifiedByLiveProviderReadThisStage: false },
    knowledgeBookRef: null, promptRef: null, referencesState: "not_verified_do_not_guess",
    existingRuntimePromptUntouched: true, phoneAssignmentsUntouched: true }],
  emptySlots: slots.map(s => s.key),
};
await save("Secretary_catalog.json", catalog);
const shared = [["chief_engineer", "HEAD.07", "Главный инженер — код"],
  ["duty", "P.OPS", "Тихон — дежурный компании"],
  ["hr", "P.ORG", "Нина Кадрова — книжки знаний и обучение"]]
  .map(([key, code, label]) => ({ key, code, label,
    existingRoleId: team.roles.find(r => r.code === code)?.id ?? null,
    sharedAcrossProducts: true, movedUnderSeva: false, duplicated: false }));
const map = { format: "talkhint.secretary.department-structure.proposal", version: 1, ...ownerScope,
  nodes: [{ key: "maria", existingRoleId: "head-product", label: "Мария Соболь" },
    ...cards.map(c => ({ key: c.key, suggestedStableId: c.suggestedStableId, label: c.name.proposed,
      nameStatus: "proposed", existingRoleId: null, position: c.position })),
    { key: "secretary_catalog", label: "Каталог секретарей", source: "existing_runtime_catalog_reference" },
    { key: "katya_existing", label: "Катя", existingProjectionId: "employee-katya", createDuplicate: false },
    ...slots.map(s => ({ key: s.key, label: s.label, empty: true }))],
  edges: [...cards.map(c => ({ from: c.key, to: c.reportsToKey, kind: "reports_to", applied: false })),
    { from: "secretary_catalog", to: "secretary_project_head", kind: "responsibility_for_catalog", applied: false },
    { from: "katya_existing", to: "secretary_project_head", kind: "reports_to", applied: false },
    ...catalog.entries.map(e => ({ from: e.key, to: "secretary_catalog", kind: "catalog_member_reference", applied: false })),
    ...slots.map(s => ({ from: s.key, to: "secretary_catalog", kind: "vacant_catalog_slot", applied: false }))],
  sharedSupport: shared,
  excluded: ["Действия этапа 2", "Активация агентов", "Расписания", "Новые расходы",
    "Изменение Кати", "Создание копии каталога", "Назначение персонажей на телефонные номера"],
};
await save("Secretary_department_map.json", map);
const inventory = [
  { area: "Браузерный стенд", code: ["server/secretaryLab/service.ts", "server/secretaryLab/retell.ts",
    "server/secretaryLab/retellEngine.ts", "server/secretaryLab/elevenEngine.ts"],
    existing: "GPT, Retell-managed, Retell + Engine и ElevenLabs + Engine — отдельные контуры сравнения. TEST-задание, контроль admission/stop и приватные отчёты.",
    limitation: "Наличие реализации не доказывает доступность конкретного провайдера сейчас, качество звука, PSTN или iPhone. Сессии не запускались." },
  { area: "Личности и версии", code: ["shared/schema.ts: secretaryPersonalities / secretaryPersonalityVersions / secretaryPersonalityAssignments",
    "server/secretaryLab/personality.ts", "server/secretaryLab/PERSONALITIES.md"],
    existing: "Расширяемый каталог, отдельные редакции и назначения; фиксация выбранной личности на сессию. Выбор личности для Retell + Engine и ElevenLabs + Engine.",
    limitation: "Каталог персонажей не равен каталогу сотрудников crew. Катя v2 в этом отчёте — факт от владельца, не новая provider-проверка." },
  { area: "Голос и модель", code: ["server/secretaryLab/RETELL-ENGINE.md", "server/secretaryLab/ELEVEN-ENGINE.md"],
    existing: "Провайдеры и именованные конфигурации/профили, запись фактической модели, голоса и параметров в отчёты.",
    limitation: "Единый произвольный селектор любого голоса и модели не подтверждён. Выбор личности не является выбором голоса." },
  { area: "Отчёты и сравнения", code: ["server/secretaryLab/comparisonStore.ts", "server/secretaryLab/comparisonRoutes.ts",
    "client/src/components/secretary-lab/SavedComparisons.tsx", "server/secretaryLab/COMPARISONS.md"],
    existing: "Сохранённые сравнения, версии/конфигурации прогонов, JSON-отчёты, оценка и комментарий владельца; общий архив сравнений.",
    limitation: "Комментарий администратора не доказывает наличие продуктового сбора отзывов всех пользователей, их согласия или назначенного получателя." },
  { area: "Цена и ограничения", code: ["server/secretaryLab/COSTS.md"],
    existing: "Расчёт/снимки стоимости прогонов и провайдерские ограничения описаны отдельно.",
    limitation: "Usage не равен счёту провайдера. Проверка кода не является разрешением на платный прогон." },
  { area: "Меню IVR и цифры", code: ["server/secretary/ivr.ts", "server/secretary/ivrSelection.ts",
    "server/secretary/fixtures/ivr-replays.json"],
    existing: "Телефонная логика текущего меню, выбор пункта и текстовые replay-фикстуры.",
    limitation: "Фикстуры воспроизводят цитаты транскриптов, не аудио. Не подтверждён единый автоматический PSTN/аудио-стенд прохождения меню; звонки не выполнялись." },
];
const materials = await read("materials");
const labMaterials = await read("lab-materials").catch(() => ({ documents: [], elements: [], nodes: [] }));
const book = await read("product-book").catch(() => null);
const bookLabReferences = [];
function collectReferences(value, path = "") {
  if (typeof value === "string") {
    for (const line of value.split("\n").filter(l => /secretary-lab|Secretary Lab|стенд.*екретар/i.test(l)))
      if (bookLabReferences.length < 20) bookLabReferences.push({ path, snippet: line.slice(0, 600) });
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) collectReferences(child, `${path}/${key}`);
  }
}
try { collectReferences(JSON.parse(book?.text ?? "{}")); } catch { /* No unparsed giant document in excerpts. */ }
await save("Secretary_lab_inventory.json", { ...ownerScope, inventory,
  model: { revision: team.revision,
    separatelyNamedSecretaryRoles: team.roles.filter(r => /секретар|secretar|сева|лёва|тома/i.test(r.name + r.code)),
    separatelyNamedSecretaryActions: roadmap.actionRegister.filter(r => /секретар|secretar|Retell|ElevenLabs/i.test(r.name)),
    secretaryMaterialTitles: materials.documents.map(d => ({ id: d.id, title: d.title })),
    labSearchMaterialTitles: labMaterials.documents.map(d => ({ id: d.id, title: d.title })),
    bookLabReferences,
    interpretation: "По проверенным ролям/названиям действий нет отдельного сформированного отдела лаборатории Секретаря. Документы и ссылки — входы, не действующая должностная схема." },
  evidenceBoundary: "Код и документы просмотрены; рабочие провайдеры, живой звук и пользовательские отзывы в этом этапе не проверялись." });
const questions = [
  "Сева: какой результат он отдаёт Марии, кто заказывает работу и как Мария принимает его собственный результат без самоприёмки?",
  "Сева: как оформляются задачи Лёве и Томе, возвраты и критерии завершения, без обхода руководителя проекта?",
  "Лёва: какие входы запускают разбор — завершённый звонок, сбой, отзыв, изменение промпта или новая личность?",
  "Лёва: какие записи/транскрипты разрешены для стенда и кем подтверждено согласие участников?",
  "Какие уровни испытаний обязательны: текстовый replay, синтетический транспорт, браузерный звук, PSTN, iPhone? Что каждый из них НЕ доказывает?",
  "Кто отдельно разрешает платный прогон, реальный звонок, лимиты расходов и предел длительности?",
  "Какие провайдеры/модели/голоса входят в утверждённую матрицу сравнения; где нужны новые переключатели вместо существующих профилей?",
  "Как фиксировать одинаковое задание, версию личности, промпт, модель, голос и профиль на каждый сравнительный прогон?",
  "Какие IVR-кейсы обязательны: несколько уровней, нет точного пункта, повторы, недоставленный help-push, лимит цифр? Где нужен аудио/PSTN-harness, а не текстовая фикстура?",
  "Тома: какие исходные материалы получает независимо от вывода Лёвы, как перепроверяет и как оформляет возврат?",
  "Кто принимает проверку Томы, какие разногласия уходят Севе, а какие — Марии?",
  "Откуда поступают отзывы обычных пользователей о темпе, перебиваниях, теплоте, юморе и уместности? Как разрешено хранить, обезличивать и удалять их?",
  "Что считать разными результатами: транспортная поломка, непрохождение меню, ошибка фактов, манера общения, задержка? Кто получает каждый тип?",
  "Как Лёва передаёт подтверждённую поломку общему главному инженеру, а эксплуатационный сбой — Тихону, без дублирования этих ролей?",
  "Как Сева передаёт Нине предложенный урок для отдельной книжки конкретного секретаря; кто проверяет и кто принимает урок?",
  "Как согласуется новый секретарь и его имя, личность, книжка и промпт? Новая редакция не должна менять прежние назначения незаметно.",
  "Как связывать персонажа с личным/рабочим профилем номера без копирования личности и без автоматического доступа к карточкам владельца?",
  "Каковы форма отчёта, место хранения доказательств, сроки и метрики? Числовые нормы пока не установлены и не придумываются.",
];
await save("Stage2_questions.json", { stage: 2, status: "QUESTIONS_ONLY_NO_ACTIONS_CREATED", questions });
const proposal = { ...ownerScope, name: "create_secretary_department_structure", status: "NEEDED_NOT_IMPLEMENTED",
  whyExistingInsufficient: "В production 14 инструментов, нет create_planned_role/set_projection_manager. Предыдущий проект create_planned_role разрешает только руководителя под Марией: внутренние роли и каталог им не создать.",
  input: ["revision", "requestId (UUID)", "ownerDecisionRef", "proposedNames: Сева / Лёва / Тома"],
  permitted: ["Три фиксированных типа пустой роли отдела secretary; менеджеры только Мария → Сева → Лёва/Тома",
    "Имена только proposed, без принятия", "Организационная ссылка на существующий каталог, не копия его персонажей",
    "Два пустых слота, независимые места под книжку/промпт для каждого будущего секретаря",
    "Существующая проекция employee-katya под Севой; без создания/переоснащения Кати",
    "Одна атомарная запись модели с квитанцией и история до/после",
    "get_team показывает роли, proposed-имена, каталог/слоты и связь существующей проекции для независимого повторного чтения"],
  forbidden: ["Произвольный JSON patch/запись документов", "Новые агенты, задачи, действия, расписания или расходы",
    "Изменение личности/промпта/голоса/модели Кати", "Назначение на телефон/смена provider-агента",
    "SQL-обход MCP", "Приёмка", "Удаление", "Замена существующих принятых сотрудников"],
  guards: ["production/new-country и текущий владелец", "Авторизация и открытая запись",
    "CAS revision", "requestId replay без дублей", "Коллизия ID/занятая роль → stop/diff, не перезапись",
    "Любой активный executor/task/schedule в создаваемой структуре → отказ",
    "Повторное чтение всей структуры после записи", "Независимая сверка до Publish владельцем"],
};
await save("Needed_MCP_tool.json", proposal);
const summary = `# Отдел «Секретарь» — этап 1\n\nProduction прочитана: r${team.revision}. Записей: **0**. Структура **НЕ ПРИМЕНЕНА**.\n\nВ production 14 MCP-инструментов. Нужен create_secretary_department_structure; в этом этапе реализация не добавлялась, обходов через документы/SQL нет.\n\n## Целевая структура\n\nМария Соболь\n└─ Сева Секретарев (proposed; пусто)\n   ├─ Лёва Секретарев (proposed; пусто)\n   ├─ Тома Секретарева (proposed; пусто)\n   └─ Каталог существующих личностей\n      ├─ Катя (существующая; Retell / persona v2 — по сообщению владельца)\n      ├─ будущий слот: рабочий телефон\n      └─ будущий слот: личный телефон\n\nГлавный инженер, Тихон и Нина — общие, не новые сотрудники Севы.\n\n## Файлы\n\n- empty-cards/: три будущие роли и два пустых слота; proposed не accepted.\n- Secretary_department_map.json: целевые связи с applied=false.\n- Secretary_catalog.json: ссылка на существующий каталог; Катю не копировать.\n- Secretary_lab_inventory.json: что найдено в коде и модели, с ограничениями доказательств.\n- Stage2_questions.json: только вопросы, никаких действий не создано.\n- Needed_MCP_tool.json: точные границы недостающего инструмента.\n\nКнижки и промпты зарезервированы отдельными ссылками, не заполнены и не активированы. Реальный ID Кати/её промпт не выдумывался. Содержимое каталогов провайдера не читалось. Роль в модели не доказывает подключённого исполнителя.\n`;
await fs.writeFile(`${out}/README.md`, summary);
const escape = s => String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Отдел «Секретарь» — структура</title><style>body{font:17px/1.55 system-ui;color:#203e36;background:#f6f8f3;margin:0;padding:20px;max-width:860px;margin:auto}h1,h2{line-height:1.2}section{background:white;border:1px solid #d9e4dc;border-radius:16px;padding:18px;margin:18px 0}pre{white-space:pre-wrap;font:15px/1.6 system-ui}li{margin:12px 0}.status{background:#fff2ce;padding:14px;border-radius:10px}small{color:#52685d}</style><h1>Отдел «Секретарь»</h1><p class="status">Этап 1 · production r${team.revision} прочитана · <b>структура не применена</b> · записей 0</p><section><h2>Целевая структура</h2><pre>${escape(summary.split("## Целевая структура\n\n")[1].split("## Файлы")[0])}</pre></section><section><h2>Почему пока не внесено</h2><p>В опубликованном MCP нет создания пустых должностей и структуры каталога. Нужен один узкий <b>create_secretary_department_structure</b>. Катю не дублировать, её поведение и настройки не менять.</p></section><section><h2>Что уже есть</h2>${inventory.map(i=>`<h3>${escape(i.area)}</h3><p>${escape(i.existing)}</p><p><small>${escape(i.limitation)}</small></p>`).join("")}</section><section><h2>Этап 2: вопросы, не действия</h2><ol>${questions.map(q=>`<li>${escape(q)}</li>`).join("")}</ol></section><section><h2>Границы</h2><p>Имена предложены, не приняты. Исполнители, задачи, расписания, расходы отсутствуют. Книжки и промпты — отдельные пустые места. Живые звонки и провайдерские сессии не запускались. JSON-проекты и доказательства чтения — в ZIP.</p></section></html>`;
const modelSection = `<section><h2>Что найдено в модели</h2><p>Чтение production r${team.revision}: отдельных должностей Севы, Лёвы и Томы и отдельно названных действий лаборатории Секретаря нет. Это не означает отсутствия работающей Кати: она показана отдельной существующей runtime-проекцией.</p><p>Поиск secretary-lab нашёл ссылки/упоминания в следующих материалах:</p><ul>${labMaterials.documents.map(d=>`<li>${escape(d.title)}</li>`).join("")}</ul><p>Также есть книга продукта и материал внешнего Secretary Mobile. Наличие документа — вход для описания действий, не приёмка отдела и не доказательство живого стенда.</p></section>`;
await fs.writeFile(`${out}/Secretary_stage1_review.html`, html.replace("<section><h2>Этап 2:", modelSection + "<section><h2>Этап 2:"));
await save("Read_evidence.json", { ...ownerScope, publishedTools: tools.tools.map(t=>t.name),
  modelRolesChecked: team.roles.length, separatelyNamedSecretaryRoles: [],
  notes: ["Доступность 14 операций проверена tools/list.", "Записи и повторное чтение записи невозможны без нужной операции; выдуманного подтверждения нет."] });
for (const c of cards) {
  if(c.executorId !== null || c.active || c.name.status !== "proposed" ||
    [c.duties,c.tasks,c.schedules,c.expenses,c.resourceAssignments].some(a=>a.length)) throw Error("Not an empty card.");
}
if(catalog.entries.length !== 1 || catalog.entries[0].createEmployee || map.edges.some(e=>e.applied))
  throw Error("Existing Katya duplicated or unapplied graph mislabelled.");
const paths = execFileSync("find",[out,"-type","f"],{encoding:"utf8"}).trim().split("\n").filter(p=>!p.endsWith("/SHA256.json"));
const hashes = {};
for(const path of paths) hashes[path.slice(out.length+1)] = createHash("sha256").update(await fs.readFile(path)).digest("hex");
await save("SHA256.json", hashes);
const zip = "generated-artifacts/Secretary_department_stage1_review.zip";
execFileSync("zip",["-q","-r",zip.slice("generated-artifacts/".length),"secretary-structure/review"],{cwd:"generated-artifacts"});
console.log(JSON.stringify({zip,revision:team.revision,cards:cards.length,slots:slots.length,productionWrites:0,
  applied:false,questions:questions.length,files:paths.length+1}));
