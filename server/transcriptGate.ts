import { log } from "./index";
import { getCallContext } from "./callContext";

export interface TranscriptEntry {
  callKey: string;
  callSid: string;
  callType: "inbound" | "outbound";
  role: "HON" | "GST";
  source: "owner_mic" | "twilio_stream";
  utteranceId: number;
  text: string;
  timestamp: number;
}

export interface TranscriptResult {
  accepted: boolean;
  reason?: string;
  entry?: TranscriptEntry;
}

const processedUtterances = new Map<string, Set<string>>();
const MAX_UTTERANCE_CACHE = 1000;

function getUtteranceKey(entry: TranscriptEntry): string {
  return `${entry.callSid}|${entry.role}|${entry.source}|${entry.utteranceId}`;
}

function cleanupOldEntries(callSid: string): void {
  const cache = processedUtterances.get(callSid);
  if (cache && cache.size > MAX_UTTERANCE_CACHE) {
    const entries = Array.from(cache);
    entries.slice(0, entries.length - MAX_UTTERANCE_CACHE / 2).forEach(e => cache.delete(e));
  }
}

export function appendTranscript(entry: TranscriptEntry): TranscriptResult {
  const { callKey, callSid, callType, role, source, utteranceId, text, timestamp } = entry;
  
  const logPrefix = `[TRANSCRIPT_GATE] callKey=${callKey} callSid=${callSid} callType=${callType} role=${role} source=${source} utteranceId=${utteranceId}`;
  
  if (!callKey || !callSid) {
    log(`${logPrefix} action=dropped dropReason="missing_call_identifiers"`, "twilio");
    return { accepted: false, reason: "missing_call_identifiers" };
  }
  
  const ctx = getCallContext(callKey);
  if (!ctx) {
    log(`${logPrefix} action=dropped dropReason="no_call_context"`, "twilio");
    return { accepted: false, reason: "no_call_context" };
  }
  
  if (role === "HON" && source !== "owner_mic") {
    log(`${logPrefix} action=dropped dropReason="hon_invalid_source"`, "twilio");
    return { accepted: false, reason: "hon_invalid_source" };
  }
  
  if (role === "GST" && source !== "twilio_stream") {
    log(`${logPrefix} action=dropped dropReason="gst_invalid_source"`, "twilio");
    return { accepted: false, reason: "gst_invalid_source" };
  }
  
  const expectedYouTrack = callType === "outbound" ? "outbound" : "inbound";
  if (ctx.youStreamSid && ctx.youStreamSid !== expectedYouTrack) {
    log(`${logPrefix} action=dropped dropReason="calltype_track_mismatch" expected=${expectedYouTrack} actual=${ctx.youStreamSid}`, "twilio");
    return { accepted: false, reason: "calltype_track_mismatch" };
  }
  
  const utteranceKey = getUtteranceKey(entry);
  
  if (!processedUtterances.has(callSid)) {
    processedUtterances.set(callSid, new Set());
  }
  
  const cache = processedUtterances.get(callSid)!;
  
  if (cache.has(utteranceKey)) {
    log(`${logPrefix} action=dropped dropReason="duplicate_utterance" key=${utteranceKey}`, "twilio");
    return { accepted: false, reason: "duplicate_utterance" };
  }
  
  cache.add(utteranceKey);
  cleanupOldEntries(callSid);
  
  log(`${logPrefix} action=accepted text_len=${text.length}`, "twilio");
  
  return { accepted: true, entry };
}

export function clearTranscriptCache(callSid: string): void {
  processedUtterances.delete(callSid);
  log(`[TRANSCRIPT_GATE] Cache cleared for callSid=${callSid}`, "twilio");
}

export function getTranscriptStats(): { calls: number; totalUtterances: number } {
  let totalUtterances = 0;
  processedUtterances.forEach(cache => totalUtterances += cache.size);
  return { calls: processedUtterances.size, totalUtterances };
}
