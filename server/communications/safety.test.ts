import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  communicationReadiness, recordingPermitted, RECORDING_PATHS,
  sendSmsSafely, SMS_PATHS,
} from "./safety";

const mocks = vi.hoisted(() => ({ create: vi.fn(), client: vi.fn() }));
vi.mock("twilio", () => ({ default: mocks.client }));
vi.mock("../storage", () => ({ getWriteHealth: vi.fn() }));
import { getAlertChannelStatus, sendWriteHealthAlert } from "../writeHealthAlerter";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.client.mockReturnValue({ messages: { create: mocks.create } });
});

describe("real stage-one communication quarantine (no external transport)", () => {
  it.each(SMS_PATHS)("blocks %s on initial attempt, double execution and retry", async path => {
    const deliver = vi.fn();
    for (let i = 0; i < 3; i++) {
      expect(await sendSmsSafely(path, deliver)).toEqual({
        sent: false, blocked: true, reasons: expect.arrayContaining([
          "sender_readiness_unverified", "recipient_sms_consent_unverified",
          "suppression_check_unavailable",
        ]),
      });
    }
    expect(deliver).not.toHaveBeenCalled();
  });

  it.each(RECORDING_PATHS)("denies %s even on repeated calls", path => {
    expect(recordingPermitted(path)).toBe(false);
    expect(recordingPermitted(path)).toBe(false);
  });

  it("does not allow credentials or SMS admin alert/recovery settings to grant consent", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "test-only");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "test-only");
    vi.stubEnv("WRITE_HEALTH_ALERT_PHONE", "+15550000001");
    vi.stubEnv("WRITE_HEALTH_ALERT_FROM", "+15550000002");
    vi.stubEnv("WRITE_HEALTH_ALERT_EMAIL", "");
    vi.stubEnv("SMS_ENABLED", "true");
    vi.stubEnv("BENCHMARK_CALL_RECORDING", "1");
    try {
      await sendWriteHealthAlert("failure");
      await sendWriteHealthAlert("recovery");
      expect(mocks.client).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
      expect(getAlertChannelStatus().sms).toMatchObject({
        configured: true, ready: false,
        missing: expect.arrayContaining(["suppression_check_unavailable"]),
      });
      expect(recordingPermitted("outgoing_browser")).toBe(false);
    } finally { vi.unstubAllEnvs(); }
  });

  it("does not let one request mutate readiness for another owner/channel", async () => {
    const first = communicationReadiness();
    first.sms.allowed = true;
    first.sms.reasons.length = 0;
    first.recording.allowed = true;
    expect(communicationReadiness().sms.allowed).toBe(false);
    expect(communicationReadiness().recording.allowed).toBe(false);
    expect(communicationReadiness().sms.reasons).toHaveLength(3);
  });

  it("logs only path/reason codes, never message content or recipient identifiers", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await sendSmsSafely("incoming_call_notification", () => Promise.resolve("private-message"));
      const text = JSON.stringify(log.mock.calls);
      expect(text).toContain("sender_readiness_unverified");
      expect(text).not.toContain("private-message");
      expect(text).not.toMatch(/\+\d{8}|CA[a-f0-9]{32}|token/i);
    } finally { log.mockRestore(); }
  });

  it("keeps the SMS transport inventory explicit; new direct senders require review", () => {
    const paths: string[] = [];
    const walk = (dir: string) => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, ent.name);
        if (ent.isDirectory()) walk(path);
        else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) {
          const text = readFileSync(path, "utf8");
          for (const match of text.matchAll(/\.messages\.create\(/g)) {
            paths.push(path);
            expect(text.slice(Math.max(0, match.index! - 160), match.index)).toContain("sendSmsSafely");
          }
        }
      }
    };
    walk("server");
    expect(paths.sort()).toEqual(["server/routes.ts", "server/writeHealthAlerter.ts"]);
  });
});
