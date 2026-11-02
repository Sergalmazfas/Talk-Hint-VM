import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
const db = vi.hoisted(() => ({ mode: "legacy", revision: 0, writes: 0 }));
vi.mock("../db", () => ({ pool: { query: async (sql: string, values: any[]) => {
  if (values[0] !== "owner") throw Error("WRONG_OWNER");
  if (sql.startsWith("UPDATE")) {
    if (values[2] !== db.revision) return { rows: [] };
    db.mode = values[1]; db.revision++; db.writes++;
  }
  return { rows: [{ mode: db.mode, revision: db.revision }] };
} } }));
vi.mock("../benchmark/adminGate", () => ({ requireBenchmarkAdmin: (req: any, res: any, next: any) => {
  if (req.get("x-test-owner") !== "yes") return res.status(403).end();
  req.user = { id: "owner" }; next();
} }));
import { registerLiveHintModeRoutes } from "../liveHintModeRoutes";
let server: Server, url: string, session: Record<string, unknown>;
beforeAll(async () => {
  const app = express(); app.use(express.json());
  app.use((req: any, _res, next) => { req.session = session; next(); });
  registerLiveHintModeRoutes(app);
  server = createServer(app); await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); });
beforeEach(() => { session = {}; db.mode = "legacy"; db.revision = 0; db.writes = 0; });
async function state() {
  const response = await fetch(url + "/api/admin/hint-mode", { headers: { "x-test-owner": "yes" } });
  return response.json();
}
async function write(csrf: string, revision: number, mode = "english-first", origin = url, confirmed = true) {
  return fetch(url + "/api/admin/hint-mode", { method: "PUT",
    headers: { "x-test-owner": "yes", origin, "Content-Type": "application/json", "x-hint-mode-csrf": csrf },
    body: JSON.stringify({ mode, revision, confirmed }) });
}
describe("owner switch authorization / CAS / readback", () => {
  it("denies anonymous and foreign-origin requests without writing", async () => {
    expect((await fetch(url + "/api/admin/hint-mode")).status).toBe(403);
    const s = await state();
    expect((await write(s.csrf, 0, "english-first", "https://attacker.invalid")).status).toBe(403);
    expect(db.writes).toBe(0);
  });
  it("requires session CSRF and explicit confirmation", async () => {
    const s = await state();
    expect((await write("a".repeat(64), 0)).status).toBe(403);
    expect((await write(s.csrf, 0, "english-first", url, false)).status).toBe(400);
    expect(db.writes).toBe(0);
  });
  it("writes once, re-reads, rejects stale revision, and rolls back", async () => {
    const s = await state(); expect(s.mode).toBe("legacy");
    const changed = await write(s.csrf, 0); expect(changed.status).toBe(200);
    expect(await changed.json()).toEqual({ mode: "english-first", revision: 1 });
    expect((await write(s.csrf, 0)).status).toBe(409);
    expect((await write(s.csrf, 1, "legacy")).status).toBe(200);
    expect((await state()).mode).toBe("legacy"); expect(db.writes).toBe(2);
  });
  it("owner page uses fresh state, confirmation, no automatic enabling", async () => {
    const r = await fetch(url + "/admin/hint-mode", { headers: { "x-test-owner": "yes" } });
    const html = await r.text();
    expect(html).toContain("Вы уверены?");
    expect(html).toContain("await read();buttons");
    expect(html).toContain("state.revision!==w.revision");
    expect(db.writes).toBe(0);
  });
});
