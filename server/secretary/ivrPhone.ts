import { and, eq, desc, sql } from "drizzle-orm";
import { calls, secretaryTasks } from "@shared/schema";
import { db } from "../db";
import { getSecretaryTaskById } from "./tasks";
import { SecretaryIvr, type IvrEvent, type MenuStep } from "./ivr";
import { publishSecretaryFeedEvent } from "./feed";
import { notifySecretaryResult } from "./notifications";
import type { TelephoneTools } from "./conversationEngine";

const contexts = new Map<string, Promise<{ owner: string; controller: SecretaryIvr }>>();
async function activeTask(id: string) {
  const task = await getSecretaryTaskById(id);
  if (!task || task.voiceProvider !== "retell" || !task.callSid ||
    !["starting", "ringing", "connected"].includes(task.status)) throw Error("Active Retell call required");
  return task;
}
async function record(id: string, event: IvrEvent, path?: MenuStep[]) {
  const task = await activeTask(id);
  await db.transaction(async tx => {
    const [current] = await tx.select().from(secretaryTasks).where(eq(secretaryTasks.id, id)).for("update");
    if (!current || current.callSid !== task.callSid || !["starting", "ringing", "connected"].includes(current.status))
      throw Error("Call ended");
    const [call] = await tx.select().from(calls).where(and(eq(calls.callSid, task.callSid!), eq(calls.userId, task.userId))).for("update");
    if (!call) throw Error("Bound call missing");
    const metadata = (call.metadata ?? {}) as any;
    const previous = metadata.secretaryIvr ?? {};
    const events = (Array.isArray(previous.events) ? previous.events : []).filter((e: any) => e.id !== event.id);
    events.push(event);
    await tx.update(calls).set({ metadata: { ...metadata, secretaryIvr: {
      ...previous, events: events.slice(-200), ...(path ? { learnedPath: path, confirmedAt: event.at } : {}),
    } } }).where(eq(calls.id, call.id));
    if (event.kind === "press" && event.result === "command_sent_destination_acceptance_unknown") {
      const turn = { id: event.id, role: "secretary", text: `Катя нажала ${event.digits} (команда отправлена; принятие меню пока неизвестно).` };
      const turns = [...((current.transcriptTurns ?? []) as any[]).filter(t => t.id !== turn.id), turn];
      const transcript = turns.map(t => `${t.role === "guest" ? "Other party" : "Secretary"}: ${t.text}`).join("\n");
      await tx.update(secretaryTasks).set({ transcriptTurns: turns, transcript, updatedAt: new Date() }).where(eq(secretaryTasks.id, id));
      await tx.update(calls).set({ transcript }).where(eq(calls.id, call.id));
    }
  });
  if (event.kind === "press" && event.result === "command_sent_destination_acceptance_unknown")
    publishSecretaryFeedEvent(id, { type: "turn", turnId: event.id, role: "secretary",
      text: `Катя нажала ${event.digits} (команда отправлена).` });
}
async function context(id: string) {
  let existing = contexts.get(id);
  if (!existing) {
    existing = (async () => {
      const task = await activeTask(id);
      const [memory] = await db.select({ metadata: calls.metadata }).from(calls).where(and(
        eq(calls.userId, task.userId), eq(calls.toNumber, task.phoneNumber),
        sql`${calls.metadata}->'secretaryIvr'->'learnedPath' IS NOT NULL`,
      )).orderBy(desc(calls.startedAt)).limit(1);
      const stored = (memory?.metadata as any)?.secretaryIvr?.learnedPath;
      const path: MenuStep[] = Array.isArray(stored) ? stored.filter((s: any) =>
        /^[a-f0-9]{64}$/.test(s?.menuHash) && /^[0-9*#]{1,5}$/.test(s?.digits)).slice(0, 20) : [];
      const controller = new SecretaryIvr({
        send: async (digits, signal) => {
          await activeTask(id);
          if (signal?.aborted) throw Error("Interrupted");
          (await import("./retellPhone")).retellPhoneRegistry.pressDigits(id, digits, signal);
        },
        record: event => record(id, event),
        notify: async menu => {
          await activeTask(id);
          await notifySecretaryResult(task.userId, id, false, {
            body: `Застряла в меню: ${menu.slice(0, 600)}. Ответьте цифрой на защищённой странице меню. Лимит звонка — 5 минут.`,
            url: "/api/secretary/ivr",
          });
        },
        remember: steps => record(id, { id: "ivr:learned-route", at: new Date().toISOString(),
          kind: "reached", heard: "", result: "route_saved_for_owner_and_number" }, steps),
      }, path);
      return { owner: task.userId, controller };
    })();
    contexts.set(id, existing);
    existing.catch(() => { if (contexts.get(id) === existing) contexts.delete(id); });
  }
  return existing;
}
export function resolvedPhoneIvrTools(id: string): TelephoneTools {
  let resolved: SecretaryIvr | undefined;
  return {
    beforeTurn: async turns => { resolved = (await context(id)).controller; await resolved.observe(turns); return resolved.context(); },
    execute: async (name, args, signal) => {
      resolved = (await context(id)).controller; return resolved.tool(name, args, signal);
    },
    blocksEnd: () => resolved?.blocksEnd() ?? false,
  };
}
export async function ownerIvr(id: string, owner: string) {
  const task = await activeTask(id);
  if (task.userId !== owner) throw Error("Owner mismatch");
  const c = await context(id);
  if (c.owner !== owner) throw Error("Owner mismatch");
  return c.controller;
}
export function endPhoneIvr(id: string) { contexts.delete(id); }
export async function observePhoneIvr(id: string, turns: Parameters<SecretaryIvr["observe"]>[0]) {
  await (await context(id)).controller.observe(turns);
}
