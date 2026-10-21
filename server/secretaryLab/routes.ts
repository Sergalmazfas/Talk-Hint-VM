import express, { type Express } from "express";
import type { IncomingMessage } from "node:http";
import WebSocket from "ws";
import { requireBenchmarkAdmin } from "../benchmark/adminGate";
import type { SecretaryLab } from "./service";

export function registerSecretaryLabRoutes(
  app: Express,
  lab: SecretaryLab,
  readiness: (owner: string) => Promise<unknown>,
) {
  const base = "/api/admin/secretary-lab";
  app.use(base, requireBenchmarkAdmin, express.json({ limit: "12kb" }), (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store"); next();
  });
  const error = (res: express.Response, e: unknown) => {
    const status = Number((e as any)?.status);
    res.status([400, 401, 403, 404, 409, 429].includes(status) ? status : 503)
      .json({ error: status ? (e as Error).message : "Secretary Lab is unavailable" });
  };
  app.get(base, async (req, res) => {
    try { res.json(await readiness(req.user!.id)); } catch (e) { error(res, e); }
  });
  app.post(`${base}/sessions`, async (req, res) => {
    try { res.status(201).json(await lab.create(req.user!.id, req.body)); } catch (e) { error(res, e); }
  });
  app.delete(`${base}/sessions/:id`, async (req, res) => {
    try { res.json({ report: await lab.stop(req.user!.id, req.params.id) }); } catch (e) { error(res, e); }
  });
}

/** Same-origin browser transport; opaque one-use ticket is sent in FIRST FRAME, never URL. */
export function handleSecretaryLabSocket(ws: WebSocket, request: IncomingMessage, lab: SecretaryLab) {
  const hosts = [request.headers.host, request.headers["x-forwarded-host"]]
    .filter((host): host is string => typeof host === "string")
    .map(host => host.split(",")[0].trim());
  let validOrigin = false;
  try {
    const origin = new URL(request.headers.origin ?? "");
    validOrigin = ["http:", "https:"].includes(origin.protocol) && hosts.includes(origin.host);
  } catch { /* Missing, null and foreign origins are not lab browsers. */ }
  if (!validOrigin || new URL(request.url ?? "/", "http://local").search) {
    ws.close(1008, "Lab origin denied"); return;
  }
  let id: string | undefined;
  let authenticated = false;
  const timer = setTimeout(() => ws.close(1008, "Lab authentication required"), 5000);
  timer.unref?.();
  const send = (message: Record<string, unknown>) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 256 * 1024) {
      ws.close(1011, "Lab output backpressure"); return;
    }
    ws.send(JSON.stringify(message));
  };
  ws.on("message", raw => {
    const bytes = Buffer.byteLength(raw.toString());
    if (bytes > 8192) { ws.close(1009, "Lab message too large"); return; }
    let input: any;
    try { input = JSON.parse(raw.toString()); } catch { ws.close(1008, "Invalid lab message"); return; }
    if (!authenticated) {
      if (input?.type !== "auth" || typeof input.ticket !== "string" || !/^[a-f0-9]{64}$/.test(input.ticket)) {
        ws.close(1008, "Lab authentication required"); return;
      }
      try {
        authenticated = true;
        clearTimeout(timer);
        id = lab.connect(input.ticket, send, () => ws.close(1000, "Lab session ended"));
      } catch { send({ type: "error", error: "Lab ticket is invalid or expired" }); ws.close(1008, "Lab access denied"); }
      return;
    }
    if (id) lab.receive(id, input);
  });
  const disconnected = () => { clearTimeout(timer); if (id) lab.disconnected(id); };
  ws.on("close", disconnected);
  ws.on("error", disconnected);
}
