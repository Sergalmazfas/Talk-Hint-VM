import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
const documentId = text(120).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
/** Descriptions only: these fields never configure an agent or grant access. */
export const employeeWorkplaceSchema = z.object({
  description: text(4000),
  inputs: z.array(text(1000)).max(20),
  outputs: z.array(text(1000)).max(20),
  sourceDocumentIds: z.array(documentId).max(20),
  laboratory: z.object({
    title: text(240), description: text(3000), documentId: documentId.nullable(),
  }).strict().nullable(),
  limitations: z.array(text(1000)).max(20),
}).strict();

/** A recommendation cannot be an enabled/runtime model configuration. */
export const employeeModelRecommendationSchema = z.object({
  modelId: text(120).nullable(),
  family: text(120).nullable(),
  rationale: text(3000),
  source: text(1000),
  enabled: z.literal(false),
  status: z.literal("proposed"),
}).strict();

export const employeeSectionsSchema = z.object({
  workplace: employeeWorkplaceSchema.optional(),
  modelRecommendation: employeeModelRecommendationSchema.optional(),
}).strict();
export type EmployeeSections = z.infer<typeof employeeSectionsSchema>;

/** Bad descriptive data must not take down the owner's entire team page. */
export function readEmployeeSections(value: unknown): EmployeeSections | null {
  const parsed = employeeSectionsSchema.passthrough().safeParse(value);
  return parsed.success ? {
    ...(parsed.data.workplace ? { workplace: parsed.data.workplace } : {}),
    ...(parsed.data.modelRecommendation ? { modelRecommendation: parsed.data.modelRecommendation } : {}),
  } : null;
}
