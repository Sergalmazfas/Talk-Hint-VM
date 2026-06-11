// Outbound integration: after a phone call ends, push the finished transcript to
// the AirAtoma CRM webhook (POST /api/talkhint/webhook). AirAtoma runs its own
// Claude analysis, project matching, Decisions/Tasks creation, Telegram
// notification, and Calls tab — none of that lives here. This module only builds
// the agreed payload and sends it best-effort.
//
// The pure helpers (renderTranscriptText, buildAirAtomaPayload, airAtomaConfigError)
// are dependency-free so they can be unit tested without the websocket server's
// heavy graph (Deepgram, pg pool, ./index bootstrap). The network call accepts a
// logger callback so it stays decoupled from server/index's `log`.

export interface CallTurn {
  speaker: string;
  text: string;
}

export interface AirAtomaCallInput {
  callId: string;
  transcript: CallTurn[];
  callerName: string;
  durationSecs: number;
  recordingUrl?: string | null;
  // Per-user destination. When set, the call goes to this user's personal
  // AirAtoma webhook instead of the server-wide AIRATOMA_WEBHOOK_URL env var.
  targetUrl?: string | null;
}

// The JSON body AirAtoma's webhook expects.
export interface AirAtomaPayload {
  callId: string;
  transcript: string;
  callerName: string;
  durationSecs: number;
  recordingUrl?: string;
}

export type Logger = (message: string) => void;

const defaultLogger: Logger = (message) => console.log(message);

// Max time we let the POST run before aborting. A slow/unresponsive AirAtoma must
// never leave a fetch hanging and accumulating in memory across many calls.
export const AIRATOMA_TIMEOUT_MS = 5000;

// Retry policy for the persistent delivery queue. A failed/timed-out send is
// buffered and retried with exponential backoff (30s, 60s, 120s, … capped at
// 30min) until it succeeds or MAX_AIRATOMA_ATTEMPTS is reached, after which the
// row is marked "failed" so operators can see it stopped retrying.
export const MAX_AIRATOMA_ATTEMPTS = 8;
const AIRATOMA_BACKOFF_BASE_MS = 30_000;
const AIRATOMA_BACKOFF_CAP_MS = 30 * 60_000;

// Milliseconds to wait before the next attempt, given how many attempts have
// already been made (>= 1). Pure + exported so the backoff curve is unit-testable.
export function airAtomaBackoffMs(attemptsMade: number): number {
  const n = Math.max(1, Math.floor(attemptsMade));
  const ms = AIRATOMA_BACKOFF_BASE_MS * 2 ** (n - 1);
  return Math.min(ms, AIRATOMA_BACKOFF_CAP_MS);
}

// Given how many attempts have been made and whether the latest one succeeded,
// decide the row's next state. Pure + exported for testing.
export function decideAirAtomaOutcome(
  attemptsMade: number,
  ok: boolean,
): "delivered" | "retry" | "failed" {
  if (ok) return "delivered";
  return attemptsMade >= MAX_AIRATOMA_ATTEMPTS ? "failed" : "retry";
}

// Result of a single POST attempt. Unlike sendCallToAirAtoma this surfaces the
// outcome instead of swallowing it, so the delivery queue can decide whether to
// mark the row delivered, schedule a retry, or give up.
export interface AirAtomaPostResult {
  ok: boolean;
  status?: number;
  error?: string;
}

// Perform a single best-effort POST of an already-built payload. Never throws —
// returns { ok } so callers can persist the outcome. Reads AIRATOMA_WEBHOOK_URL
// and TALKHINT_WEBHOOK_SECRET from the environment; assumes the URL has already
// passed airAtomaConfigError (returns ok:false with a config error otherwise).
export async function attemptAirAtomaPost(
  payload: AirAtomaPayload,
  logger: Logger = defaultLogger,
  targetUrl?: string | null,
): Promise<AirAtomaPostResult> {
  // Prefer the per-user destination; fall back to the server-wide env var so
  // the existing single-tenant setup keeps working unchanged.
  const url = targetUrl || process.env.AIRATOMA_WEBHOOK_URL;
  const cfg = airAtomaConfigError(url);
  if (cfg) return { ok: false, error: `config:${cfg}` };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // SECURITY: only attach the shared secret when sending to the operator-configured
  // endpoint (the env URL). Never leak it to a user-supplied personal webhook URL —
  // otherwise any user could harvest the secret by pointing their URL at themselves.
  const secret = process.env.TALKHINT_WEBHOOK_SECRET;
  const isTrustedDestination = !!url && url === process.env.AIRATOMA_WEBHOOK_URL;
  if (secret && isTrustedDestination) headers["x-talkhint-secret"] = secret;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AIRATOMA_TIMEOUT_MS);
  try {
    const res = await fetch(url as string, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (res.ok) {
      logger(`[AirAtoma] Sent call ${payload.callId} (status ${res.status})`);
      return { ok: true, status: res.status };
    }
    logger(`[AirAtoma] Webhook returned ${res.status} for call ${payload.callId}`);
    return { ok: false, status: res.status, error: `http_${res.status}` };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      logger(`[AirAtoma] Webhook timed out after ${AIRATOMA_TIMEOUT_MS}ms for call ${payload.callId}`);
      return { ok: false, error: "timeout" };
    }
    logger(`[AirAtoma] Webhook send failed for call ${payload.callId}: ${err?.message || err}`);
    return { ok: false, error: String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

// Flatten a transcript into "Speaker: text" lines. Unlike the contact-memory
// summarizer this is NOT capped — AirAtoma should receive the full transcript.
export function renderTranscriptText(turns: CallTurn[]): string {
  return turns.map((t) => `${t.speaker}: ${t.text}`).join("\n");
}

// Inverse of renderTranscriptText: parse a persisted "Speaker: text" transcript
// string back into turns. Used by the /twilio/status backstop, which only has the
// transcript persisted on the call record (not the in-memory turn array). Lines
// without a "Speaker: " prefix are kept as a turn with an empty speaker so no
// content is lost. Round-trips renderTranscriptText for typical single-line turns.
export function parseTranscriptText(text: string): CallTurn[] {
  if (!text) return [];
  return text.split("\n").map((line) => {
    const idx = line.indexOf(": ");
    if (idx === -1) return { speaker: "", text: line };
    return { speaker: line.slice(0, idx), text: line.slice(idx + 2) };
  });
}

// Build the exact JSON body for the webhook. durationSecs is normalized to a
// non-negative whole number; recordingUrl is only included when present (TalkHint
// does not record calls today, so it is normally omitted).
export function buildAirAtomaPayload(input: AirAtomaCallInput): AirAtomaPayload {
  const payload: AirAtomaPayload = {
    callId: input.callId,
    transcript: renderTranscriptText(input.transcript),
    callerName: input.callerName,
    durationSecs: Math.max(0, Math.round(input.durationSecs)),
  };
  if (input.recordingUrl && input.recordingUrl.trim()) {
    payload.recordingUrl = input.recordingUrl.trim();
  }
  return payload;
}

// Decide whether the configured URL is usable.
//   "unset"   -> feature off, skip silently
//   "invalid" -> a value is set but it's not an http(s) URL; skip + warn
//   null      -> good to send
export function airAtomaConfigError(url: string | undefined | null): "unset" | "invalid" | null {
  if (!url) return "unset";
  if (!/^https?:\/\//.test(url)) return "invalid";
  return null;
}

// Validate a USER-supplied webhook URL before saving it. Beyond requiring http(s),
// this blocks SSRF-prone destinations (loopback, link-local/cloud-metadata, and
// RFC1918 private ranges) and embedded credentials. Returns an error code or null
// when the URL is an acceptable public endpoint. (DNS rebinding — a public name
// that resolves to a private IP — is a residual risk not covered by literal checks.)
export function validateUserWebhookUrl(raw: string): "invalid_url" | "invalid_scheme" | "has_credentials" | "private_host" | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "invalid_url";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "invalid_scheme";
  if (u.username || u.password) return "has_credentials";

  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host === "metadata") {
    return "private_host";
  }
  // Reject ALL IPv6 literals. A real public AirAtoma endpoint uses a hostname, so
  // disallowing IPv6 literals outright cleanly blocks loopback (::1), link-local
  // (fe80::/10), unique-local (fc00::/7), site-local (fec0::/10) and IPv4-mapped
  // forms (::ffff:127.0.0.1) without fragile per-range parsing of normalized text.
  if (host.includes(":")) return "private_host";
  // IPv4 literal private / loopback / link-local / reserved ranges
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 10 || a === 127) return "private_host";
    if (a === 172 && b >= 16 && b <= 31) return "private_host";
    if (a === 192 && b === 168) return "private_host";
    if (a === 169 && b === 254) return "private_host"; // link-local + cloud metadata
    if (a >= 224) return "private_host"; // multicast / reserved
  }
  return null;
}

// Best-effort POST of a finished call to AirAtoma. Never throws — all failures
// (config, network, non-2xx, timeout) are logged and swallowed so call teardown
// is never affected.
export async function sendCallToAirAtoma(
  input: AirAtomaCallInput,
  logger: Logger = defaultLogger,
): Promise<void> {
  const url = process.env.AIRATOMA_WEBHOOK_URL;
  const cfg = airAtomaConfigError(url);
  if (cfg === "unset") return; // integration not configured — no-op
  if (cfg === "invalid") {
    logger(`[AirAtoma] Invalid AIRATOMA_WEBHOOK_URL — skipping send for call ${input.callId}`);
    return;
  }

  const payload = buildAirAtomaPayload(input);
  await attemptAirAtomaPost(payload, logger);
}
