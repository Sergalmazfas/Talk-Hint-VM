import { createHash } from "node:crypto";
import { pool } from "../../db";
import { outgoingSettings, prepareOutgoingContext, type OutgoingContext } from "./outgoing";
import { problem } from "./store";
import { releaseKatyaV2 } from "./katyaV2";

// Explicit owner-approved release target, verified read-only against production.
// Never match a telephone suffix at runtime, infer an owner or assign all users.
export const ownerSecretaryRelease = {
  ownerId: "47704265",
  numberId: "ad18dcef-734d-4292-a32e-b3978b596db5",
  personalityId: "877f9196-5721-4a84-8aa6-3e451ce1eba7",
};

/** Transactional, insert-only release data. No providers, dialing, grants,
 * incoming routes or card permissions are changed. Safe on repeated starts. */
export async function initializeOwnerSecretaryDefaults() {
  if (!pool) throw problem(503, "Secretary defaults database unavailable");
  const c = await pool.connect();
  const { ownerId, numberId, personalityId } = ownerSecretaryRelease;
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["secretary-owner-defaults-v1"]);
    const n = await c.query("SELECT id FROM phone_numbers WHERE id=$1 AND user_id=$2 AND type='personal' FOR UPDATE", [numberId, ownerId]);
    if (n.rowCount !== 1) throw problem(503, "Approved Secretary default line unavailable; no replacement selected");
    await c.query(`INSERT INTO secretary_personalities(id,slug,name,search_name,description,status,current_version)
      VALUES($1,'katya',$2,$3,$4,'available',2) ON CONFLICT DO NOTHING`,
      [personalityId, releaseKatyaV2.name, releaseKatyaV2.name.toLowerCase(), releaseKatyaV2.description]);
    const catalog = await c.query("SELECT id FROM secretary_personalities WHERE id=$1 AND slug='katya'", [personalityId]);
    if (catalog.rowCount !== 1) throw problem(503, "Approved catalog identity conflicts; no replacement created");
    await c.query(`INSERT INTO secretary_personality_versions(personality_id,version,content)
      VALUES($1,2,$2::jsonb) ON CONFLICT(personality_id,version) DO NOTHING`,
      [personalityId, JSON.stringify(releaseKatyaV2)]);
    const version = await c.query("SELECT content FROM secretary_personality_versions WHERE personality_id=$1 AND version=2", [personalityId]);
    const actual = version.rows[0]?.content;
    if (!actual || contextHash({ name: actual.name, description: actual.description, rules: actual.rules,
      examples: actual.examples, modeGuidance: actual.modeGuidance }) !== contextHash(releaseKatyaV2))
      throw problem(503, "Approved catalog version differs; immutable content was not overwritten");
    await c.query(`INSERT INTO secretary_personality_assignments(user_id,number_id,personality_id,version)
      VALUES($1,$2,$3,2) ON CONFLICT(user_id,number_id) DO NOTHING`, [ownerId, numberId, personalityId]);
    await c.query(`INSERT INTO secretary_outgoing_settings(user_id,number_id,card_ids)
      VALUES($1,$2,'[]'::jsonb) ON CONFLICT(user_id,number_id) DO NOTHING`, [ownerId, numberId]);
    await c.query(`INSERT INTO secretary_outgoing_defaults(user_id,number_id,provider)
      VALUES($1,$2,'retell') ON CONFLICT(user_id) DO NOTHING`, [ownerId, numberId]);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}

export async function outgoingDefault(owner: string) {
  if (!pool) return undefined;
  const r = await pool.query(`SELECT d.number_id FROM secretary_outgoing_defaults d
    WHERE d.user_id=$1 AND d.provider='retell'`, [owner]);
  if (!r.rows[0]) return undefined;
  // Let the owned-number resolver reject a revoked/transferred line. Do not
  // mistake an invalid configured default for an account without a default.
  const setup = await outgoingSettings(owner, r.rows[0].number_id);
  return { numberId: setup.numberId, provider: "retell" as const, fromNumber: setup.fromNumber,
    scope: setup.scope, personality: setup.assignment ? {
      id: setup.assignment.personalityId, name: setup.assignment.snapshot.name, version: setup.assignment.version,
    } : null };
}

// Small signed digest binds the entire permitted context without leaking full
// cards/rules into the model, approval capability or a huge signed token.
export function contextHash(value: unknown): string {
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) :
    v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
export function outgoingSummary(context: OutgoingContext) {
  return { fromNumber: context.fromNumber, scope: context.scope,
    personality: context.personality ? { id: context.personality.personalityId,
      name: context.personality.snapshot.name, version: context.personality.version } : null };
}
/** ChatGPT model arguments do not override an account's saved default. The
 * actual binding is always shown before the existing owner confirmation. */
export async function prepareDefaultCall(owner: string, input: Record<string, any>) {
  const saved = await outgoingDefault(owner);
  if (!saved) return { ...input, voiceProvider: input.voiceProvider ?? "openai" };
  const context = await prepareOutgoingContext(owner, saved.numberId, "retell");
  if (!context) throw problem(409, "Outgoing context unavailable");
  return { ...input, voiceProvider: "retell", secretaryNumberId: saved.numberId,
    outgoingContextHash: contextHash(context), outgoingSummary: outgoingSummary(context) };
}
export async function confirmedOutgoingContext(owner: string, input: {
  voiceProvider: string; secretaryNumberId?: string; outgoingContextHash?: string;
}) {
  if (!input.secretaryNumberId && !input.outgoingContextHash) return undefined; // old, already-approved drafts
  if (!input.secretaryNumberId || !input.outgoingContextHash) throw problem(409, "Incomplete outgoing confirmation");
  const context = await prepareOutgoingContext(owner, input.secretaryNumberId, input.voiceProvider);
  if (!context || contextHash(context) !== input.outgoingContextHash)
    throw problem(409, "Настройки Secretary изменились. Подготовьте и подтвердите новое поручение; звонок не начат.");
  return context;
}
