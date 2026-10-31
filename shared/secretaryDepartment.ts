import { z } from "zod";

export const SECRETARY_DEPARTMENT_DOCUMENT = "DOC-SECRETARY-DEPARTMENT-STRUCTURE";
export const secretaryDepartmentRoles = [
  { id: "secretary-project-head", code: "PLAN.SECRETARY", managerId: "head-product",
    title: "Руководитель проекта «Секретарь»", proposedName: "Сева Секретарев" },
  { id: "secretary-lab-engineer", code: "PLAN.SECRETARY.LAB", managerId: "secretary-project-head",
    title: "Инженер лаборатории Секретаря", proposedName: "Лёва Секретарев" },
  { id: "secretary-qa", code: "PLAN.SECRETARY.QA", managerId: "secretary-project-head",
    title: "Проверяющая отдела «Секретарь»", proposedName: "Тома Секретарева" },
] as const;
const id = z.string().trim().min(1).max(120);
const references = {
  knowledgeBookDocumentId: id.nullable(),
  promptDocumentId: id.nullable(),
};
/** Organizational references, not copies of the personality catalog or executable prompts. */
export const secretaryDepartmentSchema = z.object({
  format: z.literal("talkhint.secretary.department-structure"), version: z.literal(1),
  stage: z.literal("structure_only"),
  managerId: z.literal("secretary-project-head"),
  roles: z.object({
    projectHeadId: z.literal("secretary-project-head"),
    labEngineerId: z.literal("secretary-lab-engineer"),
    qaId: z.literal("secretary-qa"),
  }).strict(),
  catalog: z.object({
    source: z.literal("existing_secretary_personalities"),
    members: z.array(z.object({
      key: id, label: z.string().trim().min(1).max(240),
      runtimeProjectionId: id.nullable(),
      personaRef: z.object({ id, version: z.number().int().positive() }).strict().nullable(),
      ownerReportedPersonaVersion: z.number().int().positive().nullable(),
      referencesStatus: z.enum(["unresolved", "linked"]),
      ...references,
    }).strict()).min(1).max(2000),
    vacancies: z.array(z.object({
      id, usage: z.enum(["work_phone", "personal_phone"]),
      label: z.string().trim().min(1).max(240), ...references,
    }).strict()).max(100),
  }).strict(),
}).strict().superRefine((v, ctx) => {
  const keys = [...v.catalog.members.map(m => m.key), ...v.catalog.vacancies.map(m => m.id)];
  const projections = v.catalog.members.flatMap(m => m.runtimeProjectionId ? [m.runtimeProjectionId] : []);
  const personas = v.catalog.members.flatMap(m => m.personaRef ? [m.personaRef.id] : []);
  const refs = [...v.catalog.members, ...v.catalog.vacancies]
    .flatMap(m => [m.knowledgeBookDocumentId, m.promptDocumentId].filter((x): x is string => x !== null));
  for (const values of [keys, projections, personas, refs]) if (new Set(values).size !== values.length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Записи, личности и книжки/промпты не дублируются." });
  const katya = v.catalog.members.filter(m => m.runtimeProjectionId === "employee-katya");
  if (katya.length !== 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Нужна одна существующая проекция Кати." });
});
export type SecretaryDepartmentStructure = z.infer<typeof secretaryDepartmentSchema>;
