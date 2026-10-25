import { and, desc, eq } from "drizzle-orm";
import { phoneNumbers, pendingCalls } from "@shared/schema";
import { db } from "../db";
import { storage } from "../storage";
import { getClone, getCartesiaClone } from "../voiceLab/store";
import { requireReadyTranslatorClone } from "../translation/cloneSpeech";
import { requireSecretaryAudioModel,selectedSecretaryVoiceProvider } from "../secretary/voice";
import {
  createLiveSecretaryTask, getLiveSecretaryTaskByClientRequest,
  getSecretaryTaskById, listSecretaryTasks, attachSecretaryCall,
  markSecretaryPreDialFailed, toSecretaryTaskReport,
  type SecretaryWorkerDependencies,
} from "../secretary/tasks";
import { SecretaryPreDialError } from "../secretary/dialErrors";
import { publishSecretaryFeedEvent } from "../secretary/feed";
import { fail, type Claims } from "./security";
import { savedTaskEvents } from "./savedEvents";
import { prepareDefaultCall, confirmedOutgoingContext, contextHash } from "../secretary/personalities/defaults";
import { assertOutgoingRetryLine } from "../secretary/personalities/outgoing";

/** Reuses the same durable lease/dialer/streams/reporting as native Secretary. */
export function secretaryBackend(dial: SecretaryWorkerDependencies["dial"]) {
  const started = (task: Parameters<typeof toSecretaryTaskReport>[0], reused: boolean) => ({
    // Starting/recovering must not bypass the separate transcript permission.
    task: { id: task.id, status: task.status, clientRequestId: task.clientRequestId,
      phoneNumber: task.phoneNumber, createdAt: task.createdAt, updatedAt: task.updatedAt },
    reused,
  });
  return {
    async prepare(userId: string, input: NonNullable<Claims["call"]>) {
      return prepareDefaultCall(userId, input);
    },
    async history(userId: string) {
      const rows = await storage.getUserCalls(userId);
      const reports = (await listSecretaryTasks(userId)).filter(task => task.userId === userId && task.callId);
      const byCall = new Map(reports.map(task => [task.callId, task]));
      return rows.slice(0, 50).map(({ id, direction, fromNumber, toNumber, status, startedAt, endedAt }) => ({
        id, direction, fromNumber, toNumber, status, startedAt, endedAt,
        summary: byCall.get(id)?.summary ?? null, secretaryTaskId: byCall.get(id)?.id ?? null,
      }));
    },
    async call(userId: string, id: string, transcript: boolean) {
      const call = await storage.getCall(id);
      if (!call || call.userId !== userId) return fail(404, "Call not found");
      const taskId = (call.metadata as { secretaryTaskId?: unknown } | null)?.secretaryTaskId;
      const task = typeof taskId === "string" ? await getSecretaryTaskById(taskId) : undefined;
      const report = task?.userId === userId && task.callId === call.id ? task : undefined;
      return { id: call.id, direction: call.direction, fromNumber: call.fromNumber, toNumber: call.toNumber,
        status: call.status, startedAt: call.startedAt, endedAt: call.endedAt,
        summary: report?.summary ?? null, secretaryTaskId: report?.id ?? null,
        ...(transcript ? { transcript: call.transcript } : {}) };
    },
    async tasks(userId: string) {
      return (await listSecretaryTasks(userId)).slice(0, 50).map(task => {
        const { id, clientRequestId, status, outcome, summary, phoneNumber, createdAt, updatedAt } = toSecretaryTaskReport(task);
        return { id, clientRequestId, status, outcome, summary, phoneNumber, createdAt, updatedAt };
      });
    },
    async task(userId: string, id: string, transcript: boolean) {
      const task = await getSecretaryTaskById(id);
      if (!task || task.userId !== userId) return fail(404, "Task not found");
      const report = toSecretaryTaskReport(task);
      const { transcript: text, transcriptTurns, ...rest } = report;
      return { ...rest, events: savedTaskEvents(task), eventCoverage: "saved_checkpoints",
        ...(transcript ? { transcript: text, transcriptTurns } : {}) };
    },
    async incoming(userId: string) {
      const rows = await db.select().from(pendingCalls).where(and(eq(pendingCalls.userId, userId),
        eq(pendingCalls.status, "ringing"))).orderBy(desc(pendingCalls.createdAt)).limit(10);
      return { calls: rows.map(({ id, callSid, fromNumber, createdAt }) => ({ id, callSid, fromNumber, createdAt })),
        handling: "native_talkhint", aiAnswerEnabled: false };
    },
    async start(userId: string, input: NonNullable<Claims["call"]>) {
      const old = await getLiveSecretaryTaskByClientRequest(userId, input.clientRequestId, input.phoneNumber, input.instruction);
      if (old) {
        assertOutgoingRetryLine(old.outgoingContext, input.secretaryNumberId);
        if (input.outgoingContextHash && contextHash(old.outgoingContext) !== input.outgoingContextHash)
          return fail(409, "This request ID belongs to a different outgoing setup");
        return started(old, true);
      }
      const [number] = await db.select({ id: phoneNumbers.id }).from(phoneNumbers).where(eq(phoneNumbers.userId, userId)).limit(1);
      if (!number) return fail(409, "Assign a TalkHint number first");
      selectedSecretaryVoiceProvider(input.voiceProvider);
      const outgoingContext = await confirmedOutgoingContext(userId, input);
      if (input.voiceProvider === "openai") await requireSecretaryAudioModel();
      else if (input.voiceProvider === "retell") {
        const { requireRetellPhone } = await import("../secretary/retellPhone");
        const { secretaryCallbackOrigin } = await import("../secretary/dialer");
        await requireRetellPhone(secretaryCallbackOrigin());
      }
      else {
        const clone = await (input.voiceProvider === "cartesia" ? getCartesiaClone(userId) : getClone(userId));
        requireReadyTranslatorClone(input.voiceProvider, clone,
          input.voiceProvider === "cartesia" ? process.env.CARTESIA_API_KEY : process.env.ELEVENLABS_API_KEY);
      }
      if (!process.env.OPENAI_API_KEY) return fail(503, "Secretary is not configured");
      const result = await createLiveSecretaryTask(userId, { ...input, outgoingContext });
      if (result.created) {
        // Return the durable task immediately. Exactly one winning lease may
        // dial. A restart/ambiguous provider response never schedules a retry.
        void (async () => {
          try {
            const call = await dial(result.task);
            if (!/^CA[a-fA-F0-9]{32}$/.test(call?.sid ?? "")) throw new Error("Invalid CallSid");
            const task = await attachSecretaryCall(result.task.id, call.sid, call.callId);
            if (!task) throw new Error("Call could not be attached");
            publishSecretaryFeedEvent(task.id, { type: "status", status: task.status });
          } catch (error) {
            if (error instanceof SecretaryPreDialError) await markSecretaryPreDialFailed(result.task.id);
            // Otherwise leave the durable starting lease for reconciliation.
            // No exception details, numbers or credentials in logs/tool output.
          }
        })().catch(() => { /* Durable task remains recoverable by its ID. */ });
      }
      return started(result.task, !result.created);
    },
  };
}
export type SecretaryBackend = ReturnType<typeof secretaryBackend>;
