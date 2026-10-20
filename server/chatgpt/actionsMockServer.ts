import express from "express";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { registerChatGPTIntegration } from "./routes";
import { digest, fail, type Marker, type MarkerStore } from "./security";
import type { SecretaryBackend } from "./secretary";

export const MOCK_PHONE = "+12025550123"; // Reserved fictional 555-0123.
export const MOCK_OWNER = "talkhint-synthetic-owner";
export const MOCK_EMAIL = "owner@talkhint.test";
export const MOCK_CLIENT = "talkhint-secretary-test-actions";

interface Options {
  origin: string;
  redirectUri: string;
  clientSecret: string;
  ownerPassword: string;
  outbound?: boolean;
}
/** Only transport/protocol fixtures. No DB, native auth, Secretary worker or dialer imports. */
export function createActionsMockServer(options: Options) {
  const origin = new URL(options.origin);
  if (origin.origin !== options.origin || origin.protocol !== "https:" || origin.port ||
      options.clientSecret.length < 32 || options.ownerPassword.length < 32 ||
      digest(options.clientSecret) === digest(options.ownerPassword))
    throw new Error("Mock server needs an HTTPS origin on 443 and separate strong test credentials");
  const signingKey = randomBytes(48).toString("base64url");
  const rows = new Map<string, Marker>();
  const store: MarkerStore = {
    async put(row) { if (!rows.has(row.id)) rows.set(row.id, row); },
    async get(id) {
      const row = rows.get(id);
      return row && row.expiresAt.getTime() > Date.now() ? row : undefined;
    },
    async consume(id) {
      const row = await store.get(id);
      // No await between comparison and deletion: concurrent consumes have one winner.
      if (row && rows.get(id) === row) { rows.delete(id); return row; }
    },
    async list(userId) {
      return Array.from(rows.values()).filter(r => r.userId === userId &&
        r.id.startsWith("chatgpt:grant:") && r.expiresAt.getTime() > Date.now());
    },
    async expire(id, userId) { if (rows.get(id)?.userId === userId) rows.delete(id); },
  };
  type Task = { id: string; status: string; clientRequestId: string; phoneNumber: string;
    instruction: string; summary: string; mock: true; mockDispatches: number };
  const tasks = new Map<string, Task>();
  let dispatches = 0;
  const own = (id: string) => { if (id !== MOCK_OWNER) fail(404, "Owned record not found"); };
  const record = { id: "synthetic-call", status: "completed", mock: true,
    direction: "outgoing", fromNumber: MOCK_PHONE, toNumber: MOCK_PHONE,
    startedAt: new Date("2026-01-01T12:00:00Z"), endedAt: new Date("2026-01-01T12:01:00Z"),
    secretaryTaskId: null,
    phoneNumber: MOCK_PHONE, summary: "[TEST] Fictional opening-hours result; no call occurred." };
  const backend: SecretaryBackend = {
    async history(owner) { own(owner); return [record] as any; },
    async call(owner, id, transcript) {
      own(owner);
      if (id !== record.id) return fail(404, "Owned record not found");
      return { ...record, ...(transcript ? { transcript: "[TEST] Synthetic transcript only." } : {}) };
    },
    async tasks(owner) { own(owner); return Array.from(tasks.values()) as any; },
    async task(owner, id, transcript) {
      own(owner);
      const row = Array.from(tasks.values()).find(row => row.id === id);
      if (!row) return fail(404, "Owned record not found");
      return { ...row, ...(transcript ? { transcript: "[TEST] No real conversation occurred." } : {}) } as any;
    },
    async incoming() { return fail(403, "Incoming calls are not available in the mock server"); },
    async start(owner, input) {
      own(owner);
      if (input.phoneNumber !== MOCK_PHONE) return fail(400, "Only the fictional test number is permitted");
      const old = tasks.get(input.clientRequestId);
      if (old) {
        if (old.instruction !== input.instruction || old.phoneNumber !== input.phoneNumber)
          return fail(409, "Request identity conflicts with an existing test task");
        return { task: old, reused: true } as any;
      }
      // Synchronous lease before any await. There is deliberately no provider call.
      const task: Task = { id: randomUUID(), status: "completed", clientRequestId: input.clientRequestId,
        phoneNumber: input.phoneNumber, instruction: input.instruction, mock: true, mockDispatches: 1,
        summary: "[TEST] Mock Secretary completed. No number was dialed." };
      tasks.set(input.clientRequestId, task);
      dispatches++;
      return { task, reused: false } as any;
    },
  };
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.use((_req, res, next) => {
    res.set({ "Cache-Control": "no-store", "X-TalkHint-Environment": "mock-only" });
    // Mark the reused first-party pages visibly, not just in API headers.
    const send = res.send.bind(res);
    res.send = ((body: unknown) => send(typeof body === "string" && body.includes("<body>") ?
      body.replace("<body>", "<body><p role=\"alert\">ТЕСТ: только вымышленные данные. " +
        "Не вводите пароль настоящего TalkHint. Реальные звонки невозможны.</p>") : body)) as typeof res.send;
    next();
  });
  app.get("/test/health", (_req, res) => res.json({
    service: "TalkHint Actions protocol test", mock: true, realDialerAvailable: false,
    data: "synthetic-only", outboundMockEnabled: options.outbound === true,
  }));
  app.post("/api/chatgpt-actions/drafts", (req, res, next) => {
    if (req.body?.phoneNumber !== MOCK_PHONE)
      return res.status(400).json({ error: "Only the fictional test number is permitted" });
    next();
  });
  registerChatGPTIntegration(app, {
    enabled: true, outboundEnabled: options.outbound === true, origin: options.origin,
    clientId: MOCK_CLIENT, redirectUri: options.redirectUri, signingKey: () => signingKey,
    actions: { ownerId: MOCK_OWNER, clientSecret: () => options.clientSecret },
  }, store, backend, (_req, res) => { res.sendStatus(401); }, {
    async login(email, password) {
      const same = timingSafeEqual(Buffer.from(digest(password)), Buffer.from(digest(options.ownerPassword)));
      if (!same || email !== MOCK_EMAIL) return fail(401, "Test owner login required");
      return { id: MOCK_OWNER, email: MOCK_EMAIL };
    },
  });
  app.use((_req, res) => res.status(404).json({ error: "Not a test Actions endpoint" }));
  return { app, stats: () => ({ dispatches, tasks: tasks.size }) };
}
