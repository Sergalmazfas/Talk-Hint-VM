import { pool, dbReady } from "../db";
import { CallPlanStore } from "./store";
export async function callPlans() {
  await dbReady;
  if (!pool) throw Object.assign(new Error("Call plan storage unavailable"), { status: 503 });
  return new CallPlanStore(pool);
}
