import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComparisonEvaluation, SavedComparison } from "../../shared/secretaryLabComparison";
import { registerComparisonRoutes, type ComparisonReports } from "./comparisonRoutes";
import { comparisonSnapshot, comparisonText } from "./comparisonSnapshot";
import { PgComparisonRepository, type ComparisonRepository } from "./comparisonStore";
import type { RetellReport } from "./retell";

vi.mock("../auth", () => ({
  authMiddleware: (req: any, res: any, next: () => void) => {
    const user = req.headers.authorization?.split(" ")[1];
    if (!["alice", "bob", "ordinary"].includes(user)) return res.sendStatus(401);
    req.user = { id: user, email: user === "ordinary" ? "user@example.test" : "admin@example.test" }; next();
  },
}));
function fixture(): RetellReport {
  return {
    id: randomUUID(), callId: "web-call", status: "ended",
    instruction: "Уточнить время тестовой встречи.", model: "verified-agent-model", voice: "Merritt",
    promptHash: "f".repeat(64), createdAt: new Date().toISOString(), endedAt: new Date().toISOString(),
    monitorStatus: "ended", turns: [{ id: "turn-1", role: "guest", text: "Перенесите на два часа", atMs: 100 }],
    events: [{ type: "session_ended", atMs: 1000 }], observations: [{ atMs: 200, outcome: "stopped", note: "Перебивание слышно" }],
    metrics: { guestTurns: 1, secretaryTurns: 0 },
    engine: {
      provider: "OpenAI via TalkHint", model: "actual-engine-model", testOnly: true, connected: false,
      context: { id: "secretary-dev-fixture", timezone: "test", business: "test", availability: [], permissions: [], restrictions: [] },
      actions: [{ id: "action-1", name: "prepare_test_booking", args: { startsAt: "2026-11-02", note: "Только тест" },
        result: { ok: true, testOnly: true, status: "pending_owner_approval", calendarWritten: false, delivered: false }, status: "pending_owner_approval" }],
      events: [{ type: "test_action_committed", at: new Date().toISOString() }],
    },
  };
}
function repository(): ComparisonRepository {
  const rows = new Map<string, SavedComparison>();
  return {
    async save(_owner, content) {
      const item = { ...structuredClone(content), id: randomUUID(), createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString() };
      rows.set(item.id, item); return structuredClone(item);
    },
    async list() { return structuredClone([...rows.values()]); },
    async get(id) { return rows.has(id) ? structuredClone(rows.get(id)) : undefined; },
    async evaluate(id, evaluation) { const item = rows.get(id); if (item) item.evaluation = evaluation; return item; },
    async remove(id) { return rows.delete(id); },
    async purge() {},
  };
}
describe("explicit Dev-only Secretary comparisons", () => {
  let source: RetellReport, store: ComparisonRepository, reports: ComparisonReports, app: express.Express;
  const auth = (r: request.Test, user = "alice") => r.set("Authorization", `Bearer ${user}`);
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("BENCHMARK_ADMIN_EMAILS", "admin@example.test");
    source = fixture(); store = repository();
    reports = owner => owner === "alice" ? [{ mode: "retell-engine", report: source }] : [];
    app = express(); registerComparisonRoutes(app, store, reports);
  });
  afterEach(() => vi.unstubAllEnvs());
  const base = "/api/admin/secretary-lab/comparisons";
  const saveBody = (s: RetellReport) => ({
    title: "Проверка перебивания", consent: true, sources: [{ mode: "retell-engine", id: s.id }],
    evaluation: { score: 4, note: "Слышно хорошо; телефон не проверялся" },
  });
  it("saves an immutable server snapshot, reads after transient reports disappear, edits and physically deletes", async () => {
    const saved = await auth(request(app).post(base)).send(saveBody(source)).expect(201);
    expect(saved.body.runs[0]).toMatchObject({
      runtime: "Retell voice / TalkHint text Engine", model: "actual-engine-model", voice: "Merritt",
      instruction: source.instruction, observations: source.observations,
    });
    expect(saved.body.runs[0].engine.actions[0].result.calendarWritten).toBe(false);
    expect(Date.parse(saved.body.expiresAt) - Date.parse(saved.body.createdAt)).toBe(30 * 86400_000);
    source.turns[0].text = "changed"; reports = () => [];
    const restarted = express(); registerComparisonRoutes(restarted, store, reports);
    const read = await auth(request(restarted).get(`${base}/${saved.body.id}`), "bob").expect(200);
    expect(read.body.runs[0].turns[0].text).toBe("Перенесите на два часа");
    const listed = await auth(request(restarted).get(base)).expect(200);
    expect(listed.body.items[0].runs[0].turns).toBeUndefined();
    const edit = await auth(request(restarted).patch(`${base}/${saved.body.id}`)).send({ evaluation: { score: 2, note: "Перепроверено" } }).expect(200);
    expect(edit.body.evaluation.score).toBe(2); expect(edit.body.expiresAt).toBe(saved.body.expiresAt);
    await auth(request(restarted).delete(`${base}/${saved.body.id}`)).expect(204);
    await auth(request(restarted).get(`${base}/${saved.body.id}`)).expect(404);
    expect((await store.list()).length).toBe(0);
  });
  it("requires separate storage consent and rejects browser report bodies/unsupported actions and invalid scores", async () => {
    for (const changes of [
      { consent: false }, { consent: undefined }, { report: source }, { access_token: "never" },
      { evaluation: { score: 0, note: "" } }, { evaluation: { score: 6, note: "" } },
      { sources: [{ mode: "telephone", id: source.id }] },
    ]) await auth(request(app).post(base)).send({ ...saveBody(source), ...changes }).expect(400);
    expect(await store.list()).toEqual([]);
  });
  it("checks authorization for list/detail/candidates/create/update/delete and disables all in production", async () => {
    for (const path of [base, `${base}/candidates`, `${base}/${randomUUID()}`]) {
      await request(app).get(path).expect(401);
      await auth(request(app).get(path), "ordinary").expect(403);
    }
    for (const method of ["post", "patch", "delete"] as const) {
      const path = method === "post" ? base : `${base}/${randomUUID()}`;
      await auth(request(app)[method](path), "ordinary").send(saveBody(source)).expect(403);
      await request(app)[method](path).send(saveBody(source)).expect(401);
    }
    vi.stubEnv("NODE_ENV", "production");
    for (const path of [base, `${base}/candidates`, `${base}/${randomUUID()}`])
      await auth(request(app).get(path)).expect(404);
    await auth(request(app).post(base)).send(saveBody(source)).expect(404);
    await auth(request(app).patch(`${base}/${source.id}`)).send({ evaluation: { score: 1, note: "" } }).expect(404);
    await auth(request(app).delete(`${base}/${source.id}`)).expect(404);
  });
  it("only picks the current owner's completed reports; never copies other-owner, active or expired sessions", async () => {
    expect((await auth(request(app).get(`${base}/candidates`), "bob")).body.runs).toEqual([]);
    await auth(request(app).post(base), "bob").send(saveBody(source)).expect(404);
    source.status = "live";
    await auth(request(app).post(base)).send(saveBody(source)).expect(404);
    source.status = "stop_failed";
    await auth(request(app).post(base)).send(saveBody(source)).expect(404);
    source.status = "ended";
    await auth(request(app).post(base)).send({ ...saveBody(source), sources: [{ mode: "retell-engine", id: randomUUID() }] }).expect(404);
  });
  it("requires identical original assignments across modes and rejects duplicate runs", async () => {
    const other = fixture(); other.instruction = "Different task";
    const multi = express();
    registerComparisonRoutes(multi, store, () => [{ mode: "retell", report: source }, { mode: "retell-engine", report: other }]);
    const body = { ...saveBody(source), sources: [{ mode: "retell", id: source.id }, { mode: "retell-engine", id: other.id }] };
    await auth(request(multi).post(base)).send(body).expect(409);
    other.instruction = source.instruction;
    const saved = await auth(request(multi).post(base)).send(body).expect(201);
    expect(saved.body.runs).toHaveLength(2);
    await auth(request(multi).post(base)).send({ ...body, sources: [body.sources[0], body.sources[0]] }).expect(400);
  });
  it("never persists admissions, capabilities, arbitrary provider blobs or real calendar/notification objects", () => {
    const capability = "a".repeat(64), admission = "one-use-admission";
    const dirty: any = source;
    dirty.call = { access_token: admission, ice_servers: ["private"] };
    dirty.access_token = admission;
    dirty.engine.context.realCalendar = { private: admission };
    dirty.engine.actions[0].args.access_token = admission;
    dirty.engine.actions[0].result.notification = { access_token: admission };
    dirty.engine.actions.push({ name: "send_real_notification", args: { access_token: admission } });
    dirty.events.push({ type: "error", atMs: 1, detail: `wss://example.test/retell-engine-stream/${capability}/call?access_token=${admission} Bearer ${admission}` });
    dirty.turns[0].text = `access_token=${admission} talkhint_engine_ticket: ${capability} /retell-engine-stream/${capability}/call`;
    const encoded = JSON.stringify(comparisonSnapshot("retell-engine", dirty));
    expect(encoded).not.toContain(admission); expect(encoded).not.toContain(capability);
    expect(encoded).not.toContain("wss://"); expect(encoded).not.toContain("realCalendar");
    expect(encoded).not.toContain("send_real_notification"); expect(encoded).not.toContain("ice_servers");
    expect(encoded).toContain(source.promptHash); // Non-secret digest is explicitly allowlisted.
    expect(comparisonText('{"authorization":"Bearer abc", "access_token":"xyz"}')).not.toContain("xyz");
  });
  it("captures GPT's actual transport/model/voice and verification, never an assumed Retell runtime", () => {
    const gpt: any = { ...source, status: "ended", transport: "webrtc", voiceProvider: "openai", modelVerified: true, engine: undefined };
    const result = comparisonSnapshot("gpt", gpt);
    expect(result.runtime).toBe("TalkHint / webrtc / openai");
    expect(result.model).toBe(source.model); expect(result.verification).toBe("model_verified_by_runtime");
    expect(result).not.toHaveProperty("callId"); expect(result).not.toHaveProperty("engine");
  });
  it("returns an explicit storage error, not false success or an in-memory fallback", async () => {
    store.save = async () => { throw new Error("internal database credentials must not leak"); };
    const result = await auth(request(app).post(base)).send(saveBody(source)).expect(503);
    expect(result.body.error).toContain("не сохранены"); expect(result.body.error).not.toContain("credentials");
  });
});

describe("comparison SQL retention and durability contract", () => {
  it("uses database timestamps/30-day expiry, SQL parameters and an immutable expiry on edits", async () => {
    const row = { id: randomUUID(), title: "test", instruction: "test assignment",
      created_at: new Date(), expires_at: new Date(Date.now() + 30 * 86400_000), runs: [], evaluation: { score: null, note: "" } };
    const query = vi.fn(async () => ({ rows: [row], rowCount: 1 }));
    const store = new PgComparisonRepository({ query } as any);
    await store.save("owner", { title: "test", instruction: "test assignment", runs: [], evaluation: { score: null, note: "" } });
    expect((query.mock.calls[0] as any)[0]).toContain("interval '30 days'");
    expect((query.mock.calls[0] as any)[1][1]).toBe("owner");
    await store.evaluate(row.id, { score: 5, note: "manual" });
    const update = (query.mock.calls[1] as any)[0] as string;
    expect(update).toContain("expires_at > now()"); expect(update.split("WHERE")[0]).not.toContain("expires_at");
    await store.list(); await store.get(row.id); await store.remove(row.id); await store.purge();
    for (const i of [2, 3, 4]) expect((query.mock.calls[i] as any)[0]).toContain("expires_at > now()");
    expect((query.mock.calls[5] as any)[0]).toContain("DELETE FROM secretary_lab_comparisons WHERE expires_at <= now()");
  });
});
