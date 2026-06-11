// Persistent retry queue for outbound AirAtoma webhook deliveries.
//
// Task #103 sent each finished call's transcript to AirAtoma once, best-effort:
// a timeout / 5xx / network blip silently dropped that call's data. This module
// makes delivery durable. Every send is persisted first (server/storage:
// airatoma_deliveries), attempted immediately, and — if it fails — retried with
// exponential backoff by a background poller until it succeeds or runs out of
// attempts. Re-sends are safe because AirAtoma dedupes on callId (Twilio
// CallSid). Operators see pending/failing counts on GET /api/health.
//
// This module owns everything that touches storage; the dependency-free pieces
// (payload building, single POST attempt, backoff curve) live in
// ./airatomaWebhook so they stay unit-testable without the pg pool.

import { storage } from "./storage";
import {
  attemptAirAtomaPost,
  buildAirAtomaPayload,
  airAtomaConfigError,
  airAtomaBackoffMs,
  decideAirAtomaOutcome,
  type AirAtomaCallInput,
  type AirAtomaPayload,
  type Logger,
} from "./airatomaWebhook";

const defaultLogger: Logger = (message) => console.log(message);

// How often the background poller scans for due retries.
const POLL_INTERVAL_MS = 60 * 1000;
// How many due rows to process per tick (bounded so one tick can't run forever).
const BATCH_SIZE = 20;

// Persist the outcome of an attempt: mark delivered, schedule the next retry, or
// give up after MAX_AIRATOMA_ATTEMPTS. `attemptsMade` already includes this try.
async function recordAttempt(
  id: string,
  callId: string,
  attemptsMade: number,
  ok: boolean,
  error: string | undefined,
  logger: Logger,
): Promise<void> {
  const outcome = decideAirAtomaOutcome(attemptsMade, ok);
  if (outcome === "delivered") {
    await storage.markAirAtomaDeliverySucceeded(id, attemptsMade);
    return;
  }
  if (outcome === "failed") {
    logger(
      `[AirAtoma] Giving up on call ${callId} after ${attemptsMade} attempts (last error: ${error ?? "unknown"})`,
    );
    await storage.markAirAtomaDeliveryFailed(id, attemptsMade, error ?? null);
    return;
  }
  const delayMs = airAtomaBackoffMs(attemptsMade);
  const nextAttemptAt = new Date(Date.now() + delayMs);
  logger(
    `[AirAtoma] Retry for call ${callId} scheduled in ${Math.round(delayMs / 1000)}s (attempt ${attemptsMade} failed: ${error ?? "unknown"})`,
  );
  await storage.markAirAtomaDeliveryRetry(id, attemptsMade, nextAttemptAt, error ?? null);
}

// Entry point used at call-end: persist the delivery, then try once right away.
// No-op when the integration is unconfigured; warns (once) on an invalid URL.
// Never throws — call teardown must never be blocked by AirAtoma.
export async function deliverCallToAirAtoma(
  input: AirAtomaCallInput,
  logger: Logger = defaultLogger,
): Promise<void> {
  // Destination is the call owner's personal AirAtoma URL. There is NO server-wide
  // fallback: a user who hasn't set their own URL simply doesn't deliver, so one
  // user's transcripts can never leak to another user's (or the operator's) CRM.
  const targetUrl = input.targetUrl;
  const cfg = airAtomaConfigError(targetUrl);
  if (cfg === "unset") return; // user has no personal URL — nothing to queue
  if (cfg === "invalid") {
    logger(`[AirAtoma] Invalid webhook URL — skipping send for call ${input.callId}`);
    return;
  }

  const payload = buildAirAtomaPayload(input);

  // Persist BEFORE attempting (with the destination) so a crash mid-send still
  // leaves a row to retry — and retries always go to the right user's URL.
  const row = await storage.enqueueAirAtomaDelivery(payload, targetUrl);
  if (!row) {
    // Could not persist (DB down). Fall back to a one-shot best-effort send so we
    // don't fully regress; without a row there's nothing to retry later.
    logger(`[AirAtoma] Could not persist delivery for call ${payload.callId} — sending once without retry`);
    await attemptAirAtomaPost(payload, logger, targetUrl);
    return;
  }

  const result = await attemptAirAtomaPost(payload, logger, targetUrl);
  await recordAttempt(row.id, payload.callId, row.attempts + 1, result.ok, result.error, logger);
}

// Process all currently-due rows once. Returns how many were attempted. Exported
// so it can be driven from a test or a manual trigger, not just the timer.
export async function processDueAirAtomaDeliveries(
  logger: Logger = defaultLogger,
): Promise<number> {
  const due = await storage.getDueAirAtomaDeliveries(BATCH_SIZE);
  let attempted = 0;
  for (const row of due) {
    const payload = row.payload as AirAtomaPayload;
    // Each row carries its own destination (the owning user's personal URL,
    // captured at enqueue). No env fallback — delivery is strictly per-user.
    const targetUrl = row.targetUrl;
    // If that URL is missing/invalid (e.g. the user cleared it), leave the row
    // untouched so it resumes when a valid URL is restored — don't burn attempts.
    if (airAtomaConfigError(targetUrl)) continue;
    const result = await attemptAirAtomaPost(payload, logger, targetUrl);
    await recordAttempt(row.id, payload.callId, row.attempts + 1, result.ok, result.error, logger);
    attempted++;
  }
  return attempted;
}

let timer: ReturnType<typeof setInterval> | null = null;

// Start the background retry poller. Idempotent — a second call is a no-op while
// one is running. Opt out with DISABLE_AIRATOMA_RETRY=true.
export function startAirAtomaRetryWorker(): boolean {
  if (process.env.DISABLE_AIRATOMA_RETRY === "true") {
    console.log("[AirAtoma] Retry worker disabled (DISABLE_AIRATOMA_RETRY=true)");
    return false;
  }
  if (timer) return false;
  timer = setInterval(() => {
    processDueAirAtomaDeliveries().catch((err) =>
      console.error(`[AirAtoma] Retry worker tick failed: ${err?.message ?? err}`),
    );
  }, POLL_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
  console.log("[AirAtoma] Retry worker started");
  return true;
}

export function stopAirAtomaRetryWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
