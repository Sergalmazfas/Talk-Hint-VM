import { log } from "./index";

export interface CallContext {
  callKey: string;
  ownerUserId: string | null;
  youStreamSid: string | null;
  guestStreamSid: string | null;
  callSid: string | null;
  status: "initiated" | "connected" | "ended";
  createdAt: Date;
  updatedAt: Date;
}

const callContextStore = new Map<string, CallContext>();

export function createCallContext(callKey: string): CallContext {
  const ctx: CallContext = {
    callKey,
    ownerUserId: null,
    youStreamSid: null,
    guestStreamSid: null,
    callSid: null,
    status: "initiated",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  callContextStore.set(callKey, ctx);
  log(`[CallContext] Created: callKey=${callKey}`, "callcontext");
  return ctx;
}

export function getCallContext(callKey: string): CallContext | undefined {
  return callContextStore.get(callKey);
}

export function getCallContextByCallSid(callSid: string): CallContext | undefined {
  const entries = Array.from(callContextStore.values());
  for (const ctx of entries) {
    if (ctx.callSid === callSid) {
      return ctx;
    }
  }
  return undefined;
}

export function setCallContextOwner(callKey: string, ownerUserId: string): void {
  const ctx = callContextStore.get(callKey);
  if (ctx) {
    ctx.ownerUserId = ownerUserId;
    ctx.updatedAt = new Date();
    log(`[CallContext] Owner set: callKey=${callKey} owner=${ownerUserId}`, "callcontext");
  } else {
    log(`[CallContext] WARN: setOwner failed - no context for callKey=${callKey}`, "callcontext");
  }
}

export function setCallContextStreams(
  callKey: string,
  youStreamSid: string,
  guestStreamSid: string
): void {
  const ctx = callContextStore.get(callKey);
  if (ctx) {
    ctx.youStreamSid = youStreamSid;
    ctx.guestStreamSid = guestStreamSid;
    ctx.updatedAt = new Date();
    log(`[CallContext] Streams set: callKey=${callKey} youStream=${youStreamSid} guestStream=${guestStreamSid}`, "callcontext");
  }
}

export function setCallContextCallSid(callKey: string, callSid: string): void {
  const ctx = callContextStore.get(callKey);
  if (ctx) {
    ctx.callSid = callSid;
    ctx.updatedAt = new Date();
    log(`[CallContext] CallSid set: callKey=${callKey} callSid=${callSid}`, "callcontext");
  }
}

export function setCallContextStatus(callKey: string, status: CallContext["status"]): void {
  const ctx = callContextStore.get(callKey);
  if (ctx) {
    ctx.status = status;
    ctx.updatedAt = new Date();
    log(`[CallContext] Status: callKey=${callKey} status=${status}`, "callcontext");
  }
}

export function pinYouByTrack(callKey: string, track: "inbound" | "outbound"): void {
  const ctx = callContextStore.get(callKey);
  if (ctx) {
    ctx.youStreamSid = track;
    ctx.guestStreamSid = track === "inbound" ? "outbound" : "inbound";
    ctx.updatedAt = new Date();
    log(`[CallContext] YOU pinned to track=${track} for callKey=${callKey}`, "callcontext");
  }
}

export function getSpeakerFromContext(
  callKey: string,
  track: "inbound" | "outbound"
): "HON" | "GST" | null {
  const ctx = callContextStore.get(callKey);
  if (!ctx) {
    log(`[RoleMap] WARN: No CallContext for callKey=${callKey}`, "callcontext");
    return null;
  }
  
  if (!ctx.youStreamSid) {
    log(`[RoleMap] WARN: youStreamSid not set for callKey=${callKey}`, "callcontext");
    return null;
  }
  
  const speaker = track === ctx.youStreamSid ? "HON" : "GST";
  log(`[RoleMap] callKey=${callKey} track=${track} => speaker=${speaker}`, "callcontext");
  return speaker;
}

export function removeCallContext(callKey: string): void {
  const deleted = callContextStore.delete(callKey);
  if (deleted) {
    log(`[CallContext] Removed: callKey=${callKey}`, "callcontext");
  }
}

export function listActiveCallContexts(): CallContext[] {
  return Array.from(callContextStore.values()).filter(c => c.status !== "ended");
}
