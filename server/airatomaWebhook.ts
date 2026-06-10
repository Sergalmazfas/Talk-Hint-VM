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

// Flatten a transcript into "Speaker: text" lines. Unlike the contact-memory
// summarizer this is NOT capped — AirAtoma should receive the full transcript.
export function renderTranscriptText(turns: CallTurn[]): string {
  return turns.map((t) => `${t.speaker}: ${t.text}`).join("\n");
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

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = process.env.TALKHINT_WEBHOOK_SECRET;
  if (secret) headers["x-talkhint-secret"] = secret;

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
    } else {
      logger(`[AirAtoma] Webhook returned ${res.status} for call ${payload.callId}`);
    }
  } catch (err: any) {
    if (err?.name === "AbortError") {
      logger(`[AirAtoma] Webhook timed out after ${AIRATOMA_TIMEOUT_MS}ms for call ${payload.callId}`);
    } else {
      logger(`[AirAtoma] Webhook send failed for call ${payload.callId}: ${err?.message || err}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
