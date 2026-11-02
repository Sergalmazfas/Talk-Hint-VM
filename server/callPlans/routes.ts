import type { Express, RequestHandler } from "express";
import type { CallPlanStore } from "./store";

/** App-session auth only; never accepts ChatGPT credentials or an owner ID from input. */
export function registerPreparedHintPlans(app: Express, authenticate: RequestHandler,
  getStore: () => Promise<Pick<CallPlanStore, "pending">>) {
  app.get("/api/prepare/hint-plans", authenticate, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const owner = (req as any).user?.id;
    if (typeof owner !== "string" || !owner) return res.status(401).json({ error: "Authentication required" });
    try {
      const plans = await (await getStore()).pending(owner);
      return res.json({ plans, serverTime: new Date().toISOString() });
    } catch {
      // No plan contents, raw database messages or auth material in responses/logs.
      return res.status(503).json({ error: "Prepared Hint plans unavailable" });
    }
  });
}
