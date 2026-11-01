export const ownerProductPolicyDocumentId = "DOC-COMPANY-OWNER-PRODUCT-APPROVAL";
export const ownerProductPolicyId = "owner-product-change-approval-v1";
export const ownerProductProhibition = "не вносит изменения продукта без согласования владельца";
export const ownerProductPolicyText = "Любое изменение продукта — только после согласования владельца. Изменение продукта: что видит или слышит пользователь (экраны, подсказки, тексты, голос, поведение секретарей), новые или удалённые функции, смена моделей и провайдеров, промпты работающих сотрудников и продукта, цены и доступы. Команда сама делает разборы, замеры, проверки, исследования, опыты на стенде без влияния на пользователей, исправление поломок до уже утверждённого поведения — и предлагает изменения с вариантами. Правило не может быть ослаблено правкой промпта или решением любого сотрудника, включая руководителя продукта";

export function isOwnerProductPolicy(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return p.format === "talkhint.company.owner-product-policy" && p.version === 1 &&
    p.policyId === ownerProductPolicyId && p.text === ownerProductPolicyText &&
    p.employeeProhibition === ownerProductProhibition && p.source === "owner_decision" &&
    p.nonOverridableByEmployees === true &&
    typeof p.ownerDecisionRef === "string" && p.ownerDecisionRef.trim().length > 0;
}
