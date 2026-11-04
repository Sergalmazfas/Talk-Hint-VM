import { z } from "zod";

export const expectedResultSchema = z.object({
  text: z.string().trim().min(1).max(1500),
  appliesTo: z.enum(["secretary_call", "hint_call", "structure", "other"]),
  metrics: z.array(z.object({
    metric: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    operator: z.enum(["lte", "eq", "gte"]),
    value: z.number().finite(),
    unit: z.enum(["turns", "repeats", "ms", "count", "USD", "percent", "tokens"]),
  }).strict()).min(1).max(16),
}).strict().refine(x => new Set(x.metrics.map(m => m.metric)).size === x.metrics.length,
  "Один показатель не должен задаваться дважды");
export type ExpectedResult = z.infer<typeof expectedResultSchema>;
export const technicalExpectation: ExpectedResult = {
  text: "0 изменений продукта без согласования владельца",
  appliesTo: "other",
  metrics: [{ metric: "unauthorized_product_changes", operator: "eq", value: 0, unit: "count" }],
};
