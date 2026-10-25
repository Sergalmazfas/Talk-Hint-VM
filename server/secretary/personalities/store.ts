import { pool } from "../../db";
import type { PoolClient } from "pg";
import type { PersonalityBinding, PersonalityContent, PersonalityMode } from "./types";

export const problem = (status: number, message: string) => Object.assign(new Error(message), { status });
const database = () => { if (!pool) throw problem(503, "Хранилище личностей недоступно"); return pool; };
const columns = `id,slug,name,description,status,current_version AS "currentVersion"`;
// Catalog/owned assignments are product settings, not browser-lab features.
// Browser TEST routes retain their separate development/admin gates.
export const personalitiesEnabled = () => process.env.NODE_ENV === "development" || process.env.NODE_ENV === "production";
export const numberMode = (type: string): PersonalityMode => type === "work" ? "work" : "personal";
export function decodeCursor(cursor?: string): [string, string] | null {
  if (!cursor) return null;
  try {
    if (cursor.length > 1200) throw Error();
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (!Array.isArray(value) || value.length !== 2 ||
      value.some(x => typeof x !== "string" || x.length > 200)) throw Error();
    return value as [string, string];
  } catch { throw problem(400, "Некорректная страница каталога"); }
}
export async function listPersonalities(query: string, cursor?: string, limit = 25, retired = false) {
  const after = decodeCursor(cursor);
  const q = query.trim().toLowerCase().slice(0, 100).replace(/[\\%_]/g, "\\$&") + "%";
  const size = Math.max(1, Math.min(100, limit));
  const r = await database().query(`SELECT ${columns},search_name FROM secretary_personalities
    WHERE ($1::boolean OR status='available') AND (search_name LIKE $2 OR slug LIKE $2)
      AND ($3::text IS NULL OR (search_name,id)>($3,$4))
    ORDER BY search_name,id LIMIT $5`, [retired, q, after?.[0] ?? null, after?.[1] ?? null, size + 1]);
  const rows = r.rows.slice(0, size), last = rows.at(-1);
  return { items: rows.map(({ search_name, ...row }) => row),
    nextCursor: r.rows.length > size && last
      ? Buffer.from(JSON.stringify([last.search_name, last.id])).toString("base64url") : null };
}
export async function personalityDetails(id: string) {
  const r = await database().query(`SELECT ${columns} FROM secretary_personalities WHERE id=$1`, [id]);
  if (!r.rows[0]) throw problem(404, "Личность не найдена");
  const versions = await database().query(`SELECT version,content FROM secretary_personality_versions
    WHERE personality_id=$1 ORDER BY version DESC LIMIT 100`, [id]);
  return { personality: r.rows[0], versions: versions.rows.map(v => ({ ...v.content, version: v.version })) };
}
/** Browser TEST sessions pin an available catalog version, never a phone assignment. */
export async function availablePersonalityVersion(id: string, version: number, mode: PersonalityMode): Promise<PersonalityBinding> {
  if (!personalitiesEnabled()) throw problem(404, "Личности стенда доступны только в Dev");
  const r = await database().query(`SELECT p.id,p.status,p.current_version,v.content FROM secretary_personalities p
    JOIN secretary_personality_versions v ON v.personality_id=p.id AND v.version=$2
    WHERE p.id=$1`, [id, version]);
  const row = r.rows[0];
  if (!row || row.status !== "available" || row.current_version !== version)
    throw problem(409, "Личность недоступна или её версия изменилась. Обновите каталог и выберите её снова.");
  return { personalityId: row.id, version, mode, snapshot: {
    ...row.content, id: row.id, version, status: row.status,
  } };
}
export async function createPersonality(slug: string, content: PersonalityContent) {
  const c = await database().connect();
  try {
    await c.query("BEGIN");
    const r = await c.query(`INSERT INTO secretary_personalities(slug,name,search_name,description,current_version)
      VALUES($1,$2,$3,$4,1) RETURNING id`, [slug, content.name, content.name.toLowerCase(), content.description]);
    await c.query(`INSERT INTO secretary_personality_versions(personality_id,version,content) VALUES($1,1,$2::jsonb)`,
      [r.rows[0].id, JSON.stringify(content)]);
    await c.query("COMMIT");
    return await personalityDetails(r.rows[0].id);
  } catch (e: any) {
    await c.query("ROLLBACK");
    if (e.code === "23505") throw problem(409, "Такой постоянный slug уже существует");
    throw e;
  } finally { c.release(); }
}
export async function revisePersonality(id: string, expected: number, status: string, content: PersonalityContent) {
  const c = await database().connect();
  try {
    await c.query("BEGIN");
    const old = await c.query("SELECT current_version FROM secretary_personalities WHERE id=$1 FOR UPDATE", [id]);
    if (!old.rows[0]) throw problem(404, "Личность не найдена");
    if (old.rows[0].current_version !== expected) throw problem(409, "Версия уже изменилась. Перечитайте карточку");
    const version = expected + 1;
    await c.query("INSERT INTO secretary_personality_versions(personality_id,version,content) VALUES($1,$2,$3::jsonb)",
      [id, version, JSON.stringify(content)]);
    await c.query(`UPDATE secretary_personalities SET name=$2,search_name=$3,description=$4,status=$5,
      current_version=$6,updated_at=now() WHERE id=$1`,
      [id, content.name, content.name.toLowerCase(), content.description, status, version]);
    await c.query("COMMIT");
    return await personalityDetails(id);
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}
export async function ownedNumber(owner: string, number: string) {
  const r = await database().query("SELECT id,type,twilio_number FROM phone_numbers WHERE id=$1 AND user_id=$2", [number, owner]);
  if (!r.rows[0]) throw problem(404, "Номер не найден");
  return r.rows[0] as { id: string; type: string; twilio_number: string };
}
export async function readBinding(owner: string, number: string): Promise<PersonalityBinding | undefined> {
  const n = await ownedNumber(owner, number);
  const r = await database().query(`SELECT a.personality_id,a.version,p.status,v.content
    FROM secretary_personality_assignments a JOIN phone_numbers n ON n.id=a.number_id AND n.user_id=a.user_id
    JOIN secretary_personalities p ON p.id=a.personality_id
    JOIN secretary_personality_versions v ON v.personality_id=a.personality_id AND v.version=a.version
    WHERE a.user_id=$1 AND a.number_id=$2`, [owner, number]);
  const a = r.rows[0];
  if (!a) return undefined;
  return { personalityId: a.personality_id, version: a.version, mode: numberMode(n.type),
    snapshot: { ...a.content, id: a.personality_id, version: a.version, status: a.status } };
}
export async function assignPersonality(owner: string, number: string, id: string | null, version: number | null) {
  const c = await database().connect();
  try {
    await c.query("BEGIN");
    await assignPersonalityInTransaction(c, owner, number, id, version);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}
export async function assignPersonalityInTransaction(c: PoolClient, owner: string, number: string, id: string | null, version: number | null) {
    const n = await c.query("SELECT id FROM phone_numbers WHERE id=$1 AND user_id=$2 FOR SHARE", [number, owner]);
    if (!n.rows[0]) throw problem(404, "Номер не найден");
    if (id === null) {
      await c.query("DELETE FROM secretary_personality_assignments WHERE user_id=$1 AND number_id=$2", [owner, number]);
    } else {
      const existing = await c.query(`SELECT 1 FROM secretary_personality_assignments
        WHERE user_id=$1 AND number_id=$2 AND personality_id=$3 AND version=$4`, [owner, number, id, version]);
      if (existing.rows.length) return; // Keep a pinned/retired assignment while changing other settings.
      const p = await c.query("SELECT status,current_version FROM secretary_personalities WHERE id=$1 FOR SHARE", [id]);
      if (!p.rows[0] || p.rows[0].status !== "available") throw problem(409, "Личность недоступна для новых назначений");
      if (p.rows[0].current_version !== version) throw problem(409, "Выберите актуальную версию личности");
      await c.query(`INSERT INTO secretary_personality_assignments(user_id,number_id,personality_id,version)
        VALUES($1,$2,$3,$4) ON CONFLICT(user_id,number_id) DO UPDATE SET
        personality_id=excluded.personality_id,version=excluded.version,updated_at=now()`, [owner, number, id, version]);
    }
}
export async function resolveNumberPersonality(owner: string, number: string) {
  if (!personalitiesEnabled()) return undefined;
  return readBinding(owner, number);
}
/** Resolve the actual owned caller-ID line, not arbitrary card/number IDs from a task. */
export async function resolveOutgoingPersonality(owner: string, fromNumber: string) {
  if (!personalitiesEnabled()) return undefined;
  const r = await database().query("SELECT id FROM phone_numbers WHERE user_id=$1 AND twilio_number=$2", [owner, fromNumber]);
  if (r.rows.length !== 1) throw problem(409, "Исходящая линия не определена однозначно");
  return readBinding(owner, r.rows[0].id);
}
