import { z } from "zod";

export const labPersonalitySelection = z.object({
  id: z.string().min(1).max(100),
  version: z.number().int().positive(),
  mode: z.enum(["personal", "work"]),
}).strict();
export type LabPersonalitySelection = z.infer<typeof labPersonalitySelection>;
export type LabPersonalitySummary = LabPersonalitySelection & { name: string };
