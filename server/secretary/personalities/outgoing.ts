import { z } from "zod";
import { pool } from "../../db";
import { storage } from "../../storage";
import { validateSecretaryInstruction } from "../tasks";
import { assignPersonalityInTransaction, ownedNumber, personalitiesEnabled, problem, readBinding } from "./store";
import type { PersonalityBinding } from "./types";

const ids = z.array(z.string().min(1).max(100)).max(8).refine(a => new Set(a).size === a.length);
const fact = z.object({ id: z.string(), title: z.string(), body: z.string() }).strict();
const contextSchema = z.object({
  version: z.literal(1), numberId: z.string().min(1), fromNumber: z.string().min(1),
  scope: z.enum(["personal", "work"]), cardIds: ids, cards: z.array(fact).max(8),
  // Only server-created snapshots are persisted. Binding is rechecked against its immutable DB version below.
  personality: z.unknown().nullable(),
}).strict();
export type OutgoingContext = Omit<z.infer<typeof contextSchema>, "personality"> & { personality: PersonalityBinding | null };
const ready = () => {
  if (!personalitiesEnabled() || !pool) throw problem(409, "Настройки исходящей линии недоступны");
  return pool;
};
export function parseOutgoingContext(value: unknown): OutgoingContext {
  const parsed = contextSchema.safeParse(value);
  if (!parsed.success) throw problem(409, "Сохранённый контекст исходящего поручения повреждён");
  return parsed.data as OutgoingContext;
}
export function assertOutgoingRetryLine(value: unknown, requested: unknown) {
  if (requested && (!value || parseOutgoingContext(value).numberId !== requested))
    throw problem(409, "This request ID belongs to another outgoing line. No new call was placed.");
}
async function eligible(owner: string, number: string) {
  const n = await ownedNumber(owner, number);
  const scope = n.type === "work" ? "work" : "personal";
  const cards = (await storage.listKnowledgeCards(owner)).filter(c => c.userId === owner && c.profileScope === scope);
  return { n, scope: scope as "personal" | "work", cards };
}
export async function outgoingSettings(owner: string, number: string) {
  const db = ready(), { n, scope, cards } = await eligible(owner, number);
  const saved = await db.query("SELECT card_ids FROM secretary_outgoing_settings WHERE user_id=$1 AND number_id=$2", [owner, number]);
  return { protocolVersion: 1, numberId: n.id, scope, fromNumber: n.twilio_number,
    cardIds: saved.rows[0]?.card_ids ?? [],
    cards: cards.map(c => ({ id: c.id, title: c.title, description: c.body.slice(0, 180) })),
    assignment: await readBinding(owner, number) ?? null,
    provider: "retell", engine: "gpt-6.1-sol", reasoning: "medium" };
}
export async function saveOutgoingSetup(owner: string, number: string, input: {
  cardIds: string[]; personalityId: string | null; version: number | null;
}) {
  const db = ready(), { cards } = await eligible(owner, number);
  const chosen = ids.parse(input.cardIds);
  if (chosen.some(id => !cards.some(c => c.id === id))) throw problem(409, "Выберите только свои карточки профиля этого номера");
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await assignPersonalityInTransaction(c, owner, number, input.personalityId, input.version);
    await c.query(`INSERT INTO secretary_outgoing_settings(user_id,number_id,card_ids) VALUES($1,$2,$3::jsonb)
      ON CONFLICT(user_id,number_id) DO UPDATE SET card_ids=excluded.card_ids,updated_at=now()`,
      [owner, number, JSON.stringify(chosen)]);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  return outgoingSettings(owner, number);
}
export async function prepareOutgoingContext(owner: string, number: unknown, provider: string): Promise<OutgoingContext | undefined> {
  if (number === undefined || number === null) return undefined; // exact legacy path
  ready();
  if (typeof number !== "string" || !number || number.length > 100) throw problem(400, "Выберите исходящий номер");
  if (provider !== "retell") throw problem(409, "Выбранная связка исходящих поручений требует Retell + TalkHint Engine");
  const settings = await outgoingSettings(owner, number), { cards } = await eligible(owner, number);
  const selected = settings.cardIds as string[];
  if (selected.some(id => !cards.some(c => c.id === id))) throw problem(409, "Разрешённая карточка удалена или перемещена. Проверьте настройки Secretary");
  const facts = selected.map(id => {
    const c = cards.find(c => c.id === id)!;
    if (c.body.length > 3000 || !validateSecretaryInstruction(c.body))
      throw problem(409, "Карточка слишком длинная или содержит защищённые данные. Подготовьте отдельную карточку для разговора");
    return { id: c.id, title: c.title.slice(0, 120), body: c.body };
  });
  if (facts.reduce((sum, c) => sum + c.body.length, 0) > 12000) throw problem(409, "Общий объём выбранных карточек превышает 12000 символов");
  return { version: 1, numberId: number, fromNumber: settings.fromNumber, scope: settings.scope,
    cardIds: selected, cards: facts, personality: settings.assignment };
}
export async function validateOutgoingSnapshot(owner: string, value: unknown) {
  ready();
  const context = parseOutgoingContext(value), { n, scope, cards } = await eligible(owner, context.numberId);
  if (n.twilio_number !== context.fromNumber || scope !== context.scope)
    throw problem(409, "Принадлежность или профиль исходящей линии изменились");
  if (context.cardIds.length !== context.cards.length || context.cards.some(c =>
    !context.cardIds.includes(c.id) || !cards.some(now => now.id === c.id && now.body === c.body && now.title.slice(0, 120) === c.title)))
    throw problem(409, "Карточки поручения изменились или отозваны до соединения");
  if (context.personality) {
    const p = context.personality;
    const r = await ready().query("SELECT content FROM secretary_personality_versions WHERE personality_id=$1 AND version=$2",
      [p.personalityId, p.version]);
    if (!r.rows[0] || !sameContent(r.rows[0].content, p.snapshot)) throw problem(409, "Версия личности поручения недоступна");
    if (p.mode !== scope) throw problem(409, "Режим личности не совпадает с профилем номера");
  }
  const allowed = await ready().query("SELECT card_ids FROM secretary_outgoing_settings WHERE user_id=$1 AND number_id=$2",
    [owner, context.numberId]);
  if (context.cardIds.some(id => !allowed.rows[0]?.card_ids?.includes(id)))
    throw problem(409, "Разрешение на карточку отозвано");
  return context;
}
function sameContent(saved: any, snapshot: any) {
  return ["name", "description", "rules"].every(k => saved[k] === snapshot[k]) &&
    JSON.stringify(saved.examples) === JSON.stringify(snapshot.examples) &&
    saved.modeGuidance?.personal === snapshot.modeGuidance?.personal && saved.modeGuidance?.work === snapshot.modeGuidance?.work;
}
