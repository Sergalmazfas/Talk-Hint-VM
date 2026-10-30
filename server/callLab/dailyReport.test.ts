import { describe, expect, it } from "vitest";
import { dueHintDay, renderHintDaily, hintDailyTick, dailyMessageId } from "./dailyReport";
import { GmailLabMail } from "./mail";
describe("Hint daily report — Denver calendar, not UTC or 24-hour subtraction", () => {
  it("waits until 08:00", () => {
    expect(dueHintDay(new Date("2026-10-28T13:59:59Z"))).toBeNull();
    expect(dueHintDay(new Date("2026-10-28T14:00:00Z"))?.day).toBe("2026-10-27");
  });
  it("handles both DST boundaries", () => {
    const spring = dueHintDay(new Date("2026-03-09T15:00:00Z"))!;
    const fall = dueHintDay(new Date("2026-11-02T16:00:00Z"))!;
    expect((Date.parse(spring.end) - Date.parse(spring.start)) / 3600000).toBe(23);
    expect((Date.parse(fall.end) - Date.parse(fall.start)) / 3600000).toBe(25);
  });
  it("keeps unknown and other modes outside Hint coverage", () => {
    const now = new Date("2026-10-28T14:00:00Z");
    const letter = renderHintDaily(dueHintDay(now)!, [],
      { state: "not_checked", checkedAt: null, attemptedAt: null, activeIncidents: 0, notificationProblems: 0 },
      now, true);
    expect(letter.body).toContain("свежая проверка отсутствует");
    expect(letter.body).toContain("качество этих режимов не проверено");
    expect(letter.body).toContain("остальные системы — не проверено");
    expect(letter.body).toContain("не ноль");
  });
});

function fakeDaily(sendingFails = false) {
  const saved: any = { reports: {} };
  let sends = 0;
  const query = async (sql: string, values: any[] = []) => {
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
    if (sql.includes("pg_advisory_unlock")) return { rows: [] };
    if (sql.startsWith("SELECT * FROM call_lab_controls"))
      return { rows: [{ enabled: true, watchdog: structuredClone(saved), recipient: "owner@example.test", connection_id: "fixture" }] };
    if (sql.startsWith("UPDATE call_lab_controls")) {
      Object.assign(saved, JSON.parse(values[1])); return { rows: [] };
    }
    if (sql.startsWith("SELECT enabled")) return { rows: [{ enabled: true }] };
    if (sql.includes("FROM calls c")) return { rows: [] };
    throw new Error("Unexpected fixture query");
  };
  const client = { query, release() {} };
  const pool: any = { query, connect: async () => client };
  const mail: any = {
    sent: async () => sendingFails ? null : "gmail-fixture-id",
    sendNotice: async (_binding: any, _id: any, _subject: any, _body: any, canSend: any) => {
      if (!await canSend()) throw new Error("paused");
      sends++;
      if (sendingFails) throw new Error("ambiguous write");
      return "gmail-fixture-id";
    },
  };
  return { pool, saved, mail, sends: () => sends };
}
describe("daily durable self-mail", () => {
  const config = { environment: "development", owner: "fixture", allowed: true };
  const now = new Date("2026-10-28T14:00:00Z");
  it("sends once and confirms SENT before recording success", async () => {
    const fixture = fakeDaily();
    await hintDailyTick(fixture.pool, config, now, fixture.mail);
    await hintDailyTick(fixture.pool, config, now, fixture.mail);
    expect(fixture.sends()).toBe(1);
    expect(fixture.saved.reports["2026-10-27"].status).toBe("sent_confirmed");
  });
  it("never blindly resends an ambiguous Gmail write, including after restart", async () => {
    const fixture = fakeDaily(true);
    for (let i = 0; i < 5; i++) await hintDailyTick(fixture.pool, config, now, fixture.mail);
    expect(fixture.sends()).toBe(1);
    expect(fixture.saved.reports["2026-10-27"].status).toBe("needs_review");
  });
  it("does not send when scope is disabled", async () => {
    const fixture = fakeDaily();
    await hintDailyTick(fixture.pool, { ...config, allowed: false }, now, fixture.mail);
    expect(fixture.sends()).toBe(0);
  });
  it("isolates deterministic IDs by environment, owner and calendar day", () => {
    const id = dailyMessageId("production", "owner", "2026-10-28");
    expect(id).toMatch(/^[a-f0-9]{64}@talkhint-lab\.invalid$/);
    expect(dailyMessageId("production", "owner", "2026-10-28")).toBe(id);
    expect(new Set([id, dailyMessageId("development", "owner", "2026-10-28"),
      dailyMessageId("production", "other", "2026-10-28"),
      dailyMessageId("production", "owner", "2026-10-29")]).size).toBe(4);
  });
  it.each(["sending", "unknown"])("quarantines legacy %s without sending or lookup", async status => {
    const fixture = fakeDaily();
    const messageId = "<hint-daily-production-2026-10-27-fixture@talkhint.app>";
    fixture.saved.reports["2026-10-27"] = { status, messageId, checks: 0, body: "retained" };
    fixture.mail.sent = async () => { throw Error("Must not query an unsupported ID"); };
    for (let i = 0; i < 3; i++) await hintDailyTick(fixture.pool, config, now, fixture.mail);
    expect(fixture.sends()).toBe(0);
    expect(fixture.saved.reports["2026-10-27"]).toEqual({
      status: "needs_review", messageId, checks: 0, body: "retained", errorCode: "LAB_BAD_MESSAGE_ID",
    });
  });
  it("uses the actual Gmail encoder and SENT verifier, with network only stubbed", async () => {
    const fixture = fakeDaily();
    let sends = 0;
    let rawMessage = "";
    const sdk: any = {
      proxy: async (_connector: string, path: string, options: any) => {
        if (path.endsWith("/profile")) return Response.json({ emailAddress: "owner@example.test" });
        if (path.endsWith("/messages/send")) {
          sends++;
          rawMessage = Buffer.from(options.body.raw, "base64url").toString("utf8");
          return Response.json({ id: "gmail-fixture-id" });
        }
        if (path.includes("/messages/gmail-fixture-id?")) return Response.json({
          id: "gmail-fixture-id", labelIds: ["SENT"],
          payload: { headers: [{ name: "To", value: "owner@example.test" }] },
        });
        throw Error(`Unexpected fixture request: ${path}`);
      },
    };
    const mail = new GmailLabMail(sdk);
    await hintDailyTick(fixture.pool, config, now, mail);
    await hintDailyTick(fixture.pool, config, now, mail);
    expect(sends).toBe(1);
    expect(rawMessage).toContain(`Message-ID: <${dailyMessageId(config.environment, config.owner, "2026-10-27")}>`);
    expect(fixture.saved.reports["2026-10-27"].status).toBe("sent_confirmed");
    expect(fixture.saved.reports["2026-10-27"].gmailId).toBe("gmail-fixture-id");
  });
  it("reconciles a valid unknown delivery by provider ID without sending again", async () => {
    const fixture = fakeDaily();
    fixture.saved.reports["2026-10-27"] = {
      status: "unknown", messageId: dailyMessageId(config.environment, config.owner, "2026-10-27"),
      gmailId: "gmail-fixture-id", checks: 0,
    };
    const sdk: any = {
      proxy: async (_connector: string, path: string) => {
        if (path.endsWith("/profile")) return Response.json({ emailAddress: "owner@example.test" });
        if (path.includes("/messages/gmail-fixture-id?")) return Response.json({
          id: "gmail-fixture-id", labelIds: ["SENT"],
          payload: { headers: [{ name: "To", value: "owner@example.test" }] },
        });
        throw Error(`Must not send: ${path}`);
      },
    };
    await hintDailyTick(fixture.pool, config, now, new GmailLabMail(sdk));
    expect(fixture.sends()).toBe(0);
    expect(fixture.saved.reports["2026-10-27"].status).toBe("sent_confirmed");
    expect(fixture.saved.reports["2026-10-27"].checks).toBe(1);
  });
});
