import { createHash } from "node:crypto";
import { z } from "zod";
import type { ModelCommand, ModelDocument, ProjectModelState } from "../../shared/projectModel";
import { productBookDocumentId, productBookMarker, readProductBook } from "../../shared/productBook";
import { isOwnerProductPolicy, ownerProductPolicyDocumentId, ownerProductPolicyId,
  ownerProductPolicyText, ownerProductProhibition } from "../../shared/ownerProductPolicy";
import { ModelError } from "../projectModel/modelError";

// Stable source of the existing AI Crew/company-passport addendum, not a new catalogue.
export const aiCrewRulesDocumentId = "DOC-PC-b57c7c66-12b8-47cc-afe6-651a68e20132";
const text = (n: number) => z.string().trim().min(1).max(n);
export const applyOwnerProductPolicyInput = z.object({
  revision: z.number().int().nonnegative(), requestId: z.string().uuid(),
  reason: text(3000), ownerDecisionRef: text(1000),
  target: z.enum(["company_passport", "ai_crew_rules", "employee_profile"]),
  documentId: text(120), documentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const fail = (status: number, message: string): never => { throw new ModelError(status, message); };
const json = (s: string): any => {
  try { return JSON.parse(s); } catch { return fail(409, "Документ не является JSON; автоматического восстановления нет."); }
};
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const nextVersion = (v: unknown) => {
  if (!Number.isSafeInteger(v) || (v as number) < 1 || (v as number) >= Number.MAX_SAFE_INTEGER)
    return fail(409, "Версия документа не определена.");
  return (v as number) + 1;
};
const save = (d: ModelDocument, content: string): ModelCommand => {
  if (content.length > 50000) return fail(409, "Правило не помещается в лимит документа; старые данные не обрезаны.");
  return { type: "saveDocument", id: d.id, title: d.title, text: content, url: d.url, elementIds: d.elementIds };
};

// Only splice the canonical JSON root. Prefix and appended owner prose stay byte-identical.
function bookEnvelope(d: ModelDocument) {
  if (!readProductBook(d)) return fail(409, "Канонический паспорт не читается.");
  let start = d.text.indexOf(productBookMarker) + productBookMarker.length;
  while (/\s/.test(d.text[start] ?? "") && start < d.text.length) start++;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < d.text.length; i++) {
    const c = d.text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      if (--depth === 0) return {
        value: json(d.text.slice(start, i + 1)),
        render: (v: unknown) => d.text.slice(0, start) + JSON.stringify(v) + d.text.slice(i + 1),
      };
    }
  }
  return fail(409, "Граница JSON паспорта не определена.");
}

export function effectiveOwnerProductPolicy(documents: ModelDocument[]) {
  const books = documents.filter(d => d.id === productBookDocumentId);
  const policies = documents.filter(d => d.id === ownerProductPolicyDocumentId);
  if (books.length !== 1 || policies.length !== 1) return null;
  const b = readProductBook(books[0]);
  if (b?.ownerProductChangePolicyRef !== ownerProductPolicyDocumentId) return null;
  try {
    const p = JSON.parse(policies[0].text);
    return isOwnerProductPolicy(p) ? { policyId: ownerProductPolicyId,
      documentId: ownerProductPolicyDocumentId, text: ownerProductPolicyText,
      employeeProhibition: ownerProductProhibition, ownerDecisionRef: p.ownerDecisionRef,
      nonOverridableByEmployees: true as const } : null;
  } catch { return null; }
}

export function inheritOwnerProductPolicy(members: { prohibitions: string[] }[], documents: ModelDocument[]) {
  if (effectiveOwnerProductPolicy(documents))
    for (const m of members) m.prohibitions = Array.from(new Set([...m.prohibitions, ownerProductProhibition]));
}

export function ownerProductPolicyCommands(state: ProjectModelState, raw: unknown) {
  const a = applyOwnerProductPolicyInput.parse(raw);
  const matches = state.documents.filter(d => d.id === a.documentId);
  if (matches.length !== 1) return fail(404, "Нужен один существующий целевой документ.");
  const d = matches[0];
  if (createHash("sha256").update(d.text).digest("hex") !== a.documentHash)
    return fail(409, "Документ изменился; требуется новое чтение и hash.");
  const nodes = state.operatingModel?.revisions.at(-1)?.data.nodes ?? [];
  if (!nodes.some(n => n.id === "head-engineering" && n.kind === "role"))
    return fail(409, "Техническая роль не найдена.");
  const commands: ModelCommand[] = [];
  let targetId = "head-engineering";
  if (a.target === "company_passport") {
    if (d.id !== productBookDocumentId) return fail(400, "Разрешён только канонический паспорт.");
    const envelope = bookEnvelope(d), b = envelope.value;
    if (b.ownerProductChangePolicyRef !== undefined && b.ownerProductChangePolicyRef !== ownerProductPolicyDocumentId)
      return fail(409, "Ссылка правила уже занята; другое решение не заменено.");
    const existing = state.documents.filter(v => v.id === ownerProductPolicyDocumentId);
    if (existing.length > 1 || (existing.length === 1 && !isOwnerProductPolicy(json(existing[0].text))))
      return fail(409, "Документ правила конфликтует с утверждённым текстом.");
    if (!existing.length) commands.push({
      type: "createDocument", id: ownerProductPolicyDocumentId,
      title: "Жёсткое правило компании: изменения продукта", url: "", elementIds: [],
      text: JSON.stringify({ format: "talkhint.company.owner-product-policy", version: 1,
        policyId: ownerProductPolicyId, text: ownerProductPolicyText,
        employeeProhibition: ownerProductProhibition, source: "owner_decision",
        ownerDecisionRef: a.ownerDecisionRef, nonOverridableByEmployees: true }, null, 2),
    });
    if (b.ownerProductChangePolicyRef !== ownerProductPolicyDocumentId) {
      b.version = nextVersion(b.version);
      b.ownerProductChangePolicyRef = ownerProductPolicyDocumentId;
      commands.push(save(d, envelope.render(b)));
    }
  } else {
    if (!effectiveOwnerProductPolicy(state.documents))
      return fail(409, "Сначала зарегистрируйте правило в каноническом паспорте.");
    const p = json(d.text);
    if (!record(p)) return fail(409, "Целевой документ повреждён.");
    let changed = false;
    const setRef = (v: Record<string, any>) => {
      if (v.ownerProductChangePolicyRef !== undefined && v.ownerProductChangePolicyRef !== ownerProductPolicyDocumentId)
        return fail(409, "Другая ссылка правила не заменена.");
      if (v.ownerProductChangePolicyRef !== ownerProductPolicyDocumentId) {
        v.ownerProductChangePolicyRef = ownerProductPolicyDocumentId; changed = true;
      }
    };
    if (a.target === "ai_crew_rules") {
      if (d.id !== aiCrewRulesDocumentId) return fail(400, "Разрешён только существующий документ правил AI Crew.");
      const v = p.format === "talkhint.stage.review-result" ? p.documents?.["company-rules-addendum"] : p;
      if (!record(v) || v.format !== "talkhint.company-passport.addendum" ||
          v.targetDocumentId !== productBookDocumentId || !record(v.rules) ||
          !Array.isArray(v.rules.rules) || v.rules.rules.some((r: unknown) => typeof r !== "string"))
        return fail(409, "Формат общих правил не подтверждён.");
      setRef(v);
      if (!v.rules.rules.includes(ownerProductPolicyText)) {
        v.rules.rules.push(ownerProductPolicyText); changed = true;
      }
      if (changed) v.version = nextVersion(v.version);
    } else {
      if (!["talkhint.employee.profile", "talkhint.role-prompt-proposal"].includes(p.format) ||
          !record(p.visualPassport) || typeof p.visualPassport.roleId !== "string" || !p.visualPassport.roleId.trim())
        return fail(400, "Разрешены только существующие анкеты известных форматов.");
      const old = p.prohibitions;
      if (old == null) { p.prohibitions = [ownerProductProhibition]; changed = true; }
      else if (Array.isArray(old) && old.every(v => typeof v === "string")) {
        if (!old.includes(ownerProductProhibition)) { old.push(ownerProductProhibition); changed = true; }
      } else if (typeof old === "string") {
        if (!old.split("\n").includes(ownerProductProhibition)) {
          p.prohibitions = [old, ownerProductProhibition].filter(Boolean).join("\n"); changed = true;
        }
      } else return fail(409, "Неизвестный формат запретов; прежние данные не заменены.");
      setRef(p);
      if (changed) p.version = nextVersion(p.version);
      if (nodes.some(n => n.id === p.visualPassport.roleId && n.kind === "role")) targetId = p.visualPassport.roleId;
    }
    if (changed) commands.push(save(d, JSON.stringify(p, null, 2)));
  }
  // At most two document operations + the service's one receipt: existing cap = 3.
  return { commands, roleId: "head-engineering", targetId };
}
