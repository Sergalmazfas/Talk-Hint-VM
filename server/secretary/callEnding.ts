/** A model decision is only a request: confirmed playback and a quiet window
 * are mandatory before the server may end this same telephone attempt. */
export type SecretaryEndRequest = {
  reason: "completed" | "follow_up" | "declined" | "human_required";
  farewell: string;
};

export const secretaryEndTool = {
  type: "function",
  name: "prepare_call_end",
  description: "Only after the other party confirms the summary/next step or explicitly declines: prepare a polite end. Never use for hold, transfer, silence, or merely achieving the goal. Supply the exact short farewell you will say AFTER this tool returns. New guest speech cancels the request.",
  parameters: {
    type: "object",
    properties: {
      reason: { type: "string", enum: ["completed", "follow_up", "declined", "human_required"] },
      farewell: { type: "string", description: "Exact final farewell in the other party's language; no invented facts." },
    },
    required: ["reason", "farewell"],
    additionalProperties: false,
  },
};

export function parseSecretaryEndRequest(raw: unknown): SecretaryEndRequest | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some(key => !["reason", "farewell"].includes(key)) ||
      !["completed", "follow_up", "declined", "human_required"].includes(String(value.reason)) ||
      typeof value.farewell !== "string" || !value.farewell.trim() || value.farewell.length > 300) return;
  return { reason: value.reason as SecretaryEndRequest["reason"], farewell: value.farewell.trim() };
}

const normalize = (text: string) => text.normalize("NFKC").toLowerCase()
  .replace(new RegExp("[^\\p{L}\\p{N}]+", "gu"), " ").trim();

export class SecretaryCallEnding {
  private pending?: SecretaryEndRequest;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private spoken = "";
  constructor(private end: () => Promise<void>, private failure: () => void) {}
  request(value: SecretaryEndRequest) {
    this.cancel();
    if (!this.closed) this.pending = value;
  }
  /** Called only for text whose audio Twilio positively acknowledged. */
  played(text: string) {
    if (this.closed || !this.pending) return;
    this.spoken = `${this.spoken} ${normalize(text)}`.trim().slice(-2400);
    const farewell = normalize(this.pending.farewell), spoken = this.spoken;
    if (!farewell || !(spoken === farewell || spoken.endsWith(` ${farewell}`))) {
      // A new non-farewell reply means the conversation has continued.
      if (this.timer) this.cancel();
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.pending || this.closed) return;
      this.closed = true;
      this.pending = undefined;
      void this.end().catch(this.failure);
    }, 2500);
    this.timer.unref?.();
  }
  cancel() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
    this.spoken = "";
  }
  close() { this.cancel(); this.closed = true; }
}
