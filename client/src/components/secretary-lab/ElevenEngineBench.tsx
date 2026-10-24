import { useCallback, useEffect, useRef, useState } from "react";
import { Conversation, type VoiceConversation } from "@elevenlabs/client";
import { AlertCircle, AudioLines, Check, CircleStop, Headphones, LoaderCircle, Mic, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatLabTime, labRequest } from "@/lib/secretary-lab";
import { elevenEngineApi } from "@/lib/secretary-lab-modes";
import { elapsedClientMs, elevenProxySocketUrl, isElevenReportEnded } from "./eleven-engine-helpers";
import type { ElevenEngineReadiness } from "./stand-readiness";
import { elevenProfiles, type ElevenProfileId, type ElevenTiming } from "../../../../shared/elevenLabProfiles";
import ElevenPerformance from "./ElevenPerformance";
import EngineFixtures from "./EngineFixtures";
import "./eleven-engine.css";

type Turn = { id?: string; role?: string; text?: string; atMs?: number; [key: string]: unknown };
type EngineReport = {
  id: string; savedComparisonId?: string; voiceChoice?: "clone" | "catalog";
  status: string; model?: string; voice?: string; ttsModel?: string; instruction?: string;
  profileId?: string; configuration?: unknown; timings?: ElevenTiming[];
  createdAt?: string; endedAt?: string; turns?: Turn[]; events?: Array<Record<string, unknown>>;
  observations?: Array<Record<string, unknown>>; metrics?: Record<string, unknown>;
  engine?: { provider?: string; model?: string; testOnly?: boolean; context?: Record<string, unknown>;
    actions?: Array<{ id: string; name: string; args?: unknown; result?: unknown; status?: string }>;
    events?: Array<Record<string, unknown>>; [key: string]: unknown };
  [key: string]: unknown;
};
type Evaluation = { audibility: number | null; naturalness: number | null; note: string; device: string };
type BenchState = "idle" | "permission" | "admitting" | "starting" | "live" | "stopping" | "uncertain";
const API = elevenEngineApi;
const ended = (report: EngineReport) => isElevenReportEnded(report.status);
const errText = (cause: unknown) => cause instanceof Error ? cause.message : "Не удалось выполнить запрос.";

export default function ElevenEngineBench({ token, instruction, onInstructionChange, onActiveChange }: {
  token: string; instruction: string; onInstructionChange: (value: string) => void; onActiveChange: (active: boolean) => void;
}) {
  const [config, setConfig] = useState<ElevenEngineReadiness | null>(null);
  const [loadError, setLoadError] = useState("");
  const [state, setState] = useState<BenchState>("idle");
  const [voice, setVoice] = useState<"clone" | "catalog">("catalog");
  const [profileId, setProfileId] = useState<ElevenProfileId>("baseline");
  const [scenarioLanguage, setScenarioLanguage] = useState<"ru" | "en" | "es">("ru");
  const [consent, setConsent] = useState(false);
  const [report, setReport] = useState<EngineReport | null>(null);
  const [selected, setSelected] = useState<EngineReport | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [device, setDevice] = useState("Не определено");
  const [audibility, setAudibility] = useState("");
  const [naturalness, setNaturalness] = useState("");
  const [evaluationNote, setEvaluationNote] = useState("");
  const [savingEvaluation, setSavingEvaluation] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [savedId, setSavedId] = useState("");
  const [refreshingReport, setRefreshingReport] = useState(false);
  const reportRef = useRef<EngineReport | null>(null);
  const sessionRef = useRef<VoiceConversation | null>(null);
  const mountedRef = useRef(false);
  const epochRef = useRef(0);
  const lockRef = useRef(false);
  const stoppingRef = useRef(false);
  const requestIdRef = useRef<string | null>(null);
  const admittedIdRef = useRef<string | null>(null);
  const startedAtRef = useRef(0);
  const lastPlaybackRef = useRef(false);
  const recoveredSessionRef = useRef("");
  const callbackRef = useRef(onActiveChange);
  callbackRef.current = onActiveChange;
  const isBusy = state !== "idle";

  const markBusy = useCallback((busy: boolean) => callbackRef.current(busy), []);
  const acceptReport = useCallback((next: EngineReport) => {
    if (!mountedRef.current) return;
    reportRef.current = next;
    setReport(next);
    setSelected(null);
    setSessionId(next.id);
    setSavedId(String(next.savedComparisonId || ""));
    if (ended(next) && typeof next.reason === "string" && next.reason) {
      setError(next.reason);
    }
  }, []);
  const refreshReadiness = useCallback(async () => {
    setLoadError("");
    try {
      const result = await labRequest<ElevenEngineReadiness>(API, token);
      if (mountedRef.current) setConfig(result);
    } catch (cause) {
      if (mountedRef.current) setLoadError(errText(cause));
    }
  }, [token]);

  useEffect(() => {
    mountedRef.current = true;
    void refreshReadiness();
    return () => {
      mountedRef.current = false;
      epochRef.current++;
      const current = reportRef.current;
      const session = sessionRef.current;
      if (session) void session.endSession().catch(() => undefined);
      if (current && !ended(current)) {
        void labRequest<{ report: EngineReport }>(`${API}/sessions/${encodeURIComponent(current.id)}`, token, { method: "DELETE", body: JSON.stringify({}) }).catch(() => undefined);
      }
      sessionRef.current = null;
    };
  }, [refreshReadiness, token]);

  const sendTelemetry = useCallback((type: "playback_started" | "playback_stopped" | "error", detail?: string, eventId?: number) => {
    const id = admittedIdRef.current;
    if (!id || !token) return;
    void labRequest(`${API}/sessions/${encodeURIComponent(id)}/telemetry`, token, {
      method: "POST", body: JSON.stringify({ type, atMs: elapsedClientMs(startedAtRef.current, performance.now()),
        ...(Number.isInteger(eventId) ? { eventId } : {}),
        ...(detail ? { detail: detail.slice(0, 500) } : {}) }),
    }).catch(() => undefined);
  }, [token]);

  const getReport = useCallback(async (id: string) => {
    const result = await labRequest<{ report: EngineReport }>(`${API}/sessions/${encodeURIComponent(id)}`, token);
    acceptReport(result.report);
    if (ended(result.report)) {
      stoppingRef.current = true;
      await sessionRef.current?.endSession().catch(() => undefined);
      sessionRef.current = null;
      stoppingRef.current = false;
      admittedIdRef.current = null;
      requestIdRef.current = null;
      setState("idle");
      markBusy(false);
    }
    return result.report;
  }, [acceptReport, markBusy, token]);

  useEffect(() => {
    const pendingRecord = config?.history?.find((item) => !isElevenReportEnded(item.status));
    if (!pendingRecord || recoveredSessionRef.current === pendingRecord.id) return;
    recoveredSessionRef.current = pendingRecord.id;
    const recovered = pendingRecord as EngineReport;
    reportRef.current = recovered;
    setReport(recovered);
    setSessionId(recovered.id);
    setSavedId(String(recovered.savedComparisonId || ""));
    admittedIdRef.current = recovered.id;
    setState("uncertain");
    setError("Найдена незавершённая серверная сессия. Микрофон не возобновлён; подтвердите остановку перед сменой стенда.");
    markBusy(true);
    void getReport(recovered.id).catch(() => undefined);
  }, [config?.history, getReport, markBusy]);

  useEffect(() => {
    if (!sessionId || (state !== "live" && state !== "starting" && state !== "uncertain")) return;
    const id = sessionId;
    const timer = window.setInterval(() => {
      void getReport(id).catch(() => undefined);
    }, 1600);
    return () => window.clearInterval(timer);
  }, [getReport, sessionId, state]);

  const stopSession = useCallback(async (cancelAttempt = false) => {
    if (stoppingRef.current) return;
    if (cancelAttempt) epochRef.current++;
    const current = reportRef.current;
    const sdk = sessionRef.current;
    setError("");
    if (!current) {
      if (state === "permission" || state === "starting") {
        setState("idle");
        markBusy(false);
      } else if (state === "admitting") {
        setState("uncertain");
        setError("Запрос создания уже отправлен. Ожидайте его подтверждения; повторная сессия заблокирована.");
      }
      return;
    }
    setState("stopping");
    markBusy(true);
    stoppingRef.current = true;
    const sdkEnd = sdk ? sdk.endSession().catch((cause) => { throw new Error(`SDK не подтвердил остановку: ${errText(cause)}`); }) : Promise.resolve();
    const serverEnd = labRequest<{ report: EngineReport }>(`${API}/sessions/${encodeURIComponent(current.id)}`, token, {
      method: "DELETE", body: JSON.stringify({}),
    });
    const [sdkResult, serverResult] = await Promise.allSettled([sdkEnd, serverEnd]);
    if (!mountedRef.current) return;
    if (serverResult.status === "fulfilled") {
      acceptReport(serverResult.value.report);
      if (ended(serverResult.value.report)) {
        sessionRef.current = null;
        admittedIdRef.current = null;
        requestIdRef.current = null;
        setState("idle");
        markBusy(false);
        setNotice("Сервер подтвердил остановку. Проверка поведения завершена.");
        stoppingRef.current = false;
        return;
      }
    }
    setState("uncertain");
    markBusy(true);
    stoppingRef.current = false;
    setError([
      sdkResult.status === "rejected" ? errText(sdkResult.reason) : "",
      serverResult.status === "rejected" ? errText(serverResult.reason) : "Сервер пока не подтвердил завершение.",
    ].filter(Boolean).join(" "));
  }, [acceptReport, markBusy, state, token]);

  const start = async (retry = false) => {
    const voiceReady = voice === "clone" ? config?.voices.clone.ready : config?.voices.catalog.ready;
    if (!config?.ready || !voiceReady || !token || instruction.trim().length < 8 || !consent || lockRef.current || (isBusy && !retry)) return;
    lockRef.current = true;
    const epoch = ++epochRef.current;
    const current = () => mountedRef.current && epochRef.current === epoch;
    setError(""); setNotice(""); setState("permission"); markBusy(true);
    let preflight: MediaStream | null = null;
    let createAttempted = false;
    let createdId: string | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Микрофон недоступен в этом браузере.");
      preflight = await navigator.mediaDevices.getUserMedia({ audio: true });
      const track = preflight.getAudioTracks()[0];
      const settings = track?.getSettings();
      const selectedDevice = settings?.deviceId
        ? (await navigator.mediaDevices.enumerateDevices()).find((item) => item.deviceId === settings.deviceId)?.label
        : "";
      if (current()) setDevice(selectedDevice || "Микрофон браузера · устройство не сообщено");
      preflight.getTracks().forEach((item) => item.stop());
      preflight = null;
      if (!current()) return;
      if (!requestIdRef.current || !retry) requestIdRef.current = crypto.randomUUID();
      setState("admitting");
      createAttempted = true;
      const created = await labRequest<{ id: string; websocketPath: string; report: EngineReport; savedComparisonId?: string; voiceChoice?: "clone" | "catalog"; ttsModel?: string }>(`${API}/sessions`, token, {
        method: "POST",
        body: JSON.stringify({ instruction: instruction.trim(), voice, consent: true, profileId, clientRequestId: requestIdRef.current }),
      });
      createdId = created.id;
      admittedIdRef.current = created.id;
      if (!current()) {
        try {
          await labRequest(`${API}/sessions/${encodeURIComponent(created.id)}`, token, { method: "DELETE", body: JSON.stringify({}) });
          admittedIdRef.current = null;
          if (mountedRef.current) { setState("idle"); markBusy(false); }
        } catch {
          if (mountedRef.current) { setState("uncertain"); markBusy(true); setError("Созданная сессия не была подтверждённо остановлена. Смена стенда заблокирована."); }
        }
        return;
      }
      acceptReport({
        ...created.report,
        savedComparisonId: created.report.savedComparisonId || created.savedComparisonId || created.id,
        voiceChoice: created.report.voiceChoice || created.voiceChoice || voice,
        ttsModel: created.report.ttsModel || created.ttsModel || config.ttsModel,
      });
      setState("starting");
      startedAtRef.current = performance.now();
      lastPlaybackRef.current = false;
      const conversation = await Conversation.startSession({
        signedUrl: elevenProxySocketUrl(created.websocketPath, window.location.origin),
        connectionType: "websocket",
        textOnly: false,
        onConnect: () => { if (current()) { setState("live"); setNotice("Подключено через серверный WebSocket-прокси."); } },
        onStatusChange: ({ status }) => {
          if (!current()) return;
          if (status === "connected") setState("live");
          if (status === "disconnected" && !stoppingRef.current && reportRef.current && !ended(reportRef.current)) void stopSession();
        },
        onModeChange: ({ mode }) => {
          if (!current()) return;
          const speaking = mode === "speaking";
          if (speaking && !lastPlaybackRef.current) sendTelemetry("playback_started");
          if (!speaking && lastPlaybackRef.current) sendTelemetry("playback_stopped");
          lastPlaybackRef.current = speaking;
        },
        onAudioAlignmentPlayback: (alignment) => {
          if (current() && !lastPlaybackRef.current) {
            lastPlaybackRef.current = true;
            const info = alignment as { event_id?: unknown; eventId?: unknown };
            const eventId = typeof info?.event_id === "number" ? info.event_id : info?.eventId;
            sendTelemetry("playback_started", undefined, typeof eventId === "number" && Number.isInteger(eventId) ? eventId : undefined);
          }
        },
        onInterruption: (interruption) => {
          if (!current()) return;
          const previous = reportRef.current;
          if (!previous) return;
          const next = { ...previous, events: [...(previous.events || []), { type: "sdk_interruption", ...interruption }] };
          reportRef.current = next;
          setReport(next);
        },
        onMessage: ({ message, role, event_id }) => {
          if (!current()) return;
          const prev = reportRef.current;
          if (!prev) return;
          const turns = [...(prev.turns || []), { id: String(event_id), role: role === "agent" ? "secretary" : "guest", text: message, atMs: Math.round(performance.now() - startedAtRef.current) }];
          const next = { ...prev, turns, metrics: {
            ...(prev.metrics || {}),
            guestTurns: turns.filter((turn) => turn.role === "guest").length,
            secretaryTurns: turns.filter((turn) => turn.role === "secretary").length,
          } };
          reportRef.current = next;
          setReport(next);
        },
        onError: (message) => {
          if (!current()) return;
          sendTelemetry("error", message);
          setError(`ElevenLabs SDK: ${message}`);
        },
        onDisconnect: (details) => {
          if (current() && details.reason === "error") {
            sendTelemetry("error", "SDK connection closed unexpectedly");
            setError("ElevenLabs: аудиосоединение неожиданно закрыто. Причина и этап подключения сохраняются в отчёте.");
          }
        },
      });
      if (!current()) {
        await conversation.endSession().catch(() => undefined);
        try {
          const endedReport = await labRequest<{ report: EngineReport }>(`${API}/sessions/${encodeURIComponent(created.id)}`, token, { method: "DELETE", body: JSON.stringify({}) });
          if (mountedRef.current && ended(endedReport.report)) { admittedIdRef.current = null; setState("idle"); markBusy(false); }
        } catch {
          if (mountedRef.current) { setState("uncertain"); markBusy(true); setError("Поздний запуск SDK отменён, но серверную остановку подтвердить не удалось."); }
        }
        return;
      }
      sessionRef.current = conversation;
      setState("live");
      setNotice("Сессия работает. После остановки проверьте сохранённый снимок отчёта.");
    } catch (cause) {
      preflight?.getTracks().forEach((track) => track.stop());
      if (!mountedRef.current) return;
      setError(errText(cause));
      sendTelemetry("error", errText(cause));
      if (createdId) {
        try {
          const result = await labRequest<{ report: EngineReport }>(`${API}/sessions/${encodeURIComponent(createdId)}`, token, { method: "DELETE", body: JSON.stringify({}) });
          if (result.report.reason) setError(`Не удалось запустить ElevenLabs: ${result.report.reason}`);
          acceptReport(result.report);
          if (ended(result.report)) {
            admittedIdRef.current = null; requestIdRef.current = null; setState("idle"); markBusy(false);
          } else { setState("uncertain"); markBusy(true); }
        } catch {
          setState("uncertain"); markBusy(true);
          setError((old) => `${old} Серверную остановку не удалось подтвердить; новый запуск заблокирован.`);
        }
      } else if (createAttempted) {
        setState("uncertain"); markBusy(true);
        setError((old) => `${old} Ответ создания не подтверждён. Повтор доступен только с тем же clientRequestId.`);
      } else {
        setState("idle"); markBusy(false);
      }
    } finally {
      preflight?.getTracks().forEach((track) => track.stop());
      lockRef.current = false;
    }
  };

  const readReport = async (id: string) => {
    setRefreshingReport(true); setError("");
    try { await getReport(id); }
    catch (cause) { setError(errText(cause)); }
    finally { setRefreshingReport(false); }
  };
  const saveEvaluation = async () => {
    const current = reportRef.current ?? selected;
    if (!current) return;
    setSavingEvaluation(true); setError("");
    try {
      const result = await labRequest<{ report: EngineReport }>(`${API}/sessions/${encodeURIComponent(current.id)}/evaluation`, token, {
        method: "POST",
        body: JSON.stringify({
          audibility: audibility ? Number(audibility) : null,
          naturalness: naturalness ? Number(naturalness) : null,
          note: evaluationNote.trim(), device,
        }),
      });
      acceptReport(result.report);
      setNotice("Оценка сохранена отдельно от Engine-трассы.");
    } catch (cause) { setError(errText(cause)); }
    finally { setSavingEvaluation(false); }
  };
  const downloadReport = () => {
    if (!current) return;
    const file = new Blob([JSON.stringify(current, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `eleven-report-${current.id}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };
  const current = report ?? selected;
  const history = config?.history ?? [];
  const voiceStatus = voice === "clone" ? config?.voices.clone : config?.voices.catalog;
  const scenarios = {
    ru: [
      "Проверьте отдельно: попросите записать вас на вторник после обеда. Сделайте паузу, затем назовите обращение и номер телефона.",
      "Продиктуйте номер по цифрам, попросите повторить его и исправьте одну цифру. Затем перебейте ответ секретаря и внесите короткую коррекцию.",
      "Сценарий TEST save/replay: попросите сохранить тестовую запись, дождитесь подтверждения, затем попросите повторить её. Убедитесь, что повтор не создаёт дубликат.",
    ],
    en: [
      "Test separately: ask for an appointment Tuesday afternoon. Pause, then give a form of address and a phone number.",
      "Speak the number digit by digit, ask for it back, then correct one digit. Interrupt the reply and make one short correction.",
      "TEST save/replay: ask to save a test appointment, wait for confirmation, then ask to replay it. Check that replay does not create a duplicate.",
    ],
    es: [
      "Prueba por separado: pide una cita para el martes por la tarde. Haz una pausa y después indica el tratamiento y un número de teléfono.",
      "Dicta el número cifra por cifra, pide que lo repita y corrige una cifra. Interrumpe la respuesta y haz una corrección breve.",
      "Prueba TEST guardar/reproducir: pide guardar una cita de prueba, espera la confirmación y luego pide reproducirla. Comprueba que no se cree un duplicado.",
    ],
  } as const;

  return <section className="eleven-bench" aria-label="ElevenLabs plus TalkHint Engine test bench">
    <header className="eleven-heading">
      <div><p className="eleven-eyebrow">ELEVENLABS + TALKHINT ENGINE / PRIVATE WEB</p><h2>ElevenLabs + Engine</h2><p>Та же инструкция и test fixture. ElevenLabs — только транспорт голоса; reasoning остаётся у TalkHint Engine.</p></div>
      <span className={`eleven-state ${state === "live" ? "is-live" : ""}`}><i />{state === "live" ? "CONNECTED" : state === "idle" ? config?.ready ? "READY CHECKED" : "NOT READY" : state.toUpperCase()}</span>
    </header>
    {(loadError || error) && <div className="eleven-alert" role="alert"><AlertCircle size={16} /><span>{error || loadError}</span>{loadError && <Button size="sm" variant="outline" onClick={() => void refreshReadiness()}><RefreshCw size={14} /> Retry</Button>}</div>}
    {notice && <div className="eleven-notice"><Check size={15} />{notice}</div>}
    <div className="eleven-columns">
      <div className="eleven-main">
        <article className="eleven-panel">
          <div className="eleven-panel-title"><span>01 / СЕССИЯ</span><b>Фиксированная конфигурация</b></div>
          <label className="eleven-label" htmlFor="eleven-instruction">Общая инструкция секретарю</label>
          <Textarea id="eleven-instruction" value={instruction} onChange={(event) => onInstructionChange(event.target.value)} disabled={isBusy} maxLength={1600} className="eleven-instruction" />
          <div className="eleven-meta-line"><span>Общая инструкция для всех стендов · 1 600 символов</span><span>{instruction.length}/1600</span></div>
          <div className="eleven-voice-choice">
            {([
              ["catalog", "Sarah", "Каталожный голос · женский, американский английский", config?.voices.catalog],
              ["clone", "Мой клонированный голос", "Только при отдельной готовности и доступном voiceId", config?.voices.clone],
            ] as const).map(([value, title, detail, readiness]) => <label key={value} className={`eleven-voice ${voice === value ? "selected" : ""} ${!readiness?.ready ? "unavailable" : ""}`}>
              <input type="radio" name="eleven-voice" value={value} checked={voice === value} disabled={isBusy || !readiness?.ready} onChange={() => setVoice(value)} />
              <span className="eleven-radio" /><span><b>{title}</b><small>{detail}</small>{readiness?.reason && <small className="eleven-reason">{readiness.reason}</small>}</span>
              <em>{readiness?.ready ? "READY" : "NOT READY"}</em>
            </label>)}
          </div>
          <div className="eleven-profile-wrap">
            <div className="eleven-profile-head">
              <div><b>Профиль эксперимента ElevenLabs</b><small>Влияет только на эту ElevenLabs-пробу. Выбор фиксируется в серверном отчёте; другие стенды не затрагиваются.</small></div>
              {profileId === "optimized" && <span className="eleven-profile-badge">Эксперимент</span>}
              {profileId === "eager" && <span className="eleven-profile-badge">Не подтверждён</span>}
            </div>
            <select aria-label="Профиль latency-эксперимента" value={profileId} disabled={isBusy} onChange={(event) => setProfileId(event.target.value as ElevenProfileId)}>
              {Object.entries(elevenProfiles).map(([id, profile]) => <option key={id} value={id}>{profile.label}{id === "eager" ? " · отдельный, не проверен" : id === "optimized" ? " · эксперимент" : ""}</option>)}
            </select>
            <div className="eleven-profile-details">
              TTS: {elevenProfiles[profileId].ttsModel} · основной язык провайдера: {elevenProfiles[profileId].initialLanguage} · turn eagerness: {elevenProfiles[profileId].turnEagerness} · reasoning: {elevenProfiles[profileId].reasoning} · brief: {elevenProfiles[profileId].brief ? "да" : "нет"} · checkpoint: {elevenProfiles[profileId].checkpoint}
            </div>
            {elevenProfiles[profileId].initialLanguage === "ru" && <p className="eleven-experiment-note">ElevenLabs отклоняет Flash v2.5 при основном языке EN. Здесь основной язык провайдера RU, голос по-прежнему Sarah. Engine следует языку собеседника; это не полностью изолированная замена TTS. Английский, русский, испанский и переключения требуют отдельной проверки.</p>}
            {profileId === "optimized" && <p className="eleven-experiment-note">Экспериментальная комбинация, не рекомендованный или подтверждённый пресет.</p>}
          </div>
          <div className="eleven-facts">
            <div><small>REASONING MODEL</small><b>{config?.model || "—"}</b></div>
            <div><small>TTS</small><b>{config?.ttsModel || "—"}</b></div>
            <div><small>ASR</small><b>{config?.asr || "—"}</b></div>
            <div><small>VOICE ID · READINESS ONLY</small><b>{voiceStatus?.voiceId || "Не сообщён"}</b></div>
            <div><small>SERVER READINESS</small><b>{config ? config.ready ? "Ready" : config.reason || "Not ready" : "Проверяется"}</b></div>
            <div><small>TEST SCOPE</small><b>{config?.settings ? "Настройки доступны" : "Серверный отчёт"}</b></div>
          </div>
          <label className="eleven-consent"><input type="checkbox" checked={consent} disabled={isBusy} onChange={(event) => setConsent(event.target.checked)} /><span>Я выбираю ElevenLabs для этой пробы и явно соглашаюсь на хранение текстового отчёта, инструкции, оценки и Engine-трассы в общем репозитории сравнений на 30 дней. Аудио и секреты не отправляются на сохранение.</span></label>
          <div className="eleven-actions">
            {state === "idle" ? <Button className="eleven-start" disabled={!config?.ready || !voiceStatus?.ready || !consent || instruction.trim().length < 8} onClick={() => void start()}><Mic size={15} /> Начать пробу</Button> :
              state === "uncertain" && !admittedIdRef.current ? <Button variant="outline" onClick={() => void start(true)}><RefreshCw size={14} /> Повторить тот же запрос</Button> :
              <Button className="eleven-stop" onClick={() => void stopSession(state === "permission" || state === "admitting" || state === "starting")}><CircleStop size={15} /> {state === "permission" || state === "admitting" ? "Отменить создание" : state === "starting" ? "Отменить / остановить" : state === "uncertain" ? "Повторить остановку" : "Остановить сессию"}</Button>}
          </div>
          <p className="eleven-safety"><ShieldCheck size={15} /> Путь WebSocket — одноразовый серверный прокси с cancellation/control, не provider signed URL. Секреты провайдера браузеру не передаются.</p>
          <p className="eleven-caveat">Playback в браузерном SDK не равен акустической слышимости. Серверные и браузерные часы разделены; их значения не вычитаются друг из друга.</p>
          <div className="eleven-profile-wrap">
            <div className="eleven-panel-title"><span>ИЗОЛИРОВАННЫЙ СЦЕНАРИЙ</span><b>Одна инструкция, разные прогоны</b></div>
            <div className="eleven-scenario-languages" aria-label="Язык инструкций сценария">
              {(["ru", "en", "es"] as const).map((language) => <button key={language} type="button" aria-pressed={scenarioLanguage === language} onClick={() => setScenarioLanguage(language)}>{language.toUpperCase()}</button>)}
            </div>
            <div className="eleven-scenario-copy">{scenarios[scenarioLanguage].map((line) => <p key={line}>{line}</p>)}</div>
            <p className="eleven-experiment-note">Используйте одну и ту же fixture и одинаковые инструкции отдельно для каждого профиля. Не объединяйте прогоны; вручную отмечайте перебивания и проверяйте TEST save/replay на отсутствие дублей. Эти инструкции не создают и не имитируют результаты.</p>
          </div>
        </article>
        <article className="eleven-panel">
          <div className="eleven-panel-title"><span>03 / ОТЧЁТ И ОЦЕНКА</span><b>Отдельный человеческий сигнал</b></div>
          {current ? <>
            <div className="eleven-report-id"><span>SESSION ID <b>{current.id}</b></span><span>SAVED COMPARISON ID <b>{current.savedComparisonId || savedId || "Не сообщён"}</b></span><a href="#saved-comparisons">Открыть архив сравнений ↓</a></div>
            <div className="eleven-report-facts"><span>Статус <b>{current.status}</b></span><span>Голос <b>{current.voice || current.voiceChoice || "Не сообщён"}</b></span><span>Модель <b>{current.engine?.model || current.model || "Не сообщена"}</b></span><span>Test-only <b>{current.engine?.testOnly === undefined ? "Не сообщено" : current.engine.testOnly ? "Да" : "Нет"}</b></span></div>
             <ElevenPerformance profileId={current.profileId} configuration={current.configuration} timings={current.timings} />
             <div className="eleven-report-actions">
               <Button type="button" variant="outline" onClick={downloadReport}>Скачать JSON</Button>
             </div>
            <label className="eleven-label" htmlFor="eleven-audibility">Слышимость · 1–5</label>
            <div className="eleven-evaluation">
              <label>Слышимость<select id="eleven-audibility" value={audibility} disabled={savingEvaluation || isBusy} onChange={(event) => setAudibility(event.target.value)}><option value="">Не оценено</option>{[1,2,3,4,5].map((n) => <option key={n}>{n}</option>)}</select></label>
              <label>Естественность · 1–5<select value={naturalness} disabled={savingEvaluation || isBusy} onChange={(event) => setNaturalness(event.target.value)}><option value="">Не оценено</option>{[1,2,3,4,5].map((n) => <option key={n}>{n}</option>)}</select></label>
            </div>
            <label className="eleven-label" htmlFor="eleven-eval-note">Заметка о прослушивании</label>
            <textarea id="eleven-eval-note" value={evaluationNote} maxLength={2000} disabled={savingEvaluation || isBusy} onChange={(event) => setEvaluationNote(event.target.value)} placeholder="Что было слышно, естественно или требовало проверки?" />
            <div className="eleven-device"><Headphones size={14} /> Устройство: {device} · оценка сохраняется отдельно от автоматических метрик.</div>
            <Button variant="outline" disabled={savingEvaluation || isBusy} onClick={() => void saveEvaluation()}>{savingEvaluation ? "Сохраняем…" : "Сохранить оценку"}</Button>
            <div className="eleven-trace"><b>Test-only actions / результаты из отчёта</b>{current.engine?.actions?.length ? current.engine.actions.map((action, index) => <pre key={`${action.id}-${index}`}>{action.name} · {action.status || "статус не сообщён"}{"\n"}args: {JSON.stringify(action.args ?? null)}{"\n"}result: {JSON.stringify(action.result ?? null)}</pre>) : <p>В отчёте нет test-only действий или сервер их не сообщил.</p>}<b>Контекст и события</b><pre>{JSON.stringify({ context: current.engine?.context, events: current.engine?.events || current.events }, null, 2)}</pre></div>
            {!!current.turns?.length && <div className="eleven-transcript">{current.turns.map((turn, index) => <div key={turn.id || index} className={turn.role === "secretary" || turn.role === "agent" ? "agent" : ""}><small>{turn.role || "РЕПЛИКА"} · {typeof turn.atMs === "number" ? `${Math.round(turn.atMs / 1000)}с` : "время не сообщено"}</small><p>{turn.text || "Текст не сообщён"}</p></div>)}</div>}
          </> : <div className="eleven-empty"><AudioLines size={23} /><p>Отчёт появится после первой сессии. Обновление и чтение истории не возобновляют микрофон.</p></div>}
        </article>
      </div>
      <aside className="eleven-panel eleven-history">
        <div className="eleven-panel-title"><span>04 / READ-ONLY</span><b>Сессии и read-back</b><button aria-label="Обновить readiness и историю" onClick={() => void refreshReadiness()}><RefreshCw size={14} /></button></div>
        <p>История показывает отчёты; читать отчёт не значит подключать звук или микрофон.</p>
        {config?.context && <details className="eleven-readiness-context"><summary>Общий Engine context / settings</summary><pre>{JSON.stringify({ context: config.context, settings: config.settings }, null, 2)}</pre></details>}
        {config ? <div className="eleven-history-list">{history.length ? history.map((item) => <button key={item.id} disabled={isBusy || refreshingReport} className={current?.id === item.id ? "current" : ""} onClick={() => { setSelected(item as EngineReport); setReport(null); reportRef.current = null; setSessionId(item.id); setSavedId(String(item.savedComparisonId || "")); void readReport(item.id); }}>
          <span className="eleven-history-dot" /><span><b>{String(item.voice || item.voiceChoice || "ElevenLabs")} · {item.status}</b><small>{item.createdAt ? formatLabTime(item.createdAt) : "Дата не сообщена"} · {item.id}</small></span><span>→</span>
        </button>) : <div className="eleven-empty">Сессий пока нет.</div>}</div> : <div className="eleven-skeleton"><i /><i /><i /></div>}
        {current && <Button className="eleven-readback" variant="outline" disabled={refreshingReport || isBusy} onClick={() => void readReport(sessionId || current.id)}>{refreshingReport ? <><LoaderCircle size={14} /> Читаем…</> : <><RefreshCw size={14} /> Прочитать с сервера</>}</Button>}
        <a href="#saved-comparisons">Архив сохранённых сравнений</a>
      </aside>
    </div>
  </section>;
}
