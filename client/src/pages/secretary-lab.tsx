import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  LAB_API, LabReport, LabSnapshot, LabTurn, VoiceProvider, UlawFrameQueue,
  base64ToBytes, bytesToBase64, floatToUlaw, formatLabTime, labRequest,
  makeHoldMusic, markPlaybackDecision, playbackWouldExceedLimit, scheduleLabPlayback, labEndReasonLabel,
  selectOutboundFrame, socketUrl, ulawToPcm, ULAW_SILENCE_FRAME,
  MIC_QUEUE_MAX_FRAMES, MULAW_FRAME_BYTES, PLAYBACK_QUEUE_MAX_SECONDS,
} from "@/lib/secretary-lab";
import { createLabRtcController, LabRtcController, OPENAI_LAB_MODEL, OPENAI_LAB_VOICE } from "@/lib/secretary-lab-rtc";
import { AlertCircle, ArrowDownToLine, AudioLines, Check, CircleStop, Headphones, LoaderCircle, Mic, MicOff, Radio, RefreshCw, ShieldAlert, Volume2, Wifi } from "lucide-react";
import "@/lib/secretary-lab.css";
import RetellBench from "@/components/secretary-lab/RetellBench";

type LiveState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "ended";
type WireMessage = Record<string, any>;

const SUGGESTIONS = [
  "Please hold while I try to connect you",
  "Could you connect me to a new operator?",
  "I’m not comfortable sharing my payment details",
  "Wait — I need to interrupt you",
];

function ErrorPage({ title, detail, onHome }: { title: string; detail: string; onHome: () => void }) {
  return <main className="lab-denied">
    <div className="denied-mark"><ShieldAlert size={26} /></div>
    <p className="eyebrow">TALKHINT / SECRETARY LAB</p>
    <h1>{title}</h1><p>{detail}</p>
    <div className="denied-links">
      <Link href="/diagnostics">Диагностика</Link>
      <Link href="/voice-lab">Voice Lab</Link>
      <Button variant="outline" onClick={onHome}>На главную</Button>
    </div>
  </main>;
}

function downloadReport(report: LabReport) {
  const file = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `secretary-lab-${report.id}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatMs(value?: number) {
  return value === undefined ? "—" : `${Math.round(value)} мс`;
}

export default function SecretaryLab() {
  const [, setLocation] = useLocation();
  const { user, token, isLoading } = useAuth();
  const [snapshot, setSnapshot] = useState<LabSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [denied, setDenied] = useState(false);
  const [instruction, setInstruction] = useState("Поговори с собеседником на английском как дружелюбный и собранный секретарь. Помогай уточнять цель звонка и спокойно реагируй на возражения.");
  const [stand, setStand] = useState<"gpt" | "retell">(() => new URLSearchParams(window.location.search).get("stand") === "retell" ? "retell" : "gpt");
  const [retellBusy, setRetellBusy] = useState(false);
  const [provider, setProvider] = useState<VoiceProvider>("openai");
  const [paidConsent, setPaidConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [active, setActive] = useState<LabReport | null>(null);
  const [report, setReport] = useState<LabReport | null>(null);
  const [liveState, setLiveState] = useState<LiveState>("idle");
  const [micPaused, setMicPaused] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [holdDuration, setHoldDuration] = useState(15);
  const [playingHold, setPlayingHold] = useState(false);
  const [rating, setRating] = useState("");
  const [socketConnected, setSocketConnected] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const rtcRef = useRef<LabRtcController | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micQueueRef = useRef(new UlawFrameQueue(MIC_QUEUE_MAX_FRAMES));
  const micCarryRef = useRef<Uint8Array>(new Uint8Array(0));
  const micSendTimerRef = useRef<number | null>(null);
  const musicRef = useRef<Uint8Array | null>(null);
  const musicOffsetRef = useRef(0);
  const micPausedBeforeMusicRef = useRef(false);
  const playbackCursorRef = useRef(0);
  const playbackNodesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const micPausedRef = useRef(false);
  const startLockRef = useRef(false);
  const attemptIdRef = useRef(0);
  const mountedRef = useRef(false);
  const startedAtRef = useRef(0);
  const audioClockStartRef = useRef(0);
  const firstAudioScheduledRef = useRef(false);
  const lastGuestTurnContextTimeRef = useRef<number | null>(null);
  const markTimersRef = useRef<Map<string, number>>(new Map());
  const holdUiTimerRef = useRef<number | null>(null);
  const closingRef = useRef(false);
  const currentReportRef = useRef<LabReport | null>(null);
  const standBusy = pending || !!active || retellBusy;

  useEffect(() => {
    const syncStand = () => {
      if (standBusy) {
        setLocation(`/secretary-lab?stand=${stand}`);
        return;
      }
      setStand(new URLSearchParams(window.location.search).get("stand") === "retell" ? "retell" : "gpt");
    };
    window.addEventListener("popstate", syncStand);
    return () => window.removeEventListener("popstate", syncStand);
  }, [setLocation, stand, standBusy]);

  const selectStand = (next: "gpt" | "retell") => {
    if (standBusy || next === stand) return;
    setStand(next);
    setLocation(`/secretary-lab?stand=${next}`);
  };

  const reload = useCallback(async () => {
    if (!token) return;
    setLoading(true); setLoadError(""); setDenied(false);
    try {
      const result = await labRequest<LabSnapshot>(LAB_API, token);
      setSnapshot(result);
       setProvider("openai");
    } catch (cause) {
      const e = cause as Error & { status?: number };
      if (e.status === 403) setDenied(true);
      else setLoadError(e.message || "Не удалось загрузить Secretary Lab.");
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => {
    if (!isLoading && !token) setDenied(true);
  }, [isLoading, token]);

  useEffect(() => {
    if (!isLoading && user?.isAdmin && token) void reload();
  }, [isLoading, user?.isAdmin, token, reload]);

  useEffect(() => { micPausedRef.current = micPaused; }, [micPaused]);
  useEffect(() => { currentReportRef.current = active; }, [active]);
  useEffect(() => {
    if (!active || active.status !== "running") return;
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, [active?.id, active?.status]);

  const cleanupMedia = useCallback(() => {
    rtcRef.current?.close(); rtcRef.current = null;
    processorRef.current?.disconnect(); processorRef.current = null;
    sourceRef.current?.disconnect(); sourceRef.current = null;
    if (micSendTimerRef.current !== null) window.clearInterval(micSendTimerRef.current);
    micSendTimerRef.current = null;
    micQueueRef.current.clear();
    micCarryRef.current = new Uint8Array(0);
    musicRef.current = null;
    musicOffsetRef.current = 0;
    streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null;
    playbackNodesRef.current.forEach((node) => { try { node.stop(); } catch {} });
    playbackNodesRef.current.clear();
    markTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    markTimersRef.current.clear();
    if (holdUiTimerRef.current !== null) window.clearTimeout(holdUiTimerRef.current);
    holdUiTimerRef.current = null;
    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== "closed") void context.close().catch(() => undefined);
  }, []);

  const stopServer = useCallback(async (userInitiated = true, clientReason = "browser_disconnected") => {
    const session = currentReportRef.current;
    closingRef.current = true;
    if (userInitiated && socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "user_stop" }));
      socketRef.current.close(1000, "user_stop");
    } else if (socketRef.current && socketRef.current.readyState < WebSocket.CLOSING) {
      if (socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: "client_error", reason: clientReason }));
      }
      socketRef.current.close();
    }
    socketRef.current = null;
    cleanupMedia();
    setSocketConnected(false); setPlayingHold(false); micPausedRef.current = false; setMicPaused(false); setLiveState("ended");
    if (session && token) {
      try {
        const result = await labRequest<{ report: LabReport }>(`${LAB_API}/sessions/${encodeURIComponent(session.id)}`, token, {
          method: "DELETE", body: JSON.stringify({ reason: userInitiated ? "user_stop" : clientReason }),
        });
        setReport(result.report); setActive(null); setRating("");
        currentReportRef.current = result.report;
        setSnapshot((old) => old ? { ...old, sessions: [result.report, ...old.sessions.filter((item) => item.id !== result.report.id)] } : old);
      } catch (cause) {
        const e = cause as Error;
        setError(`Не удалось подтвердить остановку на сервере: ${e.message}`);
      }
    }
    closingRef.current = false;
  }, [cleanupMedia, token]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      attemptIdRef.current++;
      closingRef.current = true;
      const sessionId = currentReportRef.current?.id;
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        try { socketRef.current.send(JSON.stringify({ type: "user_stop" })); } catch {}
      }
      socketRef.current?.close();
      if (sessionId && token) {
        void labRequest(`${LAB_API}/sessions/${encodeURIComponent(sessionId)}`, token, { method: "DELETE" }).catch(() => undefined);
      }
      cleanupMedia();
    };
  }, [cleanupMedia, token]);

  const updateReport = useCallback((fn: (previous: LabReport) => LabReport) => {
    setActive((previous) => {
      if (!previous) return previous;
      const next = fn(previous);
      currentReportRef.current = next;
      return next;
    });
  }, []);

  const setupMicrophone = useCallback(async (context: AudioContext, stream: MediaStream) => {
    streamRef.current = stream;
    const source = context.createMediaStreamSource(stream);
    sourceRef.current = source;
    const processor = context.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;
    processor.onaudioprocess = (event) => {
      const output = event.outputBuffer.getChannelData(0);
      output.fill(0);
      if (!micPausedRef.current && socketRef.current?.readyState === WebSocket.OPEN) {
        const converted = floatToUlaw(event.inputBuffer.getChannelData(0), event.inputBuffer.sampleRate);
        const combined = new Uint8Array(micCarryRef.current.length + converted.length);
        combined.set(micCarryRef.current);
        combined.set(converted, micCarryRef.current.length);
        const completeLength = combined.length - (combined.length % MULAW_FRAME_BYTES);
        if (completeLength) micQueueRef.current.pushBytes(combined.subarray(0, completeLength));
        micCarryRef.current = combined.slice(completeLength);
      }
    };
    const silentSink = context.createGain();
    silentSink.gain.value = 0;
    source.connect(processor);
    processor.connect(silentSink);
    silentSink.connect(context.destination);
  }, []);

  const scheduleMarkAck = useCallback((socket: WebSocket, name: string) => {
    if (!name || socket.readyState !== WebSocket.OPEN) return;
    const previousTimer = markTimersRef.current.get(name);
    if (previousTimer !== undefined) window.clearTimeout(previousTimer);
    const targetTime = playbackCursorRef.current;
    const checkPlayback = () => {
      if (socket.readyState !== WebSocket.OPEN) {
        markTimersRef.current.delete(name);
        return;
      }
      const context = contextRef.current;
      const decision = markPlaybackDecision(context?.state ?? "missing", context?.currentTime ?? 0, targetTime);
      if (decision === "stop") {
        markTimersRef.current.delete(name);
        setError("Аудиоконтекст приостановлен до завершения воспроизведения. Сессия остановлена без подтверждения маркера.");
        void stopServer(false, "audio_suspended");
        return;
      }
      if (decision === "ack") {
        markTimersRef.current.delete(name);
        socket.send(JSON.stringify({ type: "mark", name }));
        return;
      }
      const remainingMs = Math.max(1, (targetTime - context!.currentTime) * 1000);
      markTimersRef.current.set(name, window.setTimeout(checkPlayback, Math.min(100, remainingMs)));
    };
    checkPlayback();
  }, [stopServer]);

  const beginSession = async () => {
    const selectedProviderReady = !!snapshot?.providers[provider]?.ready;
    if (startLockRef.current || !token || !snapshot || !instruction.trim() || !paidConsent || !selectedProviderReady) return;
    startLockRef.current = true;
    const attemptId = ++attemptIdRef.current;
    const attemptIsCurrent = () => mountedRef.current && attemptIdRef.current === attemptId;
    setError(""); setNotice(""); setPending(true);
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let createdId: string | null = null;
    let ws: WebSocket | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) throw new Error("Этот браузер не поддерживает доступ к микрофону или AudioContext.");
      // Both permission prompt and context resume happen directly from the Start gesture, before session creation.
      context = new AudioContext();
      contextRef.current = context;
      await context.resume();
      if (!attemptIsCurrent()) {
        if ((context.state as AudioContextState) !== "closed") await context.close();
        return;
      }
      if (context.state !== "running") throw new Error("Браузер не разрешил запустить аудиоконтекст. Нажмите Start ещё раз.");
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!attemptIsCurrent()) {
        stream.getTracks().forEach((track) => track.stop());
        if ((context.state as AudioContextState) !== "closed") await context.close();
        return;
      }
      streamRef.current = stream;
      audioClockStartRef.current = context.currentTime;
      const created = await labRequest<{ id: string; ticket: string; socketPath: string; report: LabReport }>(`${LAB_API}/sessions`, token, {
        method: "POST",
        body: JSON.stringify({ instruction: instruction.trim(), voiceProvider: provider, consent: true }),
      });
      createdId = created.id;
      if (!attemptIsCurrent()) {
        stream.getTracks().forEach((track) => track.stop());
        if ((context.state as AudioContextState) !== "closed") await context.close();
        try { await labRequest(`${LAB_API}/sessions/${encodeURIComponent(created.id)}`, token, { method: "DELETE" }); } catch {}
        return;
      }
      currentReportRef.current = created.report;
      firstAudioScheduledRef.current = false;
      lastGuestTurnContextTimeRef.current = null;
      playbackCursorRef.current = 0;
      micQueueRef.current.clear();
      micCarryRef.current = new Uint8Array(0);
      musicRef.current = null;
      musicOffsetRef.current = 0;
      micPausedRef.current = false;
      setMicPaused(false);
      const socket = new WebSocket(socketUrl(created.socketPath));
      ws = socket;
      socketRef.current = socket;
      closingRef.current = false;
      setActive(created.report); currentReportRef.current = created.report; setReport(null); setElapsed(0);
      startedAtRef.current = Date.now();
      setLiveState("connecting"); setSocketConnected(false);
      socket.onopen = () => {
        if (!attemptIsCurrent() || socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({ type: "auth", ticket: created.ticket }));
      };
      socket.onmessage = async (event) => {
        if (!attemptIsCurrent() || closingRef.current) return;
        let message: WireMessage;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === "rtc_offer_required" && provider === "openai") {
          if (rtcRef.current) return;
          try {
            const rtc = createLabRtcController({
              stream: stream!,
              sendSocket: (payload) => {
                if (socket.readyState === WebSocket.OPEN && !closingRef.current) socket.send(JSON.stringify(payload));
              },
              onReady: () => {
                if (!attemptIsCurrent()) return;
                setSocketConnected(true);
                setLiveState("listening");
                updateReport((old) => ({ ...old, status: "running" }));
              },
              onConnectionState: (connected, modelReady) => {
                if (!attemptIsCurrent()) return;
                setSocketConnected(connected && modelReady);
                setLiveState(connected && modelReady ? "listening" : "connecting");
              },
              onError: (reason, detail) => {
                if (!attemptIsCurrent()) return;
                setError(`${detail} Сессия остановлена; автоматического переподключения нет.`);
                void stopServer(false, reason);
              },
            });
            rtcRef.current = rtc;
            await rtc.negotiate((sdp) => labRequest<{ sdp: string; model: string; voice: string }>(
              `${LAB_API}/sessions/${encodeURIComponent(created.id)}/webrtc`,
              token,
              { method: "POST", body: JSON.stringify({ sdp }) },
            ));
            if (!attemptIsCurrent() || closingRef.current || rtcRef.current !== rtc) return;
          } catch (cause) {
            if (!attemptIsCurrent() || closingRef.current || !rtcRef.current) return;
            setError(cause instanceof Error ? cause.message : "Не удалось согласовать WebRTC.");
            void stopServer(false, "webrtc_error");
          }
        } else if (message.type === "metrics" && provider === "openai") {
          updateReport(old => ({ ...old, metrics: { ...message.metrics } }));
        } else if (message.type === "ready") {
          if (!context || context.state !== "running") {
            setError("Аудиоконтекст не работает. Сессия остановлена, чтобы не терять звук.");
            void stopServer(false, "audio_suspended");
            return;
          }
          if (created.report.transport === "webrtc") {
            if (message.modelVerified === false ||
              (message.model !== undefined && message.model !== OPENAI_LAB_MODEL) ||
              (message.voice !== undefined && message.voice !== OPENAI_LAB_VOICE)) {
              setError("Сервер не подтвердил ожидаемую модель OpenAI. Сессия остановлена.");
              void stopServer(false, "webrtc_error");
              return;
            }
            rtcRef.current?.markModelReady();
            return;
          }
          setSocketConnected(true);
          setLiveState("listening");
          if(provider==="openai"&&(message.model!=="gpt-live-1"||message.voice!=="marin"||message.modelVerified!==true)){
            setError("GPT-Live 1 и Marin не подтверждены сервером. Автоматической подмены нет.");
            void stopServer(false,"client_error");return;
          }
          updateReport((old) => ({ ...old, status: "running",model:message.model??old.model,
            voice:message.voice??old.voice,modelVerified:message.modelVerified===true }));
          if (micSendTimerRef.current !== null) window.clearInterval(micSendTimerRef.current);
          micSendTimerRef.current = window.setInterval(() => {
            const activeSocket = socketRef.current;
            if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN || closingRef.current) return;
            if (context!.state !== "running") {
              setError("Аудиоконтекст приостановлен. Сессия остановлена без имитации услышанного звука.");
              void stopServer(false, "audio_suspended");
              return;
            }
            if (activeSocket.bufferedAmount > 24_000) {
              setError("Очередь аудио превысила безопасный предел. Сессия остановлена.");
              void stopServer(false, "audio_input_backpressure");
              return;
            }
            if (musicRef.current && musicOffsetRef.current >= musicRef.current.length) {
              musicRef.current = null;
              musicOffsetRef.current = 0;
              micPausedRef.current = micPausedBeforeMusicRef.current;
              setMicPaused(micPausedBeforeMusicRef.current);
              setPlayingHold(false);
            }
            const outbound = selectOutboundFrame({
              music: musicRef.current,
              musicOffset: musicOffsetRef.current,
              microphone: micQueueRef.current,
              microphonePaused: micPausedRef.current,
              silenceFrame: ULAW_SILENCE_FRAME,
            });
            if (outbound.source === "music") musicOffsetRef.current = outbound.nextMusicOffset;
            activeSocket.send(JSON.stringify({ type: "media", payload: bytesToBase64(outbound.frame) }));
          }, 20);
          void setupMicrophone(context!, stream!);
        } else if (message.type === "state") {
          const state = message.state as LiveState;
          if (["connecting", "listening", "thinking", "speaking"].includes(state)) setLiveState(state);
        } else if (message.type === "audio" && created.report.transport !== "webrtc") {
          void playAudio(message.payload, Number(message.atMs) || 0);
        } else if (message.type === "mark") {
          scheduleMarkAck(socket, String(message.name || ""));
        } else if (message.type === "clear") {
          if (created.report.transport === "webrtc") rtcRef.current?.clearInterruptedOutput(String(message.responseId || message.response_id || ""));
          playbackNodesRef.current.forEach((node) => { try { node.stop(); } catch {} });
          playbackNodesRef.current.clear();
          playbackCursorRef.current = contextRef.current?.currentTime ?? 0;
          markTimersRef.current.forEach((timer) => window.clearTimeout(timer));
          markTimersRef.current.clear();
        } else if (message.type === "turn" && message.turn) {
          const turn = message.turn as LabTurn;
          if (turn.role === "guest" && contextRef.current?.state === "running") lastGuestTurnContextTimeRef.current = contextRef.current.currentTime;
          updateReport((old) => ({ ...old, turns: [...old.turns, turn], metrics: {
            ...old.metrics,
            guestTurns: old.metrics.guestTurns + (turn.role === "guest" ? 1 : 0),
            secretaryTurns: old.metrics.secretaryTurns + (turn.role === "secretary" ? 1 : 0),
          } }));
        } else if (message.type === "subtitle") {
          updateReport((old) => ({ ...old, turns: old.turns.map((turn) => turn.id === message.turnId ? { ...turn, translation: message.translation } : turn) }));
        } else if (message.type === "event" && message.event) {
          updateReport((old) => ({ ...old, events: [...old.events, message.event] }));
        } else if (message.type === "ended" && message.report) {
          closingRef.current = true;
          setReport(message.report); setActive(null); setLiveState("ended"); setSocketConnected(false);
          setPlayingHold(false); micPausedRef.current = false; setMicPaused(false);
          currentReportRef.current = message.report;
          setSnapshot((old) => old ? { ...old, sessions: [message.report, ...old.sessions.filter((item) => item.id !== message.report.id)] } : old);
          if (socket.readyState < WebSocket.CLOSING) socket.close(1000, "ended");
          socketRef.current = null; cleanupMedia();
        } else if (message.type === "error") {
          setError(typeof message.error === "string" ? message.error : "Ошибка живой сессии.");
          void stopServer(false, "client_error");
        }
      };
      socket.onerror = () => { if (attemptIsCurrent()) setError("Ошибка соединения с живой сессией."); };
      socket.onclose = () => {
        setSocketConnected(false);
        const status = currentReportRef.current?.status;
        if (attemptIsCurrent() && !closingRef.current && (status === "running" || status === "awaiting_connection")) {
          setError("Соединение закрылось. Живая сессия остановлена; автоматического переподключения нет.");
          void stopServer(false);
        }
      };
    } catch (cause) {
      closingRef.current = true;
      if (socketRef.current === ws) socketRef.current = null;
      if (ws && ws.readyState < WebSocket.CLOSING) ws.close();
      stream?.getTracks().forEach((track) => track.stop());
      contextRef.current = null;
      if (context && context.state !== "closed") void context.close().catch(() => undefined);
      streamRef.current = null;
      if (createdId && token) {
        try {
          await labRequest(`${LAB_API}/sessions/${encodeURIComponent(createdId)}`, token, { method: "DELETE" });
        } catch { /* report the original setup failure; session cleanup is best effort */ }
      }
      if (attemptIsCurrent()) {
        setActive(null); currentReportRef.current = null; setLiveState("idle"); setSocketConnected(false);
        setError(cause instanceof Error ? cause.message : "Не удалось запустить разговор.");
      }
    } finally {
      startLockRef.current = false;
      if (attemptIsCurrent()) setPending(false);
    }
  };

  const playAudio = useCallback(async (payload: string, atMs: number) => {
    void atMs;
    const context = contextRef.current;
    if (!context) { setError("Аудиоконтекст разговора недоступен."); void stopServer(false, "audio_suspended"); return; }
    if (context.state !== "running") {
      setError("Воспроизведение заблокировано или аудиоконтекст приостановлен. Сессия остановлена, чтобы не терять ответы секретаря.");
      void stopServer(false, "audio_suspended");
      return;
    }
    try {
      const bytes = base64ToBytes(payload);
      const duration = bytes.length / 8000;
      if (playbackWouldExceedLimit(context.currentTime, playbackCursorRef.current, duration, PLAYBACK_QUEUE_MAX_SECONDS)) {
        setError(`Очередь воспроизведения превысила ${PLAYBACK_QUEUE_MAX_SECONDS} секунды. Сессия остановлена, звук не будет считаться услышанным.`);
        void stopServer(false, "audio_queue_limit");
        return;
      }
      const buffer = context.createBuffer(1, bytes.length, 8000);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < bytes.length; i++) samples[i] = ulawToPcm(bytes[i]) / 32768;
      const node = context.createBufferSource();
      node.buffer = buffer; node.connect(context.destination);
      const { startAt, endAt } = scheduleLabPlayback(context.currentTime, playbackCursorRef.current, buffer.duration);
      node.start(startAt);
      playbackCursorRef.current = endAt;
      playbackNodesRef.current.add(node);
      node.onended = () => {
        playbackNodesRef.current.delete(node);
      };
      if (!firstAudioScheduledRef.current) {
        firstAudioScheduledRef.current = true;
        updateReport((old) => ({ ...old, metrics: { ...old.metrics, firstAudioMs: Math.max(0, (startAt - audioClockStartRef.current) * 1000) } }));
      }
      if (lastGuestTurnContextTimeRef.current !== null) {
        updateReport((old) => ({ ...old, metrics: { ...old.metrics, lastTurnToAudioMs: Math.max(0, (startAt - lastGuestTurnContextTimeRef.current!) * 1000) } }));
        lastGuestTurnContextTimeRef.current = null;
      }
    } catch {
      setError("Не удалось декодировать аудио. Сессия остановлена.");
      void stopServer(false, "audio_decode_error");
    }
  }, [stopServer, updateReport]);

  const sendHoldMusic = () => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !socketConnected) return;
    const context = contextRef.current;
    if (!context || context.state !== "running") {
      setError("Аудиоконтекст приостановлен: остановите сессию и запустите её снова.");
      void stopServer(false, "audio_suspended"); return;
    }
    micPausedBeforeMusicRef.current = micPausedRef.current;
    micQueueRef.current.clear();
    micCarryRef.current = new Uint8Array(0);
    micPausedRef.current = true;
    setMicPaused(true);
    if (active?.transport === "webrtc") {
      try {
        const rtc = rtcRef.current;
        if (!rtc) throw new Error("Соединение WebRTC недоступно.");
        setPlayingHold(true);
        void rtc.startHold(context, holdDuration).then(() => {
          holdUiTimerRef.current = window.setTimeout(() => {
            const restorePaused = micPausedBeforeMusicRef.current;
            micPausedRef.current = restorePaused;
            setMicPaused(restorePaused);
            setPlayingHold(false);
          }, holdDuration * 1000);
        }).catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : "Не удалось включить тест ожидания.");
          stopHold();
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Не удалось включить тест ожидания.");
        stopHold();
      }
      return;
    }
    musicRef.current = makeHoldMusic(holdDuration);
    musicOffsetRef.current = 0;
    setPlayingHold(true);
  };

  const playFixtureText = (phrase: string) => {
    setNotice(`Текстовая подсказка — произнесите вслух: «${phrase}»`);
  };

  const stopHold = () => {
    if (holdUiTimerRef.current !== null) window.clearTimeout(holdUiTimerRef.current);
    holdUiTimerRef.current = null;
    if (active?.transport === "webrtc") {
      void rtcRef.current?.stopHold().catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Не удалось восстановить микрофон после теста ожидания.");
      });
    }
    musicRef.current = null;
    musicOffsetRef.current = 0;
    micQueueRef.current.clear();
    micCarryRef.current = new Uint8Array(0);
    const restorePaused = micPausedBeforeMusicRef.current;
    micPausedRef.current = restorePaused;
    setMicPaused(restorePaused);
    setPlayingHold(false);
  };

  const history = useMemo(() => snapshot?.sessions ?? [], [snapshot?.sessions]);
  const providerReady = snapshot?.providers[provider]?.ready ?? false;
  const visibleReport = report;
  const elapsedLabel = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  if (isLoading || (loading && !snapshot && !denied && !loadError)) return <div className="lab-shell"><div className="lab-loading"><div className="skeleton-line wide" /><div className="skeleton-line" /><div className="skeleton-card" /><div className="skeleton-card" /></div></div>;
  if (denied || (user && !user.isAdmin)) return <ErrorPage title={!token ? "Войдите в аккаунт" : "403 — только для администраторов"} detail={!token ? "Для доступа к секретарской лаборатории нужна авторизация." : "Эта закрытая лаборатория доступна только администраторам."} onHome={() => setLocation("/")} />;

  return <div className="lab-shell">
    <header className="lab-header">
      <Link href="/diagnostics" className="lab-brand"><span className="brand-glyph"><AudioLines size={18} /></span><span>TALKHINT <b>LAB / 02</b></span></Link>
      <nav className="lab-nav"><Link href="/diagnostics">Диагностика</Link><Link href="/voice-lab">Voice Lab</Link><Link href="/incoming-secretary">Входящий Secretary</Link><span className="admin-chip">ADMIN</span></nav>
    </header>
    <main className="lab-main">
      <section className="lab-intro">
        <div className="intro-copy"><p className="eyebrow">ЗАКРЫТАЯ ДИАГНОСТИКА · БЕЗ ТЕЛЕФОННОГО ВЫЗОВА</p>
          <h1>Secretary<br /><em>Lab</em></h1>
          <p className="intro-dek">Приватный голосовой разговор с тем же секретарём. Проверяйте поведение, не набирая номер.</p>
        </div>
        <div className="intro-stamp"><span>NO PSTN</span><i /><small>PRIVATE<br />SESSION</small></div>
      </section>

      <nav className="lab-stand-nav" aria-label="Выбор голосового стенда">
        <span>ВЫБРАТЬ СТЕНД</span>
        <button type="button" className={stand === "gpt" ? "selected" : ""} aria-pressed={stand === "gpt"} disabled={standBusy} onClick={() => selectStand("gpt")}><AudioLines size={15} /> GPT <small>текущий</small></button>
        <button type="button" className={stand === "retell" ? "selected" : ""} aria-pressed={stand === "retell"} disabled={standBusy} onClick={() => selectStand("retell")}><Radio size={15} /> Retell <small>live web</small></button>
        {standBusy && <small className="stand-lock">Стенд заблокирован во время сессии</small>}
      </nav>

      {loadError && <div className="lab-alert" role="alert"><AlertCircle size={18} /><span>{loadError}</span><Button variant="outline" size="sm" onClick={() => void reload()}><RefreshCw size={14} /> Повторить</Button></div>}
      {error && <div className="lab-alert" role="alert"><AlertCircle size={18} /><span>{error}</span><button onClick={() => setError("")} aria-label="Закрыть">×</button></div>}
      {notice && <div className="lab-notice"><span>{notice}</span><button onClick={() => setNotice("")}>Понятно</button></div>}

      {stand === "retell" ? <RetellBench token={token || ""} instruction={instruction} onInstructionChange={setInstruction} onActiveChange={setRetellBusy} /> :
      <div className="lab-layout">
        <div className="lab-primary">
          <Card className="control-card">
            <CardHeader className="card-heading"><div><p className="eyebrow">01 / РАЗГОВОР</p><CardTitle>Настроить сессию</CardTitle></div><span className={`state-pill ${active ? "is-live" : ""}`}><i />{active ? "СЕССИЯ АКТИВНА" : "ГОТОВ К ЗАПУСКУ"}</span></CardHeader>
            <CardContent className="control-content">
              <label className="field-label" htmlFor="lab-instruction">Инструкция секретарю</label>
              <Textarea id="lab-instruction" value={instruction} onChange={(event) => setInstruction(event.target.value)} disabled={!!active || pending} className="instruction-input" maxLength={1600} />
              <div className="field-foot"><span>На английском языке · до 1 600 символов</span><span>{instruction.length}/1600</span></div>
              <div className="provider-section">
                <div className="provider-title"><span>Голосовой провайдер</span><small>Проверяется на сервере</small></div>
                <div className="provider-options">
                  {(["openai"] as VoiceProvider[]).map((name) => {
                    const item = snapshot?.providers[name];
                    const source = name === "openai"
                      ? item?.source === "builtin" ? `${item.model} · ${item.voice}${!item.ready && item.reason ? ` · ${item.reason}` : ""}` : "Встроенный голос"
                      : item?.source === "linked_existing" ? "Связанный голос" : item?.source === "sample_clone" ? "Клон из образца" : "Недоступен";
                    return <button key={name} type="button" onClick={() => { setProvider(name); setPaidConsent(false); }} disabled={!!active || pending || !item?.ready} className={`provider-option ${provider === name ? "selected" : ""} ${!item?.ready ? "unavailable" : ""}`}>
                      <span className="provider-radio">{provider === name && <Check size={12} />}</span>
                      <span className="provider-label"><b>OpenAI · GPT-Live 1</b><small>{source}</small></span>
                      <span className={`provider-ready ${item?.ready ? "ready" : ""}`}>{item?.ready ? name === "openai" ? "ДОСТУПЕН" : "ГОТОВ" : "НЕТ"}</span>
                    </button>;
                  })}
                </div>
                {snapshot?.providers.openai?.reason && <p className="provider-disclaimer">OpenAI доступность: {snapshot.providers.openai.reason}</p>}
                {provider === "openai" && <p className="provider-disclaimer">Marin — встроенный голос OpenAI, не клон. Микрофон → TalkHint → GPT-Live 1; обработка gpt-6.1-sol. Та же голосовая ветка, что у телефонного Secretary, но без набора номера и без ElevenLabs/Cartesia.</p>}
                {provider === "openai" && <p className="provider-disclaimer">Экспериментальный Dev-режим. Доступность модели не означает проверку полного разговора на вашем iPhone. При блокировке звука или соединения появится ошибка; другой провайдер автоматически не включается.</p>}
                {provider !== "openai" && snapshot?.providers[provider]?.source === "linked_existing" && <p className="provider-disclaimer">Связанный голосовой ID не подтверждает, что провайдер использует именно клон Secretary.</p>}
                <label className={`consent-row ${!providerReady ? "muted" : ""}`}><input type="checkbox" checked={paidConsent} onChange={(event) => setPaidConsent(event.target.checked)} disabled={!!active || pending || !providerReady} /><span>Я понимаю, что разговор может использовать платные услуги AI и генерации голоса.</span></label>
              </div>
              <div className="start-row">
                {!active ? <Button className="start-button" onClick={() => void beginSession()} disabled={pending || !providerReady || !paidConsent || !instruction.trim() || !!loadError}>
                  {pending ? <><LoaderCircle className="spin" size={17} /> Подключение…</> : <><Radio size={17} /> Начать разговор</>}
                </Button> : <Button className="stop-button" onClick={() => void stopServer(true)}><CircleStop size={17} /> Остановить</Button>}
                {active && <span className="runtime"><i /> {elapsedLabel} / 05:00</span>}
                {!active && <span className="limit-copy">Лимит сессии · {snapshot?.limits.durationSeconds ?? 300} сек.</span>}
              </div>
              {pending && <p className="pending-hint">Сначала браузер запросит микрофон и включит аудио. До успешного разрешения сессия на сервере не создаётся.</p>}
            </CardContent>
          </Card>

          <Card className="conversation-card">
            <CardHeader className="card-heading"><div><p className="eyebrow">02 / ТРАНСКРИПТ</p><CardTitle>Разговор</CardTitle></div><Badge variant="outline" className={`connection-badge ${socketConnected ? "connected" : ""}`}><Wifi size={13} />{socketConnected ? "СОЕДИНЕНО" : "НЕТ СОЕДИНЕНИЯ"}</Badge></CardHeader>
            <CardContent>
              <div className="conversation-state">
                <div className={`voice-orb ${liveState}`}><AudioLines size={24} /></div>
                <div><b>{stateLabel(liveState)}</b><small>{active ? "Микрофон → TalkHint → GPT-Live 1. Телефонного набора нет." : "Транскрипт появится после подключения"}</small></div>
              </div>
              <div className="transcript-list" aria-live="polite">
                {(active?.turns ?? visibleReport?.turns ?? []).length === 0 ? <div className="transcript-empty"><span>ОЖИДАНИЕ ПЕРВОЙ РЕПЛИКИ</span><p>Здесь появятся реальные реплики разговора. Аудио не записывается.</p></div> :
                  (active?.turns ?? visibleReport?.turns ?? []).map((turn) => <TranscriptTurn key={turn.id} turn={turn} />)}
              </div>
              {active && <div className="live-tools">
                <Button variant="outline" size="sm" disabled={playingHold} onClick={() => {
                  const next = !micPausedRef.current;
                  micPausedRef.current = next;
                  if (next) { micQueueRef.current.clear(); micCarryRef.current = new Uint8Array(0); }
                   rtcRef.current?.setMicPaused(next);
                  setMicPaused(next);
                }}><MicOff size={14} /> {micPaused ? "Включить микрофон" : "Тишина микрофона"}</Button>
                <div className="hold-controls"><Headphones size={15} /><span>Тест музыки ожидания</span><select value={holdDuration} onChange={(event) => setHoldDuration(Number(event.target.value))} disabled={playingHold}><option value={15}>15 сек.</option><option value={60}>60 сек.</option><option value={180}>180 сек.</option></select>
                  {!playingHold ? <Button variant="outline" size="sm" onClick={() => void sendHoldMusic()}><Volume2 size={14} /> Воспроизвести</Button> : <Button variant="outline" size="sm" onClick={stopHold}><CircleStop size={14} /> Стоп</Button>}
                </div>
              </div>}
              <div className="fixture-area"><div className="fixture-title"><span>Текстовые тест-фразы</span><small>Произнесите вслух; в разговор отправляется только голос</small></div>
                <div className="fixture-chips">{SUGGESTIONS.map((phrase) => <button key={phrase} onClick={() => playFixtureText(phrase)} disabled={!active}>{phrase}<span>↗</span></button>)}</div>
              </div>
              <div className="safety-foot"><Mic size={14} /><span>Микрофон — только в текущей сессии. Для проверки звука рекомендуются наушники, чтобы избежать обратной связи.</span></div>
            </CardContent>
          </Card>
        </div>

        <aside className="lab-aside">
          <Card className="telemetry-card">
            <CardHeader className="card-heading"><div><p className="eyebrow">03 / СИГНАЛ</p><CardTitle>Фактические метрики</CardTitle></div></CardHeader>
            <CardContent>
              <div className="metric"><span>Реплики собеседника</span><b>{(active ?? visibleReport)?.metrics.guestTurns ?? 0}</b></div>
              <div className="metric"><span>Реплики секретаря</span><b>{(active ?? visibleReport)?.metrics.secretaryTurns ?? 0}</b></div>
              <div className="metric"><span>Первое аудио · планирование</span><b>{formatMs((active ?? visibleReport)?.metrics.firstAudioMs)}</b></div>
              <div className="metric"><span>Реплика → аудио, если измерено</span><b>{formatMs((active ?? visibleReport)?.metrics.lastTurnToAudioMs)}</b></div>
               <div className="model-note"><span>ФАКТИЧЕСКАЯ МОДЕЛЬ</span><b>{(active ?? visibleReport)?.model ?? (provider === "openai" ? snapshot?.providers.openai?.model : snapshot?.models.realtime) ?? "—"}</b><span>ГОЛОС / ТРАНСПОРТ</span><b>{(active ?? visibleReport)?.voice ?? (provider === "openai" ? snapshot?.providers.openai?.voice : "—")} · {(active ?? visibleReport)?.transport ?? (provider === "openai" ? "webrtc" : "—")}</b><span>РЕЧЬ · STT</span><b>{snapshot?.models.stt ?? "—"}</b></div>
            </CardContent>
          </Card>

          <Card className="fixture-card">
            <CardHeader className="card-heading"><div><p className="eyebrow">04 / ГРАНИЦЫ ТЕСТА</p><CardTitle>Важно знать</CardTitle></div></CardHeader>
            <CardContent><ul className="caveat-list">
              <li><b>Не звонок.</b> Здесь нет Twilio PSTN, набора номера или внешней телефонной линии.</li>
              <li><b>Не оператор.</b> Синтетическая музыка ожидания не означает подключение к реальной линии.</li>
              <li><b>Не подтверждение маршрута.</b> Тест не доказывает транспорт вызова до оператора.</li>
              <li><b>Без записи.</b> Аудио не сохраняется. Текстовые отчёты хранятся в памяти сервера до {snapshot?.limits.historyMinutes ?? 60} минут.</li>
            </ul></CardContent>
          </Card>

          <Card className="history-card">
            <CardHeader className="card-heading"><div><p className="eyebrow">05 / ПАМЯТЬ</p><CardTitle>Недавние сессии</CardTitle></div><button className="icon-button" aria-label="Обновить историю" onClick={() => void reload()}><RefreshCw size={15} /></button></CardHeader>
            <CardContent>
              {loading && !snapshot ? <div className="history-skeleton"><div /><div /><div /></div> :
                history.length === 0 ? <div className="history-empty">История пока пуста.<small>Завершённые сессии появятся здесь на срок до часа.</small></div> :
                 <div className="history-list">{history.slice(0, 8).map((item) => <button key={item.id} className={`history-item ${visibleReport?.id === item.id ? "current" : ""}`} onClick={() => { setReport(item); setActive(null); setRating(""); }}>
                   <span className={`history-dot ${item.status}`} /><span className="history-detail"><b>{item.voiceProvider === "elevenlabs" ? "ElevenLabs" : item.voiceProvider === "cartesia" ? "Cartesia" : "OpenAI · WebRTC"} · {item.metrics.guestTurns + item.metrics.secretaryTurns} реплик</b><small>{formatLabTime(item.createdAt)} · {item.instruction}</small></span><span className="history-arrow">→</span>
                </button>)}</div>}
               {visibleReport && <div className="report-actions">
                 <div className="report-title"><b>Отчёт выбран · {visibleReport.model ?? visibleReport.voiceProvider}</b><span>{visibleReport.voice ?? "голос не указан"} · {visibleReport.transport ?? "транспорт не указан"} · {labEndReasonLabel(visibleReport.reason)}</span></div>
                 <div className="report-instruction"><b>Инструкция сессии</b><p>{visibleReport.instruction}</p></div>
                <Button variant="outline" size="sm" onClick={() => downloadReport({ ...visibleReport, rating: rating || undefined })}><ArrowDownToLine size={14} /> JSON</Button>
                <label className="rating-label">Оценка секретаря <select value={rating} onChange={(event) => setRating(event.target.value)}><option value="">Не оценено</option><option>Убедительно</option><option>Нужна доработка</option><option>Не справился</option></select><small>Локальная заметка — не отправляется на сервер</small></label>
                 {!active && <Button className="new-session" onClick={() => { setReport(null); setPaidConsent(false); setError(""); }}><Mic size={15} /> Новая сессия</Button>}
              </div>}
            </CardContent>
          </Card>
        </aside>
      </div>
      }
      <footer className="lab-footer"><span>SECRETARY LAB · PRIVATE SANDBOX</span><span>REAL AUDIO · NO RECORDING · NO TELEPHONE</span></footer>
    </main>
  </div>;
}

function stateLabel(state: LiveState) {
  if (state === "connecting") return "Подключаемся";
  if (state === "listening") return "Секретарь слушает";
  if (state === "thinking") return "Секретарь отвечает";
  if (state === "speaking") return "Секретарь говорит";
  if (state === "ended") return "Сессия завершена";
  return "Ожидание разговора";
}

function TranscriptTurn({ turn }: { turn: LabTurn }) {
  return <div className={`transcript-turn ${turn.role}`}><span className="turn-role">{turn.role === "guest" ? "СОБЕСЕДНИК" : "СЕКРЕТАРЬ"}<small> · {new Date(turn.atMs).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}{turn.interrupted ? " · ПРЕРВАНО" : ""}</small></span><p>{turn.text}</p>{turn.translation && <small className="translation">{turn.translation}</small>}</div>;
}
