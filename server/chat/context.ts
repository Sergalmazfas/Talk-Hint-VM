import { z } from "zod";

/** Opt-in, foreground phone context. Data, never execution permissions. */
export const phoneContextSchema = z.object({
  localTime: z.string().datetime({ offset: true }),
  timeZone: z.string().max(80).refine(value => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
  }),
  location: z.object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    accuracyMeters: z.number().finite().min(0).max(10000),
    capturedAt: z.string().datetime({ offset: true }),
    label: z.string().max(180).optional(),
  }).strict().optional(),
}).strict();
export type PhoneContext = z.infer<typeof phoneContextSchema>;

export function usablePhoneContext(context?: PhoneContext, now = Date.now()): PhoneContext | undefined {
  if (!context || Math.abs(Date.parse(context.localTime) - now) > 5 * 60_000) return undefined;
  const location = context.location;
  const fresh = location && Math.abs(Date.parse(location.capturedAt) - now) <= 2 * 60_000;
  return { localTime: context.localTime, timeZone: context.timeZone, ...(fresh ? { location } : {}) };
}
