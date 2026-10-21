import type { Express, Response } from "express";
import { observeSecretaryFeed, type SecretaryFeedEvent } from "../secretary/feed";
import { activeGrant, Credentials, fail, type Claims, type MarkerStore } from "./security";
import type { SecretaryBackend } from "./secretary";

export const MONITOR_MS = 120_000;
export const MONITOR_SCOPES = ["calls:listen", "calls:transcript"] as const;
const TERMINAL = new Set(["completed", "no_answer", "busy", "failed", "unknown", "cancelled"]);
const POLL_MS = 2500;
const MAX_BUFFER = 256 * 1024;

/** Audio is never persisted/replayed here. New connections resume text from a durable snapshot. */
export class CallMonitor {
  private active = new Map<string, number>();
  constructor(private credentials: Credentials, private store: MarkerStore,
    private backend: SecretaryBackend, private origin: string, private enabled: () => boolean) {}

  async issue(owner: Claims, id: string) {
    await this.backend.task(owner.sub, id, false); // Includes durable task ownership check.
    const exp = Math.min(Date.now() + MONITOR_MS, owner.exp);
    const token = this.credentials.issue({ type: "monitor", sub: owner.sub, grant: owner.grant,
      client: owner.client, scopes: [...MONITOR_SCOPES], taskId: id, exp });
    return { url: `${this.origin}/api/chatgpt/monitor`, token, task_id: id,
      expiresAt: new Date(exp).toISOString(),
      fallbackUrl: `${this.origin}/api/chatgpt/secretary/tasks/${encodeURIComponent(id)}` };
  }

  register(app: Express) {
    const path = "/api/chatgpt/monitor";
    // This isolated read-only transport never uses cookies or native session tokens.
    // Do not broaden the same-origin rules for login, OAuth consent or call approval.
    app.options(path, (req, res) => {
      if (!this.cors(req.headers.origin, res)) return res.sendStatus(403);
      res.set("Access-Control-Allow-Methods", "POST, OPTIONS")
        .set("Access-Control-Allow-Headers", "Authorization, Content-Type").status(204).end();
    });
    app.post(path, async (req, res) => {
      try {
        if (!this.enabled()) return fail(503, "Monitor unavailable");
        if (!this.cors(req.headers.origin, res)) return fail(403, "Monitor host is not supported");
        if (Object.keys(req.query).length || (req.body && Object.keys(req.body).length))
          return fail(400, "Monitor accepts no URL credentials or task selector");
        const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
        const owner = this.credentials.read(token, "monitor");
        if (!owner.taskId || MONITOR_SCOPES.some(s => !owner.scopes.includes(s)))
          return fail(401, "Invalid monitor credential");
        await activeGrant(this.store, owner);
        const task = await this.backend.task(owner.sub, owner.taskId, true);
        if (!task || task.id !== owner.taskId) return fail(404, "Task not found");
        if (res.destroyed) return;
        const key = owner.sub; // Bound per owner, not per replaceable OAuth grant.
        if ((this.active.get(key) ?? 0) >= 2) return fail(429, "Too many monitor connections");
        this.active.set(key, (this.active.get(key) ?? 0) + 1);
        res.status(200).set({
          "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform",
          "X-Accel-Buffering": "no", "Referrer-Policy": "no-referrer",
        });
        res.flushHeaders();
        let closed = false, ready = false, checking = false, pendingBytes = 0, backpressured = false;
        const pending: SecretaryFeedEvent[] = [];
        let unsubscribe = () => {};
        let timer: ReturnType<typeof setInterval> | undefined;
        let expiry: ReturnType<typeof setTimeout> | undefined;
        const close = (reason?: string) => {
          if (closed) return;
          closed = true;
          unsubscribe();
          if (timer) clearInterval(timer);
          if (expiry) clearTimeout(expiry);
          const count = (this.active.get(key) ?? 1) - 1;
          if (count) this.active.set(key, count); else this.active.delete(key);
          if (!res.destroyed) {
            if (reason && res.writableLength < MAX_BUFFER)
              res.write(`data: ${JSON.stringify({ type: "ended", reason })}\n\n`);
            res.end();
          }
        };
        const send = (event: object) => {
          if (closed) return false;
          const frame = `data: ${JSON.stringify(event)}\n\n`;
          if (res.writableLength + Buffer.byteLength(frame) > MAX_BUFFER) { close("backpressure"); return false; }
          try {
            if (!res.write(frame) && !backpressured) {
              backpressured = true;
              res.once("drain", () => { backpressured = false; });
            }
            return true;
          } catch { close(); return false; }
        };
        req.on("aborted", () => close());
        res.on("close", () => close());
        expiry = setTimeout(() => close("expired"), Math.max(0, owner.exp - Date.now()));
        unsubscribe = observeSecretaryFeed(owner.taskId, event => {
          if (closed) return;
          if (owner.exp <= Date.now()) return close("expired");
          if (event.type === "audio" && backpressured) return; // Drop, never replay stale live audio.
          if (!ready) {
            pendingBytes += Buffer.byteLength(JSON.stringify(event));
            if (pendingBytes > MAX_BUFFER) return close("backpressure");
            pending.push(event);
          } else send(event);
        });
        const snapshot = async () => {
          await activeGrant(this.store, owner);
          const current = await this.backend.task(owner.sub, owner.taskId!, true);
          if (closed) return;
          const { transcript: _rawText, events: _events, ...report } = current;
          send({ type: "snapshot", task: { ...report,
            transcriptTurns: Array.isArray(current.transcriptTurns) ? current.transcriptTurns.slice(-200) : [] } });
          if (TERMINAL.has(current.status)) close("completed");
        };
        try {
          await snapshot(); // Subscribe before snapshot to close the handoff gap.
          ready = true;
          for (const event of pending.splice(0)) if (!send(event)) break;
        } catch { close("revoked"); }
        if (!closed) timer = setInterval(() => {
          if (checking) return;
          checking = true;
          void snapshot().catch(() => close("revoked")).finally(() => { checking = false; });
        }, POLL_MS);
      } catch (error: any) {
        if (!res.headersSent) res.status(error.status ?? 503).json({
          error: error.status && error.status < 500 ? error.message : "Monitor unavailable",
        });
        else res.end();
      }
    });
  }

  private cors(origin: string | undefined, res: Response) {
    if (!origin) return true; // Non-browser clients still need the scoped ticket.
    let allowed = origin === this.origin;
    try {
      const url = new URL(origin);
      allowed ||= url.protocol === "https:" && !url.port &&
        (url.hostname === "chatgpt.com" || url.hostname === "web-sandbox.oaiusercontent.com" ||
          url.hostname.endsWith(".web-sandbox.oaiusercontent.com"));
    } catch { return false; }
    if (allowed) res.set("Access-Control-Allow-Origin", origin).vary("Origin");
    return allowed;
  }
}
