import type { Pool } from "pg";
import { CDL_PREVIOUS_BINDING, UNUSED_WORK_NUMBER, WORK_NUMBER_CANDIDATE, WORK_NUMBER_OWNER } from "./policy";

const conflict = (message: string) => Object.assign(new Error(message), { status: 409 });
export function approvedCdlBinding(row: { id: string; user_id: string } | undefined): boolean {
  return !row || row.user_id === WORK_NUMBER_OWNER ||
    (row.id === CDL_PREVIOUS_BINDING.id && row.user_id === CDL_PREVIOUS_BINDING.ownerId);
}

export async function canAdoptCdl(pool: Pool): Promise<boolean> {
  const { rows } = await pool.query("SELECT id, user_id FROM phone_numbers WHERE twilio_number = $1", [WORK_NUMBER_CANDIDATE.phoneNumber]);
  return approvedCdlBinding(rows[0]);
}

/**
 * Only this owner's explicitly approved CDL plan. Not a generic release or
 * account-transfer API. No Twilio calls, purchases, webhook changes or deletion
 * of calls, accounts, reports, transcripts or prompt contents.
 */
export async function activateCdl(pool: Pool, owner: string) {
  if (owner !== WORK_NUMBER_OWNER) throw Object.assign(new Error("Owner not authorized"), { status: 403 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owners = await client.query("SELECT id FROM users WHERE id = ANY($1::varchar[]) ORDER BY id FOR UPDATE",
      [[owner, CDL_PREVIOUS_BINDING.ownerId]]);
    if (!owners.rows.some(n => n.id === owner)) throw conflict("Owner account no longer exists");
    const { rows: pools } = await client.query(
      "SELECT id, twilio_number, twilio_sid FROM available_numbers WHERE twilio_number = ANY($1::text[]) ORDER BY id FOR UPDATE",
      [[WORK_NUMBER_CANDIDATE.phoneNumber, UNUSED_WORK_NUMBER]]);
    const candidate = pools.find(n => n.id === WORK_NUMBER_CANDIDATE.id && n.twilio_number === WORK_NUMBER_CANDIDATE.phoneNumber);
    if (!candidate) throw conflict("Approved CDL number not available");
    const { rows: bindings } = await client.query(
      "SELECT * FROM phone_numbers WHERE user_id = $1 OR twilio_number = ANY($2::text[]) ORDER BY id FOR UPDATE",
      [owner, [WORK_NUMBER_CANDIDATE.phoneNumber, UNUSED_WORK_NUMBER]]);
    const cdl = bindings.find(n => n.twilio_number === WORK_NUMBER_CANDIDATE.phoneNumber);
    if (!approvedCdlBinding(cdl)) throw conflict("CDL number has an unexpected assignment");
    if (bindings.some(n => n.user_id === owner && n.type === "work" &&
      ![WORK_NUMBER_CANDIDATE.phoneNumber, UNUSED_WORK_NUMBER].includes(n.twilio_number)))
      throw conflict("Another work number is already assigned");
    const { rows: active } = await client.query(
      `SELECT id FROM calls WHERE (from_number = ANY($1::text[]) OR to_number = ANY($1::text[]))
       AND status = ANY($2::text[]) LIMIT 1`,
      [[WORK_NUMBER_CANDIDATE.phoneNumber, UNUSED_WORK_NUMBER],
        ["active", "in-progress", "ringing", "initiated", "answered", "connecting", "pending", "queued", "hold"]]);
    if (active.length) throw conflict("A call is active; retry number setup after it ends");

    const unused = bindings.find(n => n.twilio_number === UNUSED_WORK_NUMBER && n.user_id === owner);
    if (unused) {
      if (unused.type !== "work") throw conflict("Unused number changed profile; automatic release refused");
      // Keep all contents and historical ownership, only remove the obsolete
      // number attachment. Optional foreign keys become empty, not deleted.
      await client.query("UPDATE user_prompts SET phone_number_id = NULL WHERE phone_number_id = $1", [unused.id]);
      await client.query("UPDATE calls SET phone_number_id = NULL WHERE phone_number_id = $1", [unused.id]);
      await client.query("DELETE FROM phone_numbers WHERE id = $1 AND user_id = $2", [unused.id, owner]);
    }
    let number: any;
    if (cdl) {
      if (cdl.user_id !== owner) {
        await client.query("UPDATE user_prompts SET phone_number_id = NULL WHERE phone_number_id = $1 AND user_id <> $2", [cdl.id, owner]);
      }
      const changed = await client.query(
        `UPDATE phone_numbers SET user_id = $1::varchar, type = 'work', name = 'Рабочий CDL',
         active_prompt_id = CASE WHEN user_id <> $1::varchar THEN NULL ELSE active_prompt_id END
         WHERE id = $2 RETURNING *`, [owner, cdl.id]);
      number = changed.rows[0];
    } else {
      const created = await client.query(
        `INSERT INTO phone_numbers (user_id, twilio_number, twilio_number_sid, name, type)
         VALUES ($1, $2, $3, 'Рабочий CDL', 'work') RETURNING *`,
        [owner, WORK_NUMBER_CANDIDATE.phoneNumber, candidate.twilio_sid]);
      number = created.rows[0];
    }
    if (!cdl || cdl.user_id !== owner) {
      await client.query(
        `INSERT INTO user_prompts (user_id, phone_number_id, name, content, is_active)
         VALUES ($1, $2, 'Work Secretary', 'Help the owner with business calls using explicitly permitted work context.', true)`,
        [owner, number.id]);
    }
    await client.query("UPDATE available_numbers SET is_assigned = true WHERE id = $1", [WORK_NUMBER_CANDIDATE.id]);
    await client.query(
      `UPDATE available_numbers SET is_assigned = false WHERE twilio_number = $1::text
       AND NOT EXISTS (SELECT 1 FROM phone_numbers WHERE twilio_number = $1::text)`, [UNUSED_WORK_NUMBER]);
    await client.query("COMMIT");
    return { id: number.id, userId: number.user_id, twilioNumber: number.twilio_number,
      name: number.name, type: number.type };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
