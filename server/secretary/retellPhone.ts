import { SECRETARY_CALL_LIMIT_MS } from "./limits";
import { secretaryPreparationMetadata } from "../callPlans/secretary";
import { eq, and, inArray, sql } from "drizzle-orm";
import { calls, secretaryTasks } from "@shared/schema";
import { db } from "../db";
import { storage } from "../storage";
import { RetellApi } from "../secretaryLab/retellApi";
import { RetellEngineRegistry } from "../secretaryLab/retellEngine";
import type { SpokenTurn } from "./conversationEngine";
import { getSecretaryTaskForCall } from "./tasks";
import { publishSecretaryFeedEvent } from "./feed";
import { createHash } from "node:crypto";
import { resolveOutgoingPersonality } from "./personalities/store";
import { validateOutgoingSnapshot } from "./personalities/outgoing";
import { resolvedPhoneIvrTools, endPhoneIvr, observePhoneIvr } from "./ivrPhone";
import { mergeIvrTranscript } from "./ivrSelection";
import { selectedPhoneVariant, type PhoneVariant } from "./phoneRollout";

export const RETELL_PHONE_AGENT = "TalkHint Secretary — Telephone + Engine";
export const retellPhoneApi = new RetellApi();
const active = ["starting", "ringing", "connected"] as const;
const admissions = new Map<string, Promise<string>>();
const registered = new Map<string, { callId: string; callSid: string; sip: string }>();
const writes = new Map<string, Promise<void>>();
const verified = new Map<string, { id: string; version: number; until: number }>();
const preparing = new Map<string, Promise<string>>();
const phoneProfiles = new Map<string, PhoneVariant>();
const configKey = (origin: string, variant: PhoneVariant) => origin + "|" + variant;

/** Isolated phone agent, never the browser bench agent or a number-level route. */
export function retellPhoneConfiguration(origin: string, variant: PhoneVariant = "legacy") {
  return {
    agent_name: `${RETELL_PHONE_AGENT} · ${createHash("sha256").update(origin).digest("hex").slice(0, 10)}` +
      (variant === "C" ? " · C" : ""),
    response_engine: { type: "custom-llm", llm_websocket_url: origin.replace(/^https:/, "wss:") +
      "/retell-phone-engine/{{talkhint_phone_ticket}}" },
    voice_id: "retell-Merritt", language: ["en-US", "ru-RU", "es-ES"],
    interruption_sensitivity: variant === "C" ? 0.85 : 0.9, responsiveness: 1, enable_backchannel: false,
    ...(variant === "C" ? { enable_dynamic_responsiveness: true, stt_mode: "fast" } : {}),
    data_storage_setting: "basic_attributes_only", max_call_duration_ms: SECRETARY_CALL_LIMIT_MS,
    end_call_after_silence_ms: SECRETARY_CALL_LIMIT_MS, webhook_events: [], fallback_voice_ids: [],
    contact_memory_config: { enable_read: false, enable_update: false },
  };
}
export function verifyRetellPhoneAgent(agent: any, origin: string, variant: PhoneVariant = "legacy") {
  const expected = retellPhoneConfiguration(origin, variant);
  if (agent?.agent_name !== expected.agent_name ||
    agent?.response_engine?.type !== "custom-llm" ||
    agent?.response_engine?.llm_websocket_url !== expected.response_engine.llm_websocket_url ||
    agent?.voice_id !== expected.voice_id ||
    JSON.stringify(agent?.language) !== JSON.stringify(expected.language) ||
    agent?.interruption_sensitivity !== expected.interruption_sensitivity || agent?.responsiveness !== 1 ||
    (variant === "C" && (agent?.enable_dynamic_responsiveness !== true || agent?.stt_mode !== "fast")) ||
    agent?.enable_backchannel !== false || agent?.max_call_duration_ms !== SECRETARY_CALL_LIMIT_MS ||
    agent?.end_call_after_silence_ms !== SECRETARY_CALL_LIMIT_MS ||
    agent?.data_storage_setting !== "basic_attributes_only" ||
    agent?.contact_memory_config?.enable_read !== false ||
    agent?.contact_memory_config?.enable_update !== false ||
    (agent?.fallback_voice_ids?.length ?? 0) !== 0 ||
    (agent?.webhook_events?.length ?? 0) !== 0 ||
    (agent?.pre_session_tools?.length ?? 0) !== 0 ||
    (agent?.post_session_tools?.length ?? 0) !== 0 ||
    !/^[A-Za-z0-9_-]{1,120}$/.test(agent?.agent_id ?? "")) {
    throw new Error("Retell telephone configuration was not verified; no fallback");
  }
  return agent.agent_id as string;
}
/** Upgrade only the reviewed five-minute telephone config, never other drift.
 * Runs on the existing pre-dial readiness path, not on deploy/startup. */
export async function ensureRetellPhoneDuration(agent: any, origin: string,
  api: Pick<RetellApi, "request"> = retellPhoneApi, variant: PhoneVariant = "legacy") {
  if (agent?.max_call_duration_ms === 300_000 && agent?.end_call_after_silence_ms === 300_000) {
    const id = verifyRetellPhoneAgent({ ...agent, max_call_duration_ms: SECRETARY_CALL_LIMIT_MS,
      end_call_after_silence_ms: SECRETARY_CALL_LIMIT_MS }, origin, variant);
    await api.request(`/update-agent/${encodeURIComponent(id)}`, {
      max_call_duration_ms: SECRETARY_CALL_LIMIT_MS, end_call_after_silence_ms: SECRETARY_CALL_LIMIT_MS,
    }, "PATCH");
    agent = await api.request(`/get-agent/${encodeURIComponent(id)}`);
  }
  verifyRetellPhoneAgent(agent, origin, variant);
  return agent;
}
/** Does not register, dial or redirect any call. Must complete before Twilio create. */
export async function requireRetellPhone(origin: string, variant?: PhoneVariant): Promise<string> {
  if (!/^https:\/\/[a-zA-Z0-9.-]+$/.test(origin)) throw new Error("Invalid telephone callback origin");
  if (!process.env.RETELL_API_KEY || !process.env.OPENAI_API_KEY || !process.env.SESSION_SECRET)
    throw new Error("Retell telephone credentials are not configured; no call placed");
  variant ??= await selectedPhoneVariant();
  const key = configKey(origin, variant), cached = verified.get(key);
  if (cached && cached.until > Date.now()) return cached.id;
  const pending = preparing.get(key); if (pending) return pending;
  const model = variant === "C" ? "gpt-6-sol" : "gpt-6.1-sol";
  const work = (async () => {
    const r = await fetch(`https://api.openai.com/v1/models/${model}`, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(10_000), redirect: "error",
    });
    if (!r.ok || (await r.json()).id !== model) throw new Error("TalkHint Engine unavailable; no call placed");
    const matches = (await retellPhoneApi.listAgents()).filter((a: any) => a.agent_name === retellPhoneConfiguration(origin, variant).agent_name);
    if (matches.length > 1) throw new Error("Duplicate Retell telephone agents; no call placed");
    const created = matches[0] ?? await retellPhoneApi.request("/create-agent", retellPhoneConfiguration(origin, variant));
    const agent = await ensureRetellPhoneDuration(
      await retellPhoneApi.request(`/get-agent/${encodeURIComponent(created.agent_id)}`), origin, retellPhoneApi, variant);
    const id = verifyRetellPhoneAgent(agent, origin, variant);
    if (!Number.isInteger(agent.version) || agent.version < 0) throw new Error("Retell agent version not verified; no call placed");
    verified.set(key, { id, version: agent.version, until: Date.now() + 60_000 });
    return id;
  })().finally(() => { preparing.delete(key); });
  preparing.set(key, work);
  return work;
}

/** Replace snapshots, never append partial ASR as repeated "final" turns. */
async function saveTranscript(taskId: string, turns: SpokenTurn[]) {
  await observePhoneIvr(taskId, turns);
  const previous = writes.get(taskId) ?? Promise.resolve();
  const next = previous.then(async () => {
    let snapshot: (import("./ivrSelection").IvrTranscriptTurn & { role: "secretary" | "guest" })[] = turns.map((turn, index) => ({
      id: `retell:${index}`, role: turn.role === "agent" ? "secretary" as const : "guest" as const,
      text: turn.content.trim().slice(0, 4000),
    })).filter(t => t.text);
    await db.transaction(async tx => {
      const [task] = await tx.select().from(secretaryTasks).where(eq(secretaryTasks.id, taskId)).for("update");
      if (!task || task.voiceProvider !== "retell" || !task.callSid || !active.includes(task.status as any))
        throw new Error("Retell transcript no longer belongs to an active call");
      const ivr = ((task.transcriptTurns ?? []) as typeof snapshot).filter(t => t.id.startsWith("ivr:"));
      snapshot = mergeIvrTranscript(snapshot, ivr);
      const mergedTranscript = snapshot.map(t => `${t.role === "secretary" ? "Secretary" : "Other party"}: ${t.text.replace(/[\r\n]+/g, " ")}`).join("\n");
      await tx.update(secretaryTasks).set({ transcript: mergedTranscript, transcriptTurns: snapshot, updatedAt: new Date() })
        .where(eq(secretaryTasks.id, taskId));
      const diagnostics = retellPhoneRegistry.diagnostics(taskId);
      await tx.update(calls).set({ transcript: mergedTranscript,
        ...(diagnostics ? { metadata: sql`coalesce(${calls.metadata}, '{}'::jsonb) ||
          ${JSON.stringify({ secretaryEngine: diagnostics })}::jsonb` } : {}),
      }).where(and(eq(calls.callSid, task.callSid), eq(calls.userId, task.userId)));
    });
    for (const t of snapshot) publishSecretaryFeedEvent(taskId, { type: "turn", turnId: t.id, role: t.role, text: t.text });
  });
  writes.set(taskId, next);
  return next;
}
export const retellPhoneRegistry = new RetellEngineRegistry(undefined, {
    phone: true,
    phoneProfile: id => phoneProfiles.get(id) ?? "legacy",
    telephoneTools: resolvedPhoneIvrTools,
    onTranscript: saveTranscript,
    onFailure: id => { void failPhone(id).catch(() => console.error("[Secretary Retell] Failure cleanup could not complete")); },
  });
async function failPhone(id: string) {
  const binding = registered.get(id);
  if (!binding) return;
  try {
    const { getSecretaryTaskById, markSecretaryStreamFailed } = await import("./tasks");
    const task = await getSecretaryTaskById(id);
    if (task?.voiceProvider !== "retell" || task.callSid !== binding.callSid ||
      !active.includes(task.status as any)) return;
    await markSecretaryStreamFailed(id, binding.callSid, "Retell Engine connection or transcript persistence interrupted");
    await (await import("./dialer")).hangupSecretaryCall(binding.callSid);
  } finally {
    await endRetellPhone(id).catch(() => {});
  }
}

/** Twilio callback retry cannot create a second Retell registration, even after a restart.
 * An ambiguous durable reservation fails closed instead of retrying a POST. */
export function registerRetellPhone(taskId: string, callSid: string, origin: string): Promise<string> {
  const prior = admissions.get(taskId);
  if (prior) return prior;
  const work = (async () => {
    const task = await getSecretaryTaskForCall(taskId, callSid);
    if (!task || task.voiceProvider !== "retell") throw new Error("Retell call identity mismatch");
    const existing = registered.get(taskId);
    if (existing) return existing.sip;
    const variant = await selectedPhoneVariant();
    const agentId = await requireRetellPhone(origin, variant);
    const reservation = { state: "registering", taskId };
    const reserved = await db.update(calls).set({
      metadata: sql`coalesce(${calls.metadata}, '{}'::jsonb) || ${JSON.stringify({
        retellPhone: reservation, ...secretaryPreparationMetadata(task),
      })}::jsonb`,
    }).where(and(eq(calls.callSid, callSid), eq(calls.userId, task.userId),
      sql`${calls.metadata}->'retellPhone' IS NULL`)).returning({ id: calls.id });
    if (!reserved.length) throw new Error("Retell registration already attempted; automatic retry prohibited");
    const history = await storage.getCallByCallSid(callSid);
    const context = task.outgoingContext ? await validateOutgoingSnapshot(task.userId, task.outgoingContext) : undefined;
    if (context && context.fromNumber !== history?.fromNumber) throw new Error("Outgoing line context mismatch");
    const personality = context ? context.personality ?? undefined :
      await resolveOutgoingPersonality(task.userId, history?.fromNumber ?? "");
    phoneProfiles.set(taskId, variant);
    const entry = retellPhoneRegistry.reserve(task.userId, task.instruction, taskId, personality, context?.cards);
    try {
      const call = await retellPhoneApi.request("/v2/register-phone-call", {
        agent_id: agentId, agent_version: verified.get(configKey(origin, variant))!.version, direction: "outbound",
        from_number: (await storage.getCallByCallSid(callSid))?.fromNumber,
        to_number: task.phoneNumber,
        retell_llm_dynamic_variables: { talkhint_phone_ticket: entry.ticket },
      });
      if (call.call_type !== "phone_call" || !/^call_[A-Za-z0-9_-]{1,110}$/.test(call.call_id ?? ""))
        throw new Error("Retell phone admission was not confirmed");
      await db.update(calls).set({
        metadata: sql`coalesce(${calls.metadata}, '{}'::jsonb) || ${JSON.stringify({
          retellPhone: { state: "registered", taskId, callId: call.call_id, agentId,
            model: variant === "C" ? "gpt-6-sol" : "gpt-6.1-sol", voice: "retell-Merritt", variant,
            reasoning: variant === "C" ? "low" : "medium",
            engine: retellPhoneRegistry.diagnostics(taskId),
            environment: process.env.NODE_ENV === "development" ? "development" : "production",
            personality: personality ? { id: personality.personalityId, version: personality.version, mode: personality.mode } : null },
        })}::jsonb`,
      }).where(and(eq(calls.callSid, callSid), eq(calls.userId, task.userId)));
      retellPhoneRegistry.registered(taskId, call.call_id);
      const sip = `sip:${call.call_id}@sip.retellai.com;transport=tls`;
      registered.set(taskId, { callId: call.call_id, callSid, sip });
      return sip;
    } catch (error) { retellPhoneRegistry.ended(taskId); phoneProfiles.delete(taskId); throw error; }
  })();
  admissions.set(taskId, work);
  return work;
}
export async function endRetellPhone(taskId: string) {
  try {
    await retellPhoneRegistry.flush(taskId);
    await writes.get(taskId);
    const binding = registered.get(taskId), diagnostics = retellPhoneRegistry.diagnostics(taskId);
    if (binding && diagnostics) await db.update(calls).set({
      metadata: sql`coalesce(${calls.metadata}, '{}'::jsonb) || ${JSON.stringify({ secretaryEngine: diagnostics })}::jsonb`,
    }).where(eq(calls.callSid, binding.callSid));
  } finally {
    retellPhoneRegistry.ended(taskId);
    admissions.delete(taskId); registered.delete(taskId); writes.delete(taskId); phoneProfiles.delete(taskId);
    endPhoneIvr(taskId);
  }
}
