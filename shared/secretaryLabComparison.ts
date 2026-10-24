import { z } from "zod";

export const comparisonMode = z.enum(["gpt", "retell", "retell-engine", "eleven-engine"]);
export const comparisonEvaluation = z.object({
  score: z.number().int().min(1).max(5).nullable(),
  note: z.string().max(4000),
}).strict();
export const comparisonSaveInput = z.object({
  title: z.string().trim().min(1).max(160),
  consent: z.literal(true),
  sources: z.array(z.object({ mode: comparisonMode, id: z.string().uuid() }).strict()).min(1).max(6),
  evaluation: comparisonEvaluation,
}).strict();
export const comparisonEditInput = z.object({ evaluation: comparisonEvaluation }).strict();
export type ComparisonMode = z.infer<typeof comparisonMode>;
export type ComparisonEvaluation = z.infer<typeof comparisonEvaluation>;
export type ComparisonSource = z.infer<typeof comparisonSaveInput>["sources"][number];

export interface ComparisonRun {
  mode: ComparisonMode;
  id: string;
  runtime: string;
  model: string;
  voice: string;
  instruction: string;
  status: string;
  createdAt: string;
  endedAt?: string;
  /** Configuration verification is not evidence of audible speech or PSTN quality. */
  verification: string;
  [key: string]: unknown;
}
export interface SavedComparison {
  id: string;
  title: string;
  instruction: string;
  createdAt: string;
  expiresAt: string;
  evaluation: ComparisonEvaluation;
  runs: ComparisonRun[];
}
