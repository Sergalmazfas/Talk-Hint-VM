import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { registerTeamRoutes } from "./routes";
import { TEAM_OWNER, TEAM_PLAN_HASH, DIRECTORY } from "./plan";
import { semanticHash } from "../companyData/valueTree";
import { PARTNERS_BASE, PARTNERS_DOCUMENT_HASH, partnersDocument, partnersState, validPartnersPin } from "./partnersApproval";

function setup() {
  const c: any = { workspace: PARTNERS_BASE.workspace, owner: TEAM_OWNER, revision: 918,
    rootHash: PARTNERS_BASE.rootHash, phase: "active", writesOpen: true, actor: `team-package:${TEAM_PLAN_HASH}:3`,
    documents: [{ id: DIRECTORY, text: JSON.stringify({ packageHash: TEAM_PLAN_HASH }) }],
    profiles: [], roles: [], prompts: [], jobs: [], controls: [], revisions: [],
    operating: { version: 41, data: { nodes: [], links: [] } } };
  const session: any = { save: (cb: any) => cb() };
  const repository: any = { read: vi.fn(async () => structuredClone(c)), apply: vi.fn(),
    applyPartners: vi.fn(async (_owner, pin) => {
      if (c.revision !== pin.revision || c.rootHash !== pin.rootHash) throw Error("CAS");
      c.revision = 919; c.documents.push(partnersDocument()); c.rootHash = "d".repeat(64);
    }) };
  const app = express(); app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = { id: req.get("x-user") ?? TEAM_OWNER };
    req.isAuthenticated = () => req.get("x-auth") !== "no";
    req.session = req.get("x-session") === "no" ? null : session; next();
  });
  const portrait = vi.fn(async () => Buffer.from("fixture"));
  registerTeamRoutes(app, async () => { throw Error("No real DB"); },
    { environment: "production", repository, portrait, guard: (_req, _res, next) => next() });
  const headers = (r: any, csrf?: string) => {
    r.set("Host", "talkhint.test").set("Origin", "http://talkhint.test");
    if (csrf) r.set("x-team-csrf", csrf); return r;
  };
  const status = () => headers(request(app).get("/api/admin/team"));
  const post = (action: string, csrf: string, body: any) =>
    headers(request(app).post(`/api/admin/team/partners/${action}`), csrf).send(body);
  async function ready() {
    const v = (await status()).body;
    const body = { expected: v.partners.pin, confirm: true };
    const grant = (await post("grant", v.apply.csrfToken, body)).body.grant;
    return { v, body, grant };
  }
  return { c, session, repository, portrait, app, status, headers, post, ready };
}
describe("reviewed single-document owner application", () => {
  it("freezes exactly the approved document and only returns independent copies", () => {
    const d = partnersDocument(); expect(semanticHash(d)).toBe(PARTNERS_DOCUMENT_HASH);
    d.text = "changed"; expect(semanticHash(partnersDocument())).toBe(PARTNERS_DOCUMENT_HASH);
    expect(validPartnersPin(PARTNERS_BASE)).toBe(true);
  });
  it.each([null, {}, { ...PARTNERS_BASE, revision: 919 }, { ...PARTNERS_BASE, extra: true },
    { ...PARTNERS_BASE, documentHash: "0".repeat(64) }, { ...PARTNERS_BASE, workspace: "other" }])(
    "rejects malformed/non-reviewed pin %j", pin => expect(validPartnersPin(pin)).toBe(false));
  it("GET cannot grant or write and first package stays complete", async () => {
    const s = setup(), r = await s.status();
    expect(r.body.partners.available).toBe(true); expect(r.body.apply.completed).toBe(4);
    expect(r.body.apply.available).toBe(false); expect(s.session.teamPartnersGrant).toBeUndefined();
    expect(s.repository.applyPartners).not.toHaveBeenCalled(); expect(s.portrait).not.toHaveBeenCalled();
  });
  it.each(["revision", "rootHash", "workspace", "writesOpen", "phase", "document"])(
    "stops on changed %s, without a grant", async field => {
      const s = setup(), v = (await s.status()).body;
      if (field === "revision") s.c.revision++;
      if (field === "rootHash") s.c.rootHash = "f".repeat(64);
      if (field === "workspace") s.c.workspace = "other";
      if (field === "writesOpen") s.c.writesOpen = false;
      if (field === "phase") s.c.phase = "verifying";
      if (field === "document") s.c.documents.push(partnersDocument());
      expect((await s.post("grant", v.apply.csrfToken, { expected: PARTNERS_BASE, confirm: true })).status).toBe(409);
      expect(s.session.teamPartnersGrant).toBeUndefined(); expect(s.repository.applyPartners).not.toHaveBeenCalled();
    });
  it.each(["auth", "owner", "session", "bearer", "origin", "csrf", "cross-site"])("enforces %s", async kind => {
    const s = setup(), v = (await s.status()).body;
    const r = s.headers(request(s.app).post("/api/admin/team/partners/grant"), v.apply.csrfToken)
      .send({ expected: PARTNERS_BASE, confirm: true });
    if (kind === "auth") r.set("x-auth", "no");
    if (kind === "owner") r.set("x-user", "other");
    if (kind === "session") r.set("x-session", "no");
    if (kind === "bearer") r.set("Authorization", "Bearer bad");
    if (kind === "origin") r.set("Origin", "https://other.test");
    if (kind === "csrf") r.set("x-team-csrf", "a".repeat(64));
    if (kind === "cross-site") r.set("sec-fetch-site", "cross-site");
    expect((await r).status).toBe(403); expect(s.repository.applyPartners).not.toHaveBeenCalled();
  });
  it("does not accept an arbitrary replacement document", async () => {
    const s = setup(), v = (await s.status()).body;
    expect((await s.post("grant", v.apply.csrfToken,
      { expected: PARTNERS_BASE, confirm: true, document: {} })).status).toBe(400);
  });
  it("requires verified portrait reads before a grant", async () => {
    const s = setup(), v = (await s.status()).body;
    s.portrait.mockRejectedValueOnce(Error("missing"));
    expect((await s.post("grant", v.apply.csrfToken, { expected: PARTNERS_BASE, confirm: true })).status).toBe(503);
    expect(s.session.teamPartnersGrant).toBeUndefined();
  });
  it("consumes once, applies one new revision, and rejects replay or another grant", async () => {
    const s = setup(), { v, body, grant } = await s.ready();
    const done = await s.post("apply", v.apply.csrfToken, { ...body, grant });
    expect(done.status).toBe(200); expect(done.body.partners.completed).toBe(true);
    expect(done.body.apply.completed).toBe(4);
    expect(done.body.source.revision).toBe(919); expect(s.repository.applyPartners).toHaveBeenCalledTimes(1);
    expect(s.repository.apply).not.toHaveBeenCalled();
    expect((await s.post("apply", v.apply.csrfToken, { ...body, grant })).status).toBe(409);
    expect((await s.post("grant", v.apply.csrfToken, body)).status).toBe(409);
  });
  it.each(["expired", "wrong-token", "other-session", "first-package-token"])("rejects %s", async kind => {
    const s = setup(), { v, body, grant } = await s.ready();
    let sent = grant;
    if (kind === "expired") s.session.teamPartnersGrant.expires = 0;
    if (kind === "wrong-token") sent = "b".repeat(64);
    if (kind === "other-session") delete s.session.teamPartnersGrant;
    if (kind === "first-package-token") { s.session.teamGrant = s.session.teamPartnersGrant; delete s.session.teamPartnersGrant; }
    expect((await s.post("apply", v.apply.csrfToken, { ...body, grant: sent })).status).toBe(403);
    expect(s.repository.applyPartners).not.toHaveBeenCalled();
  });
  it("does not replay after a writer error or lost/uncertain response", async () => {
    const s = setup(), { v, body, grant } = await s.ready();
    s.repository.applyPartners.mockRejectedValueOnce(Error("uncertain"));
    expect((await s.post("apply", v.apply.csrfToken, { ...body, grant })).status).toBe(503);
    expect(s.session.teamPartnersGrant).toBeUndefined();
    await s.status(); expect(s.repository.applyPartners).toHaveBeenCalledTimes(1);
    expect((await s.post("apply", v.apply.csrfToken, { ...body, grant })).status).toBe(403);
  });
  it("recovers by GET only when the write committed but its response could not be built", async () => {
    const s = setup(), { v, body, grant } = await s.ready();
    s.repository.read.mockImplementationOnce(async () => structuredClone(s.c))
      .mockRejectedValueOnce(Error("read after committed write unavailable"));
    expect((await s.post("apply", v.apply.csrfToken, { ...body, grant })).status).toBe(503);
    expect(s.c.revision).toBe(919); expect(s.session.teamPartnersGrant).toBeUndefined();
    expect((await s.status()).body.partners.completed).toBe(true);
    expect(s.repository.applyPartners).toHaveBeenCalledTimes(1);
    expect((await s.post("apply", v.apply.csrfToken, { ...body, grant })).status).toBe(409);
  });
  it("does not write when consuming the grant cannot be saved", async () => {
    const s = setup(), { v, body, grant } = await s.ready();
    s.session.save = (cb: any) => cb(Error("session unavailable"));
    expect((await s.post("apply", v.apply.csrfToken, { ...body, grant })).status).toBe(503);
    expect(s.repository.applyPartners).not.toHaveBeenCalled();
  });
  it("recognizes an exact existing document, not a merely matching id", () => {
    const s = setup(); s.c.revision = 919; s.c.documents.push(partnersDocument());
    expect(partnersState(s.c).completed).toBe(true);
    s.c.documents.find((d: any) => d.id === partnersDocument().id).text += " ";
    expect(partnersState(s.c).completed).toBe(false);
    expect(partnersState(s.c).available).toBe(false);
  });
});
