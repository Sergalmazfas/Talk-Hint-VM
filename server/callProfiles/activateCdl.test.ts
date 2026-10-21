import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { activateCdl, approvedCdlBinding } from "./activateCdl";
import { CDL_PREVIOUS_BINDING, UNUSED_WORK_NUMBER, WORK_NUMBER_CANDIDATE, WORK_NUMBER_OWNER } from "./policy";

describe("owner-approved CDL setup transaction; no provider operations", () => {
  let bindings: any[], active: boolean, ownerExists: boolean;
  const query = vi.fn(), release = vi.fn();
  const pool = { connect: vi.fn() } as unknown as Pool;
  beforeEach(() => {
    vi.clearAllMocks(); active = false; ownerExists = true;
    bindings = [];
    (pool.connect as any).mockResolvedValue({ query, release });
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT id FROM users")) return { rows: ownerExists ? [{ id: WORK_NUMBER_OWNER }] : [] };
      if (sql.startsWith("SELECT id, twilio_number")) return { rows: [{ id: WORK_NUMBER_CANDIDATE.id, twilio_number: WORK_NUMBER_CANDIDATE.phoneNumber, twilio_sid: "provider-number" }] };
      if (sql.startsWith("SELECT * FROM phone_numbers")) return { rows: bindings };
      if (sql.startsWith("SELECT id FROM calls")) return { rows: active ? [{ id: "active-call" }] : [] };
      if (sql.startsWith("UPDATE phone_numbers SET")) {
        return { rows: [{ ...bindings.find(n => n.twilio_number === WORK_NUMBER_CANDIDATE.phoneNumber), user_id: WORK_NUMBER_OWNER, type: "work", name: "Рабочий CDL" }] };
      }
      if (sql.startsWith("INSERT INTO phone_numbers")) return { rows: [{ id: "new-cdl", user_id: WORK_NUMBER_OWNER, twilio_number: WORK_NUMBER_CANDIDATE.phoneNumber, type: "work", name: "Рабочий CDL" }] };
      return { rows: [] };
    });
  });
  const statements = () => query.mock.calls.map(c => String(c[0])).join("\n");
  const previous = () => ({ id: CDL_PREVIOUS_BINDING.id, user_id: CDL_PREVIOUS_BINDING.ownerId, twilio_number: WORK_NUMBER_CANDIDATE.phoneNumber, type: "personal" });
  it("accepts only the specifically approved former binding or the current owner", () => {
    expect(approvedCdlBinding(undefined)).toBe(true);
    expect(approvedCdlBinding(previous())).toBe(true);
    expect(approvedCdlBinding({ id: "changed-row", user_id: CDL_PREVIOUS_BINDING.ownerId })).toBe(false);
    expect(approvedCdlBinding({ id: CDL_PREVIOUS_BINDING.id, user_id: "another-account" })).toBe(false);
  });
  it("returns the trial number to the pool while retaining prompt contents and call history", async () => {
    bindings = [{ id: "trial", user_id: WORK_NUMBER_OWNER, twilio_number: UNUSED_WORK_NUMBER, type: "work" }];
    const result = await activateCdl(pool, WORK_NUMBER_OWNER);
    expect(result.twilioNumber).toBe(WORK_NUMBER_CANDIDATE.phoneNumber);
    expect(query).toHaveBeenCalledWith("DELETE FROM phone_numbers WHERE id = $1 AND user_id = $2", ["trial", WORK_NUMBER_OWNER]);
    expect(query).toHaveBeenCalledWith("UPDATE calls SET phone_number_id = NULL WHERE phone_number_id = $1", ["trial"]);
    expect(statements()).toContain("SET is_assigned = false");
    expect(statements()).not.toMatch(/DELETE FROM (calls|users|user_prompts|available_numbers|secretary_tasks)\b/);
    expect(query).toHaveBeenCalledWith("COMMIT");
  });
  it("retains the existing CDL binding ID and historical owners, detaching old private instructions", async () => {
    bindings = [previous()];
    const result = await activateCdl(pool, WORK_NUMBER_OWNER);
    expect(result.id).toBe(CDL_PREVIOUS_BINDING.id);
    expect(result.userId).toBe(WORK_NUMBER_OWNER); expect(result.type).toBe("work");
    expect(statements()).not.toContain("INSERT INTO phone_numbers");
    expect(statements()).not.toContain("UPDATE calls SET user_id");
    expect(query).toHaveBeenCalledWith(
      "UPDATE user_prompts SET phone_number_id = NULL WHERE phone_number_id = $1 AND user_id <> $2",
      [CDL_PREVIOUS_BINDING.id, WORK_NUMBER_OWNER]);
  });
  it("never releases the rejected trial number when it belongs to another account", async () => {
    bindings = [{ id: "other", user_id: "other", twilio_number: UNUSED_WORK_NUMBER, type: "work" }];
    await activateCdl(pool, WORK_NUMBER_OWNER);
    expect(statements()).not.toContain("DELETE FROM phone_numbers");
    // The pool update itself also requires NOT EXISTS, so an occupied number stays assigned.
    expect(statements()).toContain("NOT EXISTS (SELECT 1 FROM phone_numbers");
  });
  it("does not recreate an already-owned CDL binding on retry", async () => {
    bindings = [{ ...previous(), user_id: WORK_NUMBER_OWNER, type: "work" }];
    expect((await activateCdl(pool, WORK_NUMBER_OWNER)).id).toBe(CDL_PREVIOUS_BINDING.id);
    expect(statements()).not.toContain("INSERT INTO phone_numbers");
    expect(statements()).not.toContain("INSERT INTO user_prompts");
  });
  it("blocks a changed CDL owner without releasing the trial number", async () => {
    bindings = [{ ...previous(), user_id: "unexpected-owner" }];
    await expect(activateCdl(pool, WORK_NUMBER_OWNER)).rejects.toMatchObject({ status: 409 });
    expect(statements()).not.toMatch(/DELETE FROM|UPDATE /); expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });
  it("does not interrupt calls or act for an unapproved/missing owner", async () => {
    active = true;
    await expect(activateCdl(pool, WORK_NUMBER_OWNER)).rejects.toMatchObject({ status: 409 });
    expect(statements()).not.toMatch(/DELETE FROM|UPDATE /);
    await expect(activateCdl(pool, "another-owner")).rejects.toMatchObject({ status: 403 });
    active = false; ownerExists = false;
    await expect(activateCdl(pool, WORK_NUMBER_OWNER)).rejects.toMatchObject({ status: 409 });
  });
});
