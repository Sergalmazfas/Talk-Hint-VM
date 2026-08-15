// Dev helper: mint a DB session for the benchmark admin and trigger an EARS
// run inside the long-running dev server (survives shell session teardown).
import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db, dbReady } from "../server/db";
import { users, sessions, benchmarkFixtures } from "@shared/schema";

async function main() {
  await dbReady;
  const email = (process.env.BENCHMARK_ADMIN_EMAILS || "").split(",")[0].trim().toLowerCase();
  if (!email) throw new Error("BENCHMARK_ADMIN_EMAILS not set");
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) throw new Error(`no dev user with admin email`);
  const token = randomBytes(32).toString("hex");
  await db.insert(sessions).values({ id: token, userId: user.id, expiresAt: new Date(Date.now() + 3600_000) });
  const [fx] = await db.select({ id: benchmarkFixtures.id }).from(benchmarkFixtures)
    .where(eq(benchmarkFixtures.sourceCallSid, "CAfeca42c3e0ff05eb8e21b86f5096c2f1"));
  if (!fx) throw new Error("Mint fixture not found");
  const res = await fetch("http://127.0.0.1:5000/api/admin/benchmark/ears/run", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fixtureIds: [fx.id] }),
  });
  console.log("HTTP", res.status, await res.text());
  process.exit(0);
}
main().catch((e) => { console.error("FAILED:", e?.message ?? e); process.exit(1); });
