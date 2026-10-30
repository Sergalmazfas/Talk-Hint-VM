import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { registerTeamRoutes, validPin } from "./routes";
import { TEAM_OWNER, TEAM_PLAN_HASH, TEAM_ROOTS } from "./plan";
import { verifiedPortrait, portraitManifest } from "./portraits";
import { TeamRepository } from "./repository";

function setup(environment = "production", failPortrait = false) {
  const c: any = { workspace: "company-import-7cf8767b-fbeb-4e97-939f-cc2c3767cf3a",
    owner: TEAM_OWNER, revision: 914, rootHash: TEAM_ROOTS[0], phase: "active", writesOpen: true,
    actor: "prior", documents: [], profiles: [], roles: [], prompts: [], jobs: [], controls: [], revisions: [],
    operating: { version: 41, data: { nodes: [], links: [] } } };
  const repository: any = { read: vi.fn(async () => structuredClone(c)),
    apply: vi.fn(async (_owner, pin) => {
      if (c.revision !== pin.revision) throw Error("CAS");
      c.revision++; c.rootHash = TEAM_ROOTS[pin.step + 1];
      c.actor = `team-package:${TEAM_PLAN_HASH}:${pin.step}`;
    }) };
  const session: any = { save: (cb: any) => cb() };
  const app = express(); app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = { id: req.get("x-user") ?? TEAM_OWNER };
    req.isAuthenticated = () => req.get("x-auth") !== "no";
    req.session = req.get("x-session") === "no" ? null : session; next();
  });
  const portrait: any = vi.fn(async () => {
    if (failPortrait) throw Error("storage unavailable");
    return Buffer.from("fixture-image");
  });
  registerTeamRoutes(app, async () => { throw Error("must use injected repository"); },
    { environment, repository, guard: (_req, _res, next) => next(), portrait });
  const headers = (r: any, csrf?: string) => {
    r.set("Host", "talkhint.test").set("Origin", "http://talkhint.test");
    return csrf ? r.set("x-team-csrf", csrf) : r;
  };
  const status = () => headers(request(app).get("/api/admin/team"));
  const post = (path: string, csrf: string, body: any) => headers(request(app).post(`/api/admin/team/${path}`), csrf).send(body);
  return { app, c, repository, session, portrait, headers, status, post };
}
describe("owner-only pinned team application", () => {
  it("GET only reads; no grant or data write", async () => {
    const s = setup(), r = await s.status();
    expect(r.status).toBe(200); expect(r.body.apply.available).toBe(true);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(s.session.teamGrant).toBeUndefined(); expect(s.repository.apply).not.toHaveBeenCalled();
    expect(s.portrait).not.toHaveBeenCalled();
  });
  it.each([{ "x-user": "other" }, { "x-auth": "no" }, { "x-session": "no" }, { authorization: "Bearer anything" }])(
    "rejects missing/wrong owner session or bearer: %j", async h => {
      const s = setup(); expect((await s.status().set(h)).status).toBe(403);
      expect(s.repository.read).not.toHaveBeenCalled();
    });
  it("never reads a Dev source or writes to frozen Dev", async () => {
    const s = setup("development");
    expect((await s.status()).status).toBe(503);
    expect(s.repository.read).not.toHaveBeenCalled(); expect(s.repository.apply).not.toHaveBeenCalled();
  });
  it.each(["missing-origin", "foreign-origin", "csrf", "cross-site"])("rejects %s", async kind => {
    const s = setup(), view = (await s.status()).body;
    const r = s.headers(request(s.app).post("/api/admin/team/grant"), view.apply.csrfToken)
      .send({ expected: view.apply.pin, confirm: true });
    if (kind === "missing-origin") r.unset("Origin");
    if (kind === "foreign-origin") r.set("Origin", "https://foreign.test");
    if (kind === "csrf") r.set("x-team-csrf", "a".repeat(64));
    if (kind === "cross-site") r.set("sec-fetch-site", "cross-site");
    expect((await r).status).toBe(403); expect(s.repository.apply).not.toHaveBeenCalled();
  });
  it.each(["extra-key", "wrong-plan", "null-pin", "no-confirm", "extra-pin-field"])("denies malformed %s", async kind => {
    const s = setup(), v = (await s.status()).body, body: any = { expected: v.apply.pin, confirm: true };
    if (kind === "extra-key") body.command = { type: "anything" };
    if (kind === "wrong-plan") body.expected.planHash = "b".repeat(64);
    if (kind === "null-pin") body.expected = null;
    if (kind === "no-confirm") body.confirm = false;
    if (kind === "extra-pin-field") body.expected.owner = "other";
    expect((await s.post("grant", v.apply.csrfToken, body)).status).toBe(400);
  });
  it("requires exact current root/revision and phase, not only the recipe hash", async () => {
    const s = setup(), v = (await s.status()).body;
    const body = { expected: { ...v.apply.pin, rootHash: "f".repeat(64) }, confirm: true };
    expect((await s.post("grant", v.apply.csrfToken, body)).status).toBe(409);
    s.c.writesOpen = false;
    expect((await s.post("grant", v.apply.csrfToken, { expected: v.apply.pin, confirm: true })).status).toBe(409);
    expect(s.repository.apply).not.toHaveBeenCalled();
  });
  it("verifies portraits before granting; unavailable storage cannot change the model", async () => {
    const s = setup("production", true), v = (await s.status()).body;
    expect((await s.post("grant", v.apply.csrfToken, { expected: v.apply.pin, confirm: true })).status).toBe(503);
    expect(s.session.teamGrant).toBeUndefined(); expect(s.repository.apply).not.toHaveBeenCalled();
  });
  it("applies four explicitly granted CAS steps, denies replay, then disables application", async () => {
    const s = setup(); let v = (await s.status()).body;
    for (let step = 0; step < 4; step++) {
      const body = { expected: v.apply.pin, confirm: true };
      const grant = (await s.post("grant", v.apply.csrfToken, body)).body.grant;
      expect(grant).toMatch(/^[a-f0-9]{64}$/);
      const applied = await s.post("apply", v.apply.csrfToken, { ...body, grant });
      expect(applied.status).toBe(200);
      expect(s.session.teamGrant).toBeUndefined();
      expect((await s.post("apply", v.apply.csrfToken, { ...body, grant })).status).toBe(409);
      v = applied.body;
    }
    expect(v.source.revision).toBe(918); expect(v.apply.available).toBe(false);
    expect(s.repository.apply).toHaveBeenCalledTimes(4);
  });
  it("denies an expired or missing grant", async () => {
    const s = setup(), v = (await s.status()).body, body = { expected: v.apply.pin, confirm: true };
    expect((await s.post("apply", v.apply.csrfToken, { ...body, grant: "f".repeat(64) })).status).toBe(403);
    const grant = (await s.post("grant", v.apply.csrfToken, body)).body.grant;
    s.session.teamGrant.expires = 0;
    expect((await s.post("apply", v.apply.csrfToken, { ...body, grant })).status).toBe(403);
  });
  it("consumes a grant before a failed writer; a status refresh does not replay it", async () => {
    const s = setup(), v = (await s.status()).body, body = { expected: v.apply.pin, confirm: true };
    s.repository.apply.mockRejectedValueOnce(Error("writer unavailable"));
    const grant = (await s.post("grant", v.apply.csrfToken, body)).body.grant;
    expect((await s.post("apply", v.apply.csrfToken, { ...body, grant })).status).toBe(503);
    expect(s.session.teamGrant).toBeUndefined();
    await s.status();
    expect(s.repository.apply).toHaveBeenCalledTimes(1);
    expect((await s.post("apply", v.apply.csrfToken, { ...body, grant })).status).toBe(403);
  });
  it("rejects unknown actions, action GETs and unknown portrait paths", async () => {
    const s = setup();
    expect((await s.headers(request(s.app).get("/api/admin/team/grant"))).status).toBe(405);
    expect((await s.headers(request(s.app).post("/api/admin/team/start-agent"))).status).toBe(404);
    expect((await s.headers(request(s.app).get("/api/admin/team/portraits/maria/bad"))).status).toBe(404);
  });
  it("rejects invalid pins and corrupt portrait bytes", async () => {
    expect(validPin(null)).toBe(false); expect(validPin({})).toBe(false);
    const sdk: any = { downloadAsBytes: vi.fn(async () => ({ ok: true, value: [Buffer.from("corrupt")] })) };
    await expect(verifiedPortrait("maria", portraitManifest.maria.sha256, sdk)).rejects.toThrow("digest mismatch");
    await expect(verifiedPortrait("other", "f".repeat(64), sdk)).rejects.toThrow("Unknown portrait");
  });
  it("repository rejects a normalized Dev workspace without reading its frames", async () => {
    const query = vi.fn(async (sql: string) => ({ rows: sql.startsWith("SELECT w.") ?
      [{ schema_version: 3, generation: "normalized", phase: "active" }] : [] }));
    const db: any = { query, release: vi.fn() }, pool: any = { connect: async () => db };
    await expect(new TeamRepository(pool, "development").read(TEAM_OWNER)).rejects.toThrow("production");
    expect(query.mock.calls.some(([sql]) => /INSERT|UPDATE|DELETE/.test(sql))).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql.includes("company_v3_frames"))).toBe(false);
  });
});
