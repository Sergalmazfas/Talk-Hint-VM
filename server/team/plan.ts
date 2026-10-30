import { semanticHash } from "../companyData/valueTree";
import type { ModelDocument } from "../../shared/projectModel";
import type { OperatingRevision } from "../../shared/operatingModel";
import { portraitManifest } from "./portraits";

export const TEAM_OWNER = "47704265";
export const TEAM_BASE = {
  workspace: "company-import-7cf8767b-fbeb-4e97-939f-cc2c3767cf3a",
  revision: 914,
  rootHash: "2a673a7206b8debc9ee6942e9e97bdbfe87bd17a957f85e3d624e52e81e81e97",
};
export const JOURNAL = "DOC-TALKHINT-IMPROVEMENT-JOURNAL";
export const DIRECTORY = "DOC-TALKHINT-TEAM-DIRECTORY";
export const SOURCE_AT = new Date(1793320787948).toISOString();
export const JOURNAL_SHA = "ac18010cbc732804f471c44443c32255104a12cc174dd705d06f76da553bc5cc";
export const characters = [
  { role: "head-product", code: "HEAD.06", name: "Мария Соболь", title: "Руководитель продукта", mode: "company", portrait: "maria",
    document: "DOC-TEAM-HEAD06", traits: ["видит продукт целиком", "смелая, не боится ломать то, что не работает", "решает по фактам"],
    motto: "Сначала человек, потом функция", image: "кожанка и хвост" },
  { role: "product-manager-specialist", code: "P.PRODUCT", name: "Паша Хинтович", title: "Менеджер Hint", mode: "hint", portrait: null,
    document: "DOC-TEAM-PPRODUCT" },
  { role: "laboratory-engineer-role", code: "P.LAB", name: "Замир Хинтович", mode: "hint", portrait: "zamir",
    document: "DOC-PLAB-PROMPT-PROPOSAL" },
  { role: "lg-qa-role", code: "P.LG.QA", name: "Фома Хинтович", mode: "hint", portrait: "foma",
    document: "DOC-PLG-QA-PROMPT-PROPOSAL" },
  { role: "management-role-operations-specialist", code: "P.OPS", name: "Тихон Хинтович", mode: "company", portrait: "tikhon",
    document: "DOC-TEAM-POPS" },
  { role: "product-work-coordinator", code: "P.COORD", name: null, mode: "company", portrait: null,
    document: "DOC-TEAM-PCOORD" },
] as const;
export const proposalCases = [
  { caseId: "DATA-PLATFORM-MIGRATION", label: "Переезд платформы данных", accepted: false,
    history: [{ at: "2026-10-28", marker: "owner-accept-unused-B-FK-2026-10-28", role: "HEAD.07 / P.OPS",
      source: "владелец; сообщение после сверки Claude",
      decision: "11 отличий deferred-FK неиспользуемых таблиц B принять как есть. B не используется. Production DDL не трогать.",
      accountBinding: "Подтверждена только модель new-country; не разрешение импорта или активации original.",
      importAuthorized: false, activationAuthorized: false, selfAcceptance: false }] },
  { caseId: "KATYA-MENU-BUTTONS-PROPOSAL", title: "Кнопки меню на экране звонка Кати", mode: "secretary",
    status: "предложение — отложено; реализация не разрешена",
    proposal: "Показывать кнопки меню на экране звонка; ответ владельца передавать в тот же звонок. Требуется изменение и сборка iOS.",
    source: "Владелец; контрольные звонки TA и Love's 29.10.2026",
    ownerAcceptance: null, relatedDocumentIds: ["DOC-TALKHINT-PRODUCT-PASSPORT"],
    runtimeChanged: false, tasksCreated: false,
    history: [{ role: "HEAD.07", note: "Предложено для журнала; не выполнено и не принято." }] },
  { caseId: "KATYA-OWNER-TAKEOVER-PROPOSAL", title: "Взять звонок: владелец говорит, Катя подсказывает", mode: "secretary",
    status: "предложение — отложено; реализация не разрешена",
    proposal: "Владелец подключается к тому же звонку; Катя становится подсказчиком, как Hint. Не создавать второй звонок.",
    source: "Владелец; контрольные звонки TA и Love's 29.10.2026",
    ownerAcceptance: null, relatedDocumentIds: ["DOC-TALKHINT-PRODUCT-PASSPORT"],
    runtimeChanged: false, tasksCreated: false,
    history: [{ role: "HEAD.07", note: "Предложено для журнала; не выполнено и не принято." }] },
];
export const teamDirectory = {
  format: "talkhint.team.directory", version: 1, source: "Решение владельца 29.10.2026",
  owner: { roleId: "owner", name: "Сергей" },
  departments: ["Продукт", "Инженерия", "Работают на клиентов"],
  teams: [
    { id: "planned-secretary", name: "Катя", mode: "secretary", portrait: "katya", status: "planned" },
    { id: "planned-copilot", name: "Copilot", mode: "copilot", portrait: null, status: "planned" },
    { id: "planned-translator", name: "Переводчик", mode: "translator", portrait: null, status: "planned" },
    { id: "unresolved-chat", name: "Чат-вход", mode: null, portrait: null, status: "unresolved" },
  ].map(t => ({ ...t, members: [], executors: [], schedules: [], jobs: [] })),
  runtimeChanged: false,
};
export const TEAM_PLAN_HASH = semanticHash({ version: 1, base: TEAM_BASE, characters, proposalCases, teamDirectory,
  portraits: portraitManifest, sourceAt: SOURCE_AT });
export const TEAM_STEPS = 4;
// Rehearsed against the exact production r914 root. Inputs AND outputs are pinned.
// Kept outside the recipe digest to avoid a cryptographic self-reference.
export const TEAM_ROOTS = [TEAM_BASE.rootHash,
  "465013bcff6019c8be35e62d4d10151ddd8aa5e70b7a01e954c455f528b2219d",
  "3fe59c2be9cc3742944510dd97f34109723d559e8c9145f6798ac19778a40422",
  "d50d009e2dd8baf15f0773bdb7b994621d77a8af1267635229ba713808ffbf8b",
  "af8fc455ef7fd387cbf368036f1ef5b9fd367e013430f1851da7d83f4a824297",
] as const;
export type Portraits = Record<string, { object: string; sha256: string; bytes: number; url: string }>;
export function documentValue(id: string, title: string, value: unknown, old?: ModelDocument): ModelDocument {
  return { ...(old ?? { id, elementIds: [], url: "" }), id, title,
    text: JSON.stringify(value), updatedAt: SOURCE_AT };
}
/** Deterministic recipe. Does not write or execute anything. */
export function proposedStep(step: number, documents: ModelDocument[], operating: OperatingRevision, portraits: Portraits) {
  const find = (id: string) => documents.find(d => d.id === id);
  if (step < 3) {
    const old = find(JOURNAL);
    if (!old) throw Error("Required journal unavailable");
    const j = JSON.parse(old.text);
    if (j.cases.some((c: any) => c.caseId === proposalCases[step].caseId)) throw Error("Case already exists");
    j.cases.push(structuredClone(proposalCases[step]));
    j.history.push({ at: SOURCE_AT, role: "HEAD.07", caseId: proposalCases[step].caseId,
      marker: `team-package:${TEAM_PLAN_HASH}:${step}`, note: "Отдельная запись по решению владельца." });
    j.version++;
    return { documents: [documentValue(JOURNAL, `TalkHint — журнал улучшений — v${j.version}`, j, old)], operating: null };
  }
  if (step !== 3) throw Error("Unknown team package step");
  const changed = characters.map(c => {
    if (!operating.data.nodes.some(n => n.id === c.role && n.code === c.code)) throw Error(`Existing role missing: ${c.code}`);
    const old = find(c.document), j = old ? JSON.parse(old.text) : {};
    const v = j.visualPassport ?? {};
    const image = c.portrait ? portraits[c.portrait] : undefined;
    return documentValue(c.document, `TalkHint — профиль ${c.code}`, {
      ...j, version: Number(j.version ?? 0) + 1, revisedAt: SOURCE_AT,
      format: j.format ?? "talkhint.employee.profile", documentId: c.document,
      mode: c.mode, nameAcceptedAt: c.name ? SOURCE_AT : null,
      visualPassport: { ...v, roleId: c.role, selectedName: c.name,
        position: "title" in c ? c.title : operating.data.nodes.find(n => n.id === c.role)!.name,
        character: { ...v.character,
          traits: "traits" in c ? [...c.traits] : v.character?.traits ?? [null, null, null],
          motto: "motto" in c ? c.motto : v.character?.motto ?? null },
        portrait: { ...v.portrait, image: "image" in c ? c.image : v.portrait?.image ?? null,
          asset: image?.url ?? null, object: image?.object ?? null,
          sha256: image?.sha256 ?? null, bytes: image?.bytes ?? null } },
      runtimeChanged: false,
    }, old);
  });
  changed.push(documentValue(DIRECTORY, "TalkHint — команда", { ...teamDirectory, portraits, packageHash: TEAM_PLAN_HASH }));
  // Projection context only, NEVER a new graph revision. The immutable model
  // root records this profile change without duplicating the large graph.
  // Existing duties, management, actions, resources and prompts remain intact.
  return { documents: changed, operating: structuredClone(operating) };
}
