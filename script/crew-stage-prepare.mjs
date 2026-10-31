// Build owner-requested review documents from verified sources; no runtime edit.
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const base = "generated-artifacts/crew-stage";
const out = `${base}/prepared`;
await fs.mkdir(out, { recursive: true });
const read = async id => JSON.parse(await fs.readFile(`${base}/documents/${id}.json`, "utf8"));
const jsonDoc = async id => JSON.parse((await read(id)).text);
const save = async (name, data) => fs.writeFile(`${out}/${name}.json`, JSON.stringify(data, null, 2));
const sha = s => createHash("sha256").update(s).digest("hex");
const nina = JSON.parse(await fs.readFile("attached_assets/0_HR_Nina_Kadrova_P-ORG_v2_1793404051168.json", "utf8"));
await save("nina-v2", { sourceFile: "HR_Nina_Kadrova_P-ORG_v2.json", sourceVersion: 2,
  ownerInstruction: "Внести описание без подключения агента; имя/личность по источнику, приёмка пакета отдельно.",
  ...nina, resolvedRoleId: "proposal-4fe46862-f07e-562b-b6d7-4ab34716a545", activation: false });
await save("company-rules-addendum", {
  format: "talkhint.company-passport.addendum", version: 1, source: "HR_Nina_Kadrova_P-ORG_v2.json",
  targetDocumentId: "DOC-TALKHINT-PRODUCT-PASSPORT", status: "prepared_not_merged",
  rules: nina.companyRules_AICrew_v1, promptLayers: nina.promptLayers,
  boundaries: ["Не включает исполнителей", "Не меняет рабочие промпты", "Не является приёмкой владельца"],
});
await save("structure-pending", {
  format: "talkhint.structure.change-proposal", version: 1,
  status: "prepared_not_applied", runtimeChanged: false,
  reason: "Текущий MCP не создаёт роли и не меняет произвольные поля узлов/документов.",
  changes: [
    { existingId: "product-manager-specialist", desiredPosition: "Руководитель проекта Hint",
      desiredScope: "Только Hint; старые обязанности вне Hint требуют адресной передачи, не удаления." },
    { proposedId: "planned-secretary-project-lead", kind: "empty_project_lead", mode: "secretary",
      managerId: "head-product", employeeName: null, executorId: null },
    { proposedId: "planned-copilot-project-lead", kind: "empty_project_lead", mode: "copilot",
      managerId: "head-product", employeeName: null, executorId: null },
    { proposedId: "planned-translator-project-lead", kind: "empty_project_lead", mode: "translator",
      managerId: "head-product", employeeName: null, executorId: null },
    { existingProjectionId: "employee-katya", desiredManagerProposalId: "planned-secretary-project-lead",
      requirement: "Не создавать вторую Катю; сохранить одну живую карточку." },
  ],
  identityNote: "proposedId — метка предложения, не утверждение существования стабильного ID в production.",
});
const pkg = await jsonDoc("DOC-HINT-LAB-AGENT-PROMPT-PACKAGE");
for (const [name, roleId] of [["zamir", "laboratory-engineer-role"], ["foma", "lg-qa-role"]]) {
  await save(`knowledge-${name}`, {
    format: "talkhint.knowledge-book", version: 1, roleId, status: "proposed",
    runtimeInjected: false, acceptedBy: null,
    lessons: pkg.lessons.map(lesson => ({
      id: lesson.id, date: lesson.documentedAt, rule: lesson.rule, sources: lesson.sources,
      title: lesson.title, scope: lesson.scope, evidenceStatus: lesson.verification,
      proposedBy: "P.ORG, ручной цикл HEAD.07 по поручению владельца",
      acceptedBy: null, status: "proposed", removedAt: null,
      note: "Факт в источнике не равен отдельной приёмке нового урока; runtime не меняется.",
    })),
  });
}
await save("knowledge-katya", {
  format: "talkhint.knowledge-book", version: 1, roleId: "employee-katya", status: "proposed",
  runtimeInjected: false, acceptedBy: null,
  lessons: [
    { id: "IVR-LEVELS", date: "2026-10-31", source: "docs/katya-multilevel-ivr-review.md",
      rule: "Каждое новое меню отдельно; после отправки цифр не выбирать по старому меню; лимит 5 цифр без нового меню.",
      evidence: "Replay TA 8→7 и Love's 1→2; это не доказательство реального PSTN-звонка.", status: "proposed" },
    { id: "HELP-NOT-BLOCKING", date: "2026-10-31", source: "docs/katya-multilevel-ivr-review.md",
      rule: "Недоставленная помощь не блокирует самостоятельный выбор услышанного пункта по цели.",
      evidence: "Провал уведомления воспроизведён тестом; реальная доставка push этим не доказана.", status: "proposed" },
    { id: "DTMF-TIMELINE", date: "2026-10-31", source: "docs/katya-multilevel-ivr-review.md",
      rule: "Не путать место строки в старом транскрипте со временем фактической отправки цифры.",
      evidence: "Старые записи не переписаны; новые события имеют sentAt и привязку к реплике.", status: "proposed" },
  ].map(l => ({ ...l, proposedBy: "P.ORG, ручной цикл", acceptedBy: null, removedAt: null })),
});
await save("knowledge-tikhon", {
  format: "talkhint.knowledge-book", version: 1, roleId: "management-role-operations-specialist",
  status: "proposed", runtimeInjected: false, acceptedBy: null,
  lessons: [
    { id: "FLAGS-NOT-WORK", rule: "Включённый флаг не является выполненной проверкой; нужны время и результат цикла.",
      source: "server/team/runtime.ts, существующая проверка P.OPS" },
    { id: "MAIL-NOT-READ", rule: "Gmail SENT не означает прочтение или приёмку; неоднозначную отправку не повторять вслепую.",
      source: "replit.md, Операционные правила v3 §6–7" },
    { id: "REPORT-SCHEDULE", rule: "Утренний отчёт в 08:00 America/Denver, по местным суткам; поломки и решения немедленно.",
      source: "replit.md, Операционные правила v3 §6" },
  ].map(l => ({ ...l, date: "2026-10-31", dateMeaning: "дата составления книжки, не дата нового инцидента",
    proposedBy: "P.ORG, ручной цикл", acceptedBy: null, status: "proposed", removedAt: null })),
});
const pass = JSON.parse(execFileSync("unzip", ["-p",
  "attached_assets/0_Prompts_pass_rev904_v1_1793220762393.zip", "TRIAL_PROTOCOL_PASS.json"], { encoding: "utf8" }));
await save("hr-first-proposals", {
  format: "talkhint.hr.proposals", version: 1, source: "TRIAL_PROTOCOL_PASS.json, зарегистрированная ревизия 904",
  status: "proposed", runtimeChanged: false,
  proposals: pass.trialProtocol.filter(r => /^R[1-5]$/.test(r.id)).map(row => ({
    ...row, originalStatus: row.status, status: "proposed", ownerDecision: null,
    priorPreparationDecision: pkg.ownerDecisions?.find(d => d.id === row.id) ?? null,
    note: "Ранее разрешённая Dev-подготовка сохранена отдельно; включение и расход не разрешены.",
  })),
});
// Lossless per-field projection, not a new executable prompt. Every source leaf
// appears exactly once, with its JSON pointer; reconstruction is verified.
for (const [name, id] of [["zamir", "DOC-PLAB-PROMPT-PROPOSAL"], ["foma", "DOC-PLG-QA-PROMPT-PROPOSAL"]]) {
  const source = await jsonDoc(id);
  const layers = { personality: [], knowledge: [], tasks: [] };
  const leaves = [];
  function walk(v, path = []) {
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) walk(x, [...path, k]);
    } else {
      const pointer = "/" + path.join("/");
      const layer = path[0] === "tasks" ? "tasks" :
        ["role", "goal"].includes(path[0]) ? "personality" : "knowledge";
      const item = { pointer, value: v };
      layers[layer].push(item); leaves.push(item);
    }
  }
  walk(source.prompt);
  const reconstructed = structuredClone(source.prompt);
  for (const leaf of leaves) {
    const keys = leaf.pointer.slice(1).split("/");
    let cursor = reconstructed;
    for (const k of keys.slice(0, -1)) cursor = cursor[k];
    cursor[keys.at(-1)] = leaf.value;
  }
  if (JSON.stringify(source.prompt) !== JSON.stringify(reconstructed)) throw Error("Lossless layer check failed");
  await save(`prompt-layers-${name}`, {
    format: "talkhint.prompt-layers.review", version: 1, sourceDocumentId: id,
    sourceProfileVersion: source.version, sourcePromptSha256: sha(JSON.stringify(source.prompt)),
    status: "description_only_not_runtime", sourceStatus: source.status,
    activePromptClaim: false, knowledgeBook: `knowledge-${name}.json`,
    layers, originalPrompt: source.prompt, exactReconstruction: true,
    limitation: "Это существующий проект промпта из модели, не доказательство действующего runtime. Смешанный expertiseText сохранён целиком в знаниях, без редакции; личность также есть в visualPassport. Задачи-шаблоны не являются выданным заданием.",
  });
}
const baseline = await read("DOC-HINT-LAB-AGENT-PROMPTS-BASELINE");
await save("active-prompt-baseline", {
  sourceDocumentId: baseline.id, readRevision: baseline.revision, text: baseline.text,
  limitation: "Сохранённый неизменённый baseline; совпадение с текущим deployed runtime отдельно не доказано.",
});
for (const [name, roleId] of [["katya", "employee-katya"], ["tikhon", "management-role-operations-specialist"]])
  await save(`prompt-layers-${name}`, {
    format: "talkhint.prompt-layers.review", roleId, status: "blocked_missing_runtime_source",
    layers: { personality: [], knowledge: [], tasks: [] }, runtimeChanged: false,
    limitation: name === "katya"
      ? "MCP get_team не возвращает динамическую Катю и снимок последней телефонной задачи; выдуманная реконструкция не выполнена."
      : "Анкета и процедуры роли не заменяют отдельный действующий промпт; через доступный MCP он не найден.",
  });
const otter = await fs.readFile("attached_assets/Pasted--Otter-ai-Otter--1793483363584_1793483363584.txt", "utf8");
await save("competitor-otter", {
  format: "talkhint.competitor-directory.entry", id: "otter-ai", name: "Otter.ai",
  ownerRoleCode: "P-BENCH", status: "заявлено, не проверено", verified: false,
  category: "AI-заметки и подсказки для онлайн-встреч",
  functions: ["Расшифровка встреч", "Live Assist, ограниченный доступ", "Work Mode: письма и план после встречи", "Подготовка к встрече"],
  platforms: ["iOS", "Android", "desktop", "Chrome"],
  pricesClaimed: { Free: "300 мин/мес", Pro: "$8.33–16.99/мес", Business: "$19.99–30/мес" },
  languagesClaimed: { count: 6, russian: false, translation: false },
  telephoneAndIvr: "не подтверждено", sourceDate: "2026-10-31",
  sources: ["Письмо Otter 31.10.2026: пересказ владельца",
    "https://sonix.ai/resources/otter-ai-review-pricing/",
    "https://useinterpreter-landing.pages.dev/compare/otter/",
    "https://www.castmagic.io/es/blog/otter-ai-pricing"],
  overlap: ["Hint ↔ Live Assist", "Prepare ↔ подготовка", "рапорт ↔ Work Mode"],
  claimedTalkHintDifference: ["телефон", "русский и перевод", "акценты", "Катя звонит сама"],
  futureCheck: "Проверить Live Assist на нашем сценарии после открытия доступа.",
  sourceText: otter, externalVerificationPerformed: false,
});
console.log("Prepared review documents; no model or runtime write.");
