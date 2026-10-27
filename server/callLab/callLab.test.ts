import { describe, it, expect, vi } from "vitest";
import { authorizedHintSource, hintSourceMarker, registerLabSourceOwner } from "./source";
import { encodeLetter, GmailLabMail } from "./mail";
import { labKey, messageIdFor } from "./store";
import { unavailableReport } from "./service";

const control = { environment: "production", enabled: true, owner_id: "owner", activated_at: "2026-10-26T10:00:00Z" };
const call = {
  user_id: "owner", call_sid: "fixture-only", started_at: "2026-10-26T10:01:00Z", ended_at: "2026-10-26T10:02:00Z",
  transcript: "Owner: No mobile service. Guest: send a photo",
  metadata: { labHintSource: { environment: "production", mode: "hint", closedAt: "2026-10-26T10:02:00Z" },
    goalText: "Check price", hintLatency: { entries: [{ utteranceId: "u1", text: "Send photo", outcome: "sent" }] } },
};
const binding = { recipient: "owner@example.invalid", connection_id: "fixture-connection" };
const messageId = messageIdFor(labKey("development", "owner", "synthetic"));

describe("private Hint source scope", () => {
  it("does not stamp other users or paused/wrong-environment live streams", () => {
    vi.stubEnv("LAB_ENABLED", "true");
    vi.stubEnv("LAB_TARGET_ENVIRONMENT", "development");
    registerLabSourceOwner("owner");
    expect(hintSourceMarker("owner")?.mode).toBe("hint");
    expect(hintSourceMarker("other")).toBeNull();
    vi.stubEnv("LAB_ENABLED", "false");
    expect(hintSourceMarker("owner")).toBeNull();
    vi.stubEnv("LAB_ENABLED", "true");
    vi.stubEnv("LAB_TARGET_ENVIRONMENT", "production");
    expect(hintSourceMarker("owner")).toBeNull();
    vi.unstubAllEnvs();
  });
  it("accepts only explicit Hint provenance, matching owner/environment and fresh completed call", () => {
    const s = authorizedHintSource(call, control, "production")!;
    expect(s.full_hint_history).toBe(false);
    expect(s.reference_verified).toBe(false);
    expect(s.hints[0].id).toBe("u1");
    expect(JSON.stringify(s)).not.toContain("from_number");
    expect(authorizedHintSource({ ...call, user_id: "other" }, control, "production")).toBeNull();
    expect(authorizedHintSource(call, control, "development")).toBeNull();
    expect(authorizedHintSource(call, { ...control, enabled: false }, "production")).toBeNull();
    expect(authorizedHintSource({ ...call, started_at: "2026-10-25T10:00:00Z" }, control, "production")).toBeNull();
    expect(authorizedHintSource({ ...call, ended_at: null }, control, "production")).toBeNull();
    expect(authorizedHintSource({ ...call, transcript: null }, control, "production")).toBeNull();
    expect(authorizedHintSource({ ...call, metadata: { hintLatency: {} } }, control, "production")).toBeNull();
    expect(authorizedHintSource({ ...call, metadata: { labHintSource: { ...call.metadata.labHintSource, mode: "copilot" } } }, control, "production")).toBeNull();
  });
  it("separates missing data from zero and reports failure without false QA or analysis", () => {
    const report = unavailableReport(call, "fixture missing source");
    expect(report.metrics.ai_classified_errors).toBeNull();
    expect(report.metrics.confirmed_missed_hints).toBeNull();
    expect(report.qa_status).toBe("НЕ ПРОВЕРЕНО QA");
    expect(report.execution).toBe("analysis_not_completed");
  });
  it("keys deduplicate within scope, never across environment or owner", () => {
    expect(labKey("dev", "a", "sid")).toBe(labKey("dev", "a", "sid"));
    expect(labKey("dev", "a", "sid")).not.toBe(labKey("prod", "a", "sid"));
    expect(labKey("dev", "a", "sid")).not.toBe(labKey("dev", "b", "sid"));
  });
});
describe("Gmail self-mail adapter (mocked, no external writes)", () => {
  it("builds self-only RFC822; subject injection cannot add Cc/Bcc; no invented metrics", () => {
    const report = unavailableReport(call, "No reference");
    report.ended_at = "fixture\r\nBcc: other@example.invalid";
    const raw = Buffer.from(encodeLetter(binding.recipient, messageId, report), "base64url").toString();
    expect(raw).toContain("From: owner@example.invalid\r\nTo: owner@example.invalid\r\n");
    expect(raw).toContain(`Message-ID: <${messageId}>`);
    expect(raw).not.toMatch(/\r\nBcc:|\r\nCc:/);
    const text = Buffer.from(raw.split("\r\n\r\n")[1].replace(/\s/g, ""), "base64").toString();
    expect(text).toContain("WER: неизвестно");
    expect(text).toContain("НЕ ПРОВЕРЕНО QA");
    expect(() => encodeLetter("owner@example.invalid\r\nCc: x@y.com", messageId, report)).toThrow("LAB_BAD_MAIL_HEADER");
  });
  it("verifies the account, sends only via me, and searches only matching SENT Message-ID", async () => {
    const sdk = { proxy: vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ emailAddress: binding.recipient })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "gmail-fixture" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ emailAddress: binding.recipient })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [{ id: "gmail-fixture" }] }))) };
    const mail = new GmailLabMail(sdk as any);
    expect(await mail.send(binding, messageId, unavailableReport(call, "fixture"))).toBe("gmail-fixture");
    expect(sdk.proxy.mock.calls[1][1]).toBe("/gmail/v1/users/me/messages/send");
    const sent = sdk.proxy.mock.calls[1][2];
    expect(sent.connectionId).toBe("fixture-connection");
    const raw = Buffer.from(sent.body.raw, "base64url").toString();
    expect(raw).toContain("To: owner@example.invalid");
    expect(await mail.sent(binding, messageId)).toBe("gmail-fixture");
    expect(decodeURIComponent(sdk.proxy.mock.calls[3][1])).toContain(`q=in:sent rfc822msgid:${messageId}`);
  });
  it("rejects a changed Gmail account before any write", async () => {
    const sdk = { proxy: vi.fn().mockResolvedValue(new Response(JSON.stringify({ emailAddress: "other@example.invalid" }))) };
    await expect(new GmailLabMail(sdk as any).send(binding, messageId, {})).rejects.toThrow("LAB_GMAIL_ACCOUNT_CHANGED");
    expect(sdk.proxy).toHaveBeenCalledTimes(1);
  });
  it("checks the kill switch after Gmail verification but before POST", async () => {
    const sdk = { proxy: vi.fn().mockResolvedValue(new Response(JSON.stringify({ emailAddress: binding.recipient }))) };
    await expect(new GmailLabMail(sdk as any).send(binding, messageId, {}, async () => false)).rejects.toThrow("LAB_MAIL_PAUSED");
    expect(sdk.proxy).toHaveBeenCalledTimes(1);
  });
  it("does not infer success or retry a rejected send", async () => {
    const sdk = { proxy: vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ emailAddress: binding.recipient })))
      .mockResolvedValueOnce(new Response("{}", { status: 503 })) };
    await expect(new GmailLabMail(sdk as any).send(binding, messageId, unavailableReport(call, "fixture"))).rejects.toThrow("LAB_GMAIL_SEND_503");
    expect(sdk.proxy).toHaveBeenCalledTimes(2);
  });
});
