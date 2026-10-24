import type WebSocket from "ws";
import { verifySecretaryStream } from "./streamAuth";
import { getSecretaryTaskForCall } from "./tasks";
import { publishSecretaryFeedEvent } from "./feed";

type MonitorSource = { guestReceived: boolean; secretaryReceived: boolean };
const sources = new Map<string, MonitorSource>();
export function retellPhoneMonitoring(taskId: string) {
  const source = sources.get(taskId);
  return { transport: "twilio-both-tracks", sourceConnected: !!source,
    sourceReconnectSupported: false, guestReceived: source?.guestReceived ?? false,
    secretaryReceived: source?.secretaryReceived ?? false };
}

/** Read-only Twilio <Start><Stream both_tracks>. Not a second microphone leg,
 * not the Retell transcript-only monitor, and never an AI audio device. */
export function handleRetellPhoneMonitor(ws: WebSocket, deps = {
  verify: verifySecretaryStream,
  lookup: getSecretaryTaskForCall,
  publish: publishSecretaryFeedEvent,
}) {
  let identity: { taskId: string; streamSid: string } | undefined;
  let source: MonitorSource | undefined;
  let starting = false, stopped = false;
  const timer = setTimeout(() => ws.close(1008, "Start required"), 8000);
  timer.unref();
  const cleanup = () => {
    stopped = true; clearTimeout(timer);
    if (identity && sources.get(identity.taskId) === source) {
      sources.delete(identity.taskId);
      deps.publish(identity.taskId, { type: "monitor_state", ...retellPhoneMonitoring(identity.taskId) });
    }
    identity = undefined;
  };
  ws.on("close", cleanup); ws.on("error", cleanup);
  ws.on("message", async (raw, binary) => {
    if (stopped) return;
    let f: any;
    try { if (binary || raw.toString().length > 64 * 1024) throw Error(); f = JSON.parse(raw.toString()); }
    catch { ws.close(1008, "Invalid frame"); return; }
    if (f.event === "connected") return;
    if (f.event === "start") {
      if (identity || starting) { ws.close(1008, "Duplicate start"); return; }
      starting = true;
      const { callSid, streamSid, customParameters: p, mediaFormat: format } = f.start ?? {};
      if (!/^CA[a-fA-F0-9]{32}$/.test(callSid ?? "") ||
        !/^MZ[a-fA-F0-9]{32}$/.test(streamSid ?? "") ||
        !deps.verify(p?.taskId, callSid, p?.streamAuth ?? "") ||
        format?.encoding !== "audio/x-mulaw" || format?.sampleRate !== 8000 || format?.channels !== 1) {
        ws.close(1008, "Monitor identity denied"); return;
      }
      try {
        const task = await deps.lookup(p.taskId, callSid);
        if (!task || task.voiceProvider !== "retell") throw Error();
        if (stopped) return;
        identity = { taskId: task.id, streamSid }; clearTimeout(timer);
        source = { guestReceived: false, secretaryReceived: false };
        sources.set(task.id, source);
        deps.publish(task.id, { type: "monitor_state", ...retellPhoneMonitoring(task.id) });
      } catch { ws.close(1008, "Monitor task denied"); }
      return;
    }
    if (f.event === "stop") { cleanup(); ws.close(1000); return; }
    if (f.event !== "media" || !identity || f.streamSid !== identity.streamSid) return;
    if (sources.get(identity.taskId) !== source) return; // Superseded source cannot duplicate/mix playback.
    const { track, payload } = f.media ?? {};
    if (!["inbound", "outbound"].includes(track) || typeof payload !== "string" ||
      !payload.length || payload.length > 16 * 1024 || payload.length % 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) { ws.close(1008, "Invalid media"); return; }
    // This stream rides the outbound guest PSTN leg: incoming guest / outgoing AI.
    if (source) {
      const key = track === "inbound" ? "guestReceived" : "secretaryReceived";
      if (!source[key]) {
        source[key] = true;
        deps.publish(identity.taskId, { type: "monitor_state", ...retellPhoneMonitoring(identity.taskId) });
      }
    }
    deps.publish(identity.taskId, { type: "audio", role: track === "inbound" ? "guest" : "secretary", payload });
  });
}
