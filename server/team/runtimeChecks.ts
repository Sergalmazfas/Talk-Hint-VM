import { createHash } from "node:crypto";
import type { TeamContext } from "./repository";
import type { RuntimeChecks } from "./runtime";
import { hintWatchdogStatus } from "../callLab/watchdog";

/** Only reads live process status and saved owner-scoped inputs.
 * Does NOT call readiness, requireRetellPhone, or any provider API. */
export async function teamRuntimeChecks(c: TeamContext): Promise<RuntimeChecks> {
  const result: RuntimeChecks = { watchdog: hintWatchdogStatus() };
  const task = c.secretaryTasks?.find(t => t.voice_provider === "retell" && t.call_sid && t.dial_started_at);
  if (!task || c.secretaryDefault !== "retell") return result;
  try {
  const { SecretaryConversationEngine } = await import("../secretary/conversationEngine");
  const context = task.outgoing_context;
  const personality = context?.personality ?? undefined;
  // Constructor builds the same current telephone instructions, without starting
  // a model, sending audio, creating a provider agent, or running a tool.
  const unavailable = async () => { throw Error("READ_ONLY_PROFILE_NO_TOOLS"); };
  const engine = new SecretaryConversationEngine(c.secretaryOwnerName ?? "", task.instruction,
    undefined, true, personality, context?.cards ?? [],
    { beforeTurn: unavailable, execute: unavailable, blocksEnd: () => false });
  const snapshot = personality?.snapshot;
  result.secretaryPrompt = {
    text: engine.instructions, version: createHash("sha256").update(engine.instructions).digest("hex"),
    source: `Текущий код телефонного Engine; реконструкция по последнему сохранённому заданию ${task.id}. Не побайтный снимок прошлой сессии; Retell provider GET не выполнялся.`,
    model: engine.report.model, name: snapshot?.name ?? null,
    traits: [snapshot?.traits?.[0] ?? null, snapshot?.traits?.[1] ?? null, snapshot?.traits?.[2] ?? null],
    motto: snapshot?.motto ?? null,
  };
  return result;
  } catch {
    console.warn("[Team] SECRETARY_PROMPT_UNAVAILABLE; no substitute prompt used");
    return result;
  }
}
