import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Headphones, Mic, MicOff, RefreshCw, Square, Volume2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createIncomingSecretaryWorkletSource, decodePcmu, floatToPcm16, encodePcmu } from "@/lib/incoming-secretary-audio";
import { acquireAndReserveLiveSession, clearScheduledAudio, closeLocalResources, ResponseAudioGuard, playbackTotals } from "@/lib/incoming-secretary-dev-lifecycle";

type Turn = { role: "caller" | "secretary"; text: string; language?: string };
type TestRequest = {
  id: string; numberId: string; status: string; fields?: Record<string, unknown>; missing?: string[];
  devModel?:string;devVoice?:string;devBackend?:string|null;
  turns?: Turn[]; outcome?: string; updatedAt: string; callSid?: string; notificationStatus?: string;
};
type NotificationHealth = {
  certificateConfigured: boolean; keyConfigured: boolean; credentialsUsable: boolean; issues: string[];
  activeAlertDevices: number; deviceEnvironments: string[]; bundleIds: string[]; deliveryTested: false;
};
type SessionResponse = { sessionId: string; capability: string; requestId: string; model: string; voice: string; backend?:string|null;cardTitles: string[]; testOnly: true };
type RecoverableSession = { sessionId: string; requestId: string };
type BenchInfo = { requests: TestRequest[]; notifications: NotificationHealth; model: string; voice: string; models?:Array<{id:string;voice:string;backend:string|null;label:string}>;testOnly: true; activeSession?: RecoverableSession | null };
type BenchStatus = "idle" | "requesting" | "connecting" | "ready" | "stopping" | "error";
type Props = { token: string; numberId: string };

const statusCopy: Record<BenchStatus, string> = {
  idle: "Ожидает запуска", requesting: "Запрашиваем микрофон", connecting: "Соединяемся с runtime",
  ready: "Микрофон и Secretary подключены", stopping: "Завершаем тест", error: "Тест остановлен с ошибкой",
};

function safeErrorText(message: string, token?: string | null, capability?: string) {
  let safe = message;
  if (token) safe = safe.split(token).join("[redacted]");
  if (capability) safe = safe.split(capability).join("[redacted]");
  return safe
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(capability|access[_ -]?token|api[_ -]?key|secret)\s*[:=]\s*["']?[^,\s"']+/gi, "$1=[redacted]");
}

async function readError(response: Response, fallback: string, token?: string | null, capability?: string) {
  try {
    const body = await response.json();
    return typeof body.error === "string" && body.error.trim() ? safeErrorText(body.error, token, capability) : fallback;
  } catch { return fallback; }
}

async function readErrorBody(response: Response, fallback: string, token: string) {
  try {
    const body = await response.json();
    return {
      error: typeof body.error === "string" ? safeErrorText(body.error, token) : fallback,
      sessionId: typeof body.sessionId === "string" ? body.sessionId : "",
      requestId: typeof body.requestId === "string" ? body.requestId : "",
    };
  } catch { return { error: fallback, sessionId: "", requestId: "" }; }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const stride = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += stride) {
    const end = Math.min(offset + stride, bytes.length);
    for (let index = offset; index < end; index += 1) binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function base64ToBytes(encoded: string) {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function IncomingSecretaryDevBench({ token, numberId }: Props) {
  const [status, setStatus] = useState<BenchStatus>("idle");
  const [error, setError] = useState("");
  const [notice,setNotice]=useState("");
  const [interruptions,setInterruptions]=useState(0);
  const [info, setInfo] = useState<BenchInfo | null>(null);
  const [currentRequest, setCurrentRequest] = useState<TestRequest | null>(null);
  const [model, setModel] = useState("");
  const [selectedModel,setSelectedModel]=useState("gpt-live-1");
  const [backend,setBackend]=useState("");
  const [voice, setVoice] = useState("");
  const [cardTitles, setCardTitles] = useState<string[]>([]);
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [reloadBusy, setReloadBusy] = useState(false);
  const [recoverableSession, setRecoverableSession] = useState<RecoverableSession | null>(null);
  const recoverableSessionRef = useRef<RecoverableSession | null>(null);
  const activeSessionRef = useRef<RecoverableSession | null>(null);
  activeSessionRef.current = info?.activeSession || null;
  const epochRef = useRef(0);
  const startLockRef = useRef(false);
  const sessionRef = useRef<SessionResponse | RecoverableSession | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const muteRef = useRef<GainNode | null>(null);
  const playbackRef = useRef<Array<{ source: AudioBufferSourceNode; responseId: string; startsAt: number; duration: number }>>([]);
  const audioGuardRef = useRef(new ResponseAudioGuard());
  const progressTimerRef = useRef<number | null>(null);
  const progressSentRef = useRef(new Map<string, number>());
  const completedPlaybackRef = useRef(new Map<string, number>());
  const statusRef = useRef(status);
  statusRef.current = status;
  const rememberRecoverableSession = useCallback((value: RecoverableSession | null) => {
    recoverableSessionRef.current = value;
    setRecoverableSession(value);
  }, []);

  const loadHistory = useCallback(async (alive: () => boolean = () => true) => {
    const response = await fetch("/api/incoming-secretary/dev", { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(await readError(response, "Не удалось загрузить историю тестов.", token));
    const data = await response.json() as BenchInfo;
    if (alive()) setInfo(data);
    return data;
  }, [token]);

  const closeAudio = useCallback(() => {
    if (progressTimerRef.current !== null) window.clearInterval(progressTimerRef.current);
    progressTimerRef.current = null;
    playbackRef.current.forEach(({ source }) => { try { source.stop(); } catch {} });
    playbackRef.current = [];
    workletRef.current?.port.close();
    workletRef.current?.disconnect();
    sourceRef.current?.disconnect();
    muteRef.current?.disconnect();
    sourceRef.current = null;
    workletRef.current = null;
    muteRef.current = null;
    const socket = socketRef.current;
    socketRef.current = null;
    const context = contextRef.current;
    contextRef.current = null;
    closeLocalResources(streamRef.current, socket, context);
    streamRef.current = null;
    audioGuardRef.current.reset();
  }, []);

  const stopSession = useCallback(async (silent = false) => {
    const oldSession = sessionRef.current;
    const recovered = recoverableSessionRef.current || activeSessionRef.current;
    const sessionId = oldSession?.sessionId || recovered?.sessionId || "";
    const requestId = oldSession?.requestId || recovered?.requestId || "";
    sessionRef.current = null;
    epochRef.current += 1;
    startLockRef.current = false;
    const socket = socketRef.current;
    if (socket) {
      try { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "stop" })); } catch {}
    }
    closeAudio();
    if (sessionId) rememberRecoverableSession({ sessionId, requestId });
    if (!silent) setStatus("idle");
    if (sessionId) {
      try {
        const response = await fetch(`/api/incoming-secretary/dev/sessions/${encodeURIComponent(sessionId)}/stop`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: "{}",
        });
        if (!response.ok && !silent) setError(await readError(response, "Сервер не подтвердил завершение теста.", token, oldSession && "capability" in oldSession ? oldSession.capability : undefined));
        if (response.ok) {
          if (recoverableSessionRef.current?.sessionId === sessionId) rememberRecoverableSession(null);
          if (activeSessionRef.current?.sessionId === sessionId) activeSessionRef.current = null;
          setInfo((previous) => previous ? { ...previous, activeSession: previous.activeSession?.sessionId === sessionId ? null : previous.activeSession } : previous);
        }
      } catch {
        if (!silent) setError("Микрофон остановлен локально, но сервер не подтвердил завершение. Эту зарезервированную сессию можно остановить повторно.");
      }
      if (!silent) {
        void loadHistory().catch((reason) => {
          setError((previous) => `${previous ? `${previous} ` : ""}Историю не удалось обновить: ${reason instanceof Error ? safeErrorText(reason.message, token) : "ошибка загрузки."}`);
        });
      }
    }
  }, [closeAudio, loadHistory, rememberRecoverableSession, token]);

  useEffect(() => {
    let mounted = true;
    void loadHistory(() => mounted).catch((reason) => { if (mounted) setError(reason instanceof Error ? reason.message : "Не удалось загрузить историю тестов."); });
    return () => { mounted = false; void stopSession(true); };
  }, [loadHistory, stopSession]);

  useEffect(() => {
    const onPageHide = () => { void stopSession(true); };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [stopSession]);

  const currentNumberIdRef = useRef(numberId);
  useEffect(() => {
    const previousNumberId = currentNumberIdRef.current;
    const changed = currentNumberIdRef.current !== numberId;
    currentNumberIdRef.current = numberId;
    if (changed && previousNumberId && (
      statusRef.current === "requesting" || statusRef.current === "connecting" || statusRef.current === "ready" ||
      sessionRef.current || recoverableSessionRef.current || activeSessionRef.current
    )) {
      void stopSession(true);
    }
  }, [numberId, stopSession]);

  const start = useCallback(async () => {
    if (startLockRef.current || !numberId || statusRef.current === "requesting" || statusRef.current === "connecting" || statusRef.current === "ready") return;
    startLockRef.current = true;
    const epoch = ++epochRef.current;
    setError("");
    setNotice("");
    setInterruptions(0);completedPlaybackRef.current.clear();progressSentRef.current.clear();
    setCurrentRequest(null);
    setTranscript([]);
    setCardTitles([]);
    setModel("");
    setVoice("");
    setStatus("requesting");
    let acquired: MediaStream | null = null;
    let createdSession: SessionResponse | null = null;
    let startedContext: AudioContext | null = null;
    try {
      if (!window.isSecureContext) throw new Error("Для доступа к микрофону требуется HTTPS или localhost.");
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Этот браузер не предоставляет доступ к микрофону.");
      if (!("AudioContext" in window)) throw new Error("Этот браузер не поддерживает аудиоконтекст для live-теста.");
      startedContext = new AudioContext();
      contextRef.current = startedContext;
      const resumeResult = startedContext.resume().then(() => null, (reason: unknown) => reason instanceof Error ? reason : new Error("Не удалось запустить аудиоустройство браузера."));
      const resumeError = await resumeResult;
      if (epochRef.current !== epoch) return;
      if (resumeError) throw resumeError;
      const setup = await acquireAndReserveLiveSession<MediaStream, SessionResponse>({
        getMedia: () => navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false,
        }),
        reserve: async () => {
          const response = await fetch("/api/incoming-secretary/dev/sessions", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ numberId,model:selectedModel }),
          });
          if (!response.ok) {
            const details = await readErrorBody(response, "Сервер не смог зарезервировать тестовую заявку.", token);
            if (details.sessionId) {
              rememberRecoverableSession({ sessionId: details.sessionId, requestId: details.requestId });
              void loadHistory().catch((reason) => setError(`Не удалось обновить историю после конфликта: ${reason instanceof Error ? safeErrorText(reason.message, token) : "ошибка загрузки."}`));
            }
            throw new Error(details.error);
          }
          return await response.json() as SessionResponse;
        },
        isCurrent: () => epochRef.current === epoch,
        onStream: (stream) => { acquired = stream; streamRef.current = stream; },
        onSession: (session) => { createdSession = session; },
        stopReserved: async (session) => {
          rememberRecoverableSession({ sessionId: session.sessionId, requestId: session.requestId });
          try {
            const response = await fetch(`/api/incoming-secretary/dev/sessions/${encodeURIComponent(session.sessionId)}/stop`, {
              method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: "{}",
            });
            if (response.ok) {
              if (recoverableSessionRef.current?.sessionId === session.sessionId) rememberRecoverableSession(null);
            } else {
              setError(await readError(response, "Сессия создана после отмены; сервер не подтвердил её остановку.", token, session.capability));
            }
          } catch {
            setError("Сессия создана после отмены; сервер не подтвердил её остановку. Её можно завершить вручную.");
          }
        },
      });
      if (!setup) return;
      acquired = setup.stream;
      createdSession = setup.session;
      sessionRef.current = createdSession;
      rememberRecoverableSession(null);
      activeSessionRef.current = { sessionId: createdSession.sessionId, requestId: createdSession.requestId };
      setInfo((previous) => previous ? { ...previous, activeSession: { sessionId: createdSession!.sessionId, requestId: createdSession!.requestId } } : previous);
      setCurrentRequest({ id: createdSession.requestId, numberId, status: "test_session_reserved", updatedAt: new Date().toISOString(), fields: {}, missing: [], turns: [], outcome: "TEST · awaiting live session" });
      setModel(createdSession.model);
      setBackend(createdSession.backend||"");
      setVoice(createdSession.voice);
      setCardTitles(createdSession.cardTitles);
      setStatus("connecting");
      const context = startedContext;
      const blobUrl = URL.createObjectURL(new Blob([createIncomingSecretaryWorkletSource()], { type: "text/javascript" }));
      try { await context.audioWorklet.addModule(blobUrl); } finally { URL.revokeObjectURL(blobUrl); }
      if (epochRef.current !== epoch) return;
      const source = context.createMediaStreamSource(acquired);
      const worklet = new AudioWorkletNode(context, "talkhint-secretary-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const mute = context.createGain();
      mute.gain.value = 0;
      source.connect(worklet).connect(mute).connect(context.destination);
      sourceRef.current = source;
      workletRef.current = worklet;
      muteRef.current = mute;

      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${wsProtocol}//${window.location.host}/incoming-secretary-dev-stream`);
      socketRef.current = socket;
      socket.onopen = () => {
        if (epochRef.current !== epoch || socketRef.current !== socket) return;
        socket.send(JSON.stringify({ type: "connect", sessionId: createdSession!.sessionId, capability: createdSession!.capability }));
      };
      socket.onmessage = (event) => {
        if (epochRef.current !== epoch || socketRef.current !== socket) return;
        let message: Record<string, unknown>;
        try { message = JSON.parse(String(event.data)); } catch { setError("Сервер прислал некорректное сообщение."); return; }
        if (message.type === "ready") {
          setBackend(String(message.backend||""));
          setModel(String(message.model || createdSession!.model));
          setVoice(String(message.voice || createdSession!.voice));
          setStatus("ready");
          worklet.port.onmessage = (captureEvent: MessageEvent<Float32Array>) => {
            if (epochRef.current !== epoch || socket.readyState !== WebSocket.OPEN) return;
            const floats = captureEvent.data;
            const pcm16 = floatToPcm16(floats);
            const encoded = bytesToBase64(encodePcmu(pcm16));
            socket.send(JSON.stringify({ type: "audio", audio: encoded }));
          };
          if (progressTimerRef.current !== null) window.clearInterval(progressTimerRef.current);
          progressTimerRef.current = window.setInterval(() => {
            if (socket.readyState !== WebSocket.OPEN) return;
            const now = context.currentTime;
            const playedByResponse = playbackTotals(playbackRef.current,completedPlaybackRef.current,now);
            playedByResponse.forEach((totalSeconds, responseId) => {
              if (!audioGuardRef.current.isCurrent(responseId)) return;
              const cappedMs = Math.floor(totalSeconds * 1000);
              const previous = progressSentRef.current.get(responseId) || 0;
              if (cappedMs > previous) {
                progressSentRef.current.set(responseId, cappedMs);
                socket.send(JSON.stringify({ type: "playback", responseId, playedMs: cappedMs }));
              }
            });
          }, 250);
        } else if (message.type === "audio") {
          const responseId = String(message.responseId || "");
          if (!audioGuardRef.current.accept(responseId) || typeof message.audio !== "string") return;
          try {
            const pcm = decodePcmu(base64ToBytes(message.audio));
            const buffer = context.createBuffer(1, pcm.length, 8000);
            const channel = buffer.getChannelData(0);
            for (let index = 0; index < pcm.length; index += 1) channel[index] = pcm[index] / 32768;
            const player = context.createBufferSource();
            player.buffer = buffer;
            player.connect(context.destination);
            const lastScheduled = playbackRef.current[playbackRef.current.length - 1];
            const startsAt = Math.max(context.currentTime + 0.025, lastScheduled ? lastScheduled.startsAt + lastScheduled.duration : context.currentTime + 0.025);
            // Realtime may generate a normal turn much faster than playback.
            // Interruption clears this whole queue immediately, independently.
            if (startsAt + buffer.duration - context.currentTime > 60) {
              player.disconnect();
              setError("Secretary прислал больше аудио, чем ограниченная очередь может безопасно буферизовать. Фрагмент пропущен; остановите и запустите тест заново.");
              return;
            }
            const entry = { source: player, responseId, startsAt, duration: buffer.duration };
            playbackRef.current.push(entry);
            player.onended = () => {
              if(epochRef.current===epoch&&playbackRef.current.includes(entry)){
                const played=Math.max(0,Math.min(entry.duration,context.currentTime-entry.startsAt));
                completedPlaybackRef.current.set(responseId,(completedPlaybackRef.current.get(responseId)||0)+played);
              }
              playbackRef.current = playbackRef.current.filter((item) => item.source !== player);
            };
            player.start(startsAt);
          } catch { setError("Получен некорректный аудиофрагмент от Secretary."); }
        } else if (message.type === "clear") {
          if(playbackRef.current.length)setInterruptions(count=>count+1);
          const responseId = String(message.responseId || "");
          clearScheduledAudio(playbackRef.current, audioGuardRef.current, responseId || undefined);
        } else if(message.type==="notice"){
          setNotice(safeErrorText(String(message.message||"Уточнение данных. Тест продолжается."),token,createdSession?.capability));
        } else if (message.type === "request" || message.type === "transcript") {
          if(message.type==="request")setNotice("");
          const request = message.request as TestRequest;
          if (request) {
            setCurrentRequest(request);
            if (Array.isArray(request.turns)) setTranscript(request.turns);
          }
        } else if (message.type === "error") {
          const code=String(message.code||"");
          setError(safeErrorText(String(message.error || "Сессия вернула неизвестную ошибку."), token, createdSession?.capability)
            +(/^[a-z0-9_:]{1,100}$/i.test(code)?` [${code}]`:""));
          void stopSession(true);
          setStatus("error");
        } else if (message.type === "ended") {
          const request = message.request as TestRequest | undefined;
          if (request) { setCurrentRequest(request); setTranscript(request.turns || []); }
          const endError = message.error ? safeErrorText(String(message.error), token, createdSession?.capability) : "";
          if (endError) setError(endError);
          setStatus(endError ? "error" : "idle");
          sessionRef.current = null;
          startLockRef.current = false;
          closeAudio();
          socketRef.current = null;
          try { socket.close(); } catch {}
          void loadHistory().then((history) => {
            const saved = history.requests.find((item) => item.id === createdSession!.requestId);
            if (saved) {
              setCurrentRequest(saved);
              setTranscript(saved.turns || []);
              if (!endError) setStatus("idle");
            } else {
              if (request) { setCurrentRequest(request); setTranscript(request.turns || []); }
              setStatus("error");
              setError((previous) => `${previous ? `${previous} ` : ""}Сессия завершилась, но TEST-заявка не найдена в истории. Сохранение не подтверждено.`);
            }
          }).catch((reason) => {
            setStatus("error");
            setError((previous) => `${previous ? `${previous} ` : ""}Не удалось подтвердить сохранение TEST-заявки: ${reason instanceof Error ? safeErrorText(reason.message, token) : "ошибка загрузки."}`);
          });
        }
      };
      socket.onerror = () => {
        if (epochRef.current === epoch) {
          setError("Не удалось подключиться к потоку теста. Проверьте соединение и повторите вручную.");
          void stopSession(true);
          setStatus("error");
        }
      };
      socket.onclose = (event) => {
        if (epochRef.current === epoch && sessionRef.current) {
          setError(`Канал браузера со стендом закрылся до завершения теста. Код: ${event.code}.`);
          void stopSession(true);
          setStatus("error");
        }
      };
    } catch (reason) {
      const isCurrentAttempt = epochRef.current === epoch;
      const failureMessage = reason instanceof Error ? safeErrorText(reason.message, token, createdSession?.capability) : "Не удалось запустить live microphone test.";
      if (isCurrentAttempt) {
        closeAudio();
        startLockRef.current = false;
        setError(failureMessage);
        setStatus("error");
      }
      if (createdSession && epochRef.current === epoch) {
        rememberRecoverableSession({ sessionId: createdSession.sessionId, requestId: createdSession.requestId });
        const closeResponse = await fetch(`/api/incoming-secretary/dev/sessions/${encodeURIComponent(createdSession.sessionId)}/stop`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: "{}",
        }).catch(() => undefined);
        if (closeResponse?.ok) {
          if (recoverableSessionRef.current?.sessionId === createdSession.sessionId) rememberRecoverableSession(null);
          if (activeSessionRef.current?.sessionId === createdSession.sessionId) activeSessionRef.current = null;
        }
        else setError((previous) => `${previous} The server has not confirmed closing this TEST session; it can be stopped again.`);
      }
      if (epochRef.current === epoch) {
        void loadHistory().catch((historyError) => {
          setError((previous) => `${previous} Не удалось проверить активную/сохранённую сессию: ${historyError instanceof Error ? safeErrorText(historyError.message, token) : "ошибка загрузки."}`);
        });
      } else {
        acquired?.getTracks().forEach((track) => track.stop());
        if (startedContext && startedContext.state !== "closed") void startedContext.close().catch(() => undefined);
      }
    }
  }, [closeAudio, loadHistory, numberId, selectedModel,rememberRecoverableSession, stopSession, token]);

  async function reload() {
    setReloadBusy(true);
    setError("");
    try { await loadHistory(); } catch (reason) { setError(reason instanceof Error ? safeErrorText(reason.message, token) : "Не удалось обновить историю."); }
    finally { setReloadBusy(false); }
  }

  const health = info?.notifications;
  const statusTone = status === "ready" ? "border-[#426e61] bg-[#183a32] text-[#c4e7d6]" :
    status === "error" ? "border-rose-800 bg-rose-950/40 text-rose-200" : "border-[#425b5e] bg-[#14272b] text-[#c4d4cf]";
  const fields = currentRequest?.fields || {};
  const pendingSession = recoverableSession || info?.activeSession || null;
  const sessionIsLive = status === "ready" || status === "connecting" || status === "requesting";

  return (
    <section className="space-y-5" aria-label="Live microphone test">
      <div className="flex flex-col justify-between gap-3 border-b border-[#2d4145] pb-3 sm:flex-row sm:items-end">
        <div><p className="text-xs uppercase tracking-[0.17em] text-amber-200">Live bench / development only</p><h2 className="mt-1 text-2xl font-semibold">Сначала услышать. Потом решать.</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[#a9bbb7]">Это реальный микрофон и реальный входящий Secretary runtime — не текстовая симуляция. Сессия резервирует TEST-заявку; телефонные вызовы, календарь и уведомления не запускаются.</p>
          <p aria-live="polite" className="mt-2 text-sm text-teal-100">Перебиваний со сбросом озвучки: {interruptions}</p></div>
        {notice&&<p role="status" className="text-sm text-amber-100">{notice}</p>}
        <Badge variant="outline" className="w-fit border-amber-700 bg-[#302b20] text-amber-100">TEST · DEV</Badge>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.08fr_0.92fr]">
        <Card className="border-[#425a5b] bg-[#17282d] text-[#e8efec]">
          <CardHeader>
            <div className="flex items-center gap-2 text-teal-200"><Mic className="h-4 w-4" /><p className="text-xs uppercase tracking-[0.15em]">Incoming line listening bench</p></div>
            <CardTitle className="text-xl">Проверка живого голоса</CardTitle>
            <CardDescription className="text-[#a9bbb7]">Используется выбранный номер и сохранённые сервером права/настройки. Несохранённые изменения формы не применяются.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-[#3b5557] bg-[#122328] p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[#9db2ad]">Выбранный номер ID</span><code className="break-all text-teal-100">{numberId || "Номер не выбран"}</code></div>
              <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${statusTone}`} role="status" aria-live="polite">{statusCopy[status]}</div>
              {model && <div className="mt-3 grid gap-2 sm:grid-cols-2"><p><span className="text-xs text-[#91a8a2]">Модель из runtime</span><span className="block font-mono text-sm text-[#dce9e4]">{model}</span></p><p><span className="text-xs text-[#91a8a2]">Голос из runtime</span><span className="block font-mono text-sm text-[#dce9e4]">{voice}</span></p></div>}
              <label className="mt-3 block text-sm text-[#c4d8d1]">Вариант разговора
                <select value={selectedModel} disabled={sessionIsLive||status==="stopping"} onChange={e=>setSelectedModel(e.target.value)}
                  className="mt-2 block w-full rounded-lg border border-[#526c68] bg-[#14292a] p-3 text-white">
                  {(info?.models||[{id:"gpt-live-1",label:"GPT‑Live 1 · естественный диалог"},{id:"gpt-realtime-2.1",label:"GPT‑Realtime‑2.1 · прежний вариант"}]).map(option=>
                    <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>
              <p className="mt-2 text-xs text-[#a9bbb7]">{selectedModel==="gpt-live-1"?"GPT‑Live 1 · Marin; заявки обрабатывает gpt-6.1-sol. Только Dev: запись сессии выключена (store:false), телефонного набора нет.":"Прежняя прямая связка Realtime‑2.1 · Marin. Только Dev."}</p>
              {backend&&<p className="mt-2 text-xs text-teal-100">Backend из runtime: {backend}</p>}
              {cardTitles.length > 0 && <p className="mt-3 text-xs leading-5 text-[#b9cbc5]">Используемые карточки: {cardTitles.join(" · ")}</p>}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              {sessionIsLive ?
                <Button onClick={() => void stopSession()} className="bg-[#9b5147] text-white hover:bg-[#b45e52]"><Square className="mr-2 h-4 w-4" />Остановить тест</Button> :
                pendingSession ?
                  <Button onClick={() => void stopSession()} className="bg-[#9b5147] text-white hover:bg-[#b45e52]"><Square className="mr-2 h-4 w-4" />Остановить резервированную TEST-сессию</Button> :
                  <Button onClick={() => void start()} disabled={!numberId || status === "stopping"} className="bg-[#28756a] text-white hover:bg-[#328b7c]"><Mic className="mr-2 h-4 w-4" />Запустить тест</Button>}
              <Button variant="outline" onClick={() => void reload()} disabled={reloadBusy} className="border-[#526c68] text-[#d3e3dd] hover:bg-[#203a39]">{reloadBusy ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Обновить историю</Button>
            </div>
            {pendingSession && !sessionIsLive && <p className="break-all rounded-lg border border-amber-800 bg-[#302b20] p-3 text-xs leading-5 text-amber-100">Сервер сообщил о незавершённой TEST-сессии ({pendingSession.sessionId}). После перезагрузки можно закрыть её без capability из WebSocket.</p>}
            <div className="rounded-xl border border-[#66583d] bg-[#302b20] p-3 text-xs leading-5 text-[#e1d6b8]">
              <p className="flex items-center gap-2 font-semibold"><Headphones className="h-4 w-4" />Рекомендуются наушники</p>
              <p className="mt-1">Включены browser echoCancellation и noiseSuppression, но это не гарантирует устранение акустического эха. Следите за громкостью и не направляйте динамик в микрофон. Ваш микрофонный звук отправляется в тестовый runtime.</p>
              <p className="mt-1 flex items-center gap-2"><Volume2 className="h-3.5 w-3.5" />Голос Secretary воспроизводится локально; микрофонный выход не направляется в динамики.</p>
            </div>
            {error && <div role="alert" className="flex gap-2 rounded-xl border border-rose-900 bg-rose-950/30 p-3 text-sm leading-5 text-rose-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
            {status === "ready" && <p className="flex items-center gap-2 text-xs text-teal-200"><CheckCircle2 className="h-4 w-4" />Живой поток активен. Скажите обычную фразу, чтобы услышать ответ Secretary.</p>}
          </CardContent>
        </Card>
        <Card className="border-[#344b4f] bg-[#17282d] text-[#e8efec]">
          <CardHeader className="border-b border-[#344b4f]"><p className="text-xs uppercase tracking-[0.15em] text-teal-300">Live transcript</p><CardTitle className="text-xl">Реплики текущего TEST</CardTitle><CardDescription className="text-[#a9bbb7]">Текст появляется только из фактических событий runtime.</CardDescription></CardHeader>
          <CardContent className="space-y-3 pt-4">
            {transcript.length ? <div className="max-h-72 space-y-2 overflow-auto">{transcript.map((turn, index) => <div key={`${index}-${turn.role}`} className={`rounded-lg p-3 text-sm leading-5 ${turn.role === "caller" ? "bg-[#203a3b] text-[#e0ece7]" : "ml-5 bg-[#28443b] text-[#e1eee5]"}`}><div className="mb-1 flex justify-between gap-3 text-[10px] uppercase tracking-wider text-[#a7c0b5]"><span>{turn.role === "caller" ? "Caller" : "Secretary"}</span><span>{turn.language || ""}</span></div>{turn.text}</div>)}</div> :
              <div className="rounded-xl border border-dashed border-[#40585c] px-4 py-8 text-center"><MicOff className="mx-auto mb-2 h-5 w-5 text-[#78918a]" /><p className="text-sm text-[#a9bbb7]">Реальных реплик пока нет.</p><p className="mt-1 text-xs text-[#819691]">Запустите тест и говорите в микрофон. Здесь не подставляются демонстрационные аудио или тексты.</p></div>}
            {currentRequest && <div className="border-t border-[#344b4f] pt-3"><Badge variant="outline" className="border-amber-700 text-amber-100">TEST · {currentRequest.status}</Badge>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">{Object.entries(fields).map(([key, value]) => <div key={key} className="min-w-0"><dt className="text-[#829993]">{key}</dt><dd className="break-words text-[#d6e1dd]">{typeof value === "boolean" ? value ? "Да" : "Нет" : String(value ?? "—")}</dd></div>)}
                <div><dt className="text-[#829993]">Missing</dt><dd className="text-[#d6e1dd]">{currentRequest.missing?.join(", ") || "Нет"}</dd></div>
                <div><dt className="text-[#829993]">Outcome</dt><dd className="text-[#d6e1dd]">{currentRequest.outcome || "Ожидает завершения теста"}</dd></div>
              </dl>
            </div>}
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-5 lg:grid-cols-[0.82fr_1.18fr]">
        <Card className="border-[#344b4f] bg-[#17282d] text-[#e8efec]">
          <CardHeader><p className="text-xs uppercase tracking-[0.15em] text-amber-200">Delivery readiness</p><CardTitle className="text-lg">Состояние уведомлений</CardTitle><CardDescription className="text-[#a9bbb7]">Информация сервера; тестовый звонок не отправляет уведомления.</CardDescription></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {health ? <>
              <p>Certificate: {health.certificateConfigured ? "настроен" : "не настроен"} · key: {health.keyConfigured ? "настроен" : "не настроен"}</p>
              <p>Credentials usable: {health.credentialsUsable ? "да" : "нет"} · активных устройств: {health.activeAlertDevices}</p>
              <p className="break-words text-xs text-[#9eb2ae]">Environments: {health.deviceEnvironments.join(", ") || "нет"} · bundle IDs: {health.bundleIds.join(", ") || "нет"}</p>
              {health.issues.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs text-amber-100">{health.issues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul>}
              <p className="text-xs text-[#91a7a1]">Delivery test: {health.deliveryTested ? "tested" : "не выполнялся"}</p>
              <p className="text-xs leading-5 text-[#91a7a1]">Наличие PEM-конфигурации — только базовая проверка. Это не подтверждает принятие APNs и доставку уведомления.</p>
            </> : <div className="h-20 animate-pulse rounded-lg bg-[#21383a]" />}
          </CardContent>
        </Card>
        <Card className="border-[#344b4f] bg-[#17282d] text-[#e8efec]">
          <CardHeader className="border-b border-[#344b4f]"><div className="flex items-center justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.15em] text-amber-200">Persistent test requests</p><CardTitle className="text-lg">История TEST · отдельно от входящих</CardTitle></div><Badge variant="outline" className="border-amber-700 text-amber-100">{info?.requests.length ?? "…"}</Badge></div></CardHeader>
          <CardContent className="space-y-2 pt-4">
            {info?.requests.length ? info.requests.map((request) => <article key={request.id} className="rounded-lg border border-amber-900/70 bg-[#242a27] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><Badge variant="outline" className="border-amber-700 text-amber-100">TEST</Badge><span className="text-xs text-[#93aaa2]">{new Date(request.updatedAt).toLocaleString()}</span></div>
              <p className="mt-2 text-sm font-medium">{request.outcome || request.status}</p>
              <p className="mt-1 text-xs text-[#91a7a1]">ID: {request.id} · номер: {request.numberId} · статус: {request.status}</p>
              <p className="mt-1 text-xs text-teal-100">{request.devModel?`${request.devModel} · ${request.devVoice||"—"}${request.devBackend?` · backend ${request.devBackend}`:""}`:"Модель в старой записи не сохранена"}</p>
              {request.missing?.length ? <p className="mt-1 text-xs text-amber-100">Missing: {request.missing.join(", ")}</p> : null}
              {request.turns?.length ? <div className="mt-2 space-y-1 border-t border-[#3e4a45] pt-2">{request.turns.map((turn, index) => <p key={`${request.id}-${index}`} className="text-xs leading-5 text-[#c3d0ca]"><strong>{turn.role === "caller" ? "Caller" : "Secretary"}:</strong> {turn.text}</p>)}</div> : <p className="mt-2 text-xs text-[#849890]">Transcript пока отсутствует.</p>}
            </article>) : info ? <div className="rounded-xl border border-dashed border-[#40585c] px-4 py-7 text-center text-sm text-[#a9bbb7]">История тестовых заявок пуста.</div> : <div className="h-24 animate-pulse rounded-xl bg-[#21383a]" />}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
