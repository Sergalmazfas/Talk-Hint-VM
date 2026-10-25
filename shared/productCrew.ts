import { z } from "zod";
/** Coordination records live on existing model elements, not in another queue. */
export const crewCoordinationSchema = z.object({
  kind: z.enum(["information", "work", "decision", "role_passport"]),
  state: z.enum(["received", "triaged", "assigned", "blocked", "deferred", "awaiting_review", "accepted", "returned"]),
  classification: z.enum(["fact", "user_report", "hypothesis", "proposal", "problem"]).optional(),
  roleId: z.string().max(120), processId: z.string().max(120),
  relatedIds: z.array(z.string().max(120)).max(40),
  nextStep: z.string().max(3000),
  resultDocumentId: z.string().max(120).optional(),
  /** Claims submitted through ChatGPT are not autonomous executor evidence. */
  origin: z.literal("owner_chatgpt"),
  operations: z.array(z.object({
    id: z.string().uuid(), fingerprint: z.string().max(64), at: z.string().datetime(),
  }).strict()).min(1).max(100),
}).strict();
export type CrewCoordination = z.infer<typeof crewCoordinationSchema>;
