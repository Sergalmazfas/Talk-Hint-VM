import twilio from "twilio";
import { getWriteHealth } from "./storage";

// ---------------------------------------------------------------------------
// Write-health alerter
//
// Task #86 made failed DB writes visible at /api/health (per-table
// writeSuccesses/writeFailures/lastError + schema-drift flags), but nothing
// actively watched that signal — a human had to poll the endpoint. This module
// is the missing watcher: a lightweight background check that reads the same
// write-health snapshot and pushes an alert (loud log + any configured
// channels) the moment any table's failure counter rises or a schema-drift
// error appears, so the silent caller-name class of bug is caught early instead
// of in support tickets.
//
// Delivery channels are opt-in and independent: Twilio SMS (WRITE_HEALTH_ALERT_
// PHONE) and/or SendGrid email (WRITE_HEALTH_ALERT_EMAIL). Configuring email in
// addition to SMS means an alert survives one channel being down. If neither is
// configured, the loud log is the only delivery.
//
// Alerts are throttled per-table so a sustained outage doesn't spam the channel,
// and each message names the table, operation, and pg-code for fast triage.
//
// The poller also closes the loop: once a table that previously alerted goes a
// sustained window with successful writes and no new failures, it sends a single
// "recovered" notification so on-call gets a positive all-clear instead of
// having to manually re-poll /api/health. Recovery is debounced over the same
// window concept as alert throttling, so a flapping table can't spam the channel
// with alert/recover/alert churn.
// ---------------------------------------------------------------------------

// Defaults (overridable via env, read at call time so tests can tweak them).
const DEFAULT_CHECK_INTERVAL_MS = 60 * 1000; // poll write health every 60s
const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000; // at most one alert per table / 15min

function checkIntervalMs(): number {
  const v = Number(process.env.WRITE_HEALTH_ALERT_INTERVAL_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_CHECK_INTERVAL_MS;
}

function cooldownMs(): number {
  const v = Number(process.env.WRITE_HEALTH_ALERT_COOLDOWN_MS);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_COOLDOWN_MS;
}

// How long a previously-alerting table must stay healthy (successful writes, no
// new failures) before we declare recovery. Defaults to the alert cooldown so
// recovery is debounced on the same time scale as alerting.
function recoveryWindowMs(): number {
  const v = Number(process.env.WRITE_HEALTH_RECOVERY_WINDOW_MS);
  return Number.isFinite(v) && v >= 0 ? v : cooldownMs();
}

interface TableAlertState {
  // Failure count we last reconciled with (only advanced once an alert for the
  // rise is actually sent, so a throttled rise stays pending and fires after the
  // cooldown instead of being silently dropped).
  reconciledFailures: number;
  lastAlertAt: number;
  // `lastError.at` of the error we last alerted on — lets a fresh schema-drift
  // error re-alert even if the failure counter didn't move between checks.
  lastAlertedErrorAt?: string;
  // True once we've actually sent an alert for this table and have NOT yet sent
  // the matching recovery. Only an alerting table can recover, so a throttled
  // (never-sent) rise won't later produce a phantom "all clear".
  alerting: boolean;
  // writeSuccesses captured at the moment we last alerted — recovery requires
  // new successful writes beyond this baseline, not just the absence of failures.
  successesAtAlert: number;
  // First time we observed a sustained-healthy check while alerting. Reset to
  // undefined whenever a new failure shows up, so a flap restarts the window.
  healthySince?: number;
}

const alertStateByTable: Record<string, TableAlertState> = {};

// Reset internal state — for tests only.
export function __resetWriteHealthAlerterState(): void {
  for (const k of Object.keys(alertStateByTable)) delete alertStateByTable[k];
}

function isDisabled(): boolean {
  return process.env.DISABLE_WRITE_HEALTH_ALERTS === "true";
}

// Try to deliver the alert by SMS. Returns true if SMS was configured and an
// attempt was made (regardless of Twilio success), false if SMS is not
// configured at all. Never throws.
async function trySendSms(body: string): Promise<boolean> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const to = process.env.WRITE_HEALTH_ALERT_PHONE;
  const from =
    process.env.WRITE_HEALTH_ALERT_FROM || process.env.TWILIO_PHONE_NUMBER;

  if (!to) return false;
  if (!accountSid || !authToken || !from) {
    console.warn(
      "[WriteHealthAlert] WRITE_HEALTH_ALERT_PHONE set but Twilio credentials or sender number missing — no SMS sent.",
    );
    return false;
  }

  try {
    const client = twilio(accountSid, authToken);
    await client.messages.create({ body, from, to });
    console.log(`[WriteHealthAlert] SMS sent to ${to}`);
  } catch (err: any) {
    console.error(
      `[WriteHealthAlert] Failed to send SMS: ${err?.message ?? err}`,
    );
  }
  return true;
}

// Parse a comma/semicolon/whitespace-separated recipient list into trimmed,
// non-empty addresses.
function parseEmailRecipients(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Try to deliver the alert by email via the SendGrid HTTP API (no SDK
// dependency — plain fetch). Opt-in: only attempts when a recipient list, a
// sender, and SENDGRID_API_KEY are all configured. Returns true if email was
// configured and an attempt was made, false otherwise. Never throws.
async function trySendEmail(body: string): Promise<boolean> {
  const rawTo = process.env.WRITE_HEALTH_ALERT_EMAIL;
  if (!rawTo) return false;

  const recipients = parseEmailRecipients(rawTo);
  const from = process.env.WRITE_HEALTH_ALERT_EMAIL_FROM;
  const apiKey = process.env.SENDGRID_API_KEY;

  if (recipients.length === 0) return false;
  if (!from || !apiKey) {
    console.warn(
      "[WriteHealthAlert] WRITE_HEALTH_ALERT_EMAIL set but WRITE_HEALTH_ALERT_EMAIL_FROM or SENDGRID_API_KEY missing — no email sent.",
    );
    return false;
  }

  const subject =
    process.env.WRITE_HEALTH_ALERT_EMAIL_SUBJECT ||
    "🚨 TalkHint DB write-health alert";

  try {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: recipients.map((email) => ({ email })) }],
        from: { email: from },
        subject,
        content: [{ type: "text/plain", value: body }],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(
        `[WriteHealthAlert] Failed to send email: HTTP ${res.status} ${detail}`,
      );
    } else {
      console.log(
        `[WriteHealthAlert] Email sent to ${recipients.join(", ")}`,
      );
    }
  } catch (err: any) {
    console.error(
      `[WriteHealthAlert] Failed to send email: ${err?.message ?? err}`,
    );
  }
  return true;
}

// Send the alert: always log loudly, then fan out to every configured channel
// (Twilio SMS and/or SendGrid email — both opt-in and independent). If no
// channel is configured, the loud log is the only delivery. Never throws —
// alerting must not crash the poller.
export async function sendWriteHealthAlert(body: string): Promise<void> {
  console.error(`[WriteHealthAlert] ${body}`);

  const [smsAttempted, emailAttempted] = await Promise.all([
    trySendSms(body),
    trySendEmail(body),
  ]);

  if (!smsAttempted && !emailAttempted) {
    console.warn(
      "[WriteHealthAlert] No alert channel configured (set WRITE_HEALTH_ALERT_PHONE and/or WRITE_HEALTH_ALERT_EMAIL) — alert logged only.",
    );
  }
}

// Build a concise, triage-ready message naming the table, operation and pg-code.
function formatAlert(table: string, health: ReturnType<typeof getWriteHealth>[string], priorFailures: number): string {
  const err = health.lastError;
  const op = err?.operation ?? "unknown";
  const code = err?.code ?? "n/a";
  const drift = err?.isSchemaDrift ? " (SCHEMA DRIFT — live DB missing column/table)" : "";
  const column = err?.column ? ` column=${err.column}` : "";
  const message = err?.message ? ` "${err.message}"` : "";
  const at = err?.at ? ` at ${err.at}` : "";
  return (
    `🚨 DB write failing on table=${table} op=${op} pgCode=${code}${drift}. ` +
    `failures=${health.writeFailures} (was ${priorFailures})${column}.${message}${at}`
  );
}

// Build the positive "all clear" message sent once a previously-failing table
// has sustained successful writes again.
function formatRecovery(table: string, health: ReturnType<typeof getWriteHealth>[string]): string {
  return (
    `✅ DB writes RECOVERED on table=${table} — successful writes resumed with no new failures. ` +
    `writeSuccesses=${health.writeSuccesses} writeFailures=${health.writeFailures} (total).`
  );
}

// One evaluation pass over the write-health snapshot. Returns the number of
// alerts actually sent (suppressed-by-throttle ones are not counted).
export async function checkWriteHealthOnce(): Promise<number> {
  if (isDisabled()) return 0;

  const snapshot = getWriteHealth();
  const now = Date.now();
  const cooldown = cooldownMs();
  const recoveryWindow = recoveryWindowMs();
  let sent = 0;

  for (const [table, health] of Object.entries(snapshot)) {
    let state = alertStateByTable[table];
    if (!state) {
      state = {
        reconciledFailures: 0,
        lastAlertAt: 0,
        alerting: false,
        successesAtAlert: 0,
      };
      alertStateByTable[table] = state;
    }

    const err = health.lastError;
    const failuresRose = health.writeFailures > state.reconciledFailures;
    const freshDriftError =
      !!err?.isSchemaDrift && err.at !== state.lastAlertedErrorAt;

    if (!failuresRose && !freshDriftError) {
      // Nothing new — keep our baseline in sync.
      state.reconciledFailures = health.writeFailures;
      // Recovery: a table that previously alerted gets a single "all clear" once
      // it has logged new successful writes and stayed clean for the recovery
      // window. Debounced via healthySince so a flap (failure mid-window) resets
      // the timer instead of firing alert/recover/alert.
      if (state.alerting) {
        const hasNewSuccesses = health.writeSuccesses > state.successesAtAlert;
        if (!hasNewSuccesses) {
          // No proof writes are flowing again — don't start the recovery clock.
          state.healthySince = undefined;
        } else {
          if (state.healthySince === undefined) state.healthySince = now;
          if (now - state.healthySince >= recoveryWindow) {
            await sendWriteHealthAlert(formatRecovery(table, health));
            state.alerting = false;
            state.healthySince = undefined;
          }
        }
      }
      continue;
    }

    // A new failure voids any in-progress recovery window.
    state.healthySince = undefined;

    // Throttle: leave the rise pending (do NOT advance reconciledFailures) so it
    // re-fires once the cooldown elapses instead of being lost.
    if (now - state.lastAlertAt < cooldown) {
      console.log(
        `[WriteHealthAlert] Suppressed (throttled) alert for table=${table} failures=${health.writeFailures}`,
      );
      continue;
    }

    const message = formatAlert(table, health, state.reconciledFailures);
    await sendWriteHealthAlert(message);
    sent += 1;
    state.reconciledFailures = health.writeFailures;
    state.lastAlertAt = now;
    state.lastAlertedErrorAt = err?.at;
    state.alerting = true;
    state.successesAtAlert = health.writeSuccesses;
  }

  return sent;
}

let timer: ReturnType<typeof setInterval> | null = null;

// Start the background poller. Idempotent — a second call is a no-op while one
// is already running. Returns true if it started, false if skipped/disabled.
export function startWriteHealthAlerter(): boolean {
  if (isDisabled()) {
    console.log("[WriteHealthAlert] Disabled (DISABLE_WRITE_HEALTH_ALERTS=true)");
    return false;
  }
  if (timer) return false;

  const interval = checkIntervalMs();
  timer = setInterval(() => {
    checkWriteHealthOnce().catch((e: any) =>
      console.error(`[WriteHealthAlert] Poll failed: ${e?.message ?? e}`),
    );
  }, interval);
  // Don't keep the event loop alive solely for this poller.
  if (typeof timer.unref === "function") timer.unref();

  console.log(
    `[WriteHealthAlert] Started — polling write health every ${Math.round(interval / 1000)}s`,
  );
  return true;
}

// Stop the poller — for tests / graceful shutdown.
export function stopWriteHealthAlerter(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
